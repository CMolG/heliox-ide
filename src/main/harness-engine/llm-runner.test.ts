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
