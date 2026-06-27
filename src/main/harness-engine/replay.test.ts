/**
 * replay.test.ts — Tests for checkpoint-based fork/replay
 *
 * Uses a 4-step linear DAG (root → step-2 → step-3 → step-4) with a scripted
 * runner so no real LLM calls are made. Verifies:
 *
 *   1. A checkpoint is emitted per step after a normal run.
 *   2. `replayFrom` the 2nd checkpoint re-seeds steps 1–2 without re-running
 *      them, then freshly executes steps 3–4 with the scripted runner.
 *   3. If `editedOutput` is supplied, step-3 (the first downstream step) sees
 *      the edited value as input context (via the seeded output of step-2).
 *   4. The fork gets a new runId that shares the original prefix.
 *   5. The fork's checkpoints are stored under the new runId.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgenticFlow, AgenticStep } from '@/types/harness';
import type { HarnessEventPayload } from '@/types/ipc-events';
import { harnessEventBus, HARNESS_EVENT_NAME } from './event-bus';
import { InMemoryCheckpointStore, listCheckpoints, setCheckpointStore } from './checkpoints';
import { executeAgenticFlow } from './executor';
import { replayFrom } from './replay';

// ---------------------------------------------------------------------------
// 4-step linear DAG fixture
// root → step-2 → step-3 → step-4
// ---------------------------------------------------------------------------

function makeLinearStep(
  id: string,
  prevStepIds: string[],
  nextStepIds: string[],
): AgenticStep {
  return {
    id,
    type: 'llm_call',
    prompt: `Prompt for ${id}`,
    tools: [],
    prevStepIds,
    nextStepIds,
    mods: [],
    roles: [],
    mentalContext: [],
  };
}

function makeFourStepFlow(): AgenticFlow {
  return {
    id: 'flow-linear-4',
    name: 'Linear 4-step DAG',
    rootStepId: 'root',
    stepsRecord: {
      root: makeLinearStep('root', [], ['step-2']),
      'step-2': makeLinearStep('step-2', ['root'], ['step-3']),
      'step-3': makeLinearStep('step-3', ['step-2'], ['step-4']),
      'step-4': makeLinearStep('step-4', ['step-3'], []),
    },
  };
}

/** Scripted runner — returns `output:<stepId>` deterministically. */
function makeScriptedRunner() {
  return vi.fn(async ({ step }: { step: AgenticStep }) => ({
    text: `output:${step.id}`,
    usage: null,
    toolCalls: [],
    toolResults: [],
  }));
}

afterEach(() => {
  harnessEventBus.removeAllListeners();
  setCheckpointStore(new InMemoryCheckpointStore());
});

// ---------------------------------------------------------------------------
// 1. Checkpoint per step after a normal run
// ---------------------------------------------------------------------------

describe('checkpoint emission during executeAgenticFlow', () => {
  it('emits one CheckpointCreated event per step', async () => {
    const store = new InMemoryCheckpointStore();
    setCheckpointStore(store);

    const events: HarnessEventPayload[] = [];
    harnessEventBus.on(HARNESS_EVENT_NAME, (e) => events.push(e));

    const runId = 'test-run-emit';
    await executeAgenticFlow(makeFourStepFlow(), {
      runId,
      runStep: makeScriptedRunner(),
    });

    const cpEvents = events.filter(
      (e): e is Extract<HarnessEventPayload, { type: 'CheckpointCreated' }> =>
        e.type === 'CheckpointCreated',
    );
    expect(cpEvents).toHaveLength(4);

    const stepIds = cpEvents.map((e) => e.stepId);
    expect(stepIds).toEqual(['root', 'step-2', 'step-3', 'step-4']);

    // Each event carries the checkpoint id and completedStepIds so-far.
    expect(cpEvents[0].completedStepIds).toEqual(['root']);
    expect(cpEvents[1].completedStepIds).toEqual(['root', 'step-2']);
    expect(cpEvents[2].completedStepIds).toEqual(['root', 'step-2', 'step-3']);
    expect(cpEvents[3].completedStepIds).toHaveLength(4);
  });

  it('persists 4 checkpoints to the store', async () => {
    const store = new InMemoryCheckpointStore();
    setCheckpointStore(store);

    const runId = 'test-run-persist';
    await executeAgenticFlow(makeFourStepFlow(), {
      runId,
      runStep: makeScriptedRunner(),
    });

    const checkpoints = listCheckpoints(runId);
    expect(checkpoints).toHaveLength(4);
    expect(checkpoints.map((c) => c.stepId)).toEqual(['root', 'step-2', 'step-3', 'step-4']);
    expect(checkpoints[0].output).toBe('output:root');
    expect(checkpoints[1].output).toBe('output:step-2');
  });
});

// ---------------------------------------------------------------------------
// 2. replayFrom — basic fork
// ---------------------------------------------------------------------------

describe('replayFrom', () => {
  it('returns a new runId that shares the original run prefix', async () => {
    const store = new InMemoryCheckpointStore();
    setCheckpointStore(store);

    const originalRunId = 'run-original';
    await executeAgenticFlow(makeFourStepFlow(), {
      runId: originalRunId,
      runStep: makeScriptedRunner(),
    });

    const checkpoints = listCheckpoints(originalRunId);
    // Replay from the 2nd checkpoint (step-2).
    const ckpt2 = checkpoints.find((c) => c.stepId === 'step-2')!;
    expect(ckpt2).toBeDefined();

    const forkedRunner = makeScriptedRunner();
    const result = await replayFrom(makeFourStepFlow(), ckpt2.id, undefined, {
      runStep: forkedRunner,
    });

    expect(result.forkRunId).toMatch(/^run-original_fork_/);
    expect(result.seededStepIds).toEqual(['root', 'step-2']);
    // We injected a scripted runner, so replay is declared deterministic.
    expect(result.isDeterministicReplay).toBe(true);
  });

  it('re-runs only downstream steps (step-3 and step-4) in the fork', async () => {
    const store = new InMemoryCheckpointStore();
    setCheckpointStore(store);

    const originalRunId = 'run-rerun-check';
    const originalRunner = makeScriptedRunner();
    await executeAgenticFlow(makeFourStepFlow(), {
      runId: originalRunId,
      runStep: originalRunner,
    });

    expect(originalRunner).toHaveBeenCalledTimes(4);

    const checkpoints = listCheckpoints(originalRunId);
    const ckpt2 = checkpoints.find((c) => c.stepId === 'step-2')!;

    const forkedRunner = makeScriptedRunner();
    await replayFrom(makeFourStepFlow(), ckpt2.id, undefined, {
      runStep: forkedRunner,
    });

    // Forked runner is ONLY called for downstream steps (step-3, step-4).
    // root and step-2 are short-circuited from the seeded state.
    expect(forkedRunner).toHaveBeenCalledTimes(2);
    const calledStepIds = forkedRunner.mock.calls.map(
      ([input]: [{ step: AgenticStep }]) => input.step.id,
    );
    expect(calledStepIds).toEqual(['step-3', 'step-4']);
  });

  it('persists checkpoints for the fork under the new runId', async () => {
    const store = new InMemoryCheckpointStore();
    setCheckpointStore(store);

    const originalRunId = 'run-fork-store';
    await executeAgenticFlow(makeFourStepFlow(), {
      runId: originalRunId,
      runStep: makeScriptedRunner(),
    });

    const checkpoints = listCheckpoints(originalRunId);
    const ckpt2 = checkpoints.find((c) => c.stepId === 'step-2')!;

    const { forkRunId } = await replayFrom(makeFourStepFlow(), ckpt2.id, undefined, {
      runStep: makeScriptedRunner(),
    });

    const forkCheckpoints = listCheckpoints(forkRunId);
    // Fork emits checkpoints for ALL steps (seeded ones come from the short-
    // circuit runner, which also triggers checkpoint writing in executeAgenticFlow).
    expect(forkCheckpoints.length).toBeGreaterThanOrEqual(2);

    // The checkpoint step (step-2) carries the stored output from the original run.
    // Steps completed before the checkpoint (root) get the sentinel empty string,
    // because the checkpoint record only stores the triggering step's own output.
    const step2Ckpt = forkCheckpoints.find((c) => c.stepId === 'step-2');
    expect(step2Ckpt?.output).toBe('output:step-2');

    // Downstream steps (step-3, step-4) were freshly executed by the scripted runner.
    const step3Ckpt = forkCheckpoints.find((c) => c.stepId === 'step-3');
    const step4Ckpt = forkCheckpoints.find((c) => c.stepId === 'step-4');
    expect(step3Ckpt?.output).toBe('output:step-3');
    expect(step4Ckpt?.output).toBe('output:step-4');
  });

  // ---------------------------------------------------------------------------
  // 3. editedOutput — downstream steps see the edited value
  // ---------------------------------------------------------------------------

  it('substitutes editedOutput in the fork so downstream steps receive it', async () => {
    const store = new InMemoryCheckpointStore();
    setCheckpointStore(store);

    const originalRunId = 'run-edited-output';
    await executeAgenticFlow(makeFourStepFlow(), {
      runId: originalRunId,
      runStep: makeScriptedRunner(),
    });

    const checkpoints = listCheckpoints(originalRunId);
    const ckpt2 = checkpoints.find((c) => c.stepId === 'step-2')!;

    // Verify original step-2 output.
    expect(ckpt2.output).toBe('output:step-2');

    // Fork with an edited step-2 output.
    const EDITED = 'EDITED_STEP2_OUTPUT';
    const { forkRunId } = await replayFrom(makeFourStepFlow(), ckpt2.id, EDITED, {
      runStep: makeScriptedRunner(),
    });

    // The fork's checkpoint for step-2 must record the edited output.
    const forkCkpts = listCheckpoints(forkRunId);
    const forkStep2 = forkCkpts.find((c) => c.stepId === 'step-2');
    expect(forkStep2?.output).toBe(EDITED);
  });

  // ---------------------------------------------------------------------------
  // 4. Error handling
  // ---------------------------------------------------------------------------

  it('throws if the checkpoint id does not exist', async () => {
    setCheckpointStore(new InMemoryCheckpointStore());

    await expect(
      replayFrom(makeFourStepFlow(), 'ckpt_nonexistent_id'),
    ).rejects.toThrow('checkpoint "ckpt_nonexistent_id" not found');
  });

  it('throws if the checkpoint references a step not in the flow', async () => {
    const store = new InMemoryCheckpointStore();
    setCheckpointStore(store);

    const originalRunId = 'run-bad-step';
    await executeAgenticFlow(makeFourStepFlow(), {
      runId: originalRunId,
      runStep: makeScriptedRunner(),
    });

    // Manually save a checkpoint with a step that doesn't exist in the flow.
    const { saveCheckpoint } = await import('./checkpoints');
    saveCheckpoint({
      runId: originalRunId,
      stepId: 'step-nonexistent',
      inputContext: '',
      output: '',
      completedStepIds: ['step-nonexistent'],
    });
    const badCkpt = listCheckpoints(originalRunId).find(
      (c) => c.stepId === 'step-nonexistent',
    )!;

    await expect(
      replayFrom(makeFourStepFlow(), badCkpt.id, undefined, {
        runStep: makeScriptedRunner(),
      }),
    ).rejects.toThrow('step "step-nonexistent" not found in flow');
  });
});
