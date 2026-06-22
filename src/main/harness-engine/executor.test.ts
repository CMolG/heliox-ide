import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgenticFlow, AgenticStep } from '@/types/harness';
import type { HarnessEventPayload } from '@/types/ipc-events';
import {
  HARNESS_EVENT_CHANNEL,
  HARNESS_EVENT_NAME,
  harnessEventBus,
  setHarnessEventWindow,
} from './event-bus';
import { executeAgenticFlow } from './executor';

function makeStep(
  id: string,
  prevStepIds: string[],
  nextStepIds: string[],
  mods: AgenticStep['mods'] = [],
): AgenticStep {
  return {
    id,
    type: 'llm_call',
    prompt: `Prompt for ${id}`,
    tools: [],
    prevStepIds,
    nextStepIds,
    mods,
    roles: [],
    mentalContext: [],
  };
}

function makeFlow(): AgenticFlow {
  return {
    id: 'flow-converged',
    name: 'Converged DAG',
    rootStepId: 'root',
    stepsRecord: {
      root: makeStep('root', [], ['branch-a', 'branch-b']),
      'branch-a': makeStep('branch-a', ['root'], ['merge'], [
        { id: 'mod-a', name: 'Mod A', type: 'system_override' },
      ]),
      'branch-b': makeStep('branch-b', ['root'], ['merge'], [
        { id: 'mod-b', name: 'Mod B', type: 'system_override' },
      ]),
      merge: makeStep('merge', ['branch-a', 'branch-b'], []),
    },
  };
}

describe('harness event bus', () => {
  afterEach(() => {
    setHarnessEventWindow(null);
    harnessEventBus.removeAllListeners();
  });

  it('routes harness payloads to Electron and local listeners', () => {
    const payload: HarnessEventPayload = {
      type: 'FlowStarted',
      flowId: 'flow-1',
      timestamp: 10,
    };
    const send = vi.fn();
    const observed: HarnessEventPayload[] = [];

    setHarnessEventWindow({ webContents: { send } } as any);
    harnessEventBus.on(HARNESS_EVENT_NAME, (event) => observed.push(event));

    harnessEventBus.emitHarnessEvent(payload);

    expect(send).toHaveBeenCalledWith(HARNESS_EVENT_CHANNEL, payload);
    expect(observed).toEqual([payload]);
  });
});

describe('executeAgenticFlow', () => {
  afterEach(() => {
    harnessEventBus.removeAllListeners();
  });

  it('waits for all previous steps before running a converged next step', async () => {
    const events: HarnessEventPayload[] = [];
    harnessEventBus.on(HARNESS_EVENT_NAME, (event) => events.push(event));
    const runStep = vi.fn(async ({ step }: { step: AgenticStep }) => ({
      text: `output:${step.id}`,
      usage: null,
      toolCalls: [],
      toolResults: [],
    }));

    await executeAgenticFlow(makeFlow(), { runStep });

    const stepEvents = events.filter(
      (event): event is Extract<HarnessEventPayload, { type: 'StepStatusChanged' }> =>
        event.type === 'StepStatusChanged',
    );
    const runningSteps = stepEvents
      .filter((event) => event.status === 'running')
      .map((event) => event.stepId);

    expect(runningSteps).toEqual(['root', 'branch-a', 'branch-b', 'merge']);

    const mergeRunningIndex = stepEvents.findIndex(
      (event) => event.stepId === 'merge' && event.status === 'running',
    );
    const branchACompletedIndex = stepEvents.findIndex(
      (event) => event.stepId === 'branch-a' && event.status === 'completed',
    );
    const branchBCompletedIndex = stepEvents.findIndex(
      (event) => event.stepId === 'branch-b' && event.status === 'completed',
    );

    expect(mergeRunningIndex).toBeGreaterThan(branchACompletedIndex);
    expect(mergeRunningIndex).toBeGreaterThan(branchBCompletedIndex);
    expect(events.at(-1)).toMatchObject({
      type: 'FlowCompleted',
      flowId: 'flow-converged',
    });
    expect(runStep).toHaveBeenCalledTimes(4);
    expect(stepEvents.find((event) => event.stepId === 'root' && event.status === 'completed')?.logs)
      .toContain('output:root');
  });

  it('emits a step error when the LLM runner fails', async () => {
    const events: HarnessEventPayload[] = [];
    harnessEventBus.on(HARNESS_EVENT_NAME, (event) => events.push(event));

    await expect(executeAgenticFlow(makeFlow(), {
      runStep: async ({ step }) => {
        if (step.id === 'branch-a') throw new Error('provider timeout');
        return { text: `output:${step.id}`, usage: null, toolCalls: [], toolResults: [] };
      },
    })).rejects.toThrow('provider timeout');

    expect(events).toContainEqual(expect.objectContaining({
      type: 'StepStatusChanged',
      stepId: 'branch-a',
      status: 'error',
      logs: 'provider timeout',
    }));
  });
});
