package io.fluxor.sdk.flow;

import io.fluxor.sdk.engine.DagTelemetry;
import io.fluxor.sdk.engine.FlowExecutor;

import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

/**
 * Fluent, boilerplate-free entry for executing a flow. Obtained from
 * {@link io.fluxor.sdk.FluxorRuntime#flow(String)}.
 *
 * <pre>{@code
 * // Single-sink flow (original API — unchanged):
 * runtime.flow("auth-audit")
 *     .withContext("jwt", tokenString)
 *     .withExpectedOutput(AuditResult.class)
 *     .withRetries(3)
 *     .executeAsync();
 *
 * // Multi-sink flow — flow ends in two independent typed sinks:
 * runtime.flow("parallel-analysis")
 *     .withContext("input", data)
 *     .withSinkOutputs(Map.of("sinkA", SummaryResult.class, "sinkB", MetricsResult.class))
 *     .withRetries(2)
 *     .executeMultiSinkAsync();
 *
 * // Telemetry-instrumented single-sink flow:
 * DagTelemetry telemetry = new DagTelemetry();
 * runtime.flow("auth-audit")
 *     .withContext("jwt", tokenString)
 *     .withExpectedOutput(AuditResult.class)
 *     .withTelemetry(telemetry)
 *     .executeAsync()
 *     .thenAccept(result -> System.out.println(telemetry.toJson()));
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
    private Map<String, Class<?>> sinkOutputTypes; // null until withSinkOutputs is called
    private int retries;
    private String systemPromptOverride;
    private String promptOverride;
    private DagTelemetry telemetry = DagTelemetry.NOOP;

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

    /**
     * Configures a {@link DagTelemetry} collector that will receive one
     * {@link io.fluxor.sdk.engine.DagTelemetry.NodeExecutionRecord} per DAG node
     * after execution completes (on both success and failure paths).
     *
     * <p>After the future returned by {@link #executeAsync()} or
     * {@link #executeMultiSinkAsync()} completes, the caller can read the collected
     * records via {@code telemetry.records()} or {@code telemetry.toJson()}.
     *
     * <p>If this method is never called the default {@link DagTelemetry#NOOP} is used
     * and all instrumentation is discarded.
     *
     * @param telemetry a fresh, reusable {@link DagTelemetry} instance; must not be {@code null}
     * @return {@code this} for chaining
     */
    public FlowExecution withTelemetry(DagTelemetry telemetry) {
        this.telemetry = telemetry != null ? telemetry : DagTelemetry.NOOP;
        return this;
    }

    @SuppressWarnings("unchecked")
    public <T> CompletableFuture<T> executeAsync() {
        if (expectedType == null) {
            return CompletableFuture.failedFuture(
                new IllegalStateException("withExpectedOutput(Class) is required before executeAsync()."));
        }
        return flowExecutor.execute(resolveDefinition(), (Class<T>) expectedType, retries, context, telemetry);
    }

    /**
     * Configures the expected output type for each sink node in a multi-sink flow.
     *
     * @param sinkOutputTypes map of sink step-id → expected output {@link Class}
     * @return {@code this} for chaining
     */
    public FlowExecution withSinkOutputs(Map<String, Class<?>> sinkOutputTypes) {
        this.sinkOutputTypes = sinkOutputTypes;
        return this;
    }

    /**
     * Executes the flow in multi-sink mode, collecting one typed result per declared sink.
     *
     * <p>Fails immediately with {@link IllegalStateException} if
     * {@link #withSinkOutputs(Map)} was not called first.
     *
     * @return a future resolving to a map of sinkId → typed result
     */
    public CompletableFuture<Map<String, Object>> executeMultiSinkAsync() {
        if (sinkOutputTypes == null) {
            return CompletableFuture.failedFuture(
                new IllegalStateException(
                    "withSinkOutputs(Map) is required before executeMultiSinkAsync()."));
        }
        return flowExecutor.executeMultiSink(resolveDefinition(), sinkOutputTypes, retries, context, telemetry);
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
