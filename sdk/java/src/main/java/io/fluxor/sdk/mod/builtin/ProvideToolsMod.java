package io.fluxor.sdk.mod.builtin;

import io.fluxor.sdk.mod.ModContext;
import io.fluxor.sdk.mod.StepMod;
import io.fluxor.sdk.provider.LlmRequest;
import io.fluxor.sdk.provider.ToolSpec;
import io.fluxor.sdk.schema.SchemaExtractor;
import io.fluxor.sdk.tool.FluxorTool;
import io.fluxor.sdk.tool.ToolRegistry;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ForkJoinPool;

/**
 * Adds tools to the step's request that are scoped ONLY to this mod's lifetime — the Java
 * analogue of the TS {@code tool_provider} mod kind. {@code toolHolder} is scanned exactly like
 * {@link ToolRegistry#register(Object)}: its {@link FluxorTool}-annotated methods become the
 * tools advertised for this step. Unlike the step executor's shared registry, these tools are
 * never registered globally — they disappear once the overlay is no longer attached.
 *
 * <p>{@code StepExecutor} recognizes this mod specifically (beyond the generic {@link StepMod}
 * contract) so a tool call the model makes against one of these on-demand tools is actually
 * dispatched, not just advertised: {@link #provides} and {@link #invoke} are its dispatch
 * surface, consulted when a call isn't found on the executor's own registry.
 *
 * <p>Uses {@link ForkJoinPool#commonPool()} for argument binding/reflective invocation rather
 * than spinning up a dedicated thread pool per instance — {@code ProvideToolsMod} is meant to be
 * built fresh per on-demand execution (e.g. once per prospect step), and a cached pool per
 * instance would never be shut down.
 */
public final class ProvideToolsMod implements StepMod {

    private final ToolRegistry registry;

    public ProvideToolsMod(Object toolHolder) {
        this.registry = new ToolRegistry(new SchemaExtractor(), ForkJoinPool.commonPool()).register(toolHolder);
    }

    @Override
    public String id() {
        return "provide-tools";
    }

    @Override
    public LlmRequest onRequest(LlmRequest request, ModContext ctx) {
        List<ToolSpec> ownSpecs = registry.specs();
        if (ownSpecs.isEmpty()) {
            return request;
        }
        List<ToolSpec> merged = new ArrayList<>(request.tools());
        merged.addAll(ownSpecs);
        return new LlmRequest(request.messages(), request.responseSchema(), request.model(), request.temperature(), merged);
    }

    /** {@code true} if this mod's tool holder registered a tool named {@code toolName}. */
    public boolean provides(String toolName) {
        return registry.specs().stream().anyMatch(spec -> spec.name().equals(toolName));
    }

    /** Dispatch a call to this mod's own tool holder. Only valid when {@link #provides} is {@code true}. */
    public CompletableFuture<String> invoke(String toolName, String argumentsJson) {
        return registry.invoke(toolName, argumentsJson);
    }
}
