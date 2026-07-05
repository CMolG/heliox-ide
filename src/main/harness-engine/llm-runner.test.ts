import { describe, expect, it, vi } from 'vitest';
import type { ToolSet } from 'ai';

// ─── @ai-sdk/{openai,anthropic} mocks (for resolveHarnessModel's `conn:` tests
// only — every runLLMStep test below passes `model: {} as any` directly and
// never exercises resolveHarnessModel, so mocking these two modules cannot
// affect them) ────────────────────────────────────────────────────────────
const { openAIModelFactory, anthropicModelFactory, createOpenAIMock, createAnthropicMock } = vi.hoisted(() => {
  const openAIModelFactory = vi.fn((modelName: string) => ({ __sdk: 'openai', modelName }));
  const anthropicModelFactory = vi.fn((modelName: string) => ({ __sdk: 'anthropic', modelName }));
  return {
    openAIModelFactory,
    anthropicModelFactory,
    createOpenAIMock: vi.fn(() => openAIModelFactory),
    createAnthropicMock: vi.fn(() => anthropicModelFactory),
  };
});
vi.mock('@ai-sdk/openai', () => ({
  openai: vi.fn((modelName: string) => ({ __sdk: 'openai-default', modelName })),
  createOpenAI: createOpenAIMock,
}));
vi.mock('@ai-sdk/anthropic', () => ({
  anthropic: vi.fn((modelName: string) => ({ __sdk: 'anthropic-default', modelName })),
  createAnthropic: createAnthropicMock,
}));

import { resolveHarnessModel, runLLMStep } from './llm-runner';

describe('runLLMStep', () => {
  it('calls generateText with system prompt, user prompt, tools, and step limit', async () => {
    const generateText = vi.fn(async () => ({
      text: 'final answer',
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
      toolCalls: [],
      toolResults: [],
    }));
    const tools = { read_file: {} } as unknown as ToolSet;

    const result = await runLLMStep({
      systemPrompt: 'system heuristics',
      userPrompt: 'user task',
      tools,
      model: {} as any,
      generateText,
      maxSteps: 5,
    });

    expect(generateText).toHaveBeenCalledWith(expect.objectContaining({
      system: 'system heuristics',
      prompt: 'user task',
      tools,
      stopWhen: expect.any(Function),
    }));
    expect(result.text).toBe('final answer');
  });

  it('extracts a cognitive trace from AI SDK ReAct steps', async () => {
    const generateText = vi.fn(async () => ({
      text: 'The missing await is on line 8.',
      usage: { promptTokens: 10, completionTokens: 8, totalTokens: 18 },
      toolCalls: [],
      toolResults: [],
      steps: [{
        text: 'I need to inspect the user loader first.',
        content: [
          { type: 'text', text: 'I need to inspect the user loader first.' },
          {
            type: 'tool-call',
            toolCallId: 'tool-1',
            toolName: 'read_file',
            input: { path: 'src/user-loader.ts' },
          },
          {
            type: 'tool-result',
            toolCallId: 'tool-1',
            toolName: 'read_file',
            input: { path: 'src/user-loader.ts' },
            output: {
              content: [{ type: 'text', text: 'const users = rows.map(loadUser);' }],
            },
          },
        ],
        toolCalls: [],
        toolResults: [],
      }],
    }));

    const result = await runLLMStep({
      systemPrompt: 'system',
      userPrompt: 'prompt',
      tools: {},
      model: {} as any,
      generateText,
    });

    expect(result.cognitiveTrace).toEqual([
      {
        type: 'thought',
        content: 'I need to inspect the user loader first.',
      },
      {
        type: 'tool_call',
        toolName: 'read_file',
        content: '{\n  "path": "src/user-loader.ts"\n}',
      },
      {
        type: 'tool_result',
        toolName: 'read_file',
        content: 'const users = rows.map(loadUser);',
      },
    ]);
    expect(result.metrics?.toolCallsCount).toBe(1);
    expect(result.metrics?.toolResultsCount).toBe(1);
  });

  it('bills aggregated totalUsage across multi-step loops, not just the last step', async () => {
    const generateText = vi.fn(async () => ({
      text: 'done',
      usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 }, // last step only
      totalUsage: { inputTokens: 5000, outputTokens: 800, totalTokens: 5800 }, // all steps
      toolCalls: [],
      toolResults: [],
      steps: [],
    }));

    const result = await runLLMStep({
      systemPrompt: 'system',
      userPrompt: 'prompt',
      tools: {},
      model: {} as any,
      generateText,
    });

    expect(result.metrics?.inputTokens).toBe(5000);
    expect(result.metrics?.outputTokens).toBe(800);
    expect(result.metrics?.totalTokens).toBe(5800);
  });

  it('reports reasoning tokens from extended AI SDK usage details', async () => {
    const generateText = vi.fn(async () => ({
      text: 'final answer',
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
        outputTokenDetails: {
          textTokens: 20,
          reasoningTokens: 2_000_000,
        },
      },
      toolCalls: [],
      toolResults: [],
      steps: [],
    }));

    const result = await runLLMStep({
      systemPrompt: 'system',
      userPrompt: 'prompt',
      tools: {},
      model: {} as any,
      generateText,
    });

    expect(result.metrics?.reasoningTokens).toBe(2_000_000);
    expect(result.metrics?.totalTokens).toBe(2_000_120);
  });

  it('logs provider headers and uses hidden Mimo token totals when present', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const generateText = vi.fn(async () => ({
      text: 'final answer',
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
      },
      response: {
        headers: {
          'x-mimo-total-tokens': '2000000',
          'x-ratelimit-remaining-tokens': '900',
          'content-type': 'application/json',
        },
      },
      toolCalls: [],
      toolResults: [],
      steps: [],
    }));

    try {
      const result = await runLLMStep({
        systemPrompt: 'system',
        userPrompt: 'prompt',
        tools: {},
        model: {} as any,
        generateText,
      });

      expect(result.metrics?.totalTokens).toBe(2_000_000);
      expect(log).toHaveBeenCalledWith(expect.objectContaining({
        type: 'pf_provider_headers',
        headers: expect.objectContaining({
          'x-mimo-total-tokens': '2000000',
          'x-ratelimit-remaining-tokens': '900',
          'content-type': 'application/json',
        }),
        usageHeaders: expect.objectContaining({
          'x-mimo-total-tokens': '2000000',
          'x-ratelimit-remaining-tokens': '900',
        }),
      }));
    } finally {
      log.mockRestore();
    }
  });

  it('normalizes LLM provider errors with useful messages', async () => {
    const generateText = vi.fn(async () => {
      throw new Error('rate limited');
    });

    await expect(runLLMStep({
      systemPrompt: 'system',
      userPrompt: 'prompt',
      tools: {},
      model: {} as any,
      generateText,
    })).rejects.toThrow('rate limited');
  });
});

describe('resolveHarnessModel — provider connections (conn:<connectionId>/<modelId>)', () => {
  it('resolves an openai-protocol connection via createOpenAI({ baseURL, apiKey })(modelName)', () => {
    const resolveConnection = vi.fn((id: string) =>
      id === 'abc123' ? { protocol: 'openai' as const, baseUrl: 'https://my-proxy.example.com/v1', token: 'sk-conn-token' } : undefined);

    const model = resolveHarnessModel('conn:abc123/gpt-4o', resolveConnection);

    expect(resolveConnection).toHaveBeenCalledWith('abc123');
    expect(createOpenAIMock).toHaveBeenCalledWith({ baseURL: 'https://my-proxy.example.com/v1', apiKey: 'sk-conn-token' });
    expect(openAIModelFactory).toHaveBeenCalledWith('gpt-4o');
    expect(model).toEqual({ __sdk: 'openai', modelName: 'gpt-4o' });
  });

  it('resolves an anthropic-protocol connection via createAnthropic({ baseURL, apiKey })(modelName)', () => {
    const resolveConnection = vi.fn((id: string) =>
      id === 'anthro1' ? { protocol: 'anthropic' as const, baseUrl: 'https://my-claude-proxy.example.com', token: 'sk-ant-conn-token' } : undefined);

    const model = resolveHarnessModel('conn:anthro1/claude-sonnet-4-6', resolveConnection);

    expect(createAnthropicMock).toHaveBeenCalledWith({ baseURL: 'https://my-claude-proxy.example.com', apiKey: 'sk-ant-conn-token' });
    expect(anthropicModelFactory).toHaveBeenCalledWith('claude-sonnet-4-6');
    expect(model).toEqual({ __sdk: 'anthropic', modelName: 'claude-sonnet-4-6' });
  });

  it('supports a model name that itself contains slashes (e.g. an OpenRouter-style id behind a custom connection)', () => {
    const resolveConnection = () => ({ protocol: 'openai' as const, baseUrl: 'https://x.example.com/v1', token: 't' });

    resolveHarnessModel('conn:abc123/vendor/model-name', resolveConnection);

    expect(openAIModelFactory).toHaveBeenCalledWith('vendor/model-name');
  });

  it('throws a descriptive error for an unknown connection id, matching the existing "Unsupported harness model provider" style', () => {
    const resolveConnection = () => undefined;

    expect(() => resolveHarnessModel('conn:does-not-exist/gpt-4o', resolveConnection)).toThrow(/does-not-exist/);
  });

  it('throws a descriptive error when no resolveConnection callback is injected at all', () => {
    expect(() => resolveHarnessModel('conn:abc123/gpt-4o')).toThrow(/abc123/);
  });

  it('leaves every pre-existing provider/model id path (no "conn:" prefix) unaffected', () => {
    // Sanity check: the new branch is additive — resolveHarnessModel with a
    // plain "provider/model" id must not attempt a connection lookup at all.
    const resolveConnection = vi.fn();
    resolveHarnessModel('openai/gpt-4o-mini', resolveConnection);
    expect(resolveConnection).not.toHaveBeenCalled();
  });
});
