package io.fluxor.sdk.flow;

import com.fasterxml.jackson.databind.JsonNode;
import io.fluxor.sdk.internal.Json;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Parses the canonical Fluxor flow JSON (exported by the TypeScript IDE) into a
 * {@link FlowDefinition} consumable by the Java runtime.
 *
 * <p>The canonical format is defined in {@code sdk/conformance/conformance-chain.flow.json}.
 * Each step carries: {@code id}, {@code type}, {@code prompt}, {@code dependsOn} (parent ids),
 * optional {@code systemPrompt}, optional {@code tools} (ignored — Java has no per-step tool
 * concept), optional {@code context} (key/value map), optional {@code contract} (carried
 * opaquely), and optional {@code model} override. The flow itself may declare an optional
 * {@code loops} array (bounded loop-back edges — see {@code conformance-loop.flow.json}).
 *
 * <p>Mapping to SDK types:
 * <ul>
 *   <li>{@code prompt}      → {@link StepConfig#promptTemplate()}</li>
 *   <li>{@code systemPrompt}→ {@link StepConfig#systemPrompt()} (nullable)</li>
 *   <li>{@code dependsOn}   → {@link StepConfig#dependencies()}</li>
 *   <li>{@code context}     → {@link StepConfig#context()} (empty map when absent)</li>
 *   <li>{@code tools}       → ignored</li>
 *   <li>{@code contract}    → {@link StepConfig#contract()} (carried opaquely, nullable)</li>
 *   <li>{@code model}       → {@link StepConfig#model()} (nullable)</li>
 *   <li>{@code loops}       → {@link FlowDefinition#loops()} (empty list when absent)</li>
 *   <li>{@code contextMode} → {@link FlowDefinition#contextMode()} (carried opaquely,
 *       nullable; {@code "feedback"} triggers a one-time downgrade-to-blind warning —
 *       see {@link #checkContextModeDowngrade})</li>
 * </ul>
 */
public final class FlowImport {

    /** Default loop passes when a loop-back edge omits/malforms {@code maxIterations}. */
    private static final int LOOP_DEFAULT_MAX_ITERATIONS = 3;
    /** Hard cap on loop passes — the format-normative upper bound. */
    private static final int LOOP_MAX_ITERATIONS_CAP = 50;

    /**
     * Current wire-format name — the value the TS exporter stamps into every export's
     * top-level {@code "format"} field ({@code FLUXOR_FLOW_FORMAT_NAME} in
     * {@code src/main/flow-export/fluxor-flow.ts}). A flow carrying exactly this value
     * imports silently.
     */
    private static final String CURRENT_FORMAT_NAME = "fluxor-flow";

    /**
     * Legacy compat: the pre-rebrand format name, assumed when the {@code "format"} field is
     * absent or null — no export of the Heliox era ever stamped the field, so absence IS the
     * legacy format. Frozen cross-runtime contract (canonical reference:
     * {@code warnIfLegacyFormat} in {@code src/main/flow-export/fluxor-flow.ts}): anything
     * other than {@link #CURRENT_FORMAT_NAME} triggers one deprecation warning per distinct
     * seen value, and never blocks parsing — see {@link #checkLegacyFormat}.
     */
    private static final String LEGACY_FORMAT_NAME = "heliox-flow";

    /**
     * Legacy format values already warned about — gives the deprecation warning
     * once-per-distinct-value process semantics, mirroring the TS {@code warnOnce} used by
     * {@code warnIfLegacyFormat}.
     */
    private static final Set<String> WARNED_LEGACY_FORMATS = ConcurrentHashMap.newKeySet();

    /**
     * Test hook — clears the once-per-value warning dedup state (the Java counterpart of the
     * TS {@code resetWarnOnceForTests}). Package-private: tests only.
     */
    static void resetLegacyFormatWarningsForTests() {
        WARNED_LEGACY_FORMATS.clear();
    }

    /**
     * Rosetta context mode this runtime cannot honour in v1 (spec decision 2:
     * {@code docs/superpowers/specs/2026-07-10-rosetta-context-manifest.md}) — importing a
     * flow declaring it downgrades execution to blind with a one-time warning; see
     * {@link #checkContextModeDowngrade}. Any other value (including the explicit
     * {@code "blind"}, absence, or an unrecognized string) is silent: there is nothing to
     * downgrade.
     */
    private static final String FEEDBACK_CONTEXT_MODE = "feedback";

    /**
     * Exact downgrade warning wording — a frozen cross-runtime contract (Java prints it to
     * {@code System.err}; Python raises it as a {@code DeprecationWarning}). Trigger and
     * wording may not vary per runtime.
     */
    private static final String FEEDBACK_DOWNGRADE_WARNING =
        "feedback mode is not supported by this runtime yet; downgrading to blind";

    /**
     * Whether the feedback-downgrade warning has fired — gives it once-per-process semantics,
     * the same idiom as {@link #WARNED_LEGACY_FORMATS} (a single flag rather than a seen-value
     * set because exactly one value, {@code "feedback"}, ever triggers it).
     */
    private static final AtomicBoolean WARNED_FEEDBACK_DOWNGRADE = new AtomicBoolean(false);

    /**
     * Test hook — clears the once-per-process downgrade-warning dedup state (the context-mode
     * counterpart of {@link #resetLegacyFormatWarningsForTests}). Package-private: tests only.
     */
    static void resetContextModeWarningsForTests() {
        WARNED_FEEDBACK_DOWNGRADE.set(false);
    }

    private FlowImport() {
    }

    /**
     * Parse canonical flow JSON from a string.
     *
     * @param json raw JSON text
     * @return a populated {@link FlowDefinition}
     * @throws IllegalArgumentException if the version is not {@code "1"} or the JSON is malformed
     */
    public static FlowDefinition fromCanonicalJson(String json) {
        JsonNode root;
        try {
            root = Json.MAPPER.readTree(json);
        } catch (IOException e) {
            throw new IllegalArgumentException("Cannot parse flow JSON: " + e.getMessage(), e);
        }

        // Validate version field.
        JsonNode versionNode = root.get("version");
        if (versionNode == null || versionNode.isNull()) {
            throw new IllegalArgumentException(
                "Canonical flow JSON is missing the required 'version' field.");
        }
        String version = versionNode.asText();
        if (!"1".equals(version)) {
            throw new IllegalArgumentException(
                "Unsupported canonical flow version: '" + version
                    + "'. Expected \"1\". Upgrade the Java SDK or downgrade the IDE export.");
        }

        // Legacy compat: advisory-only, never blocks parsing.
        checkLegacyFormat(root);

        // Rosetta context mode: carried opaquely; 'feedback' downgrades execution to blind
        // with a one-time warning (advisory-only, never blocks parsing).
        String contextMode = optionalText(root, "contextMode");
        checkContextModeDowngrade(contextMode);

        // Flow-level id.
        JsonNode idNode = root.get("id");
        if (idNode == null || idNode.isNull()) {
            throw new IllegalArgumentException("Canonical flow JSON is missing the required 'id' field.");
        }
        String flowId = idNode.asText();

        // Steps array.
        JsonNode stepsNode = root.get("steps");
        if (stepsNode == null || !stepsNode.isArray()) {
            throw new IllegalArgumentException(
                "Canonical flow JSON is missing the required 'steps' array.");
        }

        List<StepConfig> steps = new ArrayList<>();
        for (JsonNode stepNode : stepsNode) {
            steps.add(parseStep(stepNode, flowId));
        }

        List<LoopConfig> loops = parseLoops(root.get("loops"), flowId);

        return new FlowDefinition(flowId, steps, loops, contextMode);
    }

    /**
     * Parse canonical flow JSON from a file on disk.
     *
     * @param path path to the {@code .flow.json} file
     * @return a populated {@link FlowDefinition}
     * @throws IllegalArgumentException if the file cannot be read or the content is invalid
     */
    public static FlowDefinition fromCanonicalFile(Path path) {
        String content;
        try {
            content = Files.readString(path);
        } catch (IOException e) {
            throw new IllegalArgumentException(
                "Cannot read canonical flow file at '" + path + "': " + e.getMessage(), e);
        }
        return fromCanonicalJson(content);
    }

    // --- private helpers -----------------------------------------------------------------------

    /**
     * Legacy compat: warns (once per distinct value, to {@code System.err}) when importing a
     * flow that doesn't carry the current {@code "format"} tag. Mirrors the TS
     * {@code warnIfLegacyFormat} (src/main/flow-export/fluxor-flow.ts) — the frozen
     * cross-runtime contract:
     * <ol>
     *   <li>{@code "fluxor-flow"} — silence.</li>
     *   <li>absent/null — one warning, reported as the assumed {@code "heliox-flow"} (no
     *       pre-rebrand export ever stamped the field, so absence IS the legacy format).</li>
     *   <li>any other value (including the literal {@code "heliox-flow"}) — one warning
     *       mentioning the seen value.</li>
     * </ol>
     * Never throws — an unrecognized or absent format is a deprecation signal, not a
     * validation failure, since the rest of the schema hasn't changed shape.
     */
    private static void checkLegacyFormat(JsonNode root) {
        JsonNode formatNode = root.get("format");
        String format = (formatNode == null || formatNode.isNull()) ? null : formatNode.asText();
        if (CURRENT_FORMAT_NAME.equals(format)) {
            return;
        }
        String seenAs = format != null ? format : LEGACY_FORMAT_NAME;
        if (WARNED_LEGACY_FORMATS.add(seenAs)) {
            System.err.println(
                "Importing a flow in the deprecated \"" + seenAs
                    + "\" format; re-export it to upgrade to \"" + CURRENT_FORMAT_NAME + "\".");
        }
    }

    /**
     * Rosetta context-mode downgrade (spec decision 2,
     * {@code docs/superpowers/specs/2026-07-10-rosetta-context-manifest.md}): warns (once per
     * process, to {@code System.err} — the same transport and once-semantics as
     * {@link #checkLegacyFormat}) when importing a flow declaring
     * {@code contextMode: "feedback"}, which this runtime cannot honour in v1 (no run-context
     * manifest/briefing machinery — that lives in the TS harness engine). The frozen
     * cross-runtime contract:
     * <ol>
     *   <li>{@code "feedback"} — one warning ({@link #FEEDBACK_DOWNGRADE_WARNING}); execution
     *       proceeds in blind mode, the only mode this executor implements.</li>
     *   <li>{@code "blind"}, absent/null, or any other value — silence: there is nothing to
     *       downgrade.</li>
     * </ol>
     * Never throws, and never mutates the value: {@code contextMode} is preserved verbatim on
     * the parsed {@link FlowDefinition} (the downgrade changes runtime behaviour, not the
     * recorded definition) so a re-serialisation round-trips without loss.
     */
    private static void checkContextModeDowngrade(String contextMode) {
        if (!FEEDBACK_CONTEXT_MODE.equals(contextMode)) {
            return;
        }
        if (WARNED_FEEDBACK_DOWNGRADE.compareAndSet(false, true)) {
            System.err.println(FEEDBACK_DOWNGRADE_WARNING);
        }
    }

    private static StepConfig parseStep(JsonNode node, String flowId) {
        String id = requireText(node, "id", flowId);
        String prompt = requireText(node, "prompt", flowId + "/" + id);
        String systemPrompt = optionalText(node, "systemPrompt");
        List<String> dependsOn = parseStringArray(node.get("dependsOn"));
        Map<String, Object> context = parseContext(node.get("context"));
        JsonNode contract = parseContract(node.get("contract"), id, flowId);
        String model = optionalText(node, "model");
        // "tools" and "type" are intentionally ignored.
        return new StepConfig(id, systemPrompt, prompt, context, dependsOn, contract, model);
    }

    /** Carried opaquely — copied verbatim, never interpreted by this SDK. */
    private static JsonNode parseContract(JsonNode contractNode, String stepId, String flowId) {
        if (contractNode == null || contractNode.isNull()) {
            return null;
        }
        if (!contractNode.isObject()) {
            throw new IllegalArgumentException(
                "Field 'contract' in step '" + stepId + "' of flow '" + flowId + "' must be an object.");
        }
        return contractNode;
    }

    // --- loop parsing ---------------------------------------------------------------------

    private static List<LoopConfig> parseLoops(JsonNode loopsNode, String flowId) {
        if (loopsNode == null || loopsNode.isNull()) {
            return List.of();
        }
        if (!loopsNode.isArray()) {
            throw new IllegalArgumentException(
                "Canonical flow JSON 'loops' field must be an array when present, in flow '" + flowId + "'.");
        }
        List<LoopConfig> loops = new ArrayList<>();
        for (JsonNode loopNode : loopsNode) {
            loops.add(parseLoop(loopNode, flowId));
        }
        return loops;
    }

    private static LoopConfig parseLoop(JsonNode node, String flowId) {
        JsonNode idNode = node.get("id");
        if (idNode == null || idNode.isNull() || idNode.asText().isBlank()) {
            throw new IllegalArgumentException(
                "Required field 'id' is missing or null in a loop of flow '" + flowId + "'.");
        }
        String id = idNode.asText();

        JsonNode sourceNode = node.get("sourceStepId");
        if (sourceNode == null || sourceNode.isNull() || sourceNode.asText().isBlank()) {
            throw new IllegalArgumentException(
                "Required field 'sourceStepId' is missing or null in loop '" + id + "' of flow '" + flowId + "'.");
        }
        String sourceStepId = sourceNode.asText();

        JsonNode targetNode = node.get("targetStepId");
        if (targetNode == null || targetNode.isNull() || targetNode.asText().isBlank()) {
            throw new IllegalArgumentException(
                "Required field 'targetStepId' is missing or null in loop '" + id + "' of flow '" + flowId + "'.");
        }
        String targetStepId = targetNode.asText();

        int maxIterations = clampLoopIterations(node.get("maxIterations"));

        return new LoopConfig(id, sourceStepId, targetStepId, maxIterations);
    }

    /**
     * Clamp a raw {@code maxIterations} node into [1, 50], defaulting a missing, null, or
     * non-finite/non-numeric value to 3 passes. Mirrors the TypeScript
     * {@code clampLoopIterations} (src/types/harness.ts) exactly, so every consumer of a
     * parsed {@link LoopConfig} may assume a value in [1, 50] without re-validating.
     */
    private static int clampLoopIterations(JsonNode node) {
        if (node == null || node.isNull() || !node.isNumber()) {
            return LOOP_DEFAULT_MAX_ITERATIONS;
        }
        double raw = node.asDouble();
        if (Double.isNaN(raw) || Double.isInfinite(raw)) {
            return LOOP_DEFAULT_MAX_ITERATIONS;
        }
        int floored = (int) Math.floor(raw);
        return Math.min(LOOP_MAX_ITERATIONS_CAP, Math.max(1, floored));
    }

    private static String requireText(JsonNode parent, String field, String location) {
        JsonNode node = parent.get(field);
        if (node == null || node.isNull()) {
            throw new IllegalArgumentException(
                "Required field '" + field + "' is missing or null in step at " + location + ".");
        }
        return node.asText();
    }

    private static String optionalText(JsonNode parent, String field) {
        JsonNode node = parent.get(field);
        if (node == null || node.isNull()) {
            return null;
        }
        return node.asText();
    }

    private static List<String> parseStringArray(JsonNode arrayNode) {
        if (arrayNode == null || arrayNode.isNull() || !arrayNode.isArray()) {
            return List.of();
        }
        List<String> result = new ArrayList<>();
        for (JsonNode element : arrayNode) {
            result.add(element.asText());
        }
        return result;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> parseContext(JsonNode contextNode) {
        if (contextNode == null || contextNode.isNull() || !contextNode.isObject()) {
            return Map.of();
        }
        // Deserialize as a plain String→Object map; nested objects become Maps as well.
        try {
            Map<String, Object> raw = Json.MAPPER.treeToValue(contextNode,
                Json.MAPPER.getTypeFactory().constructMapType(LinkedHashMap.class, String.class, Object.class));
            return raw != null ? raw : Map.of();
        } catch (Exception e) {
            // Graceful fallback: return empty context rather than failing the import.
            return Map.of();
        }
    }
}
