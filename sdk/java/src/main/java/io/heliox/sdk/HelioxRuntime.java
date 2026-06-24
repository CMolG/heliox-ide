package io.heliox.sdk;

import io.heliox.sdk.engine.FlowExecutor;
import io.heliox.sdk.engine.StepExecutor;
import io.heliox.sdk.flow.FlowDefinition;
import io.heliox.sdk.flow.FlowExecution;
import io.heliox.sdk.provider.LlmProvider;
import io.heliox.sdk.schema.SchemaExtractor;
import io.heliox.sdk.tool.ToolRegistry;
import io.heliox.sdk.validation.SchemaValidator;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Entry point and dependency root of the Heliox runtime.
 *
 * <pre>{@code
 * HelioxRuntime runtime = HelioxRuntime.builder()
 *     .llmProvider(new MimoProvider("API_KEY"))
 *     .registerTool(new WeatherService())   // @HelioxTool-annotated methods
 *     .build();
 *
 * CompletableFuture<AuditResult> result = runtime.flow("auth-audit")
 *     .withContext("jwt", tokenString)
 *     .withExpectedOutput(AuditResult.class)
 *     .withRetries(3)
 *     .executeAsync();
 * }</pre>
 */
public final class HelioxRuntime {

    private final FlowExecutor flowExecutor;
    private final Map<String, FlowDefinition> flows;
    private final int defaultRetries;

    private HelioxRuntime(Builder builder) {
        ToolRegistry toolRegistry = new ToolRegistry();
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

    public static final class Builder {

        private LlmProvider provider;
        private String model;
        private int defaultRetries = 2;
        private final Map<String, FlowDefinition> flows = new HashMap<>();
        private final List<Object> tools = new ArrayList<>();

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

        /** Register an object whose {@code @HelioxTool} methods become callable tools. */
        public Builder registerTool(Object toolHolder) {
            this.tools.add(toolHolder);
            return this;
        }

        public HelioxRuntime build() {
            Objects.requireNonNull(provider, "llmProvider(...) is required");
            return new HelioxRuntime(this);
        }
    }
}
