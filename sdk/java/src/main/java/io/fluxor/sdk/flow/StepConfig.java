package io.fluxor.sdk.flow;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.List;
import java.util.Map;

/**
 * A single node in a flow graph — the SDK's runtime analogue of the IDE's
 * {@code AgenticStep} (see {@code src/types/harness.ts}).
 *
 * @param id             step identifier (unique within a flow)
 * @param systemPrompt   optional role / system instruction
 * @param promptTemplate the user prompt
 * @param context        key/value context injected as a Markdown block into the prompt
 * @param dependencies   ids of steps that must complete before this one runs (DAG edges)
 * @param contract       optional deterministic completion contract, carried opaquely — this
 *                       SDK never interprets it (mirrors {@code StepContract} in
 *                       {@code src/types/harness.ts}); {@code null} when the step declares none
 * @param model          optional per-step model override ("provider/model"), carried opaquely;
 *                       {@code null} when the step declares none
 * @param mods           optional declarative mods, carried opaquely — this SDK never interprets
 *                       it (mirrors {@code AgenticStep.mods} in {@code src/types/harness.ts});
 *                       {@code null} when the step declares none. The runtime mod mechanism
 *                       ({@link io.fluxor.sdk.mod.ModOverlay}, attached via
 *                       {@code FlowExecution#withMods}) is the primary, on-demand path — this
 *                       field exists purely for shape parity with the TS declarative case
 */
public record StepConfig(
    String id,
    String systemPrompt,
    String promptTemplate,
    Map<String, Object> context,
    List<String> dependencies,
    JsonNode contract,
    String model,
    JsonNode mods
) {
    public StepConfig {
        context = context == null ? Map.of() : Map.copyOf(context);
        dependencies = dependencies == null ? List.of() : List.copyOf(dependencies);
    }

    /**
     * Compatibility constructor for callers built against the pre-mods 7-arg shape — defaults
     * {@code mods} to {@code null} (carry-opaque field; absent means the step declares none) so
     * existing call sites compile unchanged.
     */
    public StepConfig(
        String id,
        String systemPrompt,
        String promptTemplate,
        Map<String, Object> context,
        List<String> dependencies,
        JsonNode contract,
        String model
    ) {
        this(id, systemPrompt, promptTemplate, context, dependencies, contract, model, null);
    }

    /**
     * Compatibility constructor for callers built against the pre-contract/model 5-arg shape —
     * defaults {@code contract}, {@code model} and {@code mods} to {@code null} (carry-opaque
     * fields; absent means the step declares none) so existing call sites compile unchanged.
     */
    public StepConfig(
        String id,
        String systemPrompt,
        String promptTemplate,
        Map<String, Object> context,
        List<String> dependencies
    ) {
        this(id, systemPrompt, promptTemplate, context, dependencies, null, null, null);
    }

    public static StepConfig of(String id, String promptTemplate) {
        return new StepConfig(id, null, promptTemplate, Map.of(), List.of());
    }

    public static StepConfig of(String id, String promptTemplate, List<String> dependencies) {
        return new StepConfig(id, null, promptTemplate, Map.of(), dependencies);
    }

    /** Render the user prompt, appending a {@code ## Context} block when context is present. */
    public String renderUserPrompt() {
        if (context.isEmpty()) {
            return promptTemplate == null ? "" : promptTemplate;
        }
        StringBuilder sb = new StringBuilder();
        if (promptTemplate != null && !promptTemplate.isBlank()) {
            sb.append(promptTemplate).append("\n\n");
        }
        sb.append("## Context\n");
        for (Map.Entry<String, Object> entry : context.entrySet()) {
            sb.append("- ").append(entry.getKey()).append(": ").append(entry.getValue()).append('\n');
        }
        return sb.toString().stripTrailing();
    }
}
