import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HarnessEventPayload } from '@/types/ipc-events';
import { useDesktopStore } from '../store/desktop-store';
import { useHarnessStore, lastLogMessage } from '../store/harness-store';

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

    // Default dispatch (no policy/deploy choice set): fixed policy, no modelId.
    expect(startHarness).toHaveBeenCalledWith(flow, { modelPolicy: { mode: 'fixed' }, modelId: undefined });
    expect(useHarnessStore.getState().executionStatus).toBe('running');
    expect(useHarnessStore.getState().currentStepId).toBe('step-root');
  });

  it('executeFlow passes the desktop store\'s modelPolicy and the Arena deploy-chosen model to startHarness', async () => {
    const desktop = useDesktopStore.getState();
    desktop.addStepNode({ id: 'step-root', title: 'Root' });
    desktop.setModelPolicy({ mode: 'smart-local', strategy: 'best-value' });
    useHarnessStore.getState().setArenaDeployModel('z-ai/glm-5.2');
    const flow = useHarnessStore.getState().compileCurrentCanvas();

    const startHarness = vi.fn().mockResolvedValue({ success: true });
    window.helioxAPI = {
      startHarness,
      onHarnessEvent: vi.fn(() => vi.fn()),
    } as any;

    await useHarnessStore.getState().startExecution();

    expect(startHarness).toHaveBeenCalledWith(flow, {
      modelPolicy: { mode: 'smart-local', strategy: 'best-value' },
      modelId: 'z-ai/glm-5.2',
    });
  });

  it('runStep executes a single step in isolation, ignoring its real canvas neighbors', async () => {
    const desktop = useDesktopStore.getState();
    const rootId = desktop.addStepNode({ id: 'step-root', title: 'Root' });
    const midId = desktop.addStepNode({ id: 'step-mid', title: 'Mid' });
    const leafId = desktop.addStepNode({ id: 'step-leaf', title: 'Leaf' });
    desktop.addMentalEdge(rootId, midId);
    desktop.addMentalEdge(midId, leafId);

    const startHarness = vi.fn().mockResolvedValue({ success: true });
    window.helioxAPI = {
      startHarness,
      onHarnessEvent: vi.fn(() => vi.fn()),
    } as any;

    await useHarnessStore.getState().runStep(midId);

    expect(startHarness).toHaveBeenCalledTimes(1);
    const dispatchedFlow = startHarness.mock.calls[0][0];
    expect(dispatchedFlow.rootStepId).toBe(midId);
    expect(Object.keys(dispatchedFlow.stepsRecord)).toEqual([midId]);
    expect(dispatchedFlow.stepsRecord[midId].prevStepIds).toEqual([]);
    expect(dispatchedFlow.stepsRecord[midId].nextStepIds).toEqual([]);

    expect(useHarnessStore.getState().activeFlow).toBe(dispatchedFlow);
    expect(useHarnessStore.getState().executionStatus).toBe('running');
    expect(useHarnessStore.getState().currentStepId).toBe(midId);
  });

  it('runFromStep includes only the downstream subgraph (chain + branch), excluding ancestors and unrelated nodes', async () => {
    const desktop = useDesktopStore.getState();
    const rootId = desktop.addStepNode({ id: 'step-root', title: 'Root' });
    const midId = desktop.addStepNode({ id: 'step-mid', title: 'Mid' });
    const leafId = desktop.addStepNode({ id: 'step-leaf', title: 'Leaf' });
    const branchId = desktop.addStepNode({ id: 'step-branch', title: 'Branch' });
    const otherId = desktop.addStepNode({ id: 'step-other', title: 'Unrelated' });
    desktop.addMentalEdge(rootId, midId);
    desktop.addMentalEdge(midId, leafId);
    desktop.addMentalEdge(midId, branchId);

    const startHarness = vi.fn().mockResolvedValue({ success: true });
    window.helioxAPI = {
      startHarness,
      onHarnessEvent: vi.fn(() => vi.fn()),
    } as any;

    await useHarnessStore.getState().runFromStep(midId);

    expect(startHarness).toHaveBeenCalledTimes(1);
    const dispatchedFlow = startHarness.mock.calls[0][0];
    expect(dispatchedFlow.rootStepId).toBe(midId);
    expect(new Set(Object.keys(dispatchedFlow.stepsRecord))).toEqual(new Set([midId, leafId, branchId]));
    expect(dispatchedFlow.stepsRecord[rootId]).toBeUndefined();
    expect(dispatchedFlow.stepsRecord[otherId]).toBeUndefined();
    expect(dispatchedFlow.stepsRecord[midId].prevStepIds).toEqual([]);
    expect(dispatchedFlow.stepsRecord[midId].nextStepIds).toEqual([leafId, branchId]);
    expect(dispatchedFlow.stepsRecord[leafId].prevStepIds).toEqual([midId]);
    expect(dispatchedFlow.stepsRecord[branchId].prevStepIds).toEqual([midId]);

    expect(useHarnessStore.getState().activeFlow).toBe(dispatchedFlow);
    expect(useHarnessStore.getState().executionStatus).toBe('running');
  });

  it('runStep fails softly on an unknown stepId without invoking startHarness', async () => {
    useDesktopStore.getState().addStepNode({ id: 'step-root', title: 'Root' });
    const startHarness = vi.fn().mockResolvedValue({ success: true });
    window.helioxAPI = {
      startHarness,
      onHarnessEvent: vi.fn(() => vi.fn()),
    } as any;

    await useHarnessStore.getState().runStep('does-not-exist');

    expect(startHarness).not.toHaveBeenCalled();
    expect(useHarnessStore.getState().executionStatus).toBe('error');
    expect(useHarnessStore.getState().executionLogs.at(-1)).toContain('does-not-exist');
  });

  it('runFromStep fails softly on an unknown stepId without invoking startHarness', async () => {
    useDesktopStore.getState().addStepNode({ id: 'step-root', title: 'Root' });
    const startHarness = vi.fn().mockResolvedValue({ success: true });
    window.helioxAPI = {
      startHarness,
      onHarnessEvent: vi.fn(() => vi.fn()),
    } as any;

    await useHarnessStore.getState().runFromStep('also-missing');

    expect(startHarness).not.toHaveBeenCalled();
    expect(useHarnessStore.getState().executionStatus).toBe('error');
    expect(useHarnessStore.getState().executionLogs.at(-1)).toContain('also-missing');
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

  describe('stepIterations', () => {
    function subscribeAndCapture(): Array<(event: HarnessEventPayload) => void> {
      const callbacks: Array<(event: HarnessEventPayload) => void> = [];
      window.helioxAPI = {
        onHarnessEvent: vi.fn((callback: (event: HarnessEventPayload) => void) => {
          callbacks.push(callback);
          return vi.fn();
        }),
      } as any;
      useHarnessStore.getState().subscribeToHarnessEvents();
      return callbacks;
    }

    it('a StepStatusChanged event carrying iteration/totalIterations/loopId populates stepIterations', () => {
      const callbacks = subscribeAndCapture();

      callbacks[0]({
        type: 'StepStatusChanged',
        flowId: 'flow-1',
        timestamp: 1,
        stepId: 'step-loop',
        status: 'running',
        iteration: 2,
        totalIterations: 5,
        loopId: 'loop-1',
      });

      expect(useHarnessStore.getState().stepIterations['step-loop']).toEqual({
        iteration: 2,
        total: 5,
        loopId: 'loop-1',
      });
    });

    it('defaults total to iteration and loopId to "" when the event omits them', () => {
      const callbacks = subscribeAndCapture();

      callbacks[0]({
        type: 'StepStatusChanged',
        flowId: 'flow-1',
        timestamp: 1,
        stepId: 'step-loop',
        status: 'running',
        iteration: 1,
      });

      expect(useHarnessStore.getState().stepIterations['step-loop']).toEqual({
        iteration: 1,
        total: 1,
        loopId: '',
      });
    });

    it('a plain StepStatusChanged (no iteration) leaves existing stepIterations untouched', () => {
      const callbacks = subscribeAndCapture();

      callbacks[0]({
        type: 'StepStatusChanged',
        flowId: 'flow-1',
        timestamp: 1,
        stepId: 'step-loop',
        status: 'running',
        iteration: 2,
        totalIterations: 5,
        loopId: 'loop-1',
      });
      callbacks[0]({
        type: 'StepStatusChanged',
        flowId: 'flow-1',
        timestamp: 2,
        stepId: 'step-loop',
        status: 'running',
        logs: 'still working',
      });

      expect(useHarnessStore.getState().stepIterations['step-loop']).toEqual({
        iteration: 2,
        total: 5,
        loopId: 'loop-1',
      });
    });

    it('a reset (stopExecution) empties stepIterations', () => {
      const callbacks = subscribeAndCapture();
      callbacks[0]({
        type: 'StepStatusChanged',
        flowId: 'flow-1',
        timestamp: 1,
        stepId: 'step-loop',
        status: 'running',
        iteration: 1,
        totalIterations: 3,
        loopId: 'loop-1',
      });
      expect(useHarnessStore.getState().stepIterations).not.toEqual({});

      useHarnessStore.getState().stopExecution();

      expect(useHarnessStore.getState().stepIterations).toEqual({});
    });

    it('a reset (compileCurrentCanvas) empties stepIterations', () => {
      const desktop = useDesktopStore.getState();
      desktop.addStepNode({ id: 'step-root', title: 'Root' });
      const callbacks = subscribeAndCapture();
      callbacks[0]({
        type: 'StepStatusChanged',
        flowId: 'flow-1',
        timestamp: 1,
        stepId: 'step-root',
        status: 'running',
        iteration: 1,
        totalIterations: 3,
        loopId: 'loop-1',
      });
      expect(useHarnessStore.getState().stepIterations).not.toEqual({});

      useHarnessStore.getState().compileCurrentCanvas();

      expect(useHarnessStore.getState().stepIterations).toEqual({});
    });
  });

  describe('stepModels', () => {
    function subscribeAndCapture(): Array<(event: HarnessEventPayload) => void> {
      const callbacks: Array<(event: HarnessEventPayload) => void> = [];
      window.helioxAPI = {
        onHarnessEvent: vi.fn((callback: (event: HarnessEventPayload) => void) => {
          callbacks.push(callback);
          return vi.fn();
        }),
      } as any;
      useHarnessStore.getState().subscribeToHarnessEvents();
      return callbacks;
    }

    it('a StepStatusChanged event carrying modelId + modelEvidence populates stepModels', () => {
      const callbacks = subscribeAndCapture();

      callbacks[0]({
        type: 'StepStatusChanged',
        flowId: 'flow-1',
        timestamp: 1,
        stepId: 'step-routed',
        status: 'completed',
        modelId: 'z-ai/glm-5.2',
        modelEvidence: {
          source: 'arena-leaderboard',
          strategy: 'best-score',
          reason: 'best-score winner: score 90 at $0.01/run',
          sealed: true,
        },
      });

      expect(useHarnessStore.getState().stepModels['step-routed']).toEqual({
        modelId: 'z-ai/glm-5.2',
        evidence: {
          source: 'arena-leaderboard',
          strategy: 'best-score',
          reason: 'best-score winner: score 90 at $0.01/run',
          sealed: true,
        },
      });
    });

    it('a StepStatusChanged event carrying modelId but no modelEvidence still populates stepModels, with evidence omitted', () => {
      const callbacks = subscribeAndCapture();

      callbacks[0]({
        type: 'StepStatusChanged',
        flowId: 'flow-1',
        timestamp: 1,
        stepId: 'step-plain',
        status: 'completed',
        modelId: 'openai/gpt-4o-mini',
      });

      expect(useHarnessStore.getState().stepModels['step-plain']).toEqual({ modelId: 'openai/gpt-4o-mini' });
    });

    it('a plain StepStatusChanged (no modelId) leaves existing stepModels untouched', () => {
      const callbacks = subscribeAndCapture();

      callbacks[0]({
        type: 'StepStatusChanged',
        flowId: 'flow-1',
        timestamp: 1,
        stepId: 'step-routed',
        status: 'running',
        modelId: 'z-ai/glm-5.2',
      });
      callbacks[0]({
        type: 'StepStatusChanged',
        flowId: 'flow-1',
        timestamp: 2,
        stepId: 'step-routed',
        status: 'completed',
        logs: 'done',
      });

      expect(useHarnessStore.getState().stepModels['step-routed']).toEqual({ modelId: 'z-ai/glm-5.2' });
    });

    it('a reset (stopExecution) empties stepModels', () => {
      const callbacks = subscribeAndCapture();
      callbacks[0]({
        type: 'StepStatusChanged',
        flowId: 'flow-1',
        timestamp: 1,
        stepId: 'step-routed',
        status: 'completed',
        modelId: 'z-ai/glm-5.2',
      });
      expect(useHarnessStore.getState().stepModels).not.toEqual({});

      useHarnessStore.getState().stopExecution();

      expect(useHarnessStore.getState().stepModels).toEqual({});
    });

    it('a reset (compileCurrentCanvas) empties stepModels', () => {
      const desktop = useDesktopStore.getState();
      desktop.addStepNode({ id: 'step-root', title: 'Root' });
      const callbacks = subscribeAndCapture();
      callbacks[0]({
        type: 'StepStatusChanged',
        flowId: 'flow-1',
        timestamp: 1,
        stepId: 'step-root',
        status: 'completed',
        modelId: 'z-ai/glm-5.2',
      });
      expect(useHarnessStore.getState().stepModels).not.toEqual({});

      useHarnessStore.getState().compileCurrentCanvas();

      expect(useHarnessStore.getState().stepModels).toEqual({});
    });
  });

  describe('lastLogMessage', () => {
    it('returns null for an empty log array (no run has happened yet)', () => {
      expect(lastLogMessage([])).toBeNull();
    });

    it('strips the leading ISO-timestamp token formatLog prepends', () => {
      expect(lastLogMessage(['2026-01-01T00:00:00.000Z Harness failed to start: boom']))
        .toBe('Harness failed to start: boom');
    });

    it('reads only the most recent entry, ignoring earlier ones', () => {
      const logs = [
        '2026-01-01T00:00:00.000Z Compiling current canvas.',
        '2026-01-01T00:00:01.000Z Compiled flow "demo" with 1 step(s).',
        '2026-01-01T00:00:02.000Z Cannot start execution because the harness IPC bridge is unavailable.',
      ];
      expect(lastLogMessage(logs)).toBe('Cannot start execution because the harness IPC bridge is unavailable.');
    });

    it('returns a timestamp-less entry unchanged instead of mangling it (no whitespace to split on)', () => {
      expect(lastLogMessage(['no-timestamp-single-token'])).toBe('no-timestamp-single-token');
    });

    it('reflects the real message harness-store produces for a missing IPC bridge', async () => {
      const desktop = useDesktopStore.getState();
      desktop.addStepNode({ id: 'step-root', title: 'Root' });
      useHarnessStore.getState().compileCurrentCanvas();
      delete window.helioxAPI; // no bridge — executeFlow's first guard

      await useHarnessStore.getState().startExecution();

      expect(useHarnessStore.getState().executionStatus).toBe('error');
      expect(lastLogMessage(useHarnessStore.getState().executionLogs))
        .toBe('Cannot start execution because the harness IPC bridge is unavailable.');
    });
  });
});
