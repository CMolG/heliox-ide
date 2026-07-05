package io.heliox.sdk.validation;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import io.heliox.sdk.internal.Json;
import io.heliox.sdk.schema.JsonSchema;
import io.heliox.sdk.schema.SchemaExtractor;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SchemaValidatorTest {

    enum Role { ADMIN, USER }

    record Account(String email, int age, Role role) {
    }

    private final SchemaExtractor extractor = new SchemaExtractor();
    private final SchemaValidator validator = new SchemaValidator();
    private final JsonSchema schema = extractor.extract(Account.class);

    private JsonNode parse(String json) {
        try {
            return Json.MAPPER.readTree(json);
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException(e);
        }
    }

    @Test
    void acceptsValidPayload() {
        ValidationResult result = validator.validate(schema,
            parse("{\"email\":\"a@b.com\",\"age\":30,\"role\":\"ADMIN\"}"));
        assertTrue(result.valid(), result.toPromptMessage());
    }

    @Test
    void flagsMissingRequiredField() {
        ValidationResult result = validator.validate(schema,
            parse("{\"email\":\"a@b.com\",\"role\":\"USER\"}"));
        assertFalse(result.valid());
        assertTrue(result.toPromptMessage().contains("age"));
    }

    @Test
    void flagsWrongType() {
        ValidationResult result = validator.validate(schema,
            parse("{\"email\":\"a@b.com\",\"age\":\"old\",\"role\":\"USER\"}"));
        assertFalse(result.valid());
        assertTrue(result.toPromptMessage().contains("age"));
    }

    @Test
    void flagsEnumViolation() {
        ValidationResult result = validator.validate(schema,
            parse("{\"email\":\"a@b.com\",\"age\":30,\"role\":\"ROOT\"}"));
        assertFalse(result.valid());
        assertTrue(result.toPromptMessage().contains("role"));
    }

    @Test
    void flagsUnexpectedProperty() {
        ValidationResult result = validator.validate(schema,
            parse("{\"email\":\"a@b.com\",\"age\":30,\"role\":\"USER\",\"extra\":true}"));
        assertFalse(result.valid());
        assertTrue(result.toPromptMessage().contains("extra"));
    }
}
