package io.heliox.sdk.flow;

import java.util.List;

/**
 * A reusable, named flow — now a <em>graph</em> of {@link StepConfig} nodes connected by
 * {@code dependencies}. {@link io.heliox.sdk.engine.FlowExecutor} schedules it as a DAG:
 * dependency-free nodes start immediately, dependent nodes wait on their parents.
 */
public record FlowDefinition(String id, List<StepConfig> steps) {

    public FlowDefinition {
        steps = List.copyOf(steps);
    }

    /** Convenience factory for a single-step flow. */
    public static FlowDefinition single(String id, String systemPrompt, String promptTemplate) {
        return new FlowDefinition(id, List.of(new StepConfig(id, systemPrompt, promptTemplate, null, List.of())));
    }
}
