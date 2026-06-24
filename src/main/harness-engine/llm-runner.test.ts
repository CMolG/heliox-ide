import { describe, expect, it, vi } from 'vitest';
import type { ToolSet } from 'ai';
import { runLLMStep } from './llm-runner';

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
