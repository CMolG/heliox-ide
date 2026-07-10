package io.fluxor.sdk.engine;

import io.fluxor.sdk.flow.StepConfig;
import io.fluxor.sdk.provider.ChatMessage;
import io.fluxor.sdk.testutil.FakeProvider;
import io.fluxor.sdk.tool.FluxorTool;
import io.fluxor.sdk.tool.ToolRegistry;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ToolCallingTest {

    static final class WeatherTool {
        @FluxorTool(name = "get_weather", description = "Clima actual por ciudad")
        public String getWeather(String city) {
            return "{\"city\":\"" + city + "\",\"tempC\":25,\"summary\":\"Sunny\"}";
        }
    }

    record WeatherReport(String city, int tempC, String summary) {
    }

    @Test
    void modelCallsToolThenReturnsStructuredResult() throws Exception {
        ToolRegistry registry = new ToolRegistry().register(new WeatherTool());
        FakeProvider provider = new FakeProvider()
            .respondWithToolCall("call_1", "get_weather", "{\"city\":\"Madrid\"}")
            .respondWith("{\"city\":\"Madrid\",\"tempC\":25,\"summary\":\"Sunny\"}");
        StepExecutor executor = new StepExecutor(provider, registry);

        WeatherReport report = executor.executeStep(
            StepConfig.of("weather", "¿Qué tiempo hace en Madrid?"), WeatherReport.class, 2).get();

        assertEquals("Madrid", report.city());
        assertEquals(25, report.tempC());

        // Two provider turns: the tool-call request, then the final answer.
        assertEquals(2, provider.requests.size());
        // Tools were advertised to the model.
        assertFalse(provider.requests.get(0).tools().isEmpty());
        // The follow-up request threads the tool result back as a TOOL message.
        boolean toolResultFedBack = provider.requests.get(1).messages().stream()
            .anyMatch(m -> m.role() == ChatMessage.Role.TOOL && m.content().contains("Sunny"));
        assertTrue(toolResultFedBack);
    }
}
