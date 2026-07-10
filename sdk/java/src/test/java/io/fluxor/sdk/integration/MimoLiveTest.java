package io.fluxor.sdk.integration;

import io.fluxor.sdk.FluxorRuntime;
import io.fluxor.sdk.provider.MimoProvider;
import io.fluxor.sdk.tool.FluxorTool;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertNotNull;

/**
 * Live sanity check against Xiaomi MiMo. Skipped automatically unless {@code AGENT_API_KEY}
 * is present, so it never breaks a default CI build. Run it explicitly with the key exported:
 *
 * <pre>{@code
 * AGENT_API_KEY=... mvn -Dtest=MimoLiveTest test
 * }</pre>
 *
 * It registers a Java tool, asks for the weather (forcing a tool call) and requires the model
 * to return a strict structured {@code WeatherReport} record.
 */
@Tag("integration")
@EnabledIfEnvironmentVariable(named = "AGENT_API_KEY", matches = ".+")
class MimoLiveTest {

    record WeatherReport(String city, String summary, int temperatureC) {
    }

    /** A trivial tool. Public class + public method so reflection can reach it. */
    public static final class WeatherService {
        @FluxorTool(name = "get_weather", description = "Devuelve el clima actual de una ciudad dada")
        public String getWeather(String city) {
            return "{\"city\":\"" + city + "\",\"summary\":\"Soleado con nubes dispersas\",\"temperatureC\":28}";
        }
    }

    @Test
    void callsToolAndReturnsStructuredRecord() throws Exception {
        FluxorRuntime runtime = FluxorRuntime.builder()
            .llmProvider(new MimoProvider(System.getenv("AGENT_API_KEY")))
            .registerTool(new WeatherService())
            .build();

        WeatherReport report = runtime.flow("weather-report")
            .withSystemPrompt("Eres un asistente meteorológico. "
                + "Usa SIEMPRE la herramienta get_weather para obtener datos reales antes de responder.")
            .withPrompt("¿Qué tiempo hace ahora mismo en Madrid? "
                + "Devuelve la ciudad, un breve resumen y la temperatura en grados Celsius.")
            .withExpectedOutput(WeatherReport.class)
            .withRetries(3)
            .<WeatherReport>executeAsync()
            .get(90, TimeUnit.SECONDS);

        assertNotNull(report, "expected a structured WeatherReport from the live model");
        assertNotNull(report.city());
        assertNotNull(report.summary());
    }
}
