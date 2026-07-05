export type McpToolTelemetryStatus =
  | 'success'
  | 'intercepted'
  | 'schema_error'
  | 'execution_error'
  | 'unknown_tool';

export interface McpToolTelemetryEvent {
  toolName: string;
  status: McpToolTelemetryStatus;
  latencyMs: number;
  errorMessage?: string;
}
