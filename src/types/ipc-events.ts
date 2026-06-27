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

export interface StepThinkingDelta extends HarnessEventBase {
  type: 'StepThinkingDelta';
  stepId: string;
  kind: 'reasoning' | 'text' | 'tool';
  delta: string;
}

export interface CheckpointCreated extends HarnessEventBase {
  type: 'CheckpointCreated';
  /** The unique id of the persisted checkpoint. */
  checkpointId: string;
  /** The step whose completion produced this checkpoint. */
  stepId: string;
  /** Ordered step ids completed up to and including `stepId`. */
  completedStepIds: string[];
}

export type HarnessEventPayload =
  | FlowStarted
  | StepStatusChanged
  | ModExecutionEvent
  | FlowCompleted
  | StepThinkingDelta
  | CheckpointCreated;

// ── Checkpoint / Time-Travel IPC ─────────────────────────────────────────────

/** Serialisable Checkpoint shape for the renderer (mirrors the main-process type). */
export interface CheckpointRecord {
  id: string;
  runId: string;
  stepId: string;
  inputContext: string;
  output: string;
  completedStepIds: string[];
  modelId: string | undefined;
  timestamp: number;
}

/** `harness:list-checkpoints` — renderer → main request. */
export interface ListCheckpointsRequest {
  runId: string;
}

/** `harness:list-checkpoints` — main → renderer response. */
export interface ListCheckpointsResponse {
  success: boolean;
  data?: CheckpointRecord[];
  error?: string;
}

/** `harness:replay-from` — renderer → main request. */
export interface ReplayFromRequest {
  /** The `AgenticFlow` definition to replay (JSON-serialisable). */
  flow: import('./harness').AgenticFlow;
  checkpointId: string;
  editedOutput?: string;
}

/** `harness:replay-from` — main → renderer response. */
export interface ReplayFromResponse {
  success: boolean;
  data?: {
    forkRunId: string;
    seededStepIds: string[];
    isDeterministicReplay: boolean;
  };
  error?: string;
}

// ── Performance Frontier Scorecard IPC ───────────────────────────────────────

export interface ScorecardRunOptions {
  /** PF suite name, e.g. 'architecture', 'development'. */
  suite?: string;
  /** Seed for deterministic case selection. */
  seed?: number;
  /** Model id to benchmark; falls back to env default. */
  modelId?: string;
}

/**
 * Incremental progress event streamed on 'pf:scorecard-progress' while the
 * PF run is in flight. The renderer accumulates these and replaces state once
 * 'pf:scorecard-result' or 'pf:scorecard-error' arrives.
 */
export interface ScorecardProgressEvent {
  phase: 'starting' | 'running' | 'judging' | 'done';
  message: string;
  /** Wall-clock elapsed ms since run start. */
  elapsedMs: number;
}

/**
 * Structured result shape returned on 'pf:run-scorecard'.
 * Mirrors PFJudgeResult but only carries the data the panel needs — safe to
 * cross the context bridge (JSON-serializable, no Buffer/Function).
 */
export interface ScorecardResult {
  runId: string;
  caseId: string;
  suite: string;
  modelUnderTest: string;
  verdict: 'pass' | 'partial' | 'fail';
  /** Final composite score out of 100. */
  finalScore: number;
  /** Semantic evaluation score (judge output). */
  semanticScore: number;
  semanticMaxScore: number;
  /** Latency + token-efficiency score (0–10). */
  telemetryScore: number;
  judgeError?: boolean;
  /** Ground-truth verifier results — execution evidence, not judge opinion. */
  groundTruth?: {
    tests?: {
      ran: boolean;
      passed: number;
      failed: number;
      total: number;
      errorMessage?: string;
    };
    a11y?: {
      ran: boolean;
      violations: number;
      critical: string[];
      passes: number;
      errorMessage?: string;
    };
    api?: {
      booted: boolean;
      checks: Array<{ name: string; ok: boolean; status?: number; detail?: string }>;
      errorMessage?: string;
    };
  };
  /** Token usage and latency telemetry. */
  telemetry: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;
    latencyMs: number;
    stepCount: number;
    mcpSyntaxPrecision: number;
  };
  /** Critical failures preventing scoring. */
  criticalFailures: string[];
  /** Bench statistics when multiple runs were aggregated (optional). */
  bench?: {
    n: number;
    mean: number;
    stdDev: number;
    ci95: { lower: number; upper: number };
    min: number;
    max: number;
  };
}

// ── Performance Frontier Arena IPC ───────────────────────────────────────────

/**
 * Options for the `pf:run-arena` invoke call.
 * An empty object triggers the default: free model discovery + forced models.
 */
export interface ArenaRunOptions {
  /** Pin the benchmark to exactly these OpenRouter model ids. */
  modelIds?: string[];
  /** Seed for deterministic PF case selection (default 1). */
  seed?: number;
  /** Max free models to discover (default 6). */
  freeModelLimit?: number;
}

/**
 * Per-model progress event streamed on `pf:arena-progress` while the Arena
 * is running. The renderer accumulates these to show a live leaderboard.
 */
export interface ArenaProgressEvent {
  /** Index into the candidate model list (0-based). */
  modelIndex: number;
  /** Total number of candidate models. */
  totalModels: number;
  modelId: string;
  modelName: string;
  /** Partial score after suites completed so far; null while the first suite is running. */
  scoresSoFar: Record<string, number | null>;
  status: 'running' | 'completed' | 'api_error';
  /** Per-suite error messages for this model. */
  errors?: string[];
}

/**
 * A single entry in the Arena leaderboard returned by `pf:run-arena`.
 * Mirrors ArenaLeaderboardEntry from arena-runner, kept JSON-serializable.
 */
export interface ArenaLeaderboardEntryResult {
  modelId: string;
  name: string;
  status: 'completed' | 'api_error';
  scores: Record<string, number | null>;
  finalArenaScore: number;
  totalTokens: number;
  executionCostUsd: number;
  errors?: string[];
  avgLatencyMs?: number;
}

/**
 * The winning model recommendation for each of the four selection strategies.
 * Mirrors ModelSelection from model-selector, kept JSON-serializable.
 */
export interface ArenaRecommendation {
  strategy: 'best-score' | 'cheapest' | 'fastest' | 'best-value';
  modelId: string;
  evidence: {
    score: number;
    costPerRun: number;
    latencyMs: number | undefined;
  };
}

/**
 * Structured result returned by the `pf:run-arena` invoke call.
 */
export interface ArenaResult {
  leaderboard: ArenaLeaderboardEntryResult[];
  /** One recommendation per strategy; absent when no completed entries exist. */
  recommendations: ArenaRecommendation[];
  /** Wall-clock ms for the full Arena run. */
  elapsedMs: number;
}
