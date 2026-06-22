import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HarnessEventPayload } from '@/types/ipc-events';
import { useDesktopStore } from '../store/desktop-store';
import { useHarnessStore } from '../store/harness-store';

describe('useHarnessStore', () => {
  beforeEach(() => {
    useDesktopStore.setState(useDesktopStore.getInitialState(), true);
    useHarnessStore.setState(useHarnessStore.getInitialState(), true);
    delete window.helioxAPI;
  });

  it('compiles the current desktop canvas into activeFlow', () => {
    const desktop = useDesktopStore.getState();
    const rootId = desktop.addStepNode({
      id: 'step-root',
      title: 'Root',
      description: 'Start from the current canvas.',
      mods: [{
        id: 'strict-linting',
        name: 'Strict Linting',
        type: 'system_override',
        config: { level: 'strict' },
        icon: 'MdRule',
        iconLibrary: 'md',
        description: 'Lint with strict defaults',
        tags: ['quality'],
      } as any],
      roles: [{
        id: 'planner',
        name: 'Planner',
        systemPrompt: 'Plan before touching files.',
        icon: 'MdAssignment',
        iconLibrary: 'md',
        color: '#E87040',
        description: 'Plans work',
        tags: ['planning'],
      } as any],
    });
    const nextId = desktop.addStepNode({ id: 'step-next', title: 'Next' });
    desktop.addMentalEdge(rootId, nextId);

    const flow = useHarnessStore.getState().compileCurrentCanvas();

    expect(flow?.rootStepId).toBe(rootId);
    expect(useHarnessStore.getState().activeFlow).toBe(flow);
    expect(useHarnessStore.getState().executionStatus).toBe('idle');
    expect(flow?.stepsRecord[rootId].nextStepIds).toEqual([nextId]);
    expect(flow?.stepsRecord[rootId].mods).toEqual([{
      id: 'strict-linting',
      name: 'Strict Linting',
      type: 'system_override',
      config: { level: 'strict' },
    }]);
    expect(flow?.stepsRecord[rootId].roles).toEqual([{
      id: 'planner',
      name: 'Planner',
      systemPrompt: 'Plan before touching files.',
    }]);
    expect(useHarnessStore.getState().executionLogs.at(-1)).toContain('Compiled flow');
  });

  it('starts active flow through the harness IPC bridge', async () => {
    const desktop = useDesktopStore.getState();
    desktop.addStepNode({ id: 'step-root', title: 'Root' });
    const flow = useHarnessStore.getState().compileCurrentCanvas();
    const startHarness = vi.fn().mockResolvedValue({ success: true });
    window.helioxAPI = {
      startHarness,
      onHarnessEvent: vi.fn(() => vi.fn()),
    } as any;

    await useHarnessStore.getState().startExecution();

    expect(startHarness).toHaveBeenCalledWith(flow);
    expect(useHarnessStore.getState().executionStatus).toBe('running');
    expect(useHarnessStore.getState().currentStepId).toBe('step-root');
  });

  it('subscribes once to harness events and tracks per-step status', () => {
    const callbacks: Array<(event: HarnessEventPayload) => void> = [];
    const unsubscribe = vi.fn();
    window.helioxAPI = {
      onHarnessEvent: vi.fn((callback: (event: HarnessEventPayload) => void) => {
        callbacks.push(callback);
        return unsubscribe;
      }),
    } as any;

    useHarnessStore.getState().subscribeToHarnessEvents();
    useHarnessStore.getState().subscribeToHarnessEvents();

    const api = window.helioxAPI!;
    expect(api.onHarnessEvent).toHaveBeenCalledTimes(1);

    callbacks[0]({
      type: 'FlowStarted',
      flowId: 'flow-step-root',
      timestamp: 1,
    });
    callbacks[0]({
      type: 'StepStatusChanged',
      flowId: 'flow-step-root',
      timestamp: 2,
      stepId: 'step-root',
      status: 'running',
      logs: 'Root started.',
    });
    callbacks[0]({
      type: 'StepStatusChanged',
      flowId: 'flow-step-root',
      timestamp: 3,
      stepId: 'step-root',
      status: 'completed',
      logs: 'Root completed.',
    });

    expect(useHarnessStore.getState().executionStatus).toBe('running');
    expect(useHarnessStore.getState().currentStepId).toBe('step-root');
    expect(useHarnessStore.getState().stepStatuses['step-root']).toBe('completed');
    expect(useHarnessStore.getState().executionLogs.at(-1)).toContain('Root completed.');

    useHarnessStore.getState().unsubscribeFromHarnessEvents();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
