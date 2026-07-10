package io.fluxor.sdk.flow;

import java.util.List;

/**
 * A reusable, named flow — now a <em>graph</em> of {@link StepConfig} nodes connected by
 * {@code dependencies}. {@link io.fluxor.sdk.engine.FlowExecutor} schedules it as a DAG:
 * dependency-free nodes start immediately, dependent nodes wait on their parents.
 *
 * <p>{@code loops} declares bounded loop-back edges (Phase 4a) — after a loop's
 * {@code sourceStepId} completes, control returns to its {@code targetStepId} and the loop
 * body re-runs, up to {@code maxIterations} total passes. The forward graph stays acyclic;
 * loops are expanded into a per-iteration instance graph at execution time by
 * {@link io.fluxor.sdk.engine.FlowExecutor#executeAllTextTrace}.
 *
 * <p>{@code contextMode} is the Rosetta context mode ({@code AgenticFlow.contextMode} in
 * {@code src/types/harness.ts}; spec:
 * {@code docs/superpowers/specs/2026-07-10-rosetta-context-manifest.md}), carried
 * <em>opaquely</em> like {@link StepConfig#contract()}/{@link StepConfig#model()}: this
 * runtime never branches on it. {@code null} when the flow declares none (blind default).
 * {@code "feedback"} is NOT supported by this runtime in v1 — {@link FlowImport} emits a
 * one-time downgrade warning at import and execution proceeds in blind mode (the only mode
 * this executor implements); the recorded value stays {@code "feedback"} so the definition
 * round-trips without loss (spec decision 2: downgrade, not parity).
 */
public record FlowDefinition(String id, List<StepConfig> steps, List<LoopConfig> loops,
                             String contextMode) {

    public FlowDefinition {
        steps = List.copyOf(steps);
        loops = loops == null ? List.of() : List.copyOf(loops);
    }

    /**
     * Compatibility constructor for callers built against the pre-Rosetta 3-arg shape —
     * defaults {@code contextMode} to {@code null} (carry-opaque field; absent means the flow
     * declares none, i.e. blind) so existing call sites compile unchanged.
     */
    public FlowDefinition(String id, List<StepConfig> steps, List<LoopConfig> loops) {
        this(id, steps, loops, null);
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
