package io.heliox.sdk.flow;

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
 */
public record StepConfig(
    String id,
    String systemPrompt,
    String promptTemplate,
    Map<String, Object> context,
    List<String> dependencies
) {
    public StepConfig {
        context = context == null ? Map.of() : Map.copyOf(context);
        dependencies = dependencies == null ? List.of() : List.copyOf(dependencies);
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
