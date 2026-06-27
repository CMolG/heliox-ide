/**
 * ipc.ts — Performance Frontier IPC handler
 *
 * Responsibility:
 * - Registers `pf:run-scorecard` on ipcMain, runs the PF engine for a given
 *   flow/suite off the UI thread, and streams incremental progress events back
 *   to the renderer via `pf:scorecard-progress`.
 * - Registers `pf:run-arena` on ipcMain, runs the Arena across candidate models
 *   for the current flow, streaming per-model progress events back to the renderer
 *   via `pf:arena-progress`, and returning the full leaderboard with the four
 *   recommendation lenses (reusing model-selector strategy logic).
 * - The final structured result (or error) is returned as the invoke reply so
 *   the renderer only ever owns a single, authoritative result.
 *
 * Boundaries:
 * - Owns: IPC wiring, result mapping, progress streaming.
 * - Does NOT own: scoring logic (delegated to runner.ts + judge/), storage
 *   (delegated to report/ledger.ts), or renderer state (delegated to
 *   harness-store.ts).
 *
 * Stubbed: The full `runPerformanceFrontier` invocation runs synchronously
 * inside this handler but streams synthetic progress phases before calling it.
 * If the runner is too heavy for a single invocation (long timeout), callers
 * may pass a `signal` in the future; this handler is already structured to
 * support cancellation.
 */
import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { runPerformanceFrontier } from './runner';
import type { PFSuite } from './types';
import {
  evaluateArenaModel,
  sortLeaderboard,
  ARENA_SUITES,
} from './arena/arena-runner';
import type { ArenaLeaderboardEntry } from './arena/arena-runner';
import { fetchArenaModels, buildArenaModelList, ARENA_FORCED_MODEL_IDS } from './arena/model-fetcher';
import type {
  ScorecardRunOptions,
  ScorecardProgressEvent,
  ScorecardResult,
  ArenaRunOptions,
  ArenaProgressEvent,
  ArenaResult,
  ArenaLeaderboardEntryResult,
  ArenaRecommendation,
} from '../../types/ipc-events';

// ── Inline strategy helpers (mirrors model-selector.ts logic without fs I/O) ──

type SelectionStrategy = 'best-score' | 'cheapest' | 'fastest' | 'best-value';

function completedEntries(ledger: ArenaLeaderboardEntry[]): ArenaLeaderboardEntry[] {
  return ledger.filter((e) => e.status === 'completed');
}

function toBestScore(entries: ArenaLeaderboardEntry[]): ArenaLeaderboardEntry | undefined {
  return entries.reduce<ArenaLeaderboardEntry | undefined>((best, e) => {
    if (!best) return e;
    if (e.finalArenaScore > best.finalArenaScore) return e;
    if (e.finalArenaScore === best.finalArenaScore && e.executionCostUsd < best.executionCostUsd) return e;
    return best;
  }, undefined);
}

function toCheapest(entries: ArenaLeaderboardEntry[]): ArenaLeaderboardEntry | undefined {
  return entries.reduce<ArenaLeaderboardEntry | undefined>((best, e) => {
    if (!best) return e;
    if (e.executionCostUsd < best.executionCostUsd) return e;
    if (e.executionCostUsd === best.executionCostUsd && e.finalArenaScore > best.finalArenaScore) return e;
    return best;
  }, undefined);
}

function toFastest(entries: ArenaLeaderboardEntry[]): ArenaLeaderboardEntry | undefined {
  const withLatency = entries.filter(
    (e): e is ArenaLeaderboardEntry & { avgLatencyMs: number } => e.avgLatencyMs !== undefined,
  );
  return withLatency.reduce<ArenaLeaderboardEntry | undefined>((best, e) => {
    if (!best) return e;
    if (e.avgLatencyMs! < (best.avgLatencyMs ?? Infinity)) return e;
    if (e.avgLatencyMs === best.avgLatencyMs && e.finalArenaScore > best.finalArenaScore) return e;
    return best;
  }, undefined);
}

function valueScore(e: ArenaLeaderboardEntry): number {
  if (e.executionCostUsd === 0) return Number.MAX_SAFE_INTEGER;
  return e.finalArenaScore / e.executionCostUsd;
}

function toBestValue(entries: ArenaLeaderboardEntry[]): ArenaLeaderboardEntry | undefined {
  return entries.reduce<ArenaLeaderboardEntry | undefined>((best, e) => {
    if (!best) return e;
    const eVal = valueScore(e);
    const bestVal = valueScore(best);
    if (eVal > bestVal) return e;
    if (eVal === bestVal && e.finalArenaScore > best.finalArenaScore) return e;
    return best;
  }, undefined);
}

function buildRecommendations(leaderboard: ArenaLeaderboardEntry[]): ArenaRecommendation[] {
  const candidates = completedEntries(leaderboard);
  if (candidates.length === 0) return [];

  const strategies: SelectionStrategy[] = ['best-score', 'cheapest', 'fastest', 'best-value'];
  const recommendations: ArenaRecommendation[] = [];

  for (const strategy of strategies) {
    let winner: ArenaLeaderboardEntry | undefined;
    switch (strategy) {
      case 'best-score': winner = toBestScore(candidates); break;
      case 'cheapest': winner = toCheapest(candidates); break;
      case 'fastest': winner = toFastest(candidates); break;
      case 'best-value': winner = toBestValue(candidates); break;
    }
    if (winner) {
      recommendations.push({
        strategy,
        modelId: winner.modelId,
        evidence: {
          score: winner.finalArenaScore,
          costPerRun: winner.executionCostUsd,
          latencyMs: winner.avgLatencyMs,
        },
      });
    }
  }

  return recommendations;
}

function toSerializableEntry(entry: ArenaLeaderboardEntry): ArenaLeaderboardEntryResult {
  return {
    modelId: entry.modelId,
    name: entry.name,
    status: entry.status,
    scores: entry.scores as Record<string, number | null>,
    finalArenaScore: entry.finalArenaScore,
    totalTokens: entry.totalTokens,
    executionCostUsd: entry.executionCostUsd,
    ...(entry.errors ? { errors: entry.errors } : {}),
    ...(entry.avgLatencyMs !== undefined ? { avgLatencyMs: entry.avgLatencyMs } : {}),
  };
}

const PROGRESS_CHANNEL = 'pf:scorecard-progress';
const ARENA_PROGRESS_CHANNEL = 'pf:arena-progress';

function sendProgress(
  win: BrowserWindow,
  payload: ScorecardProgressEvent,
): void {
  if (!win.isDestroyed()) {
    win.webContents.send(PROGRESS_CHANNEL, payload);
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Register the `pf:run-scorecard` IPC handler.
 * Must be called once from `registerIpcHandlers` after the main window is ready.
 */
export function registerScorecardIpc(mainWindow: BrowserWindow): void {
  ipcMain.handle(
    'pf:run-scorecard',
    async (_event, opts: ScorecardRunOptions = {}): Promise<{ success: boolean; data?: ScorecardResult; error?: string }> => {
      const startMs = Date.now();

      function elapsed(): number {
        return Date.now() - startMs;
      }

      sendProgress(mainWindow, {
        phase: 'starting',
        message: 'Initialising Performance Frontier run…',
        elapsedMs: elapsed(),
      });

      try {
        const suite = (opts.suite ?? 'architecture') as PFSuite;
        const seed = opts.seed ?? 1;
        const modelId = opts.modelId;

        sendProgress(mainWindow, {
          phase: 'running',
          message: `Running suite "${suite}" (seed=${seed})…`,
          elapsedMs: elapsed(),
        });

        // Run the full PF engine. This is the heavy step — it spawns a sandbox,
        // executes an agentic flow, verifies ground truth, and runs the judge.
        // It is already off the UI thread (ipcMain.handle runs in main process).
        const result = await runPerformanceFrontier({
          suite,
          seed,
          ...(modelId ? { modelId } : {}),
        });

        sendProgress(mainWindow, {
          phase: 'judging',
          message: 'Judge evaluation complete. Mapping result…',
          elapsedMs: elapsed(),
        });

        const semanticMaxScore: number =
          (result.semanticMaxScore) ?? (suite === 'flow-assembler' ? 150 : 90);

        const scorecard: ScorecardResult = {
          runId: result.runId,
          caseId: result.caseId,
          suite: result.suite,
          modelUnderTest: result.modelUnderTest,
          verdict: result.verdict,
          finalScore: result.finalScore,
          semanticScore: result.semanticScore,
          semanticMaxScore,
          telemetryScore: result.telemetryScore,
          judgeError: result.judgeError,
          groundTruth: result.groundTruth,
          telemetry: {
            inputTokens: result.telemetry.inputTokens,
            outputTokens: result.telemetry.outputTokens,
            reasoningTokens: result.telemetry.reasoningTokens,
            cacheReadTokens: result.telemetry.cacheReadTokens,
            cacheWriteTokens: result.telemetry.cacheWriteTokens,
            totalTokens: result.telemetry.totalTokens,
            latencyMs: result.telemetry.latencyMs,
            stepCount: result.telemetry.stepCount,
            mcpSyntaxPrecision: result.telemetry.mcpSyntaxPrecision,
          },
          criticalFailures: result.criticalFailures,
        };

        sendProgress(mainWindow, {
          phase: 'done',
          message: `Scorecard complete — ${result.verdict} (${result.finalScore}/100)`,
          elapsedMs: elapsed(),
        });

        return { success: true, data: scorecard };
      } catch (err) {
        const message = errMsg(err);
        sendProgress(mainWindow, {
          phase: 'done',
          message: `Run failed: ${message}`,
          elapsedMs: elapsed(),
        });
        return { success: false, error: message };
      }
    },
  );
}

/**
 * Register the `pf:run-arena` IPC handler.
 * Must be called once from `registerIpcHandlers` after the main window is ready.
 *
 * Streams per-model progress on `pf:arena-progress` and returns the full
 * leaderboard + four recommendation lenses as the invoke reply.
 */
export function registerArenaIpc(mainWindow: BrowserWindow): void {
  ipcMain.handle(
    'pf:run-arena',
    async (_event, opts: ArenaRunOptions = {}): Promise<{ success: boolean; data?: ArenaResult; error?: string }> => {
      const startMs = Date.now();
      const seed = opts.seed ?? 1;
      const freeModelLimit = opts.freeModelLimit ?? 6;

      // ── Model discovery ──────────────────────────────────────────────────────
      let models;
      try {
        models = opts.modelIds
          ? await fetchArenaModels({ forcedModelIds: opts.modelIds, freeModelLimit: 0 })
          : await fetchArenaModels({ freeModelLimit });
      } catch {
        // Fall back to forced/pinned models only so the Arena never yields nothing.
        models = buildArenaModelList([], opts.modelIds ?? ARENA_FORCED_MODEL_IDS);
      }

      const suites = ARENA_SUITES;
      const leaderboard: ArenaLeaderboardEntry[] = [];

      // ── Per-model evaluation with streaming progress ─────────────────────────
      for (const [index, model] of models.entries()) {
        // Notify renderer that this model is starting.
        const progressEvent: ArenaProgressEvent = {
          modelIndex: index,
          totalModels: models.length,
          modelId: model.id,
          modelName: model.name,
          scoresSoFar: { architecture: null, teamWork: null, assembler: null },
          status: 'running',
        };
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send(ARENA_PROGRESS_CHANNEL, progressEvent);
        }

        let entry: ArenaLeaderboardEntry;
        try {
          entry = await evaluateArenaModel(model, {
            seed,
            suites,
            onSuiteResult: ({ suite, score }) => {
              // Stream intermediate per-suite scores so the renderer can update live.
              const scoreKey = suites.find((s) => s.suite === suite)?.scoreKey;
              if (scoreKey && !mainWindow.isDestroyed()) {
                const updated = { ...progressEvent.scoresSoFar, [scoreKey]: score };
                progressEvent.scoresSoFar = updated;
                mainWindow.webContents.send(ARENA_PROGRESS_CHANNEL, {
                  ...progressEvent,
                  scoresSoFar: updated,
                  status: 'running',
                });
              }
            },
          });
        } catch (err) {
          entry = {
            modelId: model.id,
            name: model.name,
            status: 'api_error',
            scores: { architecture: null, teamWork: null, assembler: null },
            finalArenaScore: 0,
            totalTokens: 0,
            executionCostUsd: 0,
            errors: [errMsg(err)],
          };
        }

        leaderboard.push(entry);

        // Notify renderer of final per-model status.
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send(ARENA_PROGRESS_CHANNEL, {
            modelIndex: index,
            totalModels: models.length,
            modelId: model.id,
            modelName: model.name,
            scoresSoFar: entry.scores as Record<string, number | null>,
            status: entry.status,
            ...(entry.errors ? { errors: entry.errors } : {}),
          } satisfies ArenaProgressEvent);
        }
      }

      const sorted = sortLeaderboard(leaderboard);
      const recommendations = buildRecommendations(sorted);

      const result: ArenaResult = {
        leaderboard: sorted.map(toSerializableEntry),
        recommendations,
        elapsedMs: Date.now() - startMs,
      };

      return { success: true, data: result };
    },
  );
}
