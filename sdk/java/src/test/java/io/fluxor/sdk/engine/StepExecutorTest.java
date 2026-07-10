package io.fluxor.sdk.engine;

import io.fluxor.sdk.flow.StepConfig;
import io.fluxor.sdk.provider.ChatMessage;
import io.fluxor.sdk.testutil.FakeProvider;
import io.fluxor.sdk.validation.SchemaValidationException;
import org.junit.jupiter.api.Test;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class StepExecutorTest {

    record AuditResult(String verdict, int riskScore) {
    }

    @Test
    void happyPathReturnsTypedResult() throws Exception {
        FakeProvider provider = new FakeProvider()
            .respondWith("{\"verdict\":\"safe\",\"riskScore\":10}");
        StepExecutor executor = new StepExecutor(provider);

        AuditResult result = executor.executeStep(
            StepConfig.of("audit", "Audita el token."), AuditResult.class, 2).get();

        assertEquals("safe", result.verdict());
        assertEquals(10, result.riskScore());
        assertEquals(1, provider.requests.size());
    }

    @Test
    void recoversAfterInvalidThenValid() throws Exception {
        FakeProvider provider = new FakeProvider().respondWith(
            "{\"verdict\":\"safe\"}",                    // missing riskScore -> invalid
            "{\"verdict\":\"safe\",\"riskScore\":42}");  // corrected
        StepExecutor executor = new StepExecutor(provider);

        AuditResult result = executor.executeStep(
            StepConfig.of("audit", "Audita."), AuditResult.class, 3).get();

        assertEquals(42, result.riskScore());
        assertEquals(2, provider.requests.size());

        boolean correctionInjected = provider.requests.get(1).messages().stream()
            .anyMatch(m -> m.role() == ChatMessage.Role.SYSTEM
                && m.content().contains("El JSON falló")
                && m.content().contains("riskScore"));
        assertTrue(correctionInjected, "expected a corrective system message naming the failing field");
    }

    @Test
    void failsWithValidationExceptionWhenRetriesExhausted() {
        FakeProvider provider = new FakeProvider().respondWith(
            "{\"verdict\":\"safe\"}", "{\"verdict\":\"safe\"}", "{\"verdict\":\"safe\"}");
        StepExecutor executor = new StepExecutor(provider);

        CompletableFuture<AuditResult> future = executor.executeStep(
            StepConfig.of("audit", "Audita."), AuditResult.class, 1);

        ExecutionException ex = assertThrows(ExecutionException.class, future::get);
        assertInstanceOf(SchemaValidationException.class, ex.getCause());
    }

    @Test
    void extractJsonStripsCodeFences() {
        assertEquals("{\"a\":1}", StepExecutor.extractJson("```json\n{\"a\":1}\n```"));
        assertEquals("{\"a\":1}", StepExecutor.extractJson("Here you go: {\"a\":1}"));
        assertEquals("{\"a\":1}", StepExecutor.extractJson("{\"a\":1}"));
    }
}
