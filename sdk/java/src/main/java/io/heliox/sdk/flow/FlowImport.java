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
 * concept), and optional {@code context} (key/value map).
 *
 * <p>Mapping to SDK types:
 * <ul>
 *   <li>{@code prompt}      → {@link StepConfig#promptTemplate()}</li>
 *   <li>{@code systemPrompt}→ {@link StepConfig#systemPrompt()} (nullable)</li>
 *   <li>{@code dependsOn}   → {@link StepConfig#dependencies()}</li>
 *   <li>{@code context}     → {@link StepConfig#context()} (empty map when absent)</li>
 *   <li>{@code tools}       → ignored</li>
 * </ul>
 */
public final class FlowImport {

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

        return new FlowDefinition(flowId, steps);
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
        // "tools" and "type" are intentionally ignored.
        return new StepConfig(id, systemPrompt, prompt, context, dependsOn);
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
