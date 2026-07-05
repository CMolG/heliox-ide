package io.heliox.sdk.flow;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import io.heliox.sdk.engine.FlowExecutor;
import io.heliox.sdk.engine.StepExecutor;
import io.heliox.sdk.internal.Json;
import io.heliox.sdk.provider.ChatMessage;
import io.heliox.sdk.provider.LlmResponse;
import io.heliox.sdk.provider.ToolCall;
import io.heliox.sdk.testutil.FakeProvider;
import io.heliox.sdk.tool.HelioxTool;
import io.heliox.sdk.tool.ToolRegistry;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedDeque;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Cross-runtime conformance test — proves that the Java runtime traverses the canonical
 * DAG in the same topological order as the TypeScript IDE runtime AND propagates identical
 * raw provider text for all steps (typed-output parity, ARCH-074) AND calls the same tools
 * with the same arguments and integrates the same results (tool-calling parity, ARCH-075).
 *
 * <p><b>Shared fixture</b>: {@code sdk/conformance/conformance-chain.flow.json} (never
 * modified here). Both runtimes consume this single source of truth.
 *
 * <p><b>Golden DAG order</b>: {@code [step-a, step-b, step-c, step-d, step-e]} — a strict
 * linear chain where each step depends on the previous one.
 *
 * <p><b>Tool-calling parity (ARCH-075):</b> {@code step-e} invokes the deterministic
 * {@code uppercase} tool, which is registered in both the Java {@link ToolRegistry} (here)
 * and the TypeScript conformance test harness. Both runtimes call the tool with the same
 * arguments ({@code {"text":"hello conformance"}}) and integrate the same result
 * ({@code "HELLO CONFORMANCE"}) into the conversation, producing the same post-tool output
 * ({@code "Result: HELLO CONFORMANCE"}) — proven by comparing against
 * {@code golden-tool-calls.json}.
 */
class CrossRuntimeConformanceTest {

    /** The golden execution order that BOTH runtimes must agree on. */
    private static final List<String> GOLDEN_ORDER =
        List.of("step-a", "step-b", "step-c", "step-d", "step-e");

    /** Minimal output type for the terminal step (explicit typed-path test only). */
    record FlowResult(String value) {}

    // ---------------------------------------------------------------------------
    // Conformance tool — uppercase
    //
    // Identical name/schema/behaviour to the function in semantic-parity.test.ts.
    // Pure, deterministic, no side-effects: uppercase(text) = text.toUpperCase().
    // ---------------------------------------------------------------------------

    static final class UppercaseTool {
        @HelioxTool(name = "uppercase", description = "Returns the input text in upper case.")
        public String uppercase(String text) {
            return text == null ? "" : text.toUpperCase();
        }
    }

    // Tool-call fixture constants (must match golden-tool-calls.json exactly).
    static final String UPPERCASE_TOOL_ARGS   = "{\"text\":\"hello conformance\"}";
    static final String UPPERCASE_TOOL_RESULT = "HELLO CONFORMANCE";
    static final String STEP_E_FINAL_TEXT     = "Result: HELLO CONFORMANCE";

    // ---- Fixture resolution ---------------------------------------------------------------

    /**
     * Locate a named file within the shared {@code sdk/conformance/} directory.
     * Tries the Maven module CWD ({@code ../conformance/<name>}) first, then several
     * fallbacks so the test works from any working directory.
     */
    private static Path resolveConformanceFile(String filename) {
        // Primary: Maven default CWD is the module directory (sdk/java/).
        Path primary = Path.of("..", "conformance", filename).toAbsolutePath().normalize();
        if (Files.exists(primary)) {
            return primary;
        }

        // Fallback 1: run from the sdk/ directory (e.g. IDE with sdk/ as working dir).
        Path fromSdk = Path.of("conformance", filename).toAbsolutePath().normalize();
        if (Files.exists(fromSdk)) {
            return fromSdk;
        }

        // Fallback 2: run from the repo root (heliox-ide/).
        Path fromRoot = Path.of("sdk", "conformance", filename).toAbsolutePath().normalize();
        if (Files.exists(fromRoot)) {
            return fromRoot;
        }

        // Fallback 3: walk up from CWD until we find the conformance directory.
        Path cwd = Path.of(".").toAbsolutePath().normalize();
        Path candidate = cwd;
        for (int depth = 0; depth < 6; depth++) {
            Path attempt = candidate.resolve(Path.of("sdk", "conformance", filename)).normalize();
            if (Files.exists(attempt)) {
                return attempt;
            }
            candidate = candidate.getParent();
            if (candidate == null) {
                break;
            }
        }

        throw new AssertionError(
            "Cannot locate the shared fixture '" + filename + "'. "
                + "Tried (primary) " + primary + ", (sdk/) " + fromSdk
                + ", (root) " + fromRoot + ". "
                + "Ensure the file exists at sdk/conformance/" + filename
                + " relative to the repository root. Working directory was: "
                + Path.of(".").toAbsolutePath().normalize());
    }

    /**
     * Locate the shared flow fixture — delegates to {@link #resolveConformanceFile(String)}.
     */
    private static Path resolveFixture() {
        return resolveConformanceFile("conformance-chain.flow.json");
    }

    // ---- Import correctness ---------------------------------------------------------------

    @Test
    void importsFixtureStructurallyCorrect() {
        Path fixture = resolveFixture();
        FlowDefinition flow = FlowImport.fromCanonicalFile(fixture);

        assertEquals("conformance-chain", flow.id(),
            "flow id must match the fixture's 'id' field");

        List<StepConfig> steps = flow.steps();
        assertEquals(5, steps.size(), "expected exactly 5 steps");

        // Check ids in order.
        assertEquals("step-a", steps.get(0).id());
        assertEquals("step-b", steps.get(1).id());
        assertEquals("step-c", steps.get(2).id());
        assertEquals("step-d", steps.get(3).id());
        assertEquals("step-e", steps.get(4).id());

        // Verify promptTemplate mapping (canonical 'prompt' field).
        assertTrue(steps.get(0).promptTemplate().contains("Step A"),
            "step-a promptTemplate should contain 'Step A'");
        assertTrue(steps.get(1).promptTemplate().contains("Step B"),
            "step-b promptTemplate should contain 'Step B'");
        assertTrue(steps.get(4).promptTemplate().contains("Step E"),
            "step-e promptTemplate should contain 'Step E'");

        // Verify dependsOn → dependencies mapping.
        assertEquals(List.of(), steps.get(0).dependencies(),
            "step-a must have no dependencies");
        assertEquals(List.of("step-a"), steps.get(1).dependencies(),
            "step-b must depend on step-a");
        assertEquals(List.of("step-b"), steps.get(2).dependencies(),
            "step-c must depend on step-b");
        assertEquals(List.of("step-c"), steps.get(3).dependencies(),
            "step-d must depend on step-c");
        assertEquals(List.of("step-d"), steps.get(4).dependencies(),
            "step-e must depend on step-d");

        // systemPrompt must be null (not present in fixture).
        assertNull(steps.get(0).systemPrompt(), "step-a systemPrompt should be null");

        // context must default to empty map.
        assertTrue(steps.get(0).context().isEmpty(), "step-a context should be empty");
    }

    // ---- DAG execution order -------------------------------------------------------------

    /**
     * Runs the imported flow through the real {@link FlowExecutor} with a stub
     * {@link FakeProvider}, captures execution order, and asserts it equals the golden order.
     *
     * <p>For step-e, the provider must handle two turns: first the tool-call request, then
     * the final text after the tool result is fed back. The responder detects the post-tool
     * turn by checking for a TOOL-role message in the request.
     */
    @Test
    void dagOrderMatchesGoldenOrder() throws Exception {
        Path fixture = resolveFixture();
        FlowDefinition flow = FlowImport.fromCanonicalFile(fixture);

        // Build a prompt → step-id mapping from the imported steps.
        Map<String, String> promptToId = new LinkedHashMap<>();
        for (StepConfig step : flow.steps()) {
            promptToId.put(step.promptTemplate(), step.id());
        }

        CopyOnWriteArrayList<String> observedOrder = new CopyOnWriteArrayList<>();

        // Register the uppercase tool so step-e's tool call can be executed.
        ToolRegistry registry = new ToolRegistry().register(new UppercaseTool());

        FakeProvider provider = new FakeProvider().responder(request -> {
            // Locate the USER-role message — it always contains the rendered promptTemplate.
            String userContent = request.messages().stream()
                .filter(m -> m.role() == ChatMessage.Role.USER)
                .map(ChatMessage::content)
                .findFirst()
                .orElse("");

            // Match against the known prompts.
            String matchedId = null;
            for (Map.Entry<String, String> entry : promptToId.entrySet()) {
                if (userContent.contains(entry.getKey())) {
                    matchedId = entry.getValue();
                    break;
                }
            }

            if (matchedId != null) {
                // Record order only on first call for each step (tool-loop may call multiple times).
                final String stepId = matchedId;
                if (!observedOrder.contains(stepId)) {
                    observedOrder.add(stepId);
                }
            }

            // Detect post-tool turn for step-e: a TOOL message is present in the history.
            boolean isToolResultTurn = request.messages().stream()
                .anyMatch(m -> m.role() == ChatMessage.Role.TOOL);

            if (isToolResultTurn) {
                // Second turn for step-e: model emits the final text after seeing the tool result.
                boolean isTypedStep = request.messages().stream()
                    .anyMatch(m -> m.role() == ChatMessage.Role.SYSTEM
                        && m.content().contains("JSON Schema"));
                return LlmResponse.of(isTypedStep ? "{\"value\":\"done\"}" : STEP_E_FINAL_TEXT);
            }

            // First (or only) turn: detect step-e by its prompt and return a tool call.
            if (matchedId != null && matchedId.equals("step-e")) {
                return LlmResponse.withToolCalls(
                    "",
                    List.of(new ToolCall("call_conformance_1", "uppercase", UPPERCASE_TOOL_ARGS))
                );
            }

            // All other steps (step-a through step-d): detect typed path and return appropriate text.
            boolean isTypedStep = request.messages().stream()
                .anyMatch(m -> m.role() == ChatMessage.Role.SYSTEM
                    && m.content().contains("JSON Schema"));
            return LlmResponse.of(isTypedStep ? "{\"value\":\"done\"}" : "ok");
        });

        FlowExecutor executor = new FlowExecutor(new StepExecutor(provider, registry));
        FlowResult result = executor.execute(flow, FlowResult.class, 1, Map.of()).get();

        // Assert the typed terminal response came back correctly.
        assertEquals("done", result.value(), "terminal step must deserialize FlowResult correctly");

        // Assert execution order matches the canonical golden order.
        List<String> captured = new ArrayList<>(observedOrder);
        assertEquals(GOLDEN_ORDER, captured,
            "Java DAG execution order must match the golden order " + GOLDEN_ORDER
                + " but got " + captured
                + ". This is a cross-runtime conformance failure.");
    }

    // ---- Semantic output parity ----------------------------------------------------------

    /**
     * SEMANTIC EXECUTION PARITY (ARCH-074 + ARCH-075) — proves the Java runtime produces
     * the same per-step outputs as the TypeScript runtime for the canonical conformance flow,
     * including the tool-calling step (step-e).
     *
     * <h3>Tool-calling step-e</h3>
     * The scripted {@link FakeProvider} first returns a tool-call request for
     * {@code uppercase}, then (after the tool has executed and the result has been threaded
     * back) returns the final text. The {@link ToolRegistry} with the real
     * {@link UppercaseTool} ensures the tool is ACTUALLY invoked — not bypassed.
     *
     * <h3>How the trace is captured</h3>
     * All steps use {@code executeAllText}. For steps a-d the scripted text flows through
     * unchanged. For step-e the text is the post-tool final response
     * ({@code "Result: HELLO CONFORMANCE"}). The golden trace entry for step-e records this
     * same text, making the assertion byte-identical across runtimes.
     */
    @Test
    void semanticParityMatchesGoldenTrace() throws Exception {
        // 1. Load the flow fixture.
        Path flowFixture = resolveConformanceFile("conformance-chain.flow.json");
        FlowDefinition flow = FlowImport.fromCanonicalFile(flowFixture);

        // 2a. Load scripted responses: Map<stepId, text>.
        Path scriptedResponsesPath = resolveConformanceFile("scripted-responses.json");
        Map<String, String> scriptedResponses = Json.MAPPER.readValue(
            scriptedResponsesPath.toFile(),
            new TypeReference<Map<String, String>>() {}
        );

        // 2b. Load golden trace: List<{stepId, output}>.
        Path goldenTracePath = resolveConformanceFile("golden-trace.json");
        List<Map<String, String>> goldenTrace = Json.MAPPER.readValue(
            goldenTracePath.toFile(),
            new TypeReference<List<Map<String, String>>>() {}
        );

        // Build prompt → stepId mapping (each prompt is unique — unambiguous).
        Map<String, String> promptToId = new LinkedHashMap<>();
        for (StepConfig step : flow.steps()) {
            promptToId.put(step.promptTemplate(), step.id());
        }

        // Register the uppercase tool so the real tool-execution loop runs for step-e.
        ToolRegistry registry = new ToolRegistry().register(new UppercaseTool());

        // 3. Scripted provider: handles both plain text steps AND the two-turn tool-calling step.
        //    - For step-a through step-d: return canned text from scripted-responses.json.
        //    - For step-e, turn 1: return a tool-call request for uppercase.
        //    - For step-e, turn 2 (TOOL message present): return the post-tool final text.
        FakeProvider provider = new FakeProvider().responder(request -> {
            String userContent = request.messages().stream()
                .filter(m -> m.role() == ChatMessage.Role.USER)
                .map(ChatMessage::content)
                .findFirst()
                .orElse("");

            String matchedId = null;
            for (Map.Entry<String, String> entry : promptToId.entrySet()) {
                if (userContent.contains(entry.getKey())) {
                    matchedId = entry.getValue();
                    break;
                }
            }

            // Detect post-tool turn: a TOOL-role message has been threaded back.
            boolean isToolResultTurn = request.messages().stream()
                .anyMatch(m -> m.role() == ChatMessage.Role.TOOL);

            if (isToolResultTurn) {
                // Second call for step-e: return the final text (after tool result consumed).
                String text = scriptedResponses.getOrDefault("step-e", "");
                return LlmResponse.of(text);
            }

            if ("step-e".equals(matchedId)) {
                // First call for step-e: the model requests the uppercase tool.
                return LlmResponse.withToolCalls(
                    "",
                    List.of(new ToolCall("call_conformance_1", "uppercase", UPPERCASE_TOOL_ARGS))
                );
            }

            // Steps a-d: plain text response.
            String text = matchedId != null ? scriptedResponses.get(matchedId) : null;
            return LlmResponse.of(text != null ? text : "");
        });

        // 4. Execute ALL steps as plain text — the canonical default (no schema opt-in).
        //    The ToolRegistry is wired so step-e's tool call is ACTUALLY executed.
        FlowExecutor executor = new FlowExecutor(new StepExecutor(provider, registry));
        Map<String, String> executionResults = executor.executeAllText(flow, 1, Map.of()).get();

        // 5. Build the observed trace in golden-trace order (DAG topological order).
        List<Map<String, String>> capturedTrace = new ArrayList<>();
        for (StepConfig step : flow.steps()) {
            String output = executionResults.get(step.id());
            Map<String, String> entry = new LinkedHashMap<>();
            entry.put("stepId", step.id());
            entry.put("output", output != null ? output : "");
            capturedTrace.add(entry);
        }

        // 6. Assert the actual runtime output equals the golden trace — no normalization needed.
        assertEquals(goldenTrace.size(), capturedTrace.size(),
            "Trace length must match golden trace. Golden=" + goldenTrace.size()
                + " Observed=" + capturedTrace.size());

        for (int i = 0; i < goldenTrace.size(); i++) {
            Map<String, String> expected = goldenTrace.get(i);
            Map<String, String> actual = capturedTrace.get(i);

            assertEquals(expected.get("stepId"), actual.get("stepId"),
                "Trace entry[" + i + "] stepId mismatch. Expected=" + expected.get("stepId")
                    + " Actual=" + actual.get("stepId"));

            assertEquals(expected.get("output"), actual.get("output"),
                "Trace entry[" + i + "] output mismatch for stepId='" + expected.get("stepId") + "'. "
                    + "Expected=\"" + expected.get("output") + "\" Actual=\"" + actual.get("output") + "\". "
                    + "Both runtimes must propagate identical raw provider text (ARCH-074 + ARCH-075).");
        }
    }

    // ---- Tool-calling parity (ARCH-075) --------------------------------------------------

    /**
     * TOOL-CALLING CONFORMANCE PARITY (ARCH-075) — proves the Java runtime invokes the
     * {@code uppercase} tool with the canonical arguments and integrates the result,
     * matching {@code golden-tool-calls.json} byte-for-byte.
     *
     * <p>This test directly exercises {@link StepExecutor} with the {@link ToolRegistry}
     * so the REAL tool-execution loop (provider → tool invocation → provider) runs — not
     * a shortcut. The {@link FakeProvider} scripted queue delivers the same two-turn
     * sequence used in {@link ToolCallingTest}: first a tool-call response, then the final
     * text after the result is threaded back.
     *
     * <p>The TypeScript half of this assertion lives in {@code semantic-parity.test.ts}:
     * the {@code uppercase} function is called directly and the result verified against the
     * same fixture.
     */
    @Test
    void toolCallingParityMatchesGoldenToolCalls() throws Exception {
        // Load the golden tool-calls fixture.
        Path goldenToolCallsPath = resolveConformanceFile("golden-tool-calls.json");
        List<Map<String, String>> goldenToolCalls = Json.MAPPER.readValue(
            goldenToolCallsPath.toFile(),
            new TypeReference<List<Map<String, String>>>() {}
        );

        // Load the flow to get step-e's StepConfig.
        Path flowFixture = resolveConformanceFile("conformance-chain.flow.json");
        FlowDefinition flow = FlowImport.fromCanonicalFile(flowFixture);
        StepConfig stepE = flow.steps().stream()
            .filter(s -> "step-e".equals(s.id()))
            .findFirst()
            .orElseThrow(() -> new AssertionError("step-e not found in fixture"));

        // Register the real uppercase tool — the executor will ACTUALLY invoke it.
        ToolRegistry registry = new ToolRegistry().register(new UppercaseTool());

        // Scripted provider: turn 1 → tool call; turn 2 → final text.
        FakeProvider provider = new FakeProvider()
            .respondWithToolCall("call_conformance_1", "uppercase", UPPERCASE_TOOL_ARGS)
            .respondWith(STEP_E_FINAL_TEXT);

        StepExecutor stepExecutor = new StepExecutor(provider, registry);

        // Execute step-e as plain text — the tool loop runs inside executeStepText.
        String output = stepExecutor.executeStepText(stepE, 1).get();

        // Assert the post-tool output matches the golden contract.
        assertEquals(STEP_E_FINAL_TEXT, output,
            "step-e post-tool output must match the golden fixture");

        // Assert the provider was called twice (tool-call turn + final-text turn).
        assertEquals(2, provider.requests.size(),
            "Provider must be called exactly twice for step-e: tool-call request + final-text request");

        // Assert the tool result was threaded back as a TOOL message in the second request.
        boolean toolResultFedBack = provider.requests.get(1).messages().stream()
            .anyMatch(m -> m.role() == ChatMessage.Role.TOOL
                && m.content().contains(UPPERCASE_TOOL_RESULT));
        assertTrue(toolResultFedBack,
            "The tool result '" + UPPERCASE_TOOL_RESULT + "' must be fed back as a TOOL message");

        // Assert against golden-tool-calls.json.
        assertEquals(1, goldenToolCalls.size(),
            "golden-tool-calls.json must contain exactly one entry");
        Map<String, String> golden = goldenToolCalls.get(0);

        assertEquals("step-e", golden.get("stepId"));
        assertEquals("uppercase", golden.get("toolName"),
            "Tool name must match the golden fixture");
        assertEquals(UPPERCASE_TOOL_ARGS, golden.get("arguments"),
            "Tool arguments must match the golden fixture");
        assertEquals(UPPERCASE_TOOL_RESULT, golden.get("result"),
            "Tool result must match the golden fixture");

        // Verify the tool was ACTUALLY INVOKED by cross-checking the result independently.
        UppercaseTool tool = new UppercaseTool();
        String independentResult = tool.uppercase("hello conformance");
        assertEquals(UPPERCASE_TOOL_RESULT, independentResult,
            "The golden result must equal uppercase(\"hello conformance\") — verifying the tool logic");
    }

    // ---- Loop execution parity (Phase 4a) -------------------------------------------------

    /**
     * LOOP EXECUTION CONFORMANCE PARITY (Phase 4a) — proves the Java runtime expands
     * {@code conformance-loop.flow.json}'s bounded loop-back edge (loop-1: step-b2 ->
     * step-b1, maxIterations=3) into the same per-iteration instance trace as the TS/Python
     * runtimes — see {@code golden-loop-trace.json} and {@code sdk/conformance/README.md}.
     *
     * <p>The loop body {@code {step-b1, step-b2}} interleaves pass-by-pass
     * ({@code b1@1, b2@1, b1@2, b2@2, b1@3, b2@3}) rather than running all of step-b1's
     * passes before any of step-b2's; {@code step-c} waits for the loop's final pass.
     */
    @Test
    void loopExecutionMatchesGoldenTrace() throws Exception {
        Path flowFixture = resolveConformanceFile("conformance-loop.flow.json");
        FlowDefinition flow = FlowImport.fromCanonicalFile(flowFixture);

        assertEquals(1, flow.loops().size(), "conformance-loop.flow.json must declare exactly one loop");
        assertEquals("loop-1", flow.loops().get(0).id());
        assertEquals("step-b2", flow.loops().get(0).sourceStepId());
        assertEquals("step-b1", flow.loops().get(0).targetStepId());
        assertEquals(3, flow.loops().get(0).maxIterations());

        Path scriptedPath = resolveConformanceFile("scripted-loop-responses.json");
        Map<String, List<String>> scriptedLoopResponses = Json.MAPPER.readValue(
            scriptedPath.toFile(),
            new TypeReference<Map<String, List<String>>>() {}
        );

        Path goldenPath = resolveConformanceFile("golden-loop-trace.json");
        List<Map<String, Object>> goldenTrace = Json.MAPPER.readValue(
            goldenPath.toFile(),
            new TypeReference<List<Map<String, Object>>>() {}
        );

        Map<String, String> promptToId = new LinkedHashMap<>();
        for (StepConfig step : flow.steps()) {
            promptToId.put(step.promptTemplate(), step.id());
        }

        // Per-step FIFO queues — the fake provider pops the next scripted response for
        // whichever step matches the request's prompt on every call (one call per iteration;
        // the prompt text itself does not vary by iteration).
        Map<String, ConcurrentLinkedDeque<String>> queues = new ConcurrentHashMap<>();
        scriptedLoopResponses.forEach((stepId, responses) -> queues.put(stepId, new ConcurrentLinkedDeque<>(responses)));

        FakeProvider provider = new FakeProvider().responder(request -> {
            String userContent = request.messages().stream()
                .filter(m -> m.role() == ChatMessage.Role.USER)
                .map(ChatMessage::content)
                .findFirst()
                .orElse("");

            String matchedId = null;
            for (Map.Entry<String, String> entry : promptToId.entrySet()) {
                if (userContent.contains(entry.getKey())) {
                    matchedId = entry.getValue();
                    break;
                }
            }

            ConcurrentLinkedDeque<String> queue = matchedId != null ? queues.get(matchedId) : null;
            String text = queue != null ? queue.poll() : null;
            return LlmResponse.of(text != null ? text : "");
        });

        FlowExecutor executor = new FlowExecutor(new StepExecutor(provider));
        List<FlowExecutor.TraceEntry> trace = executor.executeAllTextTrace(flow, 1, Map.of()).get();

        assertEquals(goldenTrace.size(), trace.size(),
            "Trace length must match golden-loop-trace.json. Golden=" + goldenTrace.size()
                + " Observed=" + trace.size());

        for (int i = 0; i < goldenTrace.size(); i++) {
            Map<String, Object> expected = goldenTrace.get(i);
            FlowExecutor.TraceEntry actual = trace.get(i);

            assertEquals(expected.get("stepId"), actual.stepId(),
                "Trace entry[" + i + "] stepId mismatch. Expected=" + expected.get("stepId")
                    + " Actual=" + actual.stepId());
            assertEquals(((Number) expected.get("iteration")).intValue(), actual.iteration(),
                "Trace entry[" + i + "] iteration mismatch for stepId='" + actual.stepId() + "'.");
            assertEquals(expected.get("output"), actual.output(),
                "Trace entry[" + i + "] output mismatch for stepId='" + actual.stepId() + "'. "
                    + "All three runtimes must reproduce golden-loop-trace.json exactly.");
        }

        // Every per-step queue must be fully drained — proves each iteration triggered
        // exactly one provider call (no skipped/duplicated passes).
        queues.forEach((stepId, queue) -> assertTrue(queue.isEmpty(),
            "Step '" + stepId + "' has " + queue.size() + " unconsumed scripted response(s)."));
    }

    // ---- Contract/model round-trip (Phase 4a) ----------------------------------------------

    /**
     * CONTRACT/MODEL CARRY-OPAQUE PARITY (Phase 4a) — proves {@code step-b}'s {@code contract}
     * (StepContract) and {@code model} override survive {@link FlowImport} parsing byte-for-byte.
     * This format never interprets either field — it only guarantees they are carried opaquely
     * (see {@code golden-contract-roundtrip.json}, the TS-side proof of the same contract).
     */
    @Test
    void contractAndModelAreCarried() {
        Path fixture = resolveConformanceFile("conformance-contract.flow.json");
        FlowDefinition flow = FlowImport.fromCanonicalFile(fixture);

        StepConfig stepA = flow.steps().stream().filter(s -> "step-a".equals(s.id())).findFirst()
            .orElseThrow(() -> new AssertionError("step-a not found in fixture"));
        StepConfig stepB = flow.steps().stream().filter(s -> "step-b".equals(s.id())).findFirst()
            .orElseThrow(() -> new AssertionError("step-b not found in fixture"));

        assertNull(stepA.contract(), "step-a must not carry a contract");
        assertNull(stepA.model(), "step-a must not carry a model override");

        JsonNode contract = stepB.contract();
        assertNotNull(contract, "step-b must carry its contract opaquely");
        assertTrue(contract.get("mustWriteFiles").asBoolean(),
            "step-b contract.mustWriteFiles must survive parsing");
        assertEquals(2, contract.get("maxAttempts").asInt(),
            "step-b contract.maxAttempts must survive parsing");
        assertEquals("openai/gpt-4o-mini", stepB.model(),
            "step-b model override must survive parsing");
    }
}
