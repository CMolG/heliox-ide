package io.fluxor.sdk.mod.builtin;

import io.fluxor.sdk.mod.ModContext;
import io.fluxor.sdk.mod.StepMod;
import io.fluxor.sdk.provider.LlmRequest;
import io.fluxor.sdk.provider.ToolSpec;

import java.util.List;
import java.util.Set;

/**
 * Removes tools by name from the request advertised to the model — the Java analogue of the TS
 * {@code runtime.blockTools} mechanism. Applied on every provider call for the step (see
 * {@link StepMod#onRequest}), so a forbidden tool stays forbidden across the whole tool-calling
 * loop and every schema-validation retry, even if the underlying {@code ToolRegistry} still has
 * it registered for other steps.
 */
public final class ForbidToolsMod implements StepMod {

    private final Set<String> names;

    public ForbidToolsMod(String... names) {
        this(List.of(names));
    }

    public ForbidToolsMod(List<String> names) {
        this.names = Set.copyOf(names);
    }

    @Override
    public String id() {
        return "forbid-tools";
    }

    @Override
    public LlmRequest onRequest(LlmRequest request, ModContext ctx) {
        List<ToolSpec> filtered = request.tools().stream()
            .filter(tool -> !names.contains(tool.name()))
            .toList();
        if (filtered.size() == request.tools().size()) {
            return request; // nothing to forbid — avoid an unnecessary allocation
        }
        return new LlmRequest(request.messages(), request.responseSchema(), request.model(), request.temperature(), filtered);
    }
}
