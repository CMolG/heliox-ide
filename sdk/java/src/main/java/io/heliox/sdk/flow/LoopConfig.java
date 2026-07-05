package io.heliox.sdk.flow;

/**
 * A bounded loop-back edge: after {@code sourceStepId} completes, control returns to
 * {@code targetStepId} (an upstream step) and the loop body re-runs, up to
 * {@code maxIterations} total passes (the first pass counts as iteration 1).
 *
 * <p>Mirrors the TypeScript {@code AgenticLoop} ({@code src/types/harness.ts}) and the wire
 * format's {@code HelioxFlowLoop} ({@code src/main/flow-export/heliox-flow.ts}). The forward
 * graph ({@link StepConfig#dependencies()}) never encodes loop-back edges — those live here,
 * separately, and are expanded into a per-iteration instance graph by
 * {@link io.heliox.sdk.engine.FlowExecutor#executeAllTextTrace}.
 *
 * @param id            loop identifier
 * @param sourceStepId  step id after which control returns to {@code targetStepId}
 * @param targetStepId  upstream step id the loop body restarts from
 * @param maxIterations total passes of the loop body, clamped to [1, 50] at parse time
 *                      (see {@link FlowImport})
 */
public record LoopConfig(String id, String sourceStepId, String targetStepId, int maxIterations) {
}
