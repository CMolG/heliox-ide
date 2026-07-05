import type { PFTelemetrySummary } from '../types';
import type { McpToolTelemetryEvent } from './tool-events';

export interface LLMStepTelemetryEvent {
  flowId?: string;
  stepId?: string;
  modelId?: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens: number;
  latencyMs: number;
  toolCallsCount: number;
  toolResultsCount: number;
}

export class PerformanceTelemetryCollector {
  readonly llmSteps: LLMStepTelemetryEvent[] = [];
  readonly toolCalls: McpToolTelemetryEvent[] = [];

  recordLLMStep(event: LLMStepTelemetryEvent): void {
    this.llmSteps.push(event);
  }

  recordToolCall(event: McpToolTelemetryEvent): void {
    this.toolCalls.push(event);
  }

  summary(): PFTelemetrySummary {
    const inputTokens = this.llmSteps.reduce((sum, event) => sum + event.inputTokens, 0);
    const outputTokens = this.llmSteps.reduce((sum, event) => sum + event.outputTokens, 0);
    const reasoningTokens = this.llmSteps.reduce((sum, event) => sum + (event.reasoningTokens ?? 0), 0);
    const cacheReadTokens = this.llmSteps.reduce((sum, event) => sum + (event.cacheReadTokens ?? 0), 0);
    const cacheWriteTokens = this.llmSteps.reduce((sum, event) => sum + (event.cacheWriteTokens ?? 0), 0);
    const totalTokens = this.llmSteps.reduce((sum, event) => sum + event.totalTokens, 0);
    const latencyMs = this.llmSteps.reduce((sum, event) => sum + event.latencyMs, 0);
    const toolCallsCount = this.llmSteps.reduce((sum, event) => sum + event.toolCallsCount, 0);
    const toolResultsCount = this.llmSteps.reduce((sum, event) => sum + event.toolResultsCount, 0);
    const mcpSuccessfulToolCalls = this.toolCalls.filter((event) => event.status === 'success').length;
    const mcpInterceptedToolCalls = this.toolCalls.filter((event) => event.status === 'intercepted').length;
    const mcpSchemaErrors = this.toolCalls.filter((event) => event.status === 'schema_error').length;
    const syntaxAttempts = mcpSuccessfulToolCalls + mcpSchemaErrors;

    return {
      inputTokens,
      outputTokens,
      reasoningTokens,
      cacheReadTokens,
      cacheWriteTokens,
      totalTokens,
      latencyMs,
      stepCount: this.llmSteps.length,
      toolCallsCount,
      toolResultsCount,
      mcpToolCalls: this.toolCalls.length,
      mcpSuccessfulToolCalls,
      mcpInterceptedToolCalls,
      mcpSchemaErrors,
      mcpSyntaxPrecision: syntaxAttempts === 0 ? 1 : mcpSuccessfulToolCalls / syntaxAttempts,
    };
  }
}
