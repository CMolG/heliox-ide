package io.fluxor.sdk.internal;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;

/**
 * Shared, pre-configured {@link ObjectMapper}. Centralised so schema extraction,
 * validation, provider transport and deserialization all agree on the same JSON
 * conventions (ISO-8601 dates, lenient unknown handling — structural validation
 * is enforced separately by the SchemaValidator).
 */
public final class Json {

    /** Thread-safe, shared instance. ObjectMapper is safe for concurrent reads/writes once configured. */
    public static final ObjectMapper MAPPER = create();

    private Json() {
    }

    public static ObjectMapper create() {
        return new ObjectMapper()
            .registerModule(new JavaTimeModule())
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
            .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
    }
}
