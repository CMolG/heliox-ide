package io.fluxor.sdk.mod;

import io.fluxor.sdk.FluxorRuntime;
import io.fluxor.sdk.engine.DagTelemetry;
import io.fluxor.sdk.engine.StepExecutor;
import io.fluxor.sdk.flow.StepConfig;
import io.fluxor.sdk.mod.builtin.AppendGuidelineMod;
import io.fluxor.sdk.mod.builtin.ForbidToolsMod;
import io.fluxor.sdk.mod.builtin.ProvideToolsMod;
import io.fluxor.sdk.mod.builtin.RegexPostProcessMod;
import io.fluxor.sdk.provider.ChatMessage;
import io.fluxor.sdk.provider.LlmRequest;
import io.fluxor.sdk.testutil.FakeProvider;
import io.fluxor.sdk.tool.FluxorTool;
import io.fluxor.sdk.tool.ToolRegistry;
import org.junit.jupiter.api.Test;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Verifies {@link StepExecutor} applies an on-demand {@link ModOverlay} exactly as documented:
 * {@code onRequest} before every provider call, {@code onResponseText} before schema validation,
 * both re-applied on schema-validation retries, and — with no overlay — the exact same request
 * pipeline as before mods existed.
 */
class StepModExecutionTest {

    record AuditResult(String verdict, int riskScore) {
    }

    static final class GreetTool {
        @FluxorTool(name = "greet", description = "Saluda por nombre")
        public String greet(String name) {
            return "Hola, " + name;
        }
    }

    // -------------------------------------------------------------------
    // system/prompt injection reaches the captured request
    // -------------------------------------------------------------------

    @Test
    void appendGuidelineModInjectsGuidelineIntoCapturedRequest() throws Exception {
        FakeProvider provider = new FakeProvider().respondWith("{\"verdict\":\"safe\",\"riskScore\":10}");
        StepExecutor executor = new StepExecutor(provider);
        ModOverlay overlay = new ModOverlay().forAll(new AppendGuidelineMod("SOLO mobile-first"));

        AuditResult result = executor.executeStep(
            StepConfig.of("audit", "Audita el token."), AuditResult.class, 2, DagTelemetry.NOOP, overlay).get();

        assertEquals("safe", result.verdict());
        String systemContent = provider.requests.get(0).messages().get(0).content();
        assertTrue(systemContent.contains("SOLO mobile-first"),
            "expected the guideline in the captured system message: " + systemContent);
    }

    // -------------------------------------------------------------------
    // ForbidToolsMod removes a tool from the captured request
    // -------------------------------------------------------------------

    @Test
    void forbidToolsModRemovesToolFromCapturedRequest() throws Exception {
        FakeProvider provider = new FakeProvider().respondWith("{\"verdict\":\"safe\",\"riskScore\":10}");
        ToolRegistry registry = new ToolRegistry().register(new GreetTool());
        StepExecutor executor = new StepExecutor(provider, registry);
        ModOverlay overlay = new ModOverlay().forAll(new ForbidToolsMod("greet"));

        executor.executeStep(StepConfig.of("audit", "Audita."), AuditResult.class, 2, DagTelemetry.NOOP, overlay).get();

        assertTrue(provider.requests.get(0).tools().isEmpty(),
            "the only registered tool was forbidden — the request should advertise none");
    }

    // -------------------------------------------------------------------
    // A post-process mod alters the output BEFORE schema validation
    // -------------------------------------------------------------------

    @Test
    void postProcessModAltersOutputBeforeSchemaValidation() throws Exception {
        // Single-quoted JSON is not valid JSON — without the mod this would fail parsing/validation
        // and consume a retry. RegexPostProcessMod fixes it up before extractJson/parse ever runs.
        FakeProvider provider = new FakeProvider().respondWith("{'verdict':'safe','riskScore':10}");
        StepExecutor executor = new StepExecutor(provider);
        ModOverlay overlay = new ModOverlay().forAll(new RegexPostProcessMod("'", "\""));

        AuditResult result = executor.executeStep(
            StepConfig.of("audit", "Audita."), AuditResult.class, 2, DagTelemetry.NOOP, overlay).get();

        assertEquals("safe", result.verdict());
        assertEquals(10, result.riskScore());
        assertEquals(1, provider.requests.size(), "the post-process fix should avoid any retry");
    }

    @Test
    void regexPostProcessModAppliesToTextStepOutput() throws Exception {
        FakeProvider provider = new FakeProvider().respondWith("Hola foo");
        StepExecutor executor = new StepExecutor(provider);
        ModOverlay overlay = new ModOverlay().forAll(new RegexPostProcessMod("foo", "mundo"));

        String result = executor.executeStepText(
            StepConfig.of("greeting", "Saluda."), 1, DagTelemetry.NOOP, overlay).get();

        assertEquals("Hola mundo", result);
    }

    // -------------------------------------------------------------------
    // No overlay => byte-identical request to the pre-mods call path
    // -------------------------------------------------------------------

    @Test
    void withoutOverlayRequestIsIdenticalToPreModsCallPath() throws Exception {
        // Uses executeStepText (responseSchema is always null there) rather than executeStep,
        // because JsonSchema has no value-based equals() — two schema extractions of the same
        // type are content-identical but reference-distinct, which would make a record-equality
        // assertion on executeStep's LlmRequest flaky for reasons unrelated to mods. Every other
        // LlmRequest component (messages/model/temperature/tools) has proper structural equality.
        FakeProvider baselineProvider = new FakeProvider().respondWith("hola");
        StepExecutor baselineExecutor = new StepExecutor(baselineProvider);
        // Pre-mods call path: the original 2-argument overload, untouched by this plan.
        baselineExecutor.executeStepText(StepConfig.of("greeting", "Saluda."), 1).get();

        FakeProvider overlayAwareProvider = new FakeProvider().respondWith("hola");
        StepExecutor overlayAwareExecutor = new StepExecutor(overlayAwareProvider);
        // New 4-argument overload, explicit ModOverlay.EMPTY.
        overlayAwareExecutor.executeStepText(
            StepConfig.of("greeting", "Saluda."), 1, DagTelemetry.NOOP, ModOverlay.EMPTY).get();

        assertEquals(1, baselineProvider.requests.size());
        assertEquals(baselineProvider.requests, overlayAwareProvider.requests,
            "no overlay attached — the captured LlmRequest must be structurally identical (record equality)");
    }

    // -------------------------------------------------------------------
    // Mods are re-applied on every schema-validation retry
    // -------------------------------------------------------------------

    @Test
    void modsAreReappliedOnEachRetryAttempt() throws Exception {
        AtomicInteger onRequestCalls = new AtomicInteger(0);
        StepMod countingMod = new StepMod() {
            @Override
            public String id() {
                return "counting";
            }

            @Override
            public LlmRequest onRequest(LlmRequest request, ModContext ctx) {
                onRequestCalls.incrementAndGet();
                return request;
            }
        };

        FakeProvider provider = new FakeProvider().respondWith(
            "{\"verdict\":\"safe\"}",                    // missing riskScore -> invalid, forces a retry
            "{\"verdict\":\"safe\",\"riskScore\":42}");  // corrected
        StepExecutor executor = new StepExecutor(provider);
        ModOverlay overlay = new ModOverlay().forAll(countingMod);

        AuditResult result = executor.executeStep(
            StepConfig.of("audit", "Audita."), AuditResult.class, 3, DagTelemetry.NOOP, overlay).get();

        assertEquals(42, result.riskScore());
        assertEquals(2, provider.requests.size());
        assertEquals(2, onRequestCalls.get(), "onRequest must fire again on the retry attempt, not just the first");
    }

    // -------------------------------------------------------------------
    // ProvideToolsMod: the on-demand tool is advertised AND actually dispatchable
    // -------------------------------------------------------------------

    @Test
    void provideToolsModAddsAndDispatchesOnDemandTool() throws Exception {
        FakeProvider provider = new FakeProvider()
            .respondWithToolCall("call_1", "greet", "{\"name\":\"Ana\"}")
            .respondWith("{\"verdict\":\"safe\",\"riskScore\":1}");
        StepExecutor executor = new StepExecutor(provider); // no tool on the shared registry
        ModOverlay overlay = new ModOverlay().forAll(new ProvideToolsMod(new GreetTool()));

        AuditResult result = executor.executeStep(
            StepConfig.of("greeting", "Saluda a Ana."), AuditResult.class, 2, DagTelemetry.NOOP, overlay).get();

        assertEquals("safe", result.verdict());
        assertTrue(provider.requests.get(0).tools().stream().anyMatch(t -> t.name().equals("greet")),
            "the on-demand tool should be advertised on the first request");
        boolean toolResultFedBack = provider.requests.get(1).messages().stream()
            .anyMatch(m -> m.role() == ChatMessage.Role.TOOL && m.content().contains("Hola, Ana"));
        assertTrue(toolResultFedBack, "the on-demand tool must be actually dispatched, not just advertised");
    }

    // -------------------------------------------------------------------
    // FlowExecution.withMods propagates through FlowExecutor down to StepExecutor
    // -------------------------------------------------------------------

    @Test
    void flowExecutionPropagatesOverlayThroughFlowExecutorToStepExecutor() throws Exception {
        FakeProvider provider = new FakeProvider().respondWith("{\"verdict\":\"safe\",\"riskScore\":5}");
        FluxorRuntime runtime = FluxorRuntime.builder().llmProvider(provider).build();
        try {
            ModOverlay overlay = new ModOverlay().forAll(new AppendGuidelineMod("SOLO mobile-first"));

            CompletableFuture<AuditResult> future = runtime.flow("ad-hoc-step")
                .withPrompt("Audita.")
                .withExpectedOutput(AuditResult.class)
                .withMods(overlay)
                .executeAsync();
            AuditResult result = future.get();

            assertEquals("safe", result.verdict());
            String systemContent = provider.requests.get(0).messages().get(0).content();
            assertTrue(systemContent.contains("SOLO mobile-first"),
                "the overlay attached via FlowExecution#withMods must reach the provider request");
        } finally {
            runtime.close();
        }
    }
}
