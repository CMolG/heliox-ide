/**
 * ipc-events.ts — Shared IPC event contracts
 *
 * Main emits these payloads over heliox:harness-event. Renderer state should
 * treat them as a stream, not as the result of a long-running invoke call.
 */

export type HarnessExecutionStatus = 'running' | 'completed' | 'error';

export interface HarnessEventBase {
  flowId: string;
  timestamp: number;
}

export interface FlowStarted extends HarnessEventBase {
  type: 'FlowStarted';
}

export interface StepStatusChanged extends HarnessEventBase {
  type: 'StepStatusChanged';
  stepId: string;
  status: HarnessExecutionStatus;
  logs?: string;
}

export interface ModExecutionEvent extends HarnessEventBase {
  type: 'ModExecutionEvent';
  stepId: string;
  modId: string;
  status: HarnessExecutionStatus;
  logs?: string;
}

export interface FlowCompleted extends HarnessEventBase {
  type: 'FlowCompleted';
  finalOutput: unknown;
}

export type HarnessEventPayload =
  | FlowStarted
  | StepStatusChanged
  | ModExecutionEvent
  | FlowCompleted;
