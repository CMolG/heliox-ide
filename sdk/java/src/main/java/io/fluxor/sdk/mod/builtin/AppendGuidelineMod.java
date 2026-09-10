package io.fluxor.sdk.mod.builtin;

import io.fluxor.sdk.mod.ModContext;
import io.fluxor.sdk.mod.StepMod;
import io.fluxor.sdk.provider.LlmRequest;

/**
 * Appends a standing guideline to the step's system framing — e.g. {@code new
 * AppendGuidelineMod("SOLO mobile-first")}. A thin, purpose-named convenience over
 * {@link SystemPromptMod} fixed to {@link SystemPromptMod.Position#APPEND}: guidelines are
 * closing reminders, never hard overrides (use {@link SystemPromptMod} with {@code PREPEND}
 * for that).
 */
public final class AppendGuidelineMod implements StepMod {

    private final SystemPromptMod delegate;

    public AppendGuidelineMod(String text) {
        this.delegate = new SystemPromptMod(text, SystemPromptMod.Position.APPEND);
    }

    @Override
    public String id() {
        return "append-guideline";
    }

    @Override
    public LlmRequest onRequest(LlmRequest request, ModContext ctx) {
        return delegate.onRequest(request, ctx);
    }
}
