package io.heliox.sdk.engine;

import io.heliox.sdk.flow.FlowDefinition;
import io.heliox.sdk.flow.FlowExecution;
import io.heliox.sdk.flow.StepConfig;
import io.heliox.sdk.provider.ChatMessage;
import io.heliox.sdk.provider.LlmResponse;
import io.heliox.sdk.testutil.FakeProvider;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutionException;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests for {@link FlowExecutor#executeMultiSink} and the corresponding
 * {@link FlowExecution#executeMultiSinkAsync()} fluent path.
 *
 * <p>Flow topology used by the happy-path tests:
 * <pre>
 *   root → B (sink)
 *   root → C (sink)
 * </pre>
 * {@code root} is a non-sink (text) node; {@code B} and {@code C} are independent sinks that
 * both depend on {@code root} and each produce a distinct typed {@link java.lang.Record}.
 */
class FlowExecutorMultiSinkTest {

    /** Typed result for sink B. */
    record SummaryResult(String summary) {
    }

    /** Typed result for sink C. */
    record MetricsResult(int count) {
    }

    private static String userPrompt(io.heliox.sdk.provider.LlmRequest request) {
        return request.messages().stream()
            .filter(m -> m.role() == ChatMessage.Role.USER)
            .map(ChatMessage::content)
            .findFirst().orElse("");
    }

    /**
     * Builds the flow: root → B, root → C. B and C are independent sinks, both gated on root.
     */
    private static FlowDefinition twoSinkFlow() {
        return new FlowDefinition("two-sink", List.of(
            new StepConfig("root", null, "node:root", Map.of(), List.of()),
            new StepConfig("B", null, "node:B", Map.of(), List.of("root")),
            new StepConfig("C", null, "node:C", Map.of(), List.of("root"))));
    }

    /**
     * Happy path: two independent sinks each receive the root's text output in their context and
     * produce distinct typed records.
     *
     * <p>Specifically verifies:
     * <ul>
     *   <li>Both sink ids are present in the result map.</li>
     *   <li>Each sink has the correct type and value.</li>
     *   <li>Root was executed exactly once (text), B and C each once (typed) → 3 total requests.</li>
     * </ul>
     */
    @Test
    void executesTwoIndependentSinksAndAggregatesResults() throws Exception {
        FakeProvider provider = new FakeProvider().responder(request -> {
            String prompt = userPrompt(request);
            if (prompt.contains("node:root")) {
                return LlmResponse.of("root-output");
            }
            if (prompt.contains("node:B")) {
                // B is a sink — the executor sends a JSON-schema request; return valid JSON.
                return LlmResponse.of("{\"summary\":\"summary-from-B\"}");
            }
            if (prompt.contains("node:C")) {
                return LlmResponse.of("{\"count\":42}");
            }
            return LlmResponse.of("{}");
        });

        FlowExecutor executor = new FlowExecutor(new StepExecutor(provider));
        Map<String, Class<?>> sinkTypes = Map.of(
            "B", SummaryResult.class,
            "C", MetricsResult.class);

        Map<String, Object> result = executor.executeMultiSink(twoSinkFlow(), sinkTypes, 1, Map.of()).get();

        assertEquals(2, result.size());
        SummaryResult bResult = (SummaryResult) result.get("B");
        MetricsResult cResult = (MetricsResult) result.get("C");
        assertNotNull(bResult, "sink B result must be present");
        assertNotNull(cResult, "sink C result must be present");
        assertEquals("summary-from-B", bResult.summary());
        assertEquals(42, cResult.count());

        // root runs once (text), B once (typed), C once (typed) → exactly 3 LLM requests.
        assertEquals(3, provider.requests.size());
    }

    /**
     * Root output propagation: the prompt rendered for each sink must contain the root node's
     * text output, proving parent-result injection works for multi-sink flows.
     */
    @Test
    void sinksReceiveRootOutputInContext() throws Exception {
        FakeProvider provider = new FakeProvider().responder(request -> {
            String prompt = userPrompt(request);
            if (prompt.contains("node:root")) {
                return LlmResponse.of("root-data");
            }
            if (prompt.contains("node:B")) {
                boolean sawRoot = prompt.contains("root-data");
                return LlmResponse.of("{\"summary\":\"" + (sawRoot ? "has-root" : "missing-root") + "\"}");
            }
            if (prompt.contains("node:C")) {
                boolean sawRoot = prompt.contains("root-data");
                return LlmResponse.of("{\"count\":" + (sawRoot ? 1 : 0) + "}");
            }
            return LlmResponse.of("{}");
        });

        FlowExecutor executor = new FlowExecutor(new StepExecutor(provider));
        Map<String, Object> result = executor.executeMultiSink(twoSinkFlow(),
            Map.of("B", SummaryResult.class, "C", MetricsResult.class), 1, Map.of()).get();

        assertEquals("has-root", ((SummaryResult) result.get("B")).summary());
        assertEquals(1, ((MetricsResult) result.get("C")).count());
    }

    /**
     * Validation: declaring a non-sink step id in sinkTypes (a step that has dependents)
     * must throw {@link IllegalArgumentException} with a message naming the offending step.
     */
    @Test
    void rejectsNonSinkInSinkTypes() {
        FlowExecutor executor = new FlowExecutor(new StepExecutor(new FakeProvider()));
        // "root" has dependents (B and C depend on it) — it is NOT a sink.
        Map<String, Class<?>> badSinkTypes = Map.of("root", SummaryResult.class);

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
            () -> executor.executeMultiSink(twoSinkFlow(), badSinkTypes, 1, Map.of()));
        assertTrue(ex.getMessage().contains("root"),
            "Error message must name the offending step 'root'. Got: " + ex.getMessage());
    }

    /**
     * Validation: omitting a real sink from sinkTypes (i.e., providing only one of B and C)
     * must throw {@link IllegalStateException} naming the missing sink.
     */
    @Test
    void rejectsMissingSinkInSinkTypes() {
        FlowExecutor executor = new FlowExecutor(new StepExecutor(new FakeProvider()));
        // Only declare type for B; C is left undeclared.
        Map<String, Class<?>> partialSinkTypes = Map.of("B", SummaryResult.class);

        IllegalStateException ex = assertThrows(IllegalStateException.class,
            () -> executor.executeMultiSink(twoSinkFlow(), partialSinkTypes, 1, Map.of()));
        assertTrue(ex.getMessage().contains("C"),
            "Error message must name the missing sink 'C'. Got: " + ex.getMessage());
    }

    /**
     * Validation: passing null or empty sinkTypes must throw {@link IllegalArgumentException}.
     */
    @Test
    void rejectsEmptySinkTypes() {
        FlowExecutor executor = new FlowExecutor(new StepExecutor(new FakeProvider()));
        assertThrows(IllegalArgumentException.class,
            () -> executor.executeMultiSink(twoSinkFlow(), Map.of(), 1, Map.of()));
    }

    /**
     * Fluent API: {@link FlowExecution#executeMultiSinkAsync()} without calling
     * {@link FlowExecution#withSinkOutputs(Map)} first must return a failed future with
     * {@link IllegalStateException}.
     */
    @Test
    void fluentApiFailsFastWithoutSinkOutputs() {
        FlowExecutor executor = new FlowExecutor(new StepExecutor(new FakeProvider()));
        FlowExecution fe = new FlowExecution(executor, "two-sink", twoSinkFlow(), 1);

        ExecutionException ex = assertThrows(ExecutionException.class,
            () -> fe.executeMultiSinkAsync().get());
        assertInstanceOf(IllegalStateException.class, ex.getCause());
        assertTrue(ex.getCause().getMessage().contains("withSinkOutputs"),
            "Error must mention withSinkOutputs. Got: " + ex.getCause().getMessage());
    }

    /**
     * Fluent API happy path: {@link FlowExecution#withSinkOutputs(Map)} +
     * {@link FlowExecution#executeMultiSinkAsync()} delegates correctly to the executor.
     */
    @Test
    void fluentApiMultiSinkDelegatesToExecutor() throws Exception {
        FakeProvider provider = new FakeProvider().responder(request -> {
            String prompt = userPrompt(request);
            if (prompt.contains("node:root")) return LlmResponse.of("root-text");
            if (prompt.contains("node:B"))   return LlmResponse.of("{\"summary\":\"fluent-B\"}");
            if (prompt.contains("node:C"))   return LlmResponse.of("{\"count\":7}");
            return LlmResponse.of("{}");
        });

        FlowExecutor executor = new FlowExecutor(new StepExecutor(provider));
        FlowExecution fe = new FlowExecution(executor, "two-sink", twoSinkFlow(), 1);

        Map<String, Object> result = fe
            .withSinkOutputs(Map.of("B", SummaryResult.class, "C", MetricsResult.class))
            .executeMultiSinkAsync()
            .get();

        assertEquals("fluent-B", ((SummaryResult) result.get("B")).summary());
        assertEquals(7, ((MetricsResult) result.get("C")).count());
    }

    /**
     * Sanity / regression: the original single-sink {@code execute} path must still work
     * correctly on a standard diamond DAG (root → B, root → C → D). D is the sole sink.
     * This verifies no regression was introduced by the shared {@code scheduleNonSinkNodes}
     * refactor.
     */
    @Test
    void singleSinkFlowStillWorksAfterRefactor() throws Exception {
        record DiamondResult(String value) {}

        FakeProvider provider = new FakeProvider().responder(request -> {
            String prompt = userPrompt(request);
            if (prompt.contains("node:A")) return LlmResponse.of("out-A");
            if (prompt.contains("node:B")) return LlmResponse.of("out-B");
            if (prompt.contains("node:C")) return LlmResponse.of("out-C");
            if (prompt.contains("node:D")) {
                boolean sawB = prompt.contains("out-B");
                boolean sawC = prompt.contains("out-C");
                return LlmResponse.of("{\"value\":\"" + (sawB && sawC ? "ok" : "fail") + "\"}");
            }
            return LlmResponse.of("{}");
        });

        FlowExecutor executor = new FlowExecutor(new StepExecutor(provider));
        FlowDefinition diamond = new FlowDefinition("diamond", List.of(
            new StepConfig("A", null, "node:A", Map.of(), List.of()),
            new StepConfig("B", null, "node:B", Map.of(), List.of("A")),
            new StepConfig("C", null, "node:C", Map.of(), List.of("A")),
            new StepConfig("D", null, "node:D", Map.of(), List.of("B", "C"))));

        DiamondResult result = executor.execute(diamond, DiamondResult.class, 1, Map.of()).get();
        assertEquals("ok", result.value());
        assertEquals(4, provider.requests.size());
    }
}
