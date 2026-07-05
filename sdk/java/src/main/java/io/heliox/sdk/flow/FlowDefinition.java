package io.heliox.sdk.flow;

import java.util.List;

/**
 * A reusable, named flow — now a <em>graph</em> of {@link StepConfig} nodes connected by
 * {@code dependencies}. {@link io.heliox.sdk.engine.FlowExecutor} schedules it as a DAG:
 * dependency-free nodes start immediately, dependent nodes wait on their parents.
 *
 * <p>{@code loops} declares bounded loop-back edges (Phase 4a) — after a loop's
 * {@code sourceStepId} completes, control returns to its {@code targetStepId} and the loop
 * body re-runs, up to {@code maxIterations} total passes. The forward graph stays acyclic;
 * loops are expanded into a per-iteration instance graph at execution time by
 * {@link io.heliox.sdk.engine.FlowExecutor#executeAllTextTrace}.
 */
public record FlowDefinition(String id, List<StepConfig> steps, List<LoopConfig> loops) {

    public FlowDefinition {
        steps = List.copyOf(steps);
        loops = loops == null ? List.of() : List.copyOf(loops);
    }

    /**
     * Compatibility constructor for callers built against the pre-loop 2-arg shape — defaults
     * to no loops so existing call sites compile unchanged.
     */
    public FlowDefinition(String id, List<StepConfig> steps) {
        this(id, steps, List.of());
    }

    /** Convenience factory for a single-step flow. */
    public static FlowDefinition single(String id, String systemPrompt, String promptTemplate) {
        return new FlowDefinition(id, List.of(new StepConfig(id, systemPrompt, promptTemplate, null, List.of())));
    }
}
