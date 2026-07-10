/**
 * arena.ts — Shared types for Fluxor Arena leaderboard
 *
 * Architecture note:
 * This file follows the explanatory style used across the codebase:
 * explicit intent, clear boundaries, and behavior-preserving structure.
 */
// src/types/arena.ts — Public data-model types for the Arena leaderboard UI

/**
 * The three benchmark suites the Arena evaluates each model against.
 * Scores are normalised to 0–100; null indicates the suite was skipped
 * or failed without a recoverable score.
 */
export interface ArenaScoreBreakdown {
  architecture: number | null;
  teamWork: number | null;
  assembler: number | null;
}

/**
 * One row in the Arena leaderboard JSON produced by `npm run pf:arena`.
 *
 * Mirror of `ArenaLeaderboardEntry` in
 * `src/main/performance-frontier/arena/arena-runner.ts` — kept in sync manually;
 * the backend is the authoritative definition.
 *
 * `avgLatencyMs` is declared optional here for forward compatibility: the
 * backend does not yet populate it (a separate task), but the dashboard
 * renders it when present.
 */
export interface ArenaLeaderboardEntry {
  /** OpenRouter model id (e.g. "z-ai/glm-5.2") */
  modelId: string;
  /** Human-readable display name (e.g. "Z.ai: GLM 5.2") */
  name: string;
  /** Terminal status of the Arena run for this model */
  status: 'completed' | 'api_error';
  /** Per-suite normalised scores (0–100, null = not run / failed) */
  scores: ArenaScoreBreakdown;
  /** Arithmetic mean of the non-null per-suite scores, rounded (0 when none) */
  finalArenaScore: number;
  /** Aggregate token consumption across all suites */
  totalTokens: number;
  /** Total inference cost in USD across all suites */
  executionCostUsd: number;
  /** Per-suite failure messages; present only when something went wrong */
  errors?: string[];
  /**
   * Average wall-clock latency in milliseconds across all suites.
   * Optional — the backend does not populate this yet; the dashboard
   * renders it when present, shows "—" otherwise.
   */
  avgLatencyMs?: number;
}
