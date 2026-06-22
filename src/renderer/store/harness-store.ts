/**
 * harness-store.ts — Logical execution state for compiled agentic flows
 *
 * This store deliberately stays independent from desktop-store rendering state.
 */
import { create } from 'zustand';
import type { AgenticExecutionStatus, AgenticFlow } from '@/types/harness';
import type { HarnessEventPayload } from '@/types/ipc-events';
import { compileFlowFromCanvas } from '../lib/harness-compiler';
import { useDesktopStore } from './desktop-store';

const MAX_EXECUTION_LOGS = 500;

interface HarnessStore {
  activeFlow: AgenticFlow | null;
  executionStatus: AgenticExecutionStatus;
  currentStepId: string | null;
  stepStatuses: Record<string, AgenticExecutionStatus>;
  modStatuses: Record<string, AgenticExecutionStatus>;
  executionLogs: string[];
  harnessEventUnsubscribe: (() => void) | null;
  compileCurrentCanvas: () => AgenticFlow | null;
  startExecution: () => Promise<void>;
  stopExecution: () => void;
  setStepStatus: (stepId: string | null, status?: AgenticExecutionStatus) => void;
  handleHarnessEvent: (event: HarnessEventPayload) => void;
  subscribeToHarnessEvents: () => void;
  unsubscribeFromHarnessEvents: () => void;
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

export const useHarnessStore = create<HarnessStore>((set, get) => ({
  activeFlow: null,
  executionStatus: 'idle',
  currentStepId: null,
  stepStatuses: {},
  modStatuses: {},
  executionLogs: [],
  harnessEventUnsubscribe: null,

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
      currentStepId: activeFlow.rootStepId,
      stepStatuses: {
        ...state.stepStatuses,
        [activeFlow.rootStepId]: 'running',
      },
      executionLogs: appendLog(state.executionLogs, `Execution cursor started at "${activeFlow.rootStepId}".`),
    }));

    try {
      const result = await api.startHarness(activeFlow);
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
  },

  stopExecution: () => {
    set((state) => ({
      executionStatus: 'idle',
      currentStepId: null,
      stepStatuses: {},
      modStatuses: {},
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
}));
