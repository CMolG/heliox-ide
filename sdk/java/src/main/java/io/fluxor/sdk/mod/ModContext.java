package io.fluxor.sdk.mod;

import java.util.Map;

/**
 * The context a {@link StepMod} runs with: which step is executing, and the same
 * config/prospect-state map the step itself sees (see {@code StepConfig#context()} —
 * populated by {@code FlowExecution#withContext} and merged with parent-step outputs by
 * {@code FlowExecutor}). Reusing that map means a mod can read whatever the caller seeded the
 * flow with (e.g. {@code "tone": "formal"}, {@code "sector": "legal"}) without any new plumbing.
 *
 * @param stepId  the id of the step this mod is currently applying to
 * @param context read-only view of the step's config/prospect-state map; never {@code null}
 *                (empty map when the step declares no context)
 */
public record ModContext(String stepId, Map<String, Object> context) {

    public ModContext {
        context = context == null ? Map.of() : Map.copyOf(context);
    }
}
