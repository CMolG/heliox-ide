/**
 * llm-runner.ts — Vercel AI SDK harness runner
 *
 * Executes a single step prompt with model-managed tool calling enabled through
 * AI SDK's step stop condition.
 */
import { anthropic, createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI, openai } from '@ai-sdk/openai';
import { generateText as aiGenerateText, streamText as aiStreamText, stepCountIs, type LanguageModel, type ToolSet } from 'ai';
import { normalizeUsage } from '../performance-frontier/telemetry/normalize-usage';
import { logProviderHeaders, normalizeProviderHeaders } from '../performance-frontier/telemetry/provider-headers';
import type { LLMStepTelemetryEvent } from '../performance-frontier/telemetry/collector';
import type { PFCognitiveTraceEntry } from '../performance-frontier/types';
import type { ConnectionResolver } from '../../types/ipc-events';

const DEFAULT_MODEL_ID = 'openai/gpt-4o-mini';
const DEFAULT_MAX_STEPS = Number(process.env.HELIOX_HARNESS_MAX_STEPS) || 5;
const DEFAULT_TIMEOUT_MS = 120_000;
// Explicit output budget. Reasoning models (e.g. Mimo) otherwise spend the
// provider-default cap on reasoning tokens and emit empty content / zero tool
// calls — the "wrote nothing" stall. A generous floor keeps them productive.
const DEFAULT_MAX_OUTPUT_TOKENS = Number(process.env.HELIOX_HARNESS_MAX_OUTPUT_TOKENS) || 16_000;

export interface LLMStepResult {
  text: string;
  usage: unknown;
  toolCalls: unknown[];
  toolResults: unknown[];
  cognitiveTrace?: PFCognitiveTraceEntry[];
  metrics?: LLMStepTelemetryEvent;
  /** Model the provider actually served (AI SDK response.modelId); e.g. resolves openrouter/auto. */
  respondedModelId?: string;
}

export interface RunLLMStepInput {
  systemPrompt: string;
  userPrompt: string;
  tools: ToolSet;
  model?: LanguageModel;
  modelId?: string;
  /** Injected lookup so a `conn:<connectionId>/<modelId>` modelId can be resolved — see `resolveHarnessModel`. */
  resolveConnection?: ConnectionResolver;
  maxSteps?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  /** Loop-body progress passthrough; not yet wired into telemetry (later phase). */
  iteration?: number;
  totalIterations?: number;
  generateText?: (options: Record<string, unknown>) => Promise<{
    text: string;
    usage?: unknown;
    totalUsage?: unknown;
    toolCalls?: unknown[];
    toolResults?: unknown[];
    steps?: unknown[];
    response?: {
      headers?: Record<string, string>;
      modelId?: string;
    };
  }>;
  onTelemetry?: (event: LLMStepTelemetryEvent) => void;
  onDelta?: (d: { kind: 'reasoning' | 'text' | 'tool'; delta: string }) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringifyTracePayload(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return '';

  if (isRecord(value) && Array.isArray(value.content)) {
    const text = value.content
      .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n');
    if (text.trim()) return text;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function appendThought(trace: PFCognitiveTraceEntry[], text: unknown): void {
  if (typeof text !== 'string') return;
  const content = text.trim();
  if (!content) return;
  trace.push({ type: 'thought', content });
}

function appendToolCall(
  trace: PFCognitiveTraceEntry[],
  part: Record<string, unknown>,
  seenToolCallIds: Set<string>,
): void {
  const toolName = typeof part.toolName === 'string' ? part.toolName : undefined;
  const toolCallId = typeof part.toolCallId === 'string' ? part.toolCallId : undefined;
  if (toolCallId) seenToolCallIds.add(toolCallId);
  trace.push({
    type: 'tool_call',
    ...(toolName ? { toolName } : {}),
    content: stringifyTracePayload(part.input),
  });
}

function appendToolResult(
  trace: PFCognitiveTraceEntry[],
  part: Record<string, unknown>,
  seenToolResultIds: Set<string>,
): void {
  const toolName = typeof part.toolName === 'string' ? part.toolName : undefined;
  const toolCallId = typeof part.toolCallId === 'string' ? part.toolCallId : undefined;
  if (toolCallId) seenToolResultIds.add(toolCallId);
  trace.push({
    type: 'tool_result',
    ...(toolName ? { toolName } : {}),
    content: stringifyTracePayload(part.type === 'tool-error' ? part.error : part.output),
  });
}

export function extractCognitiveTraceFromSteps(steps: unknown[] | undefined): PFCognitiveTraceEntry[] {
  const trace: PFCognitiveTraceEntry[] = [];
  if (!Array.isArray(steps)) return trace;

  for (const rawStep of steps) {
    if (!isRecord(rawStep)) continue;

    const seenToolCallIds = new Set<string>();
    const seenToolResultIds = new Set<string>();
    const content = Array.isArray(rawStep.content) ? rawStep.content : [];

    for (const rawPart of content) {
      if (!isRecord(rawPart)) continue;

      if (rawPart.type === 'text') {
        appendThought(trace, rawPart.text);
      } else if (rawPart.type === 'tool-call') {
        appendToolCall(trace, rawPart, seenToolCallIds);
      } else if (rawPart.type === 'tool-result' || rawPart.type === 'tool-error') {
        appendToolResult(trace, rawPart, seenToolResultIds);
      }
    }

    if (content.length === 0) {
      appendThought(trace, rawStep.text);
    }

    const toolCalls = Array.isArray(rawStep.toolCalls) ? rawStep.toolCalls : [];
    for (const rawCall of toolCalls) {
      if (!isRecord(rawCall)) continue;
      const toolCallId = typeof rawCall.toolCallId === 'string' ? rawCall.toolCallId : undefined;
      if (toolCallId && seenToolCallIds.has(toolCallId)) continue;
      appendToolCall(trace, rawCall, seenToolCallIds);
    }

    const toolResults = Array.isArray(rawStep.toolResults) ? rawStep.toolResults : [];
    for (const rawResult of toolResults) {
      if (!isRecord(rawResult)) continue;
      const toolCallId = typeof rawResult.toolCallId === 'string' ? rawResult.toolCallId : undefined;
      if (toolCallId && seenToolResultIds.has(toolCallId)) continue;
      appendToolResult(trace, rawResult, seenToolResultIds);
    }
  }

  return trace;
}

function timeoutSignal(timeoutMs: number): AbortSignal | undefined {
  if (typeof AbortSignal === 'undefined') return undefined;
  if (typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }

  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

/**
 * Resolve a `conn:<connectionId>/<modelId>` model id against the
 * user-defined connection profiles (Settings → Connections). `resolveConnection`
 * is injected (rather than importing `provider-connections.ts` directly) so
 * this module stays unit-testable in isolation — the ipc/executor boundary
 * (`heliox:start-harness`) is the one place that actually reads the
 * connection-profile store and decrypts a token, once per run, closing over
 * the result in a plain synchronous lookup.
 */
function resolveConnectionModel(modelId: string, resolveConnection: ConnectionResolver | undefined): LanguageModel {
  const rest = modelId.slice('conn:'.length); // '<connectionId>/<modelName...>'
  const slashIdx = rest.indexOf('/');
  const connectionId = slashIdx === -1 ? rest : rest.slice(0, slashIdx);
  const modelName = slashIdx === -1 ? '' : rest.slice(slashIdx + 1);

  const resolved = resolveConnection?.(connectionId);
  if (!resolved) {
    throw new Error(
      `Unknown provider connection "${connectionId}". It may have been deleted — reselect a model in Settings → Connections.`,
    );
  }
  if (!modelName) {
    throw new Error(`Invalid harness model id "${modelId}". Expected "conn:<connectionId>/<modelId>".`);
  }

  if (resolved.protocol === 'anthropic') {
    return createAnthropic({ baseURL: resolved.baseUrl, apiKey: resolved.token })(modelName);
  }
  return createOpenAI({ baseURL: resolved.baseUrl, apiKey: resolved.token })(modelName);
}

export function resolveHarnessModel(
  modelId = process.env.HELIOX_HARNESS_MODEL ?? DEFAULT_MODEL_ID,
  resolveConnection?: ConnectionResolver,
): LanguageModel {
  if (modelId.startsWith('conn:')) return resolveConnectionModel(modelId, resolveConnection);

  const [provider, ...modelParts] = modelId.includes('/') ? modelId.split('/') : ['openai', modelId];
  const modelName = modelParts.join('/');

  if (!modelName) {
    throw new Error(`Invalid harness model id "${modelId}". Expected "provider/model".`);
  }

  if (provider === 'anthropic') return anthropic(modelName);
  if (provider === 'openai') return openai(modelName);

  if (provider === 'openrouter') {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY is required for openrouter harness models.');
    }
    return createOpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      name: 'openrouter',
      // OpenRouter attribution headers — surface Heliox on the OpenRouter
      // dashboard/leaderboards. Both are optional and overridable via env.
      headers: {
        'HTTP-Referer': process.env.OPENROUTER_APP_URL ?? 'https://heliox.dev',
        'X-Title': process.env.OPENROUTER_APP_TITLE ?? 'Heliox Arena',
      },
    })(modelName);
  }

  if (provider === 'mimo' || provider === 'xiaomi-token-plan-ams') {
    const apiKey = process.env.MIMO_API_KEY ?? process.env.AGENT_API_KEY;
    if (!apiKey) {
      throw new Error('MIMO_API_KEY or AGENT_API_KEY is required for Xiaomi Mimo harness models.');
    }
    const provider = createOpenAI({
      apiKey,
      baseURL: 'https://token-plan-ams.xiaomimimo.com/v1',
      name: 'mimo',
    });
    return provider.chat(modelName);
  }

  throw new Error(`Unsupported harness model provider "${provider}". Use openai, anthropic, openrouter, mimo, or xiaomi-token-plan-ams.`);
}

interface RawStepResult {
  text: string;
  usage?: unknown;
  totalUsage?: unknown;
  toolCalls?: unknown[];
  toolResults?: unknown[];
  steps?: unknown[];
  response?: {
    headers?: Record<string, string>;
    modelId?: string;
  };
}

function buildLLMStepResult(
  input: RunLLMStepInput,
  raw: RawStepResult,
  startedAt: number,
): LLMStepResult {
  const providerHeaders = normalizeProviderHeaders(raw.response?.headers);
  // AI SDK exposes `usage` as the LAST step only; `totalUsage` aggregates every
  // tool-calling round of a multi-step ReAct loop. Bill the total so we don't
  // undercount the context re-sent on each round (was a ~20x underestimate).
  const aggregatedUsage = raw.totalUsage ?? raw.usage ?? null;
  const usage = normalizeUsage(aggregatedUsage, providerHeaders);
  const cognitiveTrace = extractCognitiveTraceFromSteps(raw.steps);
  const traceToolCallsCount = cognitiveTrace.filter((entry) => entry.type === 'tool_call').length;
  const traceToolResultsCount = cognitiveTrace.filter((entry) => entry.type === 'tool_result').length;
  const metrics: LLMStepTelemetryEvent = {
    modelId: input.modelId,
    ...usage,
    latencyMs: performance.now() - startedAt,
    toolCallsCount: traceToolCallsCount || (raw.toolCalls?.length ?? 0),
    toolResultsCount: traceToolResultsCount || (raw.toolResults?.length ?? 0),
  };
  logProviderHeaders(providerHeaders, {
    inputTokens: metrics.inputTokens,
    outputTokens: metrics.outputTokens,
    reasoningTokens: metrics.reasoningTokens ?? 0,
    totalTokens: metrics.totalTokens,
  });
  input.onTelemetry?.(metrics);

  return {
    text: raw.text,
    usage: aggregatedUsage,
    toolCalls: raw.toolCalls ?? [],
    toolResults: raw.toolResults ?? [],
    cognitiveTrace,
    metrics,
    respondedModelId: raw.response?.modelId,
  };
}

export async function runLLMStep(input: RunLLMStepInput): Promise<LLMStepResult> {
  const startedAt = performance.now();

  // Use the streaming path only when onDelta is provided AND no generateText override
  // is present. The override is used exclusively by tests to inject a mock, so
  // keeping generateText as the default branch ensures tests remain unaffected.
  const useStreaming = input.onDelta !== undefined && input.generateText === undefined;

  try {
    if (useStreaming) {
      const streamResult = aiStreamText({
        model: input.model ?? resolveHarnessModel(input.modelId, input.resolveConnection),
        system: input.systemPrompt,
        prompt: input.userPrompt,
        tools: input.tools,
        stopWhen: stepCountIs(input.maxSteps ?? DEFAULT_MAX_STEPS),
        maxOutputTokens: input.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        maxRetries: 1,
        abortSignal: timeoutSignal(input.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });

      // Consume the fullStream and forward deltas to onDelta as they arrive.
      for await (const part of streamResult.fullStream) {
        if (part.type === 'text-delta') {
          input.onDelta!({ kind: 'text', delta: part.text });
        } else if (part.type === 'reasoning-delta') {
          input.onDelta!({ kind: 'reasoning', delta: part.text });
        } else if (part.type === 'tool-call') {
          const toolName = (part as { toolName?: string }).toolName ?? '';
          const toolInput = (part as { input?: unknown }).input;
          let brief: string;
          try {
            brief = `${toolName}(${JSON.stringify(toolInput)})`;
          } catch {
            brief = toolName;
          }
          input.onDelta!({ kind: 'tool', delta: brief });
        }
      }

      // After the stream is fully consumed, collect the aggregated result via
      // the PromiseLike properties exposed by StreamTextResult.
      const [text, rawUsage, totalUsage, steps, toolCalls, toolResults, response] = await Promise.all([
        streamResult.text,
        streamResult.usage,
        streamResult.totalUsage,
        streamResult.steps,
        streamResult.toolCalls,
        streamResult.toolResults,
        streamResult.response,
      ]);

      const raw: RawStepResult = {
        text,
        usage: rawUsage,
        totalUsage,
        toolCalls: toolCalls as unknown[],
        toolResults: toolResults as unknown[],
        steps: steps as unknown[],
        response: {
          headers: (response as { headers?: Record<string, string> }).headers,
          modelId: (response as { modelId?: string }).modelId,
        },
      };
      return buildLLMStepResult(input, raw, startedAt);
    }

    // Default path: generateText (used directly by tests via the override).
    const generateText = input.generateText ?? aiGenerateText;
    const result = await generateText({
      model: input.model ?? resolveHarnessModel(input.modelId, input.resolveConnection),
      system: input.systemPrompt,
      prompt: input.userPrompt,
      tools: input.tools,
      stopWhen: stepCountIs(input.maxSteps ?? DEFAULT_MAX_STEPS),
      maxOutputTokens: input.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      maxRetries: 1,
      abortSignal: timeoutSignal(input.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    return buildLLMStepResult(input, result as RawStepResult, startedAt);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`LLM step failed: ${message}`);
  }
}
