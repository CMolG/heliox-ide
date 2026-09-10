package io.fluxor.sdk.mod;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * An ephemeral, execution-time collection of {@link StepMod}s — attached via
 * {@code FlowExecution#withMods(ModOverlay)}, never serialized into a {@code FlowDefinition}.
 * This is the "on-demand" surface: a caller (typically meta-web, per-prospect) builds an overlay
 * right before executing a flow, and it applies only to that one execution.
 *
 * <p>Mods can target every step of the flow ({@link #forAll}) or a specific step id
 * ({@link #forStep}). {@link #resolve(String)} returns the mods that apply to a given step, in a
 * deterministic order: flow-wide mods first (in the order added), then that step's specific mods
 * (in the order added).
 *
 * <p>Not thread-safe for concurrent building — build the overlay to completion on one thread,
 * then hand it to {@code FlowExecution}, exactly like the rest of that builder's fluent API
 * (e.g. {@code withContext}).
 */
public final class ModOverlay {

    /** No mods attached — the default when {@code FlowExecution#withMods} is never called. */
    public static final ModOverlay EMPTY = new ModOverlay();

    private final List<StepMod> forAllMods = new ArrayList<>();
    private final Map<String, List<StepMod>> forStepMods = new LinkedHashMap<>();

    /** Attach {@code mods} to every step of the flow. Returns {@code this} for chaining. */
    public ModOverlay forAll(StepMod... mods) {
        forAllMods.addAll(List.of(mods));
        return this;
    }

    /** Attach {@code mods} to the step identified by {@code stepId} only. Returns {@code this} for chaining. */
    public ModOverlay forStep(String stepId, StepMod... mods) {
        forStepMods.computeIfAbsent(stepId, ignored -> new ArrayList<>()).addAll(List.of(mods));
        return this;
    }

    /**
     * Mods applicable to {@code stepId}: every flow-wide mod (in insertion order), followed by
     * that step's specific mods (in insertion order). Never {@code null}; empty when neither
     * {@link #forAll} nor a matching {@link #forStep} was ever called.
     */
    public List<StepMod> resolve(String stepId) {
        if (forAllMods.isEmpty() && !forStepMods.containsKey(stepId)) {
            return List.of();
        }
        List<StepMod> resolved = new ArrayList<>(forAllMods);
        resolved.addAll(forStepMods.getOrDefault(stepId, List.of()));
        return List.copyOf(resolved);
    }
}
