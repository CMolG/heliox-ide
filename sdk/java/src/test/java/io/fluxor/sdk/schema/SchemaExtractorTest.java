package io.fluxor.sdk.schema;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SchemaExtractorTest {

    enum Severity { LOW, MEDIUM, HIGH }

    record Address(String street, String city) {
    }

    record Person(String name, int age, Severity severity, List<Address> addresses,
                  Map<String, Integer> scores, Optional<String> nickname) {
    }

    /** Self-referential type: the recursion challenge. */
    record Node(String id, List<Node> children) {
    }

    private final SchemaExtractor extractor = new SchemaExtractor();

    @Test
    void generatesDraft2020ObjectSchema() {
        JsonNode schema = extractor.extract(Person.class).node();
        assertEquals("https://json-schema.org/draft/2020-12/schema", schema.get("$schema").asText());
        JsonNode person = schema.at("/$defs/Person");
        assertEquals("object", person.get("type").asText());
        assertFalse(person.get("additionalProperties").asBoolean());
        assertEquals("integer", person.at("/properties/age/type").asText());
        assertEquals("string", person.at("/properties/name/type").asText());
    }

    @Test
    void optionalFieldIsNotRequired() {
        JsonNode person = extractor.extract(Person.class).node().at("/$defs/Person");
        String required = person.get("required").toString();
        assertTrue(required.contains("name"));
        assertTrue(required.contains("age"));
        assertFalse(required.contains("nickname"));
        // Optional<String> still produces a string property schema.
        assertEquals("string", person.at("/properties/nickname/type").asText());
    }

    @Test
    void enumBecomesStringEnum() {
        JsonNode severity = extractor.extract(Person.class).node().at("/$defs/Person/properties/severity");
        assertEquals("string", severity.get("type").asText());
        assertEquals(3, severity.get("enum").size());
        assertEquals("LOW", severity.get("enum").get(0).asText());
    }

    @Test
    void collectionBecomesArrayWithItemRef() {
        JsonNode schema = extractor.extract(Person.class).node();
        JsonNode addresses = schema.at("/$defs/Person/properties/addresses");
        assertEquals("array", addresses.get("type").asText());
        assertEquals("#/$defs/Address", addresses.at("/items/$ref").asText());
        assertEquals("object", schema.at("/$defs/Address/type").asText());
    }

    @Test
    void mapBecomesObjectWithAdditionalProperties() {
        JsonNode scores = extractor.extract(Person.class).node().at("/$defs/Person/properties/scores");
        assertEquals("object", scores.get("type").asText());
        assertEquals("integer", scores.at("/additionalProperties/type").asText());
    }

    @Test
    void selfReferentialTypeResolvesToRefWithoutInfiniteRecursion() {
        JsonNode schema = extractor.extract(Node.class).node();
        assertTrue(schema.at("/$defs/Node").isObject());
        assertEquals("array", schema.at("/$defs/Node/properties/children/type").asText());
        assertEquals("#/$defs/Node", schema.at("/$defs/Node/properties/children/items/$ref").asText());
    }

    @Test
    void stringOverloadPassesThrough() {
        String raw = "{\"type\":\"object\",\"properties\":{\"ok\":{\"type\":\"boolean\"}}}";
        JsonNode schema = extractor.extract(raw).node();
        assertEquals("boolean", schema.at("/properties/ok/type").asText());
    }
}
