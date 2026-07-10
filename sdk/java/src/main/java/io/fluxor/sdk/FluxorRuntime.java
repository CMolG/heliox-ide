package io.fluxor.sdk;

import io.fluxor.sdk.engine.FlowExecutor;
import io.fluxor.sdk.engine.StepExecutor;
import io.fluxor.sdk.flow.FlowDefinition;
import io.fluxor.sdk.flow.FlowExecution;
import io.fluxor.sdk.provider.LlmProvider;
import io.fluxor.sdk.schema.SchemaExtractor;
import io.fluxor.sdk.tool.ToolRegistry;
import io.fluxor.sdk.validation.SchemaValidator;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ExecutorService;

/**
 * Entry point and dependency root of the Fluxor runtime.
 *
 * <pre>{@code
 * FluxorRuntime runtime = FluxorRuntime.builder()
 *     .llmProvider(new MimoProvider("API_KEY"))
 *     .registerTool(new WeatherService())   // @FluxorTool-annotated methods
 *     .build();
 *
 * CompletableFuture<AuditResult> result = runtime.flow("auth-audit")
 *     .withContext("jwt", tokenString)
 *     .withExpectedOutput(AuditResult.class)
 *     .withRetries(3)
 *     .executeAsync();
 * }</pre>
 *
 * <p>{@code FluxorRuntime} implements {@link AutoCloseable}. When the runtime owns the tool
 * executor (i.e., none was supplied via {@link Builder#toolExecutor}), calling {@link #close()}
 * shuts it down. If you supply your own executor, you are responsible for its lifecycle and
 * {@link #close()} will not touch it. Typical usage:
 *
 * <pre>{@code
 * try (FluxorRuntime runtime = FluxorRuntime.builder()
 *         .llmProvider(provider)
 *         .build()) {
 *     runtime.flow("my-flow").executeAsync().join();
 * }
 * }</pre>
 */
public final class FluxorRuntime implements AutoCloseable {

    private final FlowExecutor flowExecutor;
    private final Map<String, FlowDefinition> flows;
    private final int defaultRetries;

    /**
     * The tool registry held for shutdown purposes. We need to shut it down only when the
     * runtime owns the executor; the registry's own {@code ownsExecutor} flag handles the
     * distinction — calling {@link ToolRegistry#shutdown()} on an externally-supplied
     * executor is always a no-op.
     */
    private final ToolRegistry toolRegistry;

    private FluxorRuntime(Builder builder) {
        // If the caller supplied a custom tool executor, inject it; otherwise the registry
        // creates (and will own) the default daemon-thread pool.
        if (builder.toolExecutor != null) {
            this.toolRegistry = new ToolRegistry(new SchemaExtractor(), builder.toolExecutor);
        } else {
            this.toolRegistry = new ToolRegistry();
        }

        for (Object tool : builder.tools) {
            toolRegistry.register(tool);
        }

        StepExecutor stepExecutor = new StepExecutor(
            builder.provider, new SchemaExtractor(), new SchemaValidator(), toolRegistry, builder.model);
        this.flowExecutor = new FlowExecutor(stepExecutor);
        this.flows = Map.copyOf(builder.flows);
        this.defaultRetries = builder.defaultRetries;
    }

    public static Builder builder() {
        return new Builder();
    }

    /**
     * Begin a flow execution. If {@code name} matches a registered {@link FlowDefinition} it is
     * used; otherwise an ad-hoc single-step flow is created so prompt-less cases work out of the box.
     */
    public FlowExecution flow(String name) {
        return new FlowExecution(flowExecutor, name, flows.get(name), defaultRetries);
    }

    /**
     * Releases resources owned by this runtime.
     *
     * <p>Specifically, if the runtime created the tool executor (i.e., no custom executor was
     * supplied via {@link Builder#toolExecutor}), this call shuts it down gracefully via
     * {@link ToolRegistry#shutdown()}. If a custom executor was injected, this method is a
     * no-op for that executor — its lifecycle remains the caller's responsibility.
     */
    @Override
    public void close() {
        toolRegistry.shutdown();
    }

    public static final class Builder {

        private LlmProvider provider;
        private String model;
        private int defaultRetries = 2;
        private final Map<String, FlowDefinition> flows = new HashMap<>();
        private final List<Object> tools = new ArrayList<>();

        /**
         * Optional custom tool executor. When set, tool invocations are offloaded to this
         * executor and the runtime will <em>not</em> shut it down on {@link FluxorRuntime#close()}.
         * When omitted, a default daemon-thread pool named {@code fluxor-tool-N} is created
         * and owned by the runtime.
         */
        private ExecutorService toolExecutor;

        public Builder llmProvider(LlmProvider provider) {
            this.provider = provider;
            return this;
        }

        public Builder model(String model) {
            this.model = model;
            return this;
        }

        public Builder defaultRetries(int defaultRetries) {
            this.defaultRetries = defaultRetries;
            return this;
        }

        public Builder registerFlow(FlowDefinition definition) {
            this.flows.put(definition.id(), definition);
            return this;
        }

        /** Register an object whose {@code @FluxorTool} methods become callable tools. */
        public Builder registerTool(Object toolHolder) {
            this.tools.add(toolHolder);
            return this;
        }

        /**
         * Supply a custom {@link ExecutorService} onto which tool argument binding and
         * reflective invocation will be offloaded. The runtime will <em>not</em> shut this
         * executor down — the caller retains full ownership of its lifecycle.
         *
         * <p>If not called, a default cached-thread-pool with daemon threads named
         * {@code fluxor-tool-N} is created automatically and will be shut down when
         * {@link FluxorRuntime#close()} is called.
         *
         * @param toolExecutor the executor to use for tool calls; must not be {@code null}
         * @return this builder
         */
        public Builder toolExecutor(ExecutorService toolExecutor) {
            this.toolExecutor = Objects.requireNonNull(toolExecutor, "toolExecutor must not be null");
            return this;
        }

        public FluxorRuntime build() {
            Objects.requireNonNull(provider, "llmProvider(...) is required");
            return new FluxorRuntime(this);
        }
    }
}
