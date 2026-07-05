package io.heliox.sdk.tool;

import com.fasterxml.jackson.databind.JsonNode;
import io.heliox.sdk.provider.ToolSpec;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ToolRegistryTest {

    static final class Calculator {
        @HelioxTool(name = "add", description = "Suma dos enteros")
        public int add(int a, int b) {
            return a + b;
        }

        @HelioxTool(description = "Saluda a alguien")
        public String greet(String name) {
            return "Hola " + name;
        }

        public int notATool(int x) {
            return x;
        }
    }

    @Test
    void scansAnnotatedMethodsAndDerivesParameterSchema() {
        List<ToolSpec> specs = new ToolRegistry().register(new Calculator()).specs();
        assertEquals(2, specs.size());

        ToolSpec add = specs.stream().filter(s -> s.name().equals("add")).findFirst().orElseThrow();
        assertEquals("Suma dos enteros", add.description());
        JsonNode params = add.parameters().node();
        assertEquals("object", params.at("/type").asText());
        assertEquals("integer", params.at("/properties/a/type").asText());
        assertEquals("integer", params.at("/properties/b/type").asText());
        assertTrue(params.get("required").toString().contains("a"));
        assertTrue(params.get("required").toString().contains("b"));
    }

    @Test
    void unannotatedMethodNameIsUsedWhenNameBlank() {
        List<ToolSpec> specs = new ToolRegistry().register(new Calculator()).specs();
        assertTrue(specs.stream().anyMatch(s -> s.name().equals("greet")));
    }

    @Test
    void invokesMethodWithArgumentsBoundByName() throws Exception {
        ToolRegistry registry = new ToolRegistry().register(new Calculator());
        assertEquals("42", registry.invoke("add", "{\"a\":2,\"b\":40}").get());
        assertEquals("Hola Carlos", registry.invoke("greet", "{\"name\":\"Carlos\"}").get());
    }

    @Test
    void unknownToolFails() {
        assertThrows(Exception.class, () -> new ToolRegistry().invoke("nope", "{}").get());
    }
}
