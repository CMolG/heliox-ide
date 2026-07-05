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
  /** Loop-body progress (present only for steps inside a loop). */
  iteration?: number;
  totalIterations?: number;
  loopId?: string;
  /** WS2 routing: the effective model this step ran on + why (present when routed/recorded). */
  modelId?: string;
  modelEvidence?: RoutedModelEvidence;
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
  /**
   * 1-based loop-pass number, present only when this checkpoint's step is
   * part of a loop body — lets the time-travel UI tell pass 1 apart from
   * pass 3 of the same repeated step. Absent (not `undefined`-valued) for
   * non-loop steps and for checkpoints persisted before this field existed.
   */
  iteration?: number;
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

/** The four Arena selection strategies. */
export type SelectionStrategy = 'best-score' | 'cheapest' | 'fastest' | 'best-value';

/** Arena-measured evidence behind a model pick. */
export interface ModelSelectionEvidence {
  score: number;
  costPerRun: number;
  latencyMs: number | undefined;
}

/** Per-flow model-selection policy chosen by the user (default fixed). */
export type ModelPolicy =
  | { mode: 'fixed' }
  | { mode: 'smart-local'; strategy: SelectionStrategy }
  | { mode: 'smart-external' };

/** Why a given model was chosen for a step run (recorded + surfaced in the UI). */
export interface RoutedModelEvidence {
  source: 'arena-leaderboard' | 'betterOn' | 'external-router' | 'fallback';
  /** Human sentence, e.g. "best-value winner: score 82 at $0.004/run". */
  reason: string;
  strategy?: SelectionStrategy;
  score?: number;
  costPerRun?: number;
  latencyMs?: number;
  /** True only when backed by a completed Arena entry ("Benchmarked" seal; never say "verified"). */
  sealed: boolean;
}

/**
 * The winning model recommendation for each of the four selection strategies.
 * Mirrors ModelSelection from model-selector, kept JSON-serializable.
 */
export interface ArenaRecommendation {
  strategy: SelectionStrategy;
  modelId: string;
  evidence: ModelSelectionEvidence;
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

// ── Provider Connections (DBeaver-style, Phase 6) ────────────────────────────
// Replaces the old opencode-backed provider-picker UI. A "connection" is a
// user-defined endpoint (name + protocol + base URL + API token) that the
// harness can execute steps against via the `conn:<connectionId>/<modelId>`
// model-id convention (see harness-engine/llm-runner.ts).

/** Wire protocols a connection can speak. Both map to an `@ai-sdk/*` client. */
export type ConnectionProtocol = 'openai' | 'anthropic';

/** Default base URL per protocol — used to pre-fill the connection form and as the tester's fallback target. */
export const PROTOCOL_DEFAULTS: Record<ConnectionProtocol, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
};

/** A single model a connection has reported, with its per-model enable flag. */
export interface ConnectionModel {
  id: string;
  enabled: boolean;
}

/**
 * A saved connection profile as seen by the renderer. The API token itself
 * NEVER crosses the IPC boundary — only `hasToken`. The decrypted token is
 * available main-side only, via `provider-connections.ts#getDecryptedToken`.
 */
export interface ProviderConnection {
  id: string;
  name: string;
  protocol: ConnectionProtocol;
  baseUrl: string;
  hasToken: boolean;
  models: ConnectionModel[];
  lastTestedAt?: number;
  lastTestOk?: boolean;
}

/** `provider-connections:create` request payload. */
export interface ProviderConnectionInput {
  name: string;
  protocol: ConnectionProtocol;
  baseUrl: string;
  /** Plaintext token, encrypted at rest by provider-connections.ts. Omit for tokenless/local endpoints. */
  token?: string;
}

/** `provider-connections:update` request payload — every field is an optional partial patch. */
export interface ProviderConnectionUpdate {
  name?: string;
  baseUrl?: string;
  /** A new plaintext token to encrypt and store, replacing the current one. */
  token?: string;
  models?: ConnectionModel[];
  lastTestedAt?: number;
  lastTestOk?: boolean;
}

/** Result of probing a connection's `/models` endpoint (saved or draft). */
export interface ConnectionTestResult {
  ok: boolean;
  models?: string[];
  error?: string;
}

/**
 * `provider-connections:test` request payload — either a saved connection id
 * (its token is resolved main-side, never round-tripped through the renderer)
 * or a draft profile for pre-save testing.
 */
export type ConnectionTestRequest =
  | { connectionId: string }
  | { protocol: ConnectionProtocol; baseUrl: string; token?: string };

/** `provider-connections:test` response — includes the refreshed profile when a SAVED connection's models were re-merged. */
export interface ConnectionTestResponse {
  success: boolean;
  data?: { result: ConnectionTestResult; connection?: ProviderConnection };
  error?: string;
}

/**
 * Minimal connection facts `resolveHarnessModel` needs to build an AI SDK
 * client for a `conn:<connectionId>/<modelId>` model id. Deliberately NOT the
 * full `ProviderConnection` (no id/name/models bookkeeping needed at this
 * layer) — see `ConnectionResolver` below.
 */
export interface ResolvedProviderConnection {
  protocol: ConnectionProtocol;
  baseUrl: string;
  token?: string;
}

/**
 * Synchronous lookup a harness run injects into `resolveHarnessModel` so it
 * can resolve `conn:` model ids without importing the provider-connections
 * store directly (keeps llm-runner.ts unit-testable in isolation). The
 * ipc/executor boundary (`heliox:start-harness`) is responsible for
 * pre-fetching every saved connection's decrypted token ONCE per run and
 * closing over a plain map, so this callback itself never touches disk.
 */
export type ConnectionResolver = (connectionId: string) => ResolvedProviderConnection | undefined;
