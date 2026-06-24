package io.heliox.sdk.schema;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.heliox.sdk.internal.Json;

import java.lang.reflect.Field;
import java.lang.reflect.GenericArrayType;
import java.lang.reflect.Modifier;
import java.lang.reflect.Parameter;
import java.lang.reflect.ParameterizedType;
import java.lang.reflect.RecordComponent;
import java.lang.reflect.Type;
import java.lang.reflect.TypeVariable;
import java.lang.reflect.WildcardType;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.time.LocalDate;
import java.time.temporal.Temporal;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Generates a standard JSON Schema (Draft 2020-12) from a Java type via reflection.
 *
 * <p>Records and POJOs are decomposed recursively. Collections become {@code array}s,
 * maps become open {@code object}s, enums become string enums and nested types are
 * factored into {@code $defs} and referenced with {@code $ref}.
 *
 * <h2>Circular references</h2>
 * Every complex type is registered in a shared {@code $defs} map keyed by a reserved
 * name. The name is reserved <em>before</em> the type's members are visited, so a
 * self-referential type such as {@code record Node(String id, List<Node> children)}
 * resolves {@code children}'s element to {@code #/$defs/Node} on the second visit
 * instead of recursing infinitely. See {@link #registerObject(Class, SchemaContext)}.
 */
public final class SchemaExtractor {

    private static final String DIALECT = "https://json-schema.org/draft/2020-12/schema";

    /** Generate a schema from a Java type via reflection. */
    public JsonSchema extract(Class<?> type) {
        ObjectNode defs = Json.MAPPER.createObjectNode();
        SchemaContext ctx = new SchemaContext(defs);
        ObjectNode body = schemaForType(type, ctx);

        ObjectNode root = Json.MAPPER.createObjectNode();
        root.put("$schema", DIALECT);
        root.setAll(body);
        if (!defs.isEmpty()) {
            root.set("$defs", defs);
        }
        return new JsonSchema(root);
    }

    /**
     * Overload that accepts a raw, predefined JSON Schema string and passes it through
     * unchanged (after asserting it parses to a JSON object).
     */
    public JsonSchema extract(String rawJsonSchema) {
        try {
            JsonNode parsed = Json.MAPPER.readTree(rawJsonSchema);
            if (parsed == null || !parsed.isObject()) {
                throw new IllegalArgumentException("Predefined JSON Schema must be a JSON object.");
            }
            return new JsonSchema((ObjectNode) parsed);
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("Invalid JSON Schema string: " + e.getOriginalMessage(), e);
        }
    }

    /**
     * Build an object schema describing a method's parameter list — reusing the same
     * recursion as {@link #extract(Class)}. Each parameter becomes a property keyed by
     * its name. This is what powers native tool calling (a tool's {@code parameters}).
     *
     * <p>Requires the module to be compiled with {@code -parameters} so real parameter
     * names are available (configured in {@code pom.xml}).
     */
    public JsonSchema extractParameters(Parameter[] parameters) {
        ObjectNode defs = Json.MAPPER.createObjectNode();
        SchemaContext ctx = new SchemaContext(defs);

        ObjectNode root = Json.MAPPER.createObjectNode();
        root.put("type", "object");
        ObjectNode properties = Json.MAPPER.createObjectNode();
        ArrayNode required = Json.MAPPER.createArrayNode();

        for (Parameter parameter : parameters) {
            ObjectNode propSchema = schemaForType(parameter.getParameterizedType(), ctx);
            Schema annotation = parameter.getAnnotation(Schema.class);
            if (annotation != null && !annotation.description().isEmpty()) {
                propSchema.put("description", annotation.description());
            }
            properties.set(parameter.getName(), propSchema);
            if (parameter.getType() != Optional.class) {
                required.add(parameter.getName());
            }
        }

        root.set("properties", properties);
        if (!required.isEmpty()) {
            root.set("required", required);
        }
        root.put("additionalProperties", false);
        if (!defs.isEmpty()) {
            root.set("$defs", defs);
        }
        return new JsonSchema(root);
    }

    // --- recursion core ---------------------------------------------------------------

    private ObjectNode schemaForType(Type type, SchemaContext ctx) {
        Class<?> raw = rawClass(type);

        // Optional<X> at a type position degrades to the schema of X; nullability of a
        // property is handled where the member is declared (see Member.required()).
        if (raw == Optional.class) {
            return schemaForType(typeArgument(type, 0), ctx);
        }

        ObjectNode node = Json.MAPPER.createObjectNode();

        if (raw == boolean.class || raw == Boolean.class) {
            node.put("type", "boolean");
            return node;
        }
        if (isIntegerType(raw)) {
            node.put("type", "integer");
            return node;
        }
        if (isNumberType(raw)) {
            node.put("type", "number");
            return node;
        }
        if (isStringType(raw)) {
            node.put("type", "string");
            return node;
        }
        if (raw.isEnum()) {
            node.put("type", "string");
            ArrayNode values = node.putArray("enum");
            for (Object constant : raw.getEnumConstants()) {
                values.add(((Enum<?>) constant).name());
            }
            return node;
        }
        if (isDateType(raw)) {
            node.put("type", "string");
            node.put("format", raw == LocalDate.class ? "date" : "date-time");
            return node;
        }

        // Arrays (both T[] and the generic E[] form).
        if (raw.isArray()) {
            node.put("type", "array");
            node.set("items", schemaForType(raw.getComponentType(), ctx));
            return node;
        }
        if (type instanceof GenericArrayType gat) {
            node.put("type", "array");
            node.set("items", schemaForType(gat.getGenericComponentType(), ctx));
            return node;
        }

        // Collections -> arrays. The element type is recovered from the field/component
        // generic signature (erased at the class level, preserved at the member level).
        if (Collection.class.isAssignableFrom(raw)) {
            node.put("type", "array");
            node.set("items", schemaForType(typeArgument(type, 0), ctx));
            if (Set.class.isAssignableFrom(raw)) {
                node.put("uniqueItems", true);
            }
            return node;
        }

        // Maps -> open objects keyed by string, valued by the schema of V.
        if (Map.class.isAssignableFrom(raw)) {
            node.put("type", "object");
            node.set("additionalProperties", schemaForType(typeArgument(type, 1), ctx));
            return node;
        }

        // Unresolvable (raw Object / wildcard / type variable) -> permissive empty schema.
        if (raw == Object.class) {
            return node;
        }

        // Anything else is a complex object: register it and reference it.
        String name = registerObject(raw, ctx);
        node.put("$ref", "#/$defs/" + name);
        return node;
    }

    /**
     * Register a complex type in {@code $defs} and return its name. The name is reserved
     * and a placeholder inserted <em>before</em> recursing into members, which is what
     * makes circular references terminate.
     */
    private String registerObject(Class<?> type, SchemaContext ctx) {
        if (ctx.isRegistered(type)) {
            return ctx.nameOf(type); // already built or currently being built -> reuse the $ref
        }

        String name = ctx.reserve(type);
        ObjectNode schema = Json.MAPPER.createObjectNode();
        ctx.defs.set(name, schema); // placeholder so self/mutual references resolve

        schema.put("type", "object");
        ObjectNode properties = Json.MAPPER.createObjectNode();
        ArrayNode required = Json.MAPPER.createArrayNode();

        for (Member member : membersOf(type)) {
            ObjectNode propSchema = schemaForType(member.genericType(), ctx);
            if (member.description() != null && !member.description().isEmpty()) {
                propSchema.put("description", member.description());
            }
            properties.set(member.name(), propSchema);
            if (member.required()) {
                required.add(member.name());
            }
        }

        schema.set("properties", properties);
        if (!required.isEmpty()) {
            schema.set("required", required);
        }
        schema.put("additionalProperties", false);
        return name;
    }

    // --- member discovery -------------------------------------------------------------

    private List<Member> membersOf(Class<?> type) {
        List<Member> members = new ArrayList<>();
        if (type.isRecord()) {
            for (RecordComponent rc : type.getRecordComponents()) {
                members.add(toMember(rc.getName(), rc.getGenericType(), rc.getType(),
                    rc.getAnnotation(JsonProperty.class), rc.getAnnotation(Schema.class)));
            }
        } else {
            for (Field f : type.getDeclaredFields()) {
                int mod = f.getModifiers();
                if (Modifier.isStatic(mod) || Modifier.isTransient(mod) || f.isSynthetic()) {
                    continue;
                }
                members.add(toMember(f.getName(), f.getGenericType(), f.getType(),
                    f.getAnnotation(JsonProperty.class), f.getAnnotation(Schema.class)));
            }
        }
        return members;
    }

    private Member toMember(String name, Type genericType, Class<?> rawType, JsonProperty jsonProperty, Schema schema) {
        String wireName = (jsonProperty != null && !jsonProperty.value().isEmpty()) ? jsonProperty.value() : name;
        boolean required = rawType != Optional.class; // Optional<X> => not required
        String description = schema != null ? schema.description() : null;
        return new Member(wireName, genericType, required, description);
    }

    private record Member(String name, Type genericType, boolean required, String description) {
    }

    // --- type helpers -----------------------------------------------------------------

    private static Class<?> rawClass(Type type) {
        if (type instanceof Class<?> c) {
            return c;
        }
        if (type instanceof ParameterizedType pt) {
            return (Class<?>) pt.getRawType();
        }
        if (type instanceof GenericArrayType) {
            return Object[].class; // dispatched explicitly in schemaForType
        }
        if (type instanceof WildcardType wt) {
            Type[] upper = wt.getUpperBounds();
            return upper.length > 0 ? rawClass(upper[0]) : Object.class;
        }
        if (type instanceof TypeVariable<?> tv) {
            Type[] bounds = tv.getBounds();
            return bounds.length > 0 ? rawClass(bounds[0]) : Object.class;
        }
        return Object.class;
    }

    private static Type typeArgument(Type type, int index) {
        if (type instanceof ParameterizedType pt) {
            Type[] args = pt.getActualTypeArguments();
            if (index < args.length) {
                return args[index];
            }
        }
        return Object.class; // raw collection/map -> permissive element/value
    }

    private static boolean isIntegerType(Class<?> c) {
        return c == byte.class || c == Byte.class
            || c == short.class || c == Short.class
            || c == int.class || c == Integer.class
            || c == long.class || c == Long.class
            || c == BigInteger.class;
    }

    private static boolean isNumberType(Class<?> c) {
        return c == float.class || c == Float.class
            || c == double.class || c == Double.class
            || c == BigDecimal.class;
    }

    private static boolean isStringType(Class<?> c) {
        return c == char.class || c == Character.class
            || CharSequence.class.isAssignableFrom(c)
            || c == UUID.class;
    }

    private static boolean isDateType(Class<?> c) {
        return Temporal.class.isAssignableFrom(c) || Date.class.isAssignableFrom(c);
    }
}
