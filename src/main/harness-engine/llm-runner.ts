/**
 * llm-runner.ts — Vercel AI SDK harness runner
 *
 * Executes a single step prompt with model-managed tool calling enabled through
 * AI SDK's step stop condition.
 */
import { anthropic } from '@ai-sdk/anthropic';
import { createOpenAI, openai } from '@ai-sdk/openai';
import { generateText as aiGenerateText, stepCountIs, type LanguageModel, type ToolSet } from 'ai';
import { normalizeUsage } from '../performance-frontier/telemetry/normalize-usage';
import { logProviderHeaders, normalizeProviderHeaders } from '../performance-frontier/telemetry/provider-headers';
import type { LLMStepTelemetryEvent } from '../performance-frontier/telemetry/collector';
import type { PFCognitiveTraceEntry } from '../performance-frontier/types';

const DEFAULT_MODEL_ID = 'openai/gpt-4o-mini';
const DEFAULT_MAX_STEPS = 5;
const DEFAULT_TIMEOUT_MS = 120_000;

export interface LLMStepResult {
  text: string;
  usage: unknown;
  toolCalls: unknown[];
  toolResults: unknown[];
  cognitiveTrace?: PFCognitiveTraceEntry[];
  metrics?: LLMStepTelemetryEvent;
}

export interface RunLLMStepInput {
  systemPrompt: string;
  userPrompt: string;
  tools: ToolSet;
  model?: LanguageModel;
  modelId?: string;
  maxSteps?: number;
  timeoutMs?: number;
  generateText?: (options: Record<string, unknown>) => Promise<{
    text: string;
    usage?: unknown;
    totalUsage?: unknown;
    toolCalls?: unknown[];
    toolResults?: unknown[];
    steps?: unknown[];
    response?: {
      headers?: Record<string, string>;
    };
  }>;
  onTelemetry?: (event: LLMStepTelemetryEvent) => void;
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

export function resolveHarnessModel(modelId = process.env.HELIOX_HARNESS_MODEL ?? DEFAULT_MODEL_ID): LanguageModel {
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

export async function runLLMStep(input: RunLLMStepInput): Promise<LLMStepResult> {
  const generateText = input.generateText ?? aiGenerateText;
  const startedAt = performance.now();

  try {
    const result = await generateText({
      model: input.model ?? resolveHarnessModel(input.modelId),
      system: input.systemPrompt,
      prompt: input.userPrompt,
      tools: input.tools,
      stopWhen: stepCountIs(input.maxSteps ?? DEFAULT_MAX_STEPS),
      maxRetries: 1,
      abortSignal: timeoutSignal(input.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    const providerHeaders = normalizeProviderHeaders(result.response?.headers);
    // AI SDK exposes `usage` as the LAST step only; `totalUsage` aggregates every
    // tool-calling round of a multi-step ReAct loop. Bill the total so we don't
    // undercount the context re-sent on each round (was a ~20x underestimate).
    const aggregatedUsage = result.totalUsage ?? result.usage ?? null;
    const usage = normalizeUsage(aggregatedUsage, providerHeaders);
    const cognitiveTrace = extractCognitiveTraceFromSteps(result.steps);
    const traceToolCallsCount = cognitiveTrace.filter((entry) => entry.type === 'tool_call').length;
    const traceToolResultsCount = cognitiveTrace.filter((entry) => entry.type === 'tool_result').length;
    const metrics: LLMStepTelemetryEvent = {
      modelId: input.modelId,
      ...usage,
      latencyMs: performance.now() - startedAt,
      toolCallsCount: traceToolCallsCount || result.toolCalls?.length || 0,
      toolResultsCount: traceToolResultsCount || result.toolResults?.length || 0,
    };
    logProviderHeaders(providerHeaders, {
      inputTokens: metrics.inputTokens,
      outputTokens: metrics.outputTokens,
      reasoningTokens: metrics.reasoningTokens ?? 0,
      totalTokens: metrics.totalTokens,
    });
    input.onTelemetry?.(metrics);

    return {
      text: result.text,
      usage: aggregatedUsage,
      toolCalls: result.toolCalls ?? [],
      toolResults: result.toolResults ?? [],
      cognitiveTrace,
      metrics,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`LLM step failed: ${message}`);
  }
}
