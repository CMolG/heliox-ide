package io.heliox.sdk.flow;

import io.heliox.sdk.engine.FlowExecutor;

import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

/**
 * Fluent, boilerplate-free entry for executing a flow. Obtained from
 * {@link io.heliox.sdk.HelioxRuntime#flow(String)}.
 *
 * <pre>{@code
 * runtime.flow("auth-audit")
 *     .withContext("jwt", tokenString)
 *     .withExpectedOutput(AuditResult.class)
 *     .withRetries(3)
 *     .executeAsync();
 * }</pre>
 *
 * Resolves to a registered {@link FlowDefinition} when one matches the name, otherwise builds
 * an ad-hoc single-step flow so simple, prompt-less cases work out of the box. Either way the
 * call is delegated to the {@link FlowExecutor} DAG scheduler.
 */
public final class FlowExecution {

    private final FlowExecutor flowExecutor;
    private final String flowId;
    private final FlowDefinition definition; // null for ad-hoc flows
    private final Map<String, Object> context = new LinkedHashMap<>();

    private Class<?> expectedType;
    private int retries;
    private String systemPromptOverride;
    private String promptOverride;

    public FlowExecution(FlowExecutor flowExecutor, String flowId, FlowDefinition definition, int defaultRetries) {
        this.flowExecutor = flowExecutor;
        this.flowId = flowId;
        this.definition = definition;
        this.retries = defaultRetries;
    }

    public FlowExecution withContext(String key, Object value) {
        context.put(key, value);
        return this;
    }

    public FlowExecution withContext(Map<String, ?> values) {
        context.putAll(values);
        return this;
    }

    public <T> FlowExecution withExpectedOutput(Class<T> type) {
        this.expectedType = type;
        return this;
    }

    public FlowExecution withRetries(int retries) {
        this.retries = retries;
        return this;
    }

    public FlowExecution withSystemPrompt(String systemPrompt) {
        this.systemPromptOverride = systemPrompt;
        return this;
    }

    public FlowExecution withPrompt(String prompt) {
        this.promptOverride = prompt;
        return this;
    }

    @SuppressWarnings("unchecked")
    public <T> CompletableFuture<T> executeAsync() {
        if (expectedType == null) {
            return CompletableFuture.failedFuture(
                new IllegalStateException("withExpectedOutput(Class) is required before executeAsync()."));
        }
        return flowExecutor.execute(resolveDefinition(), (Class<T>) expectedType, retries, context);
    }

    private FlowDefinition resolveDefinition() {
        if (definition != null) {
            return definition;
        }
        String prompt = promptOverride != null ? promptOverride : defaultPrompt();
        StepConfig step = new StepConfig(flowId, systemPromptOverride, prompt, Map.of(), List.of());
        return new FlowDefinition(flowId, List.of(step));
    }

    private String defaultPrompt() {
        return "Ejecuta el flujo cognitivo \"" + flowId + "\" usando el contexto proporcionado "
            + "y produce el resultado estructurado solicitado.";
    }
}
