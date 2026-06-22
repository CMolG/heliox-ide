/**
 * llm-runner.ts — Vercel AI SDK harness runner
 *
 * Executes a single step prompt with model-managed tool calling enabled through
 * AI SDK's step stop condition.
 */
import { anthropic } from '@ai-sdk/anthropic';
import { createOpenAI, openai } from '@ai-sdk/openai';
import { generateText as aiGenerateText, stepCountIs, type LanguageModel, type ToolSet } from 'ai';

const DEFAULT_MODEL_ID = 'openai/gpt-4o-mini';
const DEFAULT_MAX_STEPS = 5;
const DEFAULT_TIMEOUT_MS = 120_000;

export interface LLMStepResult {
  text: string;
  usage: unknown;
  toolCalls: unknown[];
  toolResults: unknown[];
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
    toolCalls?: unknown[];
    toolResults?: unknown[];
  }>;
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
    })(modelName);
  }

  throw new Error(`Unsupported harness model provider "${provider}". Use openai, anthropic, or openrouter.`);
}

export async function runLLMStep(input: RunLLMStepInput): Promise<LLMStepResult> {
  const generateText = input.generateText ?? aiGenerateText;

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

    return {
      text: result.text,
      usage: result.usage ?? null,
      toolCalls: result.toolCalls ?? [],
      toolResults: result.toolResults ?? [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`LLM step failed: ${message}`);
  }
}
