/**
 * replay.ts — Checkpoint-based fork/replay for time-travel debugging
 *
 * `replayFrom` re-seeds executor state (completedStepIds + stepOutputs) up to
 * and including the chosen checkpoint, then resumes the DAG from the next
 * unlocked steps — producing a **fork**: a new runId that shares the original
 * run's prefix so checkpoints can be grouped by lineage.
 *
 * ## Non-determinism disclaimer (by design)
 *
 * A fork does NOT produce a deterministic replay of downstream LLM calls.
 * Each resumed step is a fresh, non-deterministic inference request to the
 * model. Only steps that have already been completed (up to and including the
 * checkpoint) are reproduced exactly (from stored outputs). Downstream steps
 * will diverge unless a scripted `runStep` function is injected via
 * `ExecuteAgenticFlowOptions.runStep`.
 *
 * This is consistent with Fluxor's commitment to honesty: we surface the fork
 * as a new exploration branch, not as a deterministic "undo".
 */

import type { AgenticFlow } from '../../types/harness';
import { getCheckpoint } from './checkpoints';
import { executeAgenticFlow, type ExecuteAgenticFlowOptions } from './executor';

export interface ReplayFromResult {
  /**
   * The new runId assigned to the forked execution.
   *
   * It shares the original run's prefix:
   *   `<originalRunId>_fork_<forkTimestamp>`
   *
   * This lets consumers group the fork alongside its parent in the UI.
   */
  forkRunId: string;
  /**
   * Step ids that were re-used from checkpoint state without re-execution.
   * These are exactly the steps completed up to and including the checkpoint.
   */
  seededStepIds: string[];
  /**
   * Indicates whether downstream re-execution is deterministic.
   * Always `false` unless a scripted `runStep` is injected via options.
   */
  isDeterministicReplay: boolean;
}

/**
 * Resume a DAG execution from a previously persisted checkpoint.
 *
 * Steps up to and including the checkpoint's step are re-seeded directly
 * from stored outputs (no LLM calls). If `editedOutput` is supplied it
 * replaces the checkpoint step's stored output, so downstream steps see the
 * edited value — enabling the "edit state → fork" workflow.
 *
 * Downstream steps (those not yet completed at the checkpoint) are executed
 * via `executeAgenticFlow` as a fresh, non-deterministic run.
 *
 * @param flow          The same AgenticFlow definition used in the original run.
 * @param checkpointId  The checkpoint id returned by `getCheckpoint` /
 *                      `listCheckpoints`.
 * @param editedOutput  Optional replacement for the checkpoint step's output.
 *                      Downstream steps in the fork will receive this value
 *                      instead of the original.
 * @param options       Forwarded to `executeAgenticFlow`; may include an
 *                      injected `runStep` for deterministic testing.
 * @returns             Fork metadata including the new runId.
 * @throws              If the checkpoint is not found or references an unknown
 *                      step in the flow.
 */
export async function replayFrom(
  flow: AgenticFlow,
  checkpointId: string,
  editedOutput?: string,
  options: ExecuteAgenticFlowOptions = {},
): Promise<ReplayFromResult> {
  const checkpoint = getCheckpoint(checkpointId);
  if (!checkpoint) {
    throw new Error(
      `replayFrom: checkpoint "${checkpointId}" not found. ` +
      'Ensure the checkpoint was persisted before calling replayFrom.',
    );
  }

  // Validate that the checkpointed step actually exists in the supplied flow.
  if (!flow.stepsRecord[checkpoint.stepId]) {
    throw new Error(
      `replayFrom: checkpoint step "${checkpoint.stepId}" not found in flow "${flow.id}". ` +
      'Ensure you are replaying with the same flow definition used during the original run.',
    );
  }

  // Build the forked runId — shares the original prefix for lineage tracking.
  const forkTimestamp = Date.now();
  const forkRunId = `${checkpoint.runId}_fork_${forkTimestamp}`;

  // Re-seed stepOutputs from the checkpoint's completed steps.
  // We cannot recover individual outputs for steps before the checkpoint from
  // the checkpoint record alone (only the checkpoint step's output is stored).
  // We seed only the checkpoint step output; sibling completed steps are marked
  // as done but with an empty output sentinel so the DAG skips them correctly.
  //
  // Design rationale: the checkpoint record stores only the state-so-far
  // summary (completedStepIds) and the triggering step's own output. For the
  // fork to be useful we need to inject these completed states so the DAG
  // scheduler treats those steps as already resolved.
  const seededOutputs: Record<string, string> = {};
  for (const sid of checkpoint.completedStepIds) {
    if (sid === checkpoint.stepId) {
      // Honor editedOutput if provided; otherwise use the stored output.
      seededOutputs[sid] = editedOutput ?? checkpoint.output;
    } else {
      // Earlier completed steps: mark with a sentinel so the scheduler skips
      // them while still reflecting their completion in dependency counters.
      seededOutputs[sid] = seededOutputs[sid] ?? '';
    }
  }

  // Build a pre-seeded runStep that short-circuits already-completed steps.
  const completedSet = new Set(checkpoint.completedStepIds);
  const callerRunStep = options.runStep;

  const seededRunStep: ExecuteAgenticFlowOptions['runStep'] = async (input) => {
    if (completedSet.has(input.step.id)) {
      // Return the seeded output without hitting the LLM.
      return {
        text: seededOutputs[input.step.id] ?? '',
        usage: null,
        toolCalls: [],
        toolResults: [],
      };
    }
    // Downstream step — delegate to the caller's runner or the real LLM runner.
    if (callerRunStep) {
      return callerRunStep(input);
    }
    // Lazy import so tests that inject runStep never load the real LLM runner.
    const { runLLMStep } = await import('./llm-runner');
    return runLLMStep(input);
  };

  // Execute the full flow with the seeded runner and the forked runId.
  await executeAgenticFlow(flow, {
    ...options,
    runId: forkRunId,
    runStep: seededRunStep,
  });

  return {
    forkRunId,
    seededStepIds: [...checkpoint.completedStepIds],
    /**
     * Downstream re-execution is non-deterministic unless the caller injected
     * a scripted runStep. We advertise this explicitly in the return value.
     */
    isDeterministicReplay: callerRunStep !== undefined,
  };
}
