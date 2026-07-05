package io.heliox.sdk.flow;

import com.fasterxml.jackson.databind.JsonNode;
import io.heliox.sdk.internal.Json;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Parses the canonical Heliox flow JSON (exported by the TypeScript IDE) into a
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
 * </ul>
 */
public final class FlowImport {

    /** Default loop passes when a loop-back edge omits/malforms {@code maxIterations}. */
    private static final int LOOP_DEFAULT_MAX_ITERATIONS = 3;
    /** Hard cap on loop passes — the format-normative upper bound. */
    private static final int LOOP_MAX_ITERATIONS_CAP = 50;

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

        return new FlowDefinition(flowId, steps, loops);
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
