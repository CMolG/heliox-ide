/**
 * harness-store.ts — Logical execution state for compiled agentic flows
 *
 * This store deliberately stays independent from desktop-store rendering state.
 */
import { create } from 'zustand';
import type { AgenticExecutionStatus, AgenticFlow } from '@/types/harness';
import type {
  HarnessEventPayload,
  ScorecardResult,
  ScorecardProgressEvent,
  ScorecardRunOptions,
  CheckpointRecord,
  ListCheckpointsResponse,
  ReplayFromResponse,
  ArenaRunOptions,
  ArenaProgressEvent,
  ArenaResult,
} from '@/types/ipc-events';
import { collectDownstreamStepIds, compileFlowFromCanvas } from '../lib/harness-compiler';
import { useDesktopStore } from './desktop-store';

const MAX_EXECUTION_LOGS = 500;

// ── Checkpoint / time-travel state ──────────────────────────────────────────

export type CheckpointStatus = 'idle' | 'loading' | 'done' | 'error';

export interface CheckpointState {
  status: CheckpointStatus;
  /** Checkpoints for the currently-inspected run, ordered by creation time. */
  checkpoints: CheckpointRecord[];
  /** The index into `checkpoints` the scrubber is currently positioned at. */
  activeIndex: number;
  /** The step currently highlighted on the canvas (synced from the active checkpoint). */
  highlightedStepId: string | null;
  /** Whether the user is currently editing the output of the active checkpoint. */
  editedOutput: string | null;
  error: string | null;
  /** The forkRunId returned by the last successful `forkFrom` call. */
  lastForkRunId: string | null;
}

const INITIAL_CHECKPOINT_STATE: CheckpointState = {
  status: 'idle',
  checkpoints: [],
  activeIndex: -1,
  highlightedStepId: null,
  editedOutput: null,
  error: null,
  lastForkRunId: null,
};

// ── Scorecard state ──────────────────────────────────────────────────────────

export type ScorecardStatus = 'idle' | 'running' | 'done' | 'error';

export interface ScorecardState {
  status: ScorecardStatus;
  result: ScorecardResult | null;
  error: string | null;
  /** Latest incremental progress messages during a run. */
  progressMessages: ScorecardProgressEvent[];
  /** Unsubscribe function for the 'pf:scorecard-progress' event listener. */
  scorecardProgressUnsubscribe: (() => void) | null;
}

// ── Arena state ──────────────────────────────────────────────────────────────

export type ArenaStatus = 'idle' | 'running' | 'done' | 'error';

export interface ArenaState {
  status: ArenaStatus;
  /** Final leaderboard + recommendations returned by `pf:run-arena`. */
  result: ArenaResult | null;
  error: string | null;
  /** Incremental per-model progress events streamed during a run. */
  progressEvents: ArenaProgressEvent[];
  /** Unsubscribe function for the `pf:arena-progress` event listener. */
  arenaProgressUnsubscribe: (() => void) | null;
  /** The model id the user chose via "Use for deploy". */
  deployChosenModelId: string | null;
}

const INITIAL_ARENA_STATE: ArenaState = {
  status: 'idle',
  result: null,
  error: null,
  progressEvents: [],
  arenaProgressUnsubscribe: null,
  deployChosenModelId: null,
};

// ── Full store interface ─────────────────────────────────────────────────────

interface HarnessStore {
  activeFlow: AgenticFlow | null;
  executionStatus: AgenticExecutionStatus;
  currentStepId: string | null;
  stepStatuses: Record<string, AgenticExecutionStatus>;
  modStatuses: Record<string, AgenticExecutionStatus>;
  stepThinkings: Record<string, { kind: 'reasoning' | 'text' | 'tool'; text: string }[]>;
  executionLogs: string[];
  harnessEventUnsubscribe: (() => void) | null;
  // Scorecard
  scorecard: ScorecardState;
  // Arena
  arena: ArenaState;
  // Checkpoint / time-travel
  checkpointState: CheckpointState;
  /**
   * Load checkpoints for a run from the main process via `harness:list-checkpoints`.
   * Replaces the current checkpoint list and resets the scrubber to index 0.
   */
  loadCheckpoints: (runId: string) => Promise<void>;
  /**
   * Set the scrubber position to `index` and sync `highlightedStepId` to the
   * matching checkpoint's `stepId`. Clears any in-progress edit.
   */
  rewindTo: (index: number) => void;
  /**
   * Call `harness:replay-from` to fork the active run from the current checkpoint,
   * optionally injecting an edited output for the checkpoint step.
   *
   * On success `lastForkRunId` is populated so the canvas can render a fork lane.
   */
  forkFrom: (flow: AgenticFlow, checkpointId: string, editedOutput?: string) => Promise<void>;
  /** Update the in-progress edit text for the active checkpoint. */
  setEditedOutput: (text: string | null) => void;
  /** Reset the checkpoint panel state back to idle. */
  resetCheckpoints: () => void;
  compileCurrentCanvas: () => AgenticFlow | null;
  startExecution: () => Promise<void>;
  /**
   * Compile and dispatch a single step in isolation — its `prevStepIds`/`nextStepIds`
   * come out empty regardless of the step's real neighbors on the canvas. Sets the
   * scoped flow as `activeFlow` before dispatching. Unknown `stepId` fails softly:
   * `executionStatus` becomes 'error' with a log entry, `startHarness` is never called.
   */
  runStep: (stepId: string) => Promise<void>;
  /**
   * Compile and dispatch `stepId` plus every step transitively reachable via
   * outgoing `mentalEdges` (the downstream subgraph), with prev/next lists
   * trimmed to that included set. Sets the scoped flow as `activeFlow` before
   * dispatching. Unknown `stepId` fails softly, same as `runStep`.
   */
  runFromStep: (stepId: string) => Promise<void>;
  stopExecution: () => void;
  setStepStatus: (stepId: string | null, status?: AgenticExecutionStatus) => void;
  handleHarnessEvent: (event: HarnessEventPayload) => void;
  subscribeToHarnessEvents: () => void;
  unsubscribeFromHarnessEvents: () => void;
  /** Invoke `pf:run-scorecard` on the main process and stream progress into the store. */
  runScorecard: (opts?: ScorecardRunOptions) => Promise<void>;
  /** Reset scorecard state back to idle. */
  resetScorecard: () => void;
  /** Invoke `pf:run-arena` on the main process and stream per-model progress into the store. */
  runArena: (opts?: ArenaRunOptions) => Promise<void>;
  /** Reset arena state back to idle. */
  resetArena: () => void;
  /** Record the model chosen by the user for deploy (consumed by `heliox serve --select`). */
  setArenaDeployModel: (modelId: string) => void;
}

function formatLog(message: string): string {
  return `${new Date().toISOString()} ${message}`;
}

function appendLog(logs: string[], message: string): string[] {
  return [...logs, formatLog(message)].slice(-MAX_EXECUTION_LOGS);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Strip the leading ISO-timestamp token `formatLog` prepends to every entry,
 * leaving just the human-readable message from the latest `executionLogs`
 * line (or `null` if there are no logs yet). Exported so consumers outside
 * this store — namely App.tsx's error-toast wiring — can render a clean
 * message without re-deriving, or hardcoding a regex against, this store's
 * private log format themselves.
 */
export function lastLogMessage(logs: string[]): string | null {
  const entry = logs.at(-1);
  if (!entry) return null;
  return entry.replace(/^\S+\s+/, '');
}

const STEP_THINKING_MAX_CHARS = 8000;

const INITIAL_SCORECARD_STATE: ScorecardState = {
  status: 'idle',
  result: null,
  error: null,
  progressMessages: [],
  scorecardProgressUnsubscribe: null,
};

export const useHarnessStore = create<HarnessStore>((set, get) => {
  /**
   * Shared dispatch path for an already-scoped AgenticFlow: subscribes to harness
   * events, marks the flow's root step 'running', and invokes the harness IPC
   * bridge. `startExecution` (whole canvas), `runStep`, and `runFromStep` (step-
   * scoped flows) all funnel through here so event-wiring and error handling stay
   * identical no matter how the dispatched flow was scoped.
   */
  const executeFlow = async (flow: AgenticFlow): Promise<void> => {
    const api = window.helioxAPI;
    if (!api?.startHarness) {
      set((state) => ({
        executionStatus: 'error',
        currentStepId: null,
        executionLogs: appendLog(state.executionLogs, 'Cannot start execution because the harness IPC bridge is unavailable.'),
      }));
      return;
    }

    get().subscribeToHarnessEvents();

    set((state) => ({
      executionStatus: 'running',
      currentStepId: flow.rootStepId,
      stepStatuses: {
        ...state.stepStatuses,
        [flow.rootStepId]: 'running',
      },
      executionLogs: appendLog(state.executionLogs, `Execution cursor started at "${flow.rootStepId}".`),
    }));

    try {
      const result = await api.startHarness(flow);
      if (!result.success) {
        set((state) => ({
          executionStatus: 'error',
          executionLogs: appendLog(state.executionLogs, `Harness failed to start: ${result.error ?? 'Unknown error'}`),
        }));
      }
    } catch (error) {
      set((state) => ({
        executionStatus: 'error',
        executionLogs: appendLog(state.executionLogs, `Harness IPC start failed: ${getErrorMessage(error)}`),
      }));
    }
  };

  return {
  activeFlow: null,
  executionStatus: 'idle',
  currentStepId: null,
  stepStatuses: {},
  modStatuses: {},
  stepThinkings: {},
  executionLogs: [],
  harnessEventUnsubscribe: null,
  scorecard: { ...INITIAL_SCORECARD_STATE },
  arena: { ...INITIAL_ARENA_STATE },
  checkpointState: { ...INITIAL_CHECKPOINT_STATE },

  compileCurrentCanvas: () => {
    set((state) => ({
      executionStatus: 'compiling',
      executionLogs: appendLog(state.executionLogs, 'Compiling current canvas.'),
    }));

    try {
      const { mentalNodes, mentalEdges } = useDesktopStore.getState();
      const flow = compileFlowFromCanvas(mentalNodes, mentalEdges);
      const stepCount = Object.keys(flow.stepsRecord).length;
      set((state) => ({
        activeFlow: flow,
        executionStatus: 'idle',
        currentStepId: null,
        stepStatuses: {},
        modStatuses: {},
        stepThinkings: {},
        executionLogs: appendLog(state.executionLogs, `Compiled flow "${flow.name}" with ${stepCount} step(s).`),
      }));
      return flow;
    } catch (error) {
      set((state) => ({
        executionStatus: 'error',
        executionLogs: appendLog(state.executionLogs, `Compile failed: ${getErrorMessage(error)}`),
      }));
      return null;
    }
  },

  startExecution: async () => {
    const { activeFlow } = get();
    if (!activeFlow) {
      set((state) => ({
        executionStatus: 'error',
        currentStepId: null,
        executionLogs: appendLog(state.executionLogs, 'Cannot start execution without an active compiled flow.'),
      }));
      return;
    }

    await executeFlow(activeFlow);
  },

  runStep: async (stepId) => {
    const { mentalNodes, mentalEdges } = useDesktopStore.getState();

    let flow: AgenticFlow;
    try {
      // A singleton include-set means no step-to-step edge can have both endpoints
      // inside it, so prev/next come back empty regardless of the step's real
      // canvas neighbors — exactly the isolated one-step flow this action needs.
      flow = compileFlowFromCanvas(mentalNodes, mentalEdges, {
        rootStepId: stepId,
        includeIds: new Set([stepId]),
      });
    } catch (error) {
      // Covers the unknown-stepId edge case too: an id that names no Step node
      // yields an empty compiled step set, which compileFlowFromCanvas rejects.
      set((state) => ({
        executionStatus: 'error',
        executionLogs: appendLog(state.executionLogs, `Cannot run step "${stepId}": ${getErrorMessage(error)}`),
      }));
      return;
    }

    set((state) => ({
      activeFlow: flow,
      currentStepId: null,
      stepStatuses: {},
      modStatuses: {},
      stepThinkings: {},
      executionLogs: appendLog(state.executionLogs, `Compiled single-step run for "${stepId}".`),
    }));

    await executeFlow(flow);
  },

  runFromStep: async (stepId) => {
    const { mentalNodes, mentalEdges } = useDesktopStore.getState();
    // Unknown stepId -> collectDownstreamStepIds returns an empty Set (guarded
    // against cycles internally), which likewise makes compileFlowFromCanvas
    // reject with "no Step nodes" below — same graceful failure as runStep.
    const includeIds = collectDownstreamStepIds(stepId, mentalNodes, mentalEdges);

    let flow: AgenticFlow;
    try {
      flow = compileFlowFromCanvas(mentalNodes, mentalEdges, {
        rootStepId: stepId,
        includeIds,
      });
    } catch (error) {
      set((state) => ({
        executionStatus: 'error',
        executionLogs: appendLog(state.executionLogs, `Cannot run from step "${stepId}": ${getErrorMessage(error)}`),
      }));
      return;
    }

    set((state) => ({
      activeFlow: flow,
      currentStepId: null,
      stepStatuses: {},
      modStatuses: {},
      stepThinkings: {},
      executionLogs: appendLog(
        state.executionLogs,
        `Compiled downstream run from "${stepId}" with ${Object.keys(flow.stepsRecord).length} step(s).`,
      ),
    }));

    await executeFlow(flow);
  },

  stopExecution: () => {
    set((state) => ({
      executionStatus: 'idle',
      currentStepId: null,
      stepStatuses: {},
      modStatuses: {},
      stepThinkings: {},
      executionLogs: appendLog(state.executionLogs, 'Execution cursor stopped.'),
    }));
  },

  setStepStatus: (stepId, status = get().executionStatus) => {
    set((state) => ({
      executionStatus: status,
      currentStepId: stepId,
      stepStatuses: stepId
        ? {
            ...state.stepStatuses,
            [stepId]: status,
          }
        : state.stepStatuses,
      executionLogs: appendLog(
        state.executionLogs,
        stepId ? `Step "${stepId}" marked ${status}.` : `Execution status set to ${status}.`,
      ),
    }));
  },

  handleHarnessEvent: (event) => {
    switch (event.type) {
      case 'FlowStarted':
        set((state) => ({
          executionStatus: 'running',
          executionLogs: appendLog(state.executionLogs, `Flow "${event.flowId}" started.`),
        }));
        return;

      case 'StepStatusChanged':
        set((state) => ({
          executionStatus: event.status === 'error' ? 'error' : state.executionStatus === 'completed' ? 'completed' : 'running',
          currentStepId: event.status === 'running' ? event.stepId : state.currentStepId,
          stepStatuses: {
            ...state.stepStatuses,
            [event.stepId]: event.status,
          },
          executionLogs: event.logs ? appendLog(state.executionLogs, event.logs) : state.executionLogs,
        }));
        return;

      case 'ModExecutionEvent':
        set((state) => ({
          modStatuses: {
            ...state.modStatuses,
            [`${event.stepId}:${event.modId}`]: event.status,
          },
          executionLogs: event.logs ? appendLog(state.executionLogs, event.logs) : state.executionLogs,
        }));
        return;

      case 'FlowCompleted':
        set((state) => ({
          executionStatus: 'completed',
          currentStepId: null,
          executionLogs: appendLog(state.executionLogs, `Flow "${event.flowId}" completed.`),
        }));
        return;

      case 'StepThinkingDelta': {
        set((state) => {
          const existing = state.stepThinkings[event.stepId] ?? [];
          const last = existing.length > 0 ? existing[existing.length - 1] : null;
          let updated: typeof existing;
          if (last && last.kind === event.kind) {
            // Append to the last entry of the same kind; trim to size limit.
            const merged = last.text + event.delta;
            const clamped = merged.length > STEP_THINKING_MAX_CHARS
              ? merged.slice(-STEP_THINKING_MAX_CHARS)
              : merged;
            updated = [...existing.slice(0, -1), { kind: event.kind, text: clamped }];
          } else {
            // New kind — push a fresh entry; delta itself is already bounded.
            const delta = event.delta.length > STEP_THINKING_MAX_CHARS
              ? event.delta.slice(-STEP_THINKING_MAX_CHARS)
              : event.delta;
            updated = [...existing, { kind: event.kind, text: delta }];
          }
          return {
            stepThinkings: {
              ...state.stepThinkings,
              [event.stepId]: updated,
            },
          };
        });
        return;
      }
    }
  },

  subscribeToHarnessEvents: () => {
    if (get().harnessEventUnsubscribe) return;

    const api = window.helioxAPI;
    if (!api?.onHarnessEvent) {
      set((state) => ({
        executionLogs: appendLog(state.executionLogs, 'Harness event stream is unavailable.'),
      }));
      return;
    }

    const unsubscribe = api.onHarnessEvent((event) => {
      get().handleHarnessEvent(event);
    });
    set({ harnessEventUnsubscribe: unsubscribe });
  },

  unsubscribeFromHarnessEvents: () => {
    const unsubscribe = get().harnessEventUnsubscribe;
    if (unsubscribe) unsubscribe();
    set({ harnessEventUnsubscribe: null });
  },

  // ── Checkpoint / time-travel ──────────────────────────────────────────────

  loadCheckpoints: async (runId) => {
    set((state) => ({
      checkpointState: {
        ...INITIAL_CHECKPOINT_STATE,
        status: 'loading',
      },
      executionLogs: appendLog(state.executionLogs, `Loading checkpoints for run "${runId}".`),
    }));

    const api = window.helioxAPI as typeof window.helioxAPI & {
      listCheckpoints?: (runId: string) => Promise<ListCheckpointsResponse>;
    };

    if (typeof api?.listCheckpoints !== 'function') {
      set((state) => ({
        checkpointState: {
          ...INITIAL_CHECKPOINT_STATE,
          status: 'error',
          error: 'harness:list-checkpoints IPC handler is not available.',
        },
        executionLogs: appendLog(state.executionLogs, 'Checkpoint IPC unavailable.'),
      }));
      return;
    }

    try {
      const response = await api.listCheckpoints(runId);
      if (!response.success || !response.data) {
        throw new Error(response.error ?? 'listCheckpoints returned no data.');
      }
      const checkpoints = response.data;
      const firstStepId = checkpoints.length > 0 ? checkpoints[0].stepId : null;
      set((state) => ({
        checkpointState: {
          ...INITIAL_CHECKPOINT_STATE,
          status: 'done',
          checkpoints,
          activeIndex: checkpoints.length > 0 ? 0 : -1,
          highlightedStepId: firstStepId,
        },
        executionLogs: appendLog(state.executionLogs, `Loaded ${checkpoints.length} checkpoint(s).`),
      }));
    } catch (err) {
      set((state) => ({
        checkpointState: {
          ...INITIAL_CHECKPOINT_STATE,
          status: 'error',
          error: getErrorMessage(err),
        },
        executionLogs: appendLog(state.executionLogs, `Failed to load checkpoints: ${getErrorMessage(err)}`),
      }));
    }
  },

  rewindTo: (index) => {
    const { checkpoints } = get().checkpointState;
    const clamped = Math.max(0, Math.min(index, checkpoints.length - 1));
    const checkpoint = checkpoints[clamped];
    if (!checkpoint) return;
    set((state) => ({
      checkpointState: {
        ...state.checkpointState,
        activeIndex: clamped,
        highlightedStepId: checkpoint.stepId,
        editedOutput: null,
      },
    }));
  },

  forkFrom: async (flow, checkpointId, editedOutput) => {
    const api = window.helioxAPI as typeof window.helioxAPI & {
      replayFrom?: (req: ReplayFromResponse) => Promise<ReplayFromResponse>;
      harnessReplayFrom?: (flow: AgenticFlow, checkpointId: string, editedOutput?: string) => Promise<ReplayFromResponse>;
    };

    // Try the dedicated `harnessReplayFrom` bridge method first (added in preload),
    // then fall back to a generic `replayFrom` wrapper. If neither exists, surface an error.
    const callReplay = async (): Promise<ReplayFromResponse> => {
      if (typeof api?.harnessReplayFrom === 'function') {
        return api.harnessReplayFrom(flow, checkpointId, editedOutput);
      }
      // Fallback: use a generic bridge cast — type-safe via ReplayFromResponse.
      const bridgeWithReplay = api as typeof api & {
        replayFromCheckpoint?: (flow: AgenticFlow, checkpointId: string, editedOutput?: string) => Promise<ReplayFromResponse>;
      };
      if (typeof bridgeWithReplay?.replayFromCheckpoint === 'function') {
        return bridgeWithReplay.replayFromCheckpoint(flow, checkpointId, editedOutput);
      }
      return {
        success: false,
        error: 'harness:replay-from IPC handler is not available.',
      };
    };

    set((state) => ({
      checkpointState: { ...state.checkpointState, status: 'loading' },
      executionLogs: appendLog(state.executionLogs, `Forking from checkpoint "${checkpointId}".`),
    }));

    try {
      const response = await callReplay();
      if (!response.success || !response.data) {
        throw new Error(response.error ?? 'replayFrom returned no data.');
      }
      const { forkRunId } = response.data;
      set((state) => ({
        checkpointState: {
          ...state.checkpointState,
          status: 'done',
          lastForkRunId: forkRunId,
          editedOutput: null,
        },
        executionLogs: appendLog(state.executionLogs, `Fork started: new run "${forkRunId}".`),
      }));
    } catch (err) {
      set((state) => ({
        checkpointState: {
          ...state.checkpointState,
          status: 'error',
          error: getErrorMessage(err),
        },
        executionLogs: appendLog(state.executionLogs, `Fork failed: ${getErrorMessage(err)}`),
      }));
    }
  },

  setEditedOutput: (text) => {
    set((state) => ({
      checkpointState: { ...state.checkpointState, editedOutput: text },
    }));
  },

  resetCheckpoints: () => {
    set({ checkpointState: { ...INITIAL_CHECKPOINT_STATE } });
  },

  // ── Scorecard ──────────────────────────────────────────────────────────────

  runScorecard: async (opts = {}) => {
    const api = window.helioxAPI;
    if (!api) {
      set((state) => ({
        scorecard: {
          ...state.scorecard,
          status: 'error',
          error: 'Heliox IPC bridge is unavailable.',
        },
      }));
      return;
    }

    // Subscribe to incremental progress events if the bridge exposes them.
    // The preload exposes `onScorecardProgress` when registered; gracefully skip
    // if not yet wired in the preload (forward-compatible).
    let progressUnsubscribe: (() => void) | null = null;
    const bridgeWithPF = api as typeof api & {
      onScorecardProgress?: (cb: (e: ScorecardProgressEvent) => void) => () => void;
    };
    if (typeof bridgeWithPF.onScorecardProgress === 'function') {
      progressUnsubscribe = bridgeWithPF.onScorecardProgress((event) => {
        set((state) => ({
          scorecard: {
            ...state.scorecard,
            progressMessages: [...state.scorecard.progressMessages, event],
          },
        }));
      });
    }

    set((state) => ({
      scorecard: {
        ...INITIAL_SCORECARD_STATE,
        status: 'running',
        scorecardProgressUnsubscribe: progressUnsubscribe ?? state.scorecard.scorecardProgressUnsubscribe,
      },
    }));

    try {
      const bridgeWithRun = api as typeof api & {
        runScorecard?: (opts: ScorecardRunOptions) => Promise<{ success: boolean; data?: ScorecardResult; error?: string }>;
      };

      if (typeof bridgeWithRun.runScorecard !== 'function') {
        throw new Error('pf:run-scorecard IPC handler is not registered in the preload bridge.');
      }

      const response = await bridgeWithRun.runScorecard(opts);

      if (!response.success || !response.data) {
        throw new Error(response.error ?? 'Scorecard run returned no data.');
      }

      set((state) => ({
        scorecard: {
          ...state.scorecard,
          status: 'done',
          result: response.data ?? null,
          error: null,
        },
      }));
    } catch (err) {
      set((state) => ({
        scorecard: {
          ...state.scorecard,
          status: 'error',
          error: getErrorMessage(err),
        },
      }));
    } finally {
      if (progressUnsubscribe) {
        progressUnsubscribe();
        set((state) => ({
          scorecard: {
            ...state.scorecard,
            scorecardProgressUnsubscribe: null,
          },
        }));
      }
    }
  },

  resetScorecard: () => {
    const { scorecardProgressUnsubscribe } = get().scorecard;
    if (scorecardProgressUnsubscribe) scorecardProgressUnsubscribe();
    set({ scorecard: { ...INITIAL_SCORECARD_STATE } });
  },

  // ── Arena ─────────────────────────────────────────────────────────────────

  runArena: async (opts = {}) => {
    const api = window.helioxAPI;
    if (!api) {
      set((state) => ({
        arena: {
          ...state.arena,
          status: 'error',
          error: 'Heliox IPC bridge is unavailable.',
        },
      }));
      return;
    }

    // Subscribe to incremental per-model progress events.
    let progressUnsubscribe: (() => void) | null = null;
    const bridgeWithArena = api as typeof api & {
      onArenaProgress?: (cb: (e: ArenaProgressEvent) => void) => () => void;
    };
    if (typeof bridgeWithArena.onArenaProgress === 'function') {
      progressUnsubscribe = bridgeWithArena.onArenaProgress((event) => {
        set((state) => ({
          arena: {
            ...state.arena,
            progressEvents: [...state.arena.progressEvents, event],
          },
        }));
      });
    }

    set((state) => ({
      arena: {
        ...INITIAL_ARENA_STATE,
        status: 'running',
        arenaProgressUnsubscribe: progressUnsubscribe ?? state.arena.arenaProgressUnsubscribe,
        deployChosenModelId: state.arena.deployChosenModelId,
      },
    }));

    try {
      const bridgeWithRun = api as typeof api & {
        runArena?: (opts: ArenaRunOptions) => Promise<{ success: boolean; data?: ArenaResult; error?: string }>;
      };

      if (typeof bridgeWithRun.runArena !== 'function') {
        throw new Error('pf:run-arena IPC handler is not registered in the preload bridge.');
      }

      const response = await bridgeWithRun.runArena(opts);

      if (!response.success || !response.data) {
        throw new Error(response.error ?? 'Arena run returned no data.');
      }

      set((state) => ({
        arena: {
          ...state.arena,
          status: 'done',
          result: response.data ?? null,
          error: null,
        },
      }));
    } catch (err) {
      set((state) => ({
        arena: {
          ...state.arena,
          status: 'error',
          error: getErrorMessage(err),
        },
      }));
    } finally {
      if (progressUnsubscribe) {
        progressUnsubscribe();
        set((state) => ({
          arena: {
            ...state.arena,
            arenaProgressUnsubscribe: null,
          },
        }));
      }
    }
  },

  resetArena: () => {
    const { arenaProgressUnsubscribe } = get().arena;
    if (arenaProgressUnsubscribe) arenaProgressUnsubscribe();
    set({ arena: { ...INITIAL_ARENA_STATE } });
  },

  setArenaDeployModel: (modelId) => {
    set((state) => ({
      arena: { ...state.arena, deployChosenModelId: modelId },
    }));
  },
  };
});
