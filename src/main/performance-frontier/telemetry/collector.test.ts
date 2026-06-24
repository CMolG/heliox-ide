import { describe, expect, it } from 'vitest';
import { PerformanceTelemetryCollector } from './collector';
import { normalizeUsage } from './normalize-usage';

describe('performance frontier telemetry', () => {
  it('normalizes AI SDK usage shapes', () => {
    expect(normalizeUsage({
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
    })).toEqual({
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
    });

    expect(normalizeUsage({
      promptTokens: 5,
      completionTokens: 7,
      totalTokens: 12,
    })).toEqual({
      inputTokens: 5,
      outputTokens: 7,
      totalTokens: 12,
    });
  });

  it('includes reasoning and cache token details when providers expose them', () => {
    expect(normalizeUsage({
      inputTokens: 100,
      outputTokens: 30,
      totalTokens: 130,
      inputTokenDetails: {
        cacheReadTokens: 70,
        cacheWriteTokens: 5,
      },
      outputTokenDetails: {
        textTokens: 30,
        reasoningTokens: 1_900_000,
      },
    })).toEqual({
      inputTokens: 100,
      outputTokens: 30,
      reasoningTokens: 1_900_000,
      cacheReadTokens: 70,
      cacheWriteTokens: 5,
      totalTokens: 1_900_130,
    });

    expect(normalizeUsage({
      prompt_tokens: 40,
      completion_tokens: 20,
      completion_tokens_details: {
        reasoning_tokens: 500,
      },
      usage: {
        total_tokens: 60,
      },
    })).toMatchObject({
      inputTokens: 40,
      outputTokens: 20,
      reasoningTokens: 500,
      totalTokens: 560,
    });
  });

  it('computes MCP syntax precision from successful and schema-failed tool calls', () => {
    const collector = new PerformanceTelemetryCollector();

    collector.recordToolCall({ toolName: 'read_file', status: 'success', latencyMs: 3 });
    collector.recordToolCall({ toolName: 'write_file', status: 'schema_error', latencyMs: 2 });
    collector.recordToolCall({ toolName: 'list_directory', status: 'execution_error', latencyMs: 4 });
    collector.recordToolCall({ toolName: 'list_directory', status: 'intercepted', latencyMs: 1 });

    expect(collector.summary().mcpSyntaxPrecision).toBe(0.5);
    expect(collector.summary().mcpSchemaErrors).toBe(1);
    expect(collector.summary().mcpInterceptedToolCalls).toBe(1);
  });
});
