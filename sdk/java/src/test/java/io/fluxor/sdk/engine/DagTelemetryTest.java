package io.fluxor.sdk.engine;

import com.fasterxml.jackson.databind.JsonNode;
import io.fluxor.sdk.engine.DagTelemetry.NodeExecutionRecord;
import io.fluxor.sdk.flow.FlowDefinition;
import io.fluxor.sdk.flow.FlowExecution;
import io.fluxor.sdk.flow.StepConfig;
import io.fluxor.sdk.provider.LlmResponse;
import io.fluxor.sdk.testutil.FakeProvider;
import io.fluxor.sdk.internal.Json;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutionException;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Verifies per-node telemetry collection via {@link DagTelemetry}.
 *
 * <p>Flow topology used by most tests:
 * <pre>
 *   root (text node) → terminal (typed sink)
 * </pre>
 * The {@code terminal} node is configured to return an invalid JSON response on its first
 * attempt (missing a required field) so that the retry path is exercised.
 */
class DagTelemetryTest {

    /** Typed output of the terminal node. */
    record AuditResult(String verdict, int riskScore) {
    }

    // =========================================================================
    // Helper — two-node flow: root (text) → terminal (typed)
    // =========================================================================

    private static FlowDefinition twoNodeFlow() {
        return new FlowDefinition("telemetry-test", List.of(
                new StepConfig("root", null, "step:root", Map.of(), List.of()),
                new StepConfig("terminal", null, "step:terminal", Map.of(), List.of("root"))));
    }

    // =========================================================================
    // Test 1 — records present per node; retrying node has attempts > 1
    // =========================================================================

    /**
     * The terminal node first returns a schema-invalid response (missing {@code riskScore}),
     * then a valid one. Asserts:
     * <ul>
     *   <li>Both nodes have a telemetry record.</li>
     *   <li>The root node has {@code attempts == 1} and {@code retries == 0}.</li>
     *   <li>The terminal node has {@code attempts == 2} and {@code retries == 1}.</li>
     *   <li>Both nodes have {@code inferenceMs >= 0} and {@code schemaValidationMs >= 0}.</li>
     *   <li>Both records report {@code status == "ok"}.</li>
     * </ul>
     */
    @Test
    void capturesRetriesAndTimingsForRetryingNode() throws Exception {
        // Responses arrive in DAG execution order:
        //   1. root text node
        //   2. terminal first attempt — missing riskScore → invalid → triggers retry
        //   3. terminal second attempt (after corrective system message) — valid
        FakeProvider provider = new FakeProvider()
                .respondWith("root-output")                       // root text node
                .respondWith("{\"verdict\":\"safe\"}")            // terminal attempt 1: invalid (missing riskScore)
                .respondWith("{\"verdict\":\"safe\",\"riskScore\":42}"); // terminal attempt 2: valid

        DagTelemetry telemetry = new DagTelemetry();
        FlowExecutor executor = new FlowExecutor(new StepExecutor(provider));

        AuditResult result = executor.execute(twoNodeFlow(), AuditResult.class, 3, Map.of(), telemetry).get();

        assertEquals("safe", result.verdict());
        assertEquals(42, result.riskScore());

        List<NodeExecutionRecord> records = telemetry.records();
        assertEquals(2, records.size(), "Expected one record per node");

        NodeExecutionRecord rootRecord = records.stream()
                .filter(r -> r.stepId().equals("root"))
                .findFirst()
                .orElseThrow(() -> new AssertionError("No record for 'root'"));

        NodeExecutionRecord terminalRecord = records.stream()
                .filter(r -> r.stepId().equals("terminal"))
                .findFirst()
                .orElseThrow(() -> new AssertionError("No record for 'terminal'"));

        // Root is a text node — always 1 attempt, no schema validation.
        assertEquals(1, rootRecord.attempts(), "root: expected 1 attempt");
        assertEquals(0, rootRecord.retries(), "root: expected 0 retries");
        assertEquals("ok", rootRecord.status());
        assertTrue(rootRecord.inferenceMs() >= 0, "inferenceMs must be non-negative");
        assertEquals(0L, rootRecord.schemaValidationMs(), "text nodes have no schema validation");

        // Terminal retried once.
        assertEquals(2, terminalRecord.attempts(), "terminal: expected 2 attempts");
        assertEquals(1, terminalRecord.retries(), "terminal: expected 1 retry");
        assertEquals("ok", terminalRecord.status());
        assertTrue(terminalRecord.inferenceMs() >= 0, "inferenceMs must be non-negative");
        assertTrue(terminalRecord.schemaValidationMs() >= 0, "schemaValidationMs must be non-negative");
    }

    // =========================================================================
    // Test 2 — failing node (exhausts retries) → status == "failed"
    // =========================================================================

    /**
     * The terminal node always returns an invalid response. After exhausting the retry budget
     * the flow fails. The telemetry record for the terminal node must have {@code status == "failed"}.
     */
    @Test
    void failingNodeRecordHasStatusFailed() {
        // Always returns a response missing riskScore.
        FakeProvider provider = new FakeProvider()
                .respondWith("root-output")             // root text node
                .respondWith("{\"verdict\":\"safe\"}")  // attempt 1 — invalid
                .respondWith("{\"verdict\":\"safe\"}")  // attempt 2 — still invalid
                .respondWith("{\"verdict\":\"safe\"}"); // attempt 3 — still invalid

        DagTelemetry telemetry = new DagTelemetry();
        FlowExecutor executor = new FlowExecutor(new StepExecutor(provider));

        ExecutionException ex = assertThrows(ExecutionException.class,
                () -> executor.execute(twoNodeFlow(), AuditResult.class, 1, Map.of(), telemetry).get());

        assertNotNull(ex.getCause(), "Cause must be present");

        // Telemetry records must have been written even on failure.
        List<NodeExecutionRecord> records = telemetry.records();

        // Root (text node) succeeds.
        NodeExecutionRecord rootRecord = records.stream()
                .filter(r -> r.stepId().equals("root"))
                .findFirst()
                .orElseThrow(() -> new AssertionError("No record for 'root'"));
        assertEquals("ok", rootRecord.status());

        // Terminal node exhausted retries → failed.
        NodeExecutionRecord terminalRecord = records.stream()
                .filter(r -> r.stepId().equals("terminal"))
                .findFirst()
                .orElseThrow(() -> new AssertionError("No record for 'terminal'"));
        assertEquals("failed", terminalRecord.status());
        // With maxRetries=1 we get 2 attempts (initial + 1 retry).
        assertEquals(2, terminalRecord.attempts());
        assertEquals(1, terminalRecord.retries());
    }

    // =========================================================================
    // Test 3 — toJson() produces parseable JSON with node entries
    // =========================================================================

    /**
     * After a successful run, {@link DagTelemetry#toJson()} must return valid JSON containing
     * an array of node records with the expected structure.
     */
    @Test
    void toJsonProducesParseableJsonWithNodeEntries() throws Exception {
        FakeProvider provider = new FakeProvider()
                .respondWith("root-text")
                .respondWith("{\"verdict\":\"safe\",\"riskScore\":7}");

        DagTelemetry telemetry = new DagTelemetry();
        FlowExecutor executor = new FlowExecutor(new StepExecutor(provider));
        executor.execute(twoNodeFlow(), AuditResult.class, 1, Map.of(), telemetry).get();

        String json = telemetry.toJson();
        assertNotNull(json, "toJson() must return a non-null string");

        JsonNode root = Json.MAPPER.readTree(json);
        assertTrue(root.has("nodes"), "JSON must have 'nodes' key");
        assertTrue(root.has("totalNodes"), "JSON must have 'totalNodes' key");
        assertEquals(2, root.get("totalNodes").asInt(), "totalNodes must equal number of nodes");

        JsonNode nodes = root.get("nodes");
        assertTrue(nodes.isArray(), "'nodes' must be an array");
        assertEquals(2, nodes.size(), "'nodes' must contain 2 entries");

        // Verify every node entry has the required fields.
        for (JsonNode node : nodes) {
            assertTrue(node.has("stepId"), "node must have 'stepId'");
            assertTrue(node.has("inferenceMs"), "node must have 'inferenceMs'");
            assertTrue(node.has("schemaValidationMs"), "node must have 'schemaValidationMs'");
            assertTrue(node.has("attempts"), "node must have 'attempts'");
            assertTrue(node.has("retries"), "node must have 'retries'");
            assertTrue(node.has("status"), "node must have 'status'");
            assertTrue(node.has("tokens"), "node must have 'tokens' (nullable)");
        }

        // Both step ids are present.
        boolean hasRoot = false;
        boolean hasTerminal = false;
        for (JsonNode node : nodes) {
            String stepId = node.get("stepId").asText();
            if ("root".equals(stepId)) hasRoot = true;
            if ("terminal".equals(stepId)) hasTerminal = true;
        }
        assertTrue(hasRoot, "JSON must include 'root' node");
        assertTrue(hasTerminal, "JSON must include 'terminal' node");
    }

    // =========================================================================
    // Test 4 — NOOP: existing FlowExecutorTest-style invocations still pass
    // =========================================================================

    /**
     * Verifies that existing callers that do NOT pass a {@link DagTelemetry} (i.e., use the
     * 4-arg overloads delegating to {@link DagTelemetry#NOOP}) still produce correct results
     * without any telemetry side-effects.
     */
    @Test
    void noopDefaultDoesNotAffectExistingBehavior() throws Exception {
        FakeProvider provider = new FakeProvider()
                .respondWith("root-text")
                .respondWith("{\"verdict\":\"ok\",\"riskScore\":0}");

        FlowExecutor executor = new FlowExecutor(new StepExecutor(provider));
        // Use the 4-arg overload (no telemetry) — must still work correctly.
        AuditResult result = executor.execute(twoNodeFlow(), AuditResult.class, 1, Map.of()).get();

        assertEquals("ok", result.verdict());
        assertEquals(0, result.riskScore());
        assertEquals(2, provider.requests.size());
    }

    // =========================================================================
    // Test 5 — multi-sink flow telemetry
    // =========================================================================

    /** Typed output for sink B. */
    record SummaryResult(String summary) {
    }

    /** Typed output for sink C. */
    record MetricsResult(int count) {
    }

    /**
     * Multi-sink flow topology: root → B (sink), root → C (sink).
     * Each sink node gets one telemetry record; the root text node also gets one.
     */
    @Test
    void multiSinkFlowRecordsAllThreeNodes() throws Exception {
        FakeProvider provider = new FakeProvider().responder(request -> {
            String userContent = request.messages().stream()
                    .filter(m -> m.role().name().equals("USER"))
                    .map(m -> m.content())
                    .findFirst().orElse("");
            if (userContent.contains("node:root")) return LlmResponse.of("root-data");
            if (userContent.contains("node:B"))    return LlmResponse.of("{\"summary\":\"b-result\"}");
            if (userContent.contains("node:C"))    return LlmResponse.of("{\"count\":3}");
            return LlmResponse.of("{}");
        });

        FlowDefinition flow = new FlowDefinition("multi-sink", List.of(
                new StepConfig("root", null, "node:root", Map.of(), List.of()),
                new StepConfig("B", null, "node:B", Map.of(), List.of("root")),
                new StepConfig("C", null, "node:C", Map.of(), List.of("root"))));

        DagTelemetry telemetry = new DagTelemetry();
        FlowExecutor executor = new FlowExecutor(new StepExecutor(provider));
        executor.executeMultiSink(flow,
                Map.of("B", SummaryResult.class, "C", MetricsResult.class),
                1, Map.of(), telemetry).get();

        List<NodeExecutionRecord> records = telemetry.records();
        assertEquals(3, records.size(), "Expected one record per node (root + B + C)");

        records.forEach(r -> {
            assertEquals("ok", r.status(), "All nodes should have status 'ok'");
            assertTrue(r.inferenceMs() >= 0, "inferenceMs must be non-negative for " + r.stepId());
            assertTrue(r.schemaValidationMs() >= 0,
                    "schemaValidationMs must be non-negative for " + r.stepId());
        });
    }

    // =========================================================================
    // Test 6 — fluent API withTelemetry wires correctly
    // =========================================================================

    /**
     * Verifies that {@link FlowExecution#withTelemetry(DagTelemetry)} is wired correctly
     * through the fluent API and that records are populated after {@link FlowExecution#executeAsync()}.
     */
    @Test
    void fluentApiWithTelemetryPopulatesRecords() throws Exception {
        FakeProvider provider = new FakeProvider()
                .respondWith("root-text")
                .respondWith("{\"verdict\":\"pass\",\"riskScore\":1}");

        FlowExecutor executor = new FlowExecutor(new StepExecutor(provider));
        DagTelemetry telemetry = new DagTelemetry();

        FlowExecution fe = new FlowExecution(executor, "telemetry-test", twoNodeFlow(), 1);
        @SuppressWarnings("unchecked")
        AuditResult result = fe
                .withExpectedOutput(AuditResult.class)
                .withTelemetry(telemetry)
                .<AuditResult>executeAsync()
                .get();

        assertEquals("pass", result.verdict());
        assertEquals(2, telemetry.records().size(), "Expected 2 records via fluent API");
        telemetry.records().forEach(r ->
                assertEquals("ok", r.status(), "All nodes ok via fluent API"));
    }
}
