package io.fluxor.sdk.schema;

import com.fasterxml.jackson.databind.node.ObjectNode;

import java.util.HashMap;
import java.util.Map;

/**
 * Mutable DFS state shared across a single {@link SchemaExtractor#extract(Class)} call.
 *
 * <p>Holds the {@code $defs} registry plus a bidirectional type&harr;name index. A type's
 * name is reserved <em>before</em> its members are visited, which is exactly what breaks
 * circular references (e.g. {@code Node} containing {@code List<Node>}): the second visit
 * finds the type already registered and emits a {@code $ref} instead of recursing forever.
 */
final class SchemaContext {

    final ObjectNode defs;
    private final Map<Class<?>, String> namesByType = new HashMap<>();
    private final Map<String, Class<?>> typesByName = new HashMap<>();

    SchemaContext(ObjectNode defs) {
        this.defs = defs;
    }

    boolean isRegistered(Class<?> type) {
        return namesByType.containsKey(type);
    }

    String nameOf(Class<?> type) {
        return namesByType.get(type);
    }

    /**
     * Reserve a unique {@code $defs} name for a type, disambiguating simple-name collisions
     * across packages by appending a numeric suffix.
     */
    String reserve(Class<?> type) {
        String base = type.getSimpleName();
        String name = base;
        int counter = 2;
        while (typesByName.containsKey(name) && typesByName.get(name) != type) {
            name = base + counter++;
        }
        namesByType.put(type, name);
        typesByName.put(name, type);
        return name;
    }
}
