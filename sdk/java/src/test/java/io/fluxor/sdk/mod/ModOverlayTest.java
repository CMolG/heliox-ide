package io.fluxor.sdk.mod;

import io.fluxor.sdk.mod.builtin.ForbidToolsMod;
import io.fluxor.sdk.mod.builtin.RegexPostProcessMod;
import io.fluxor.sdk.mod.builtin.SystemPromptMod;
import io.fluxor.sdk.provider.ChatMessage;
import io.fluxor.sdk.provider.LlmRequest;
import io.fluxor.sdk.provider.ToolSpec;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ModOverlayTest {

    private static StepMod named(String id) {
        return new StepMod() {
            @Override
            public String id() {
                return id;
            }
        };
    }

    private static ModContext ctx(String stepId) {
        return new ModContext(stepId, Map.of());
    }

    // -------------------------------------------------------------------
    // ModOverlay resolution order
    // -------------------------------------------------------------------

    @Test
    void resolvesForAllFirstThenStepSpecificInInsertionOrder() {
        StepMod modA = named("modA");
        StepMod modB = named("modB");

        ModOverlay overlay = new ModOverlay().forStep("s1", modA).forAll(modB);

        assertEquals(List.of(modB, modA), overlay.resolve("s1"));
        assertEquals(List.of(modB), overlay.resolve("otro"));
    }

    @Test
    void emptyOverlayResolvesToEmptyList() {
        assertEquals(List.of(), ModOverlay.EMPTY.resolve("any-step"));
        assertEquals(List.of(), new ModOverlay().resolve("any-step"));
    }

    @Test
    void multipleForStepCallsForSameStepAccumulateInInsertionOrder() {
        StepMod modA = named("a");
        StepMod modC = named("c");
        ModOverlay overlay = new ModOverlay().forStep("s1", modA).forStep("s1", modC);

        assertEquals(List.of(modA, modC), overlay.resolve("s1"));
    }

    @Test
    void stepSpecificModsDoNotLeakToOtherSteps() {
        StepMod modA = named("a");
        ModOverlay overlay = new ModOverlay().forStep("s1", modA);

        assertEquals(List.of(), overlay.resolve("s2"));
    }

    // -------------------------------------------------------------------
    // Builtin: SystemPromptMod (antepone/añade)
    // -------------------------------------------------------------------

    @Test
    void systemPromptModPrependsBeforeExistingSystemContent() {
        LlmRequest request = new LlmRequest(
            List.of(ChatMessage.system("Eres un asistente."), ChatMessage.user("hola")),
            null, null, 0.0, List.of());

        LlmRequest result = new SystemPromptMod("REGLA DURA", SystemPromptMod.Position.PREPEND)
            .onRequest(request, ctx("s1"));

        String systemContent = result.messages().get(0).content();
        assertTrue(systemContent.startsWith("REGLA DURA"), "expected the hard rule first: " + systemContent);
        assertTrue(systemContent.contains("Eres un asistente."));
        assertEquals(2, result.messages().size());
    }

    @Test
    void systemPromptModAppendsAfterExistingSystemContent() {
        LlmRequest request = new LlmRequest(
            List.of(ChatMessage.system("Eres un asistente."), ChatMessage.user("hola")),
            null, null, 0.0, List.of());

        LlmRequest result = new SystemPromptMod("RECORDATORIO", SystemPromptMod.Position.APPEND)
            .onRequest(request, ctx("s1"));

        String systemContent = result.messages().get(0).content();
        assertTrue(systemContent.startsWith("Eres un asistente."));
        assertTrue(systemContent.endsWith("RECORDATORIO"), "expected the reminder last: " + systemContent);
    }

    @Test
    void systemPromptModInsertsNewSystemMessageWhenNoneExists() {
        LlmRequest request = new LlmRequest(List.of(ChatMessage.user("hola")), null, null, 0.0, List.of());

        LlmRequest result = new SystemPromptMod("guía", SystemPromptMod.Position.APPEND)
            .onRequest(request, ctx("s1"));

        assertEquals(2, result.messages().size());
        assertEquals(ChatMessage.Role.SYSTEM, result.messages().get(0).role());
        assertEquals("guía", result.messages().get(0).content());
    }

    // -------------------------------------------------------------------
    // Builtin: ForbidToolsMod (quita del request)
    // -------------------------------------------------------------------

    @Test
    void forbidToolsModRemovesNamedToolsOnly() {
        LlmRequest request = new LlmRequest(List.of(ChatMessage.user("hola")), null, null, 0.0,
            List.of(new ToolSpec("dangerous_tool", "d", null), new ToolSpec("safe_tool", "s", null)));

        LlmRequest result = new ForbidToolsMod("dangerous_tool").onRequest(request, ctx("s1"));

        assertEquals(1, result.tools().size());
        assertEquals("safe_tool", result.tools().get(0).name());
    }

    @Test
    void forbidToolsModIsNoOpWhenNothingMatches() {
        LlmRequest request = new LlmRequest(List.of(ChatMessage.user("hola")), null, null, 0.0,
            List.of(new ToolSpec("safe_tool", "s", null)));

        LlmRequest result = new ForbidToolsMod("other_tool").onRequest(request, ctx("s1"));

        assertSame(request, result, "no matching tool — should return the same instance untouched");
    }

    // -------------------------------------------------------------------
    // Builtin: RegexPostProcessMod (reemplaza en el texto)
    // -------------------------------------------------------------------

    @Test
    void regexPostProcessModReplacesInText() {
        StepMod mod = new RegexPostProcessMod("\\bfoo\\b", "bar");

        String result = mod.onResponseText("foo and foo again", ctx("s1"));

        assertEquals("bar and bar again", result);
    }
}
