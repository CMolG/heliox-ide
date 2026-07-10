package io.fluxor.sdk.validation;

import com.fasterxml.jackson.databind.JsonNode;
import io.fluxor.sdk.schema.JsonSchema;
import io.fluxor.sdk.validation.ValidationResult.FieldError;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

/**
 * Strict, dependency-free JSON Schema validator. It walks the schema produced by
 * {@link io.fluxor.sdk.schema.SchemaExtractor} (resolving {@code $ref} against
 * {@code $defs}) against an instance, collecting one {@link FieldError} per mismatch.
 *
 * <p>Recursion is driven by the (finite) instance data, so even cyclic schemas
 * terminate. Supported keywords: {@code type} (incl. union arrays / {@code null}),
 * {@code required}, {@code enum}, {@code properties}, {@code additionalProperties},
 * {@code items}.
 */
public final class SchemaValidator {

    public ValidationResult validate(JsonSchema schema, JsonNode instance) {
        JsonNode root = schema.node();
        List<FieldError> errors = new ArrayList<>();
        validateNode(root, root, instance, "$", errors);
        return ValidationResult.of(errors);
    }

    private void validateNode(JsonNode root, JsonNode schema, JsonNode value, String path, List<FieldError> errors) {
        schema = resolveRef(root, schema);
        if (schema == null || !schema.isObject()) {
            return; // permissive empty schema {} -> accept anything
        }

        JsonNode typeNode = schema.get("type");
        if (typeNode == null) {
            checkEnum(schema, value, path, errors); // enum-only or untyped schema
            return;
        }

        List<String> allowedTypes = typesOf(typeNode);
        boolean nullable = allowedTypes.contains("null");

        if (value == null || value.isNull()) {
            if (!nullable) {
                errors.add(new FieldError(path, "valor nulo no permitido"));
            }
            return;
        }

        String actual = jsonType(value);
        // Integers satisfy a "number" expectation.
        boolean typeOk = allowedTypes.contains(actual)
            || (actual.equals("integer") && allowedTypes.contains("number"));
        if (!typeOk) {
            List<String> expected = allowedTypes.stream().filter(t -> !t.equals("null")).toList();
            errors.add(new FieldError(path,
                "se esperaba " + String.join("|", expected) + " pero se recibió " + actual));
            return;
        }

        switch (actual) {
            case "object" -> validateObject(root, schema, value, path, errors);
            case "array" -> validateArray(root, schema, value, path, errors);
            default -> checkEnum(schema, value, path, errors);
        }
    }

    private void validateObject(JsonNode root, JsonNode schema, JsonNode value, String path, List<FieldError> errors) {
        JsonNode properties = schema.get("properties");
        JsonNode requiredNode = schema.get("required");
        JsonNode additional = schema.get("additionalProperties");

        if (requiredNode != null && requiredNode.isArray()) {
            for (JsonNode req : requiredNode) {
                if (!value.has(req.asText())) {
                    errors.add(new FieldError(path + "." + req.asText(), "campo requerido ausente"));
                }
            }
        }

        Iterator<Map.Entry<String, JsonNode>> fields = value.fields();
        while (fields.hasNext()) {
            Map.Entry<String, JsonNode> entry = fields.next();
            String childPath = path + "." + entry.getKey();
            JsonNode propSchema = properties != null ? properties.get(entry.getKey()) : null;

            if (propSchema != null) {
                validateNode(root, propSchema, entry.getValue(), childPath, errors);
            } else if (additional != null && additional.isObject()) {
                validateNode(root, additional, entry.getValue(), childPath, errors);
            } else if (additional != null && additional.isBoolean() && !additional.booleanValue()) {
                errors.add(new FieldError(childPath, "propiedad no permitida"));
            }
        }
    }

    private void validateArray(JsonNode root, JsonNode schema, JsonNode value, String path, List<FieldError> errors) {
        JsonNode items = schema.get("items");
        if (items == null) {
            return;
        }
        int index = 0;
        for (JsonNode element : value) {
            validateNode(root, items, element, path + "[" + index + "]", errors);
            index++;
        }
    }

    private void checkEnum(JsonNode schema, JsonNode value, String path, List<FieldError> errors) {
        JsonNode enumNode = schema.get("enum");
        if (enumNode == null || !enumNode.isArray()) {
            return;
        }
        for (JsonNode allowed : enumNode) {
            if (allowed.equals(value)) {
                return;
            }
        }
        errors.add(new FieldError(path, "valor no permitido '" + value.asText() + "'"));
    }

    private JsonNode resolveRef(JsonNode root, JsonNode schema) {
        if (schema == null) {
            return null;
        }
        JsonNode ref = schema.get("$ref");
        if (ref == null || !ref.isTextual()) {
            return schema;
        }
        String pointer = ref.asText();
        if (!pointer.startsWith("#/")) {
            return schema;
        }
        JsonNode target = root.at(pointer.substring(1)); // "#/$defs/X" -> JSON Pointer "/$defs/X"
        return target.isMissingNode() ? schema : target;
    }

    private List<String> typesOf(JsonNode typeNode) {
        List<String> types = new ArrayList<>();
        if (typeNode.isArray()) {
            typeNode.forEach(t -> types.add(t.asText()));
        } else {
            types.add(typeNode.asText());
        }
        return types;
    }

    private String jsonType(JsonNode value) {
        if (value.isObject()) {
            return "object";
        }
        if (value.isArray()) {
            return "array";
        }
        if (value.isTextual()) {
            return "string";
        }
        if (value.isBoolean()) {
            return "boolean";
        }
        if (value.isIntegralNumber()) {
            return "integer";
        }
        if (value.isNumber()) {
            return "number";
        }
        if (value.isNull()) {
            return "null";
        }
        return "unknown";
    }
}
