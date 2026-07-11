package io.fluxor.sdk.mod;

import io.fluxor.sdk.provider.LlmRequest;

/**
 * A behavioral overlay attachable to a step at execution time — the SDK's runtime port of the
 * IDE's {@code AgenticMod} ({@code src/types/harness.ts}: {@code id/name/type/config}, where
 * {@code type} is one of {@code pre_process|post_process|system_override|tool_provider}).
 *
 * <p>Java collapses the TS discriminated union into two hook points instead of a {@code type}
 * tag: {@link #onRequest} covers everything that must happen <em>before</em> the model is
 * called (the TS {@code pre_process}, {@code system_override} and {@code tool_provider} kinds —
 * all three only ever adjust the outgoing {@link LlmRequest}), and {@link #onResponseText}
 * covers {@code post_process}. A given {@code StepMod} implementation is free to override either
 * hook, both, or neither — the "kind" of mod is simply which methods it overrides, verified by
 * the compiler instead of a runtime string tag.
 *
 * <p><b>Divergence from the TS reference (deliberate):</b> in the current IDE engine,
 * {@code post_process} mods do not actually transform the model's output — they only inject an
 * informational hint into the prompt <em>before</em> the call (see
 * {@code harness-engine/context-builder.ts}'s {@code buildPostProcessHint}), and the model is
 * trusted to self-apply it. This SDK's {@link #onResponseText} is a real, mechanical
 * transformation of the response text, applied by {@code StepExecutor} after the model answers
 * and before schema validation — a strictly stronger guarantee than the TS hint-only behavior,
 * matching this plan's explicit contract.
 *
 * @see ModOverlay
 * @see ModContext
 */
public interface StepMod {

    /** Stable identifier for this mod (used for tracing/dedup — mirrors the TS {@code AgenticMod.id}). */
    String id();

    /**
     * Adjusts the request before it is sent to the provider. Covers system-prompt injection
     * (system_override), guideline/constraint injection (pre_process) and tool
     * addition/removal (tool_provider). The default is the identity function.
     *
     * <p>Applied on <em>every</em> provider call for the step — including each turn of the
     * tool-calling loop and each schema-validation retry — so a mod that forbids a tool, for
     * instance, keeps forbidding it for the lifetime of the step.
     *
     * @param request the request as built (or as already adjusted by an earlier mod in the overlay)
     * @param ctx     the step id and prospect/config context this step is running with
     * @return the (possibly new) request to use; returning {@code request} unchanged is a valid no-op
     */
    default LlmRequest onRequest(LlmRequest request, ModContext ctx) {
        return request;
    }

    /**
     * Transforms the model's raw text output before it is parsed/validated against the step's
     * schema (or, for text steps, before it becomes the step's final result). The default is the
     * identity function.
     *
     * @param text the text as produced by the model (or as already transformed by an earlier mod)
     * @param ctx  the step id and prospect/config context this step is running with
     * @return the (possibly new) text to use downstream
     */
    default String onResponseText(String text, ModContext ctx) {
        return text;
    }
}
