package io.fluxor.sdk.flow;

import io.fluxor.sdk.FluxorRuntime;
import io.fluxor.sdk.provider.ChatMessage;
import io.fluxor.sdk.testutil.FakeProvider;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class FluxorRuntimeTest {

    record AuditResult(String verdict, int riskScore) {
    }

    @Test
    void fluentApiExecutesAndDeserializes() throws Exception {
        FakeProvider provider = new FakeProvider()
            .respondWith("{\"verdict\":\"compromised\",\"riskScore\":88}");

        FluxorRuntime runtime = FluxorRuntime.builder()
            .llmProvider(provider)
            .build();

        AuditResult result = runtime.flow("auth-audit")
            .withContext("jwt", "eyJhbGciOi...")
            .withExpectedOutput(AuditResult.class)
            .withRetries(3)
            .<AuditResult>executeAsync()
            .get();

        assertEquals("compromised", result.verdict());
        assertEquals(88, result.riskScore());

        // Context must reach the provider's user prompt.
        String userPrompt = provider.requests.get(0).messages().stream()
            .filter(m -> m.role() == ChatMessage.Role.USER)
            .findFirst().orElseThrow().content();
        assertTrue(userPrompt.contains("jwt"));
        assertTrue(userPrompt.contains("eyJhbGciOi..."));
    }

    @Test
    void registeredFlowPromptIsUsed() throws Exception {
        FakeProvider provider = new FakeProvider()
            .respondWith("{\"verdict\":\"safe\",\"riskScore\":1}");

        FluxorRuntime runtime = FluxorRuntime.builder()
            .llmProvider(provider)
            .registerFlow(FlowDefinition.single(
                "auth-audit",
                "Eres un auditor de seguridad.",
                "Analiza el JWT en busca de vulnerabilidades."))
            .build();

        runtime.flow("auth-audit")
            .withExpectedOutput(AuditResult.class)
            .<AuditResult>executeAsync()
            .get();

        boolean systemUsed = provider.requests.get(0).messages().stream()
            .anyMatch(m -> m.role() == ChatMessage.Role.SYSTEM
                && m.content().contains("auditor de seguridad"));
        assertTrue(systemUsed);
    }

    @Test
    void missingExpectedOutputFailsFast() {
        FakeProvider provider = new FakeProvider().respondWith("{}");
        FluxorRuntime runtime = FluxorRuntime.builder().llmProvider(provider).build();

        assertThrows(Exception.class, () -> runtime.flow("x").executeAsync().get());
    }
}
