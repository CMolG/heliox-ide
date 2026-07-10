package io.fluxor.sdk.schema;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.fluxor.sdk.internal.Json;

/**
 * Immutable holder around a JSON Schema document (Draft 2020-12). Produced by
 * {@link SchemaExtractor} either from a Java type (reflection) or from a raw,
 * predefined schema string.
 */
public final class JsonSchema {

    private final ObjectNode root;

    public JsonSchema(ObjectNode root) {
        this.root = root;
    }

    /** The underlying schema node, including {@code $schema}, {@code $ref}/inline body and {@code $defs}. */
    public ObjectNode node() {
        return root;
    }

    /** Pretty-printed JSON representation, suitable for injection into a prompt. */
    public String toJson() {
        try {
            return Json.MAPPER.writerWithDefaultPrettyPrinter().writeValueAsString(root);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Failed to serialize JSON schema", e);
        }
    }

    @Override
    public String toString() {
        return toJson();
    }
}
