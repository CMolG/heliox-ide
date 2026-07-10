package io.fluxor.sdk.engine;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.fluxor.sdk.internal.Json;

import java.util.List;
import java.util.concurrent.ConcurrentLinkedQueue;

/**
 * Thread-safe collector for per-DAG-node execution telemetry.
 *
 * <p>DAG nodes run concurrently on the async pool. This collector uses a
 * {@link ConcurrentLinkedQueue} so that any node can publish its record at
 * completion without contention. One {@link NodeExecutionRecord} is emitted per
 * node, regardless of how many internal retry attempts occurred.
 *
 * <h3>Null-object pattern</h3>
 * The shared constant {@link #NOOP} is a no-op implementation that discards all
 * records and returns minimal valid JSON. All existing code paths delegate to
 * {@code DagTelemetry.NOOP} by default, so callers that do not opt into
 * telemetry pay zero cost.
 *
 * <h3>JSON format</h3>
 * {@link #toJson()} emits a document shaped like:
 * <pre>{@code
 * {
 *   "nodes": [
 *     {
 *       "stepId": "root",
 *       "inferenceMs": 12,
 *       "schemaValidationMs": 1,
 *       "attempts": 1,
 *       "retries": 0,
 *       "status": "ok",
 *       "tokens": null
 *     }
 *   ],
 *   "totalNodes": 1
 * }
 * }</pre>
 * The {@code tokens} field is omitted (null) when token usage data was not
 * available from the underlying {@link io.fluxor.sdk.provider.LlmProvider}.
 */
public class DagTelemetry {

    /**
     * Shared no-op instance. Safe to use as the default across all execution
     * paths: {@link #record(NodeExecutionRecord)} discards the input, and
     * {@link #toJson()} returns {@code {"nodes":[],"totalNodes":0}}.
     */
    public static final DagTelemetry NOOP = new DagTelemetry() {
        @Override
        public void record(NodeExecutionRecord rec) { /* discard */ }

        @Override
        public List<NodeExecutionRecord> records() { return List.of(); }

        @Override
        public String toJson() { return "{\"nodes\":[],\"totalNodes\":0}"; }
    };

    // -------------------------------------------------------------------------
    // Instance state
    // -------------------------------------------------------------------------

    private final ConcurrentLinkedQueue<NodeExecutionRecord> queue = new ConcurrentLinkedQueue<>();

    // Prevent external subclassing outside this file (NOOP override is package-private enough).
    DagTelemetry() {}

    /**
     * Appends one node record to the collector. Called exactly once per DAG node
     * on both the success and failure paths.
     *
     * @param rec the completed node record; must not be {@code null}
     */
    public void record(NodeExecutionRecord rec) {
        queue.add(rec);
    }

    /**
     * Returns a snapshot of all records collected so far, in arrival order.
     * Safe to call from any thread; the list is a stable copy.
     *
     * @return immutable snapshot of node records
     */
    public List<NodeExecutionRecord> records() {
        return List.copyOf(queue);
    }

    /**
     * Serialises the collected records to structured JSON suitable for the
     * Performance Frontier HTML report.
     *
     * <p>The top-level document contains:
     * <ul>
     *   <li>{@code nodes}      – array of per-node objects</li>
     *   <li>{@code totalNodes} – count of node records</li>
     * </ul>
     *
     * @return a JSON string; never {@code null}
     * @throws RuntimeException if Jackson serialisation fails (should not occur
     *                          for well-formed records)
     */
    public String toJson() {
        List<NodeExecutionRecord> snapshot = records();
        ObjectNode root = Json.MAPPER.createObjectNode();
        ArrayNode nodes = root.putArray("nodes");
        for (NodeExecutionRecord r : snapshot) {
            ObjectNode node = nodes.addObject();
            node.put("stepId", r.stepId());
            node.put("inferenceMs", r.inferenceMs());
            node.put("schemaValidationMs", r.schemaValidationMs());
            node.put("attempts", r.attempts());
            node.put("retries", r.retries());
            node.put("status", r.status());
            if (r.tokens() != null) {
                node.put("tokens", r.tokens());
            } else {
                node.putNull("tokens");
            }
        }
        root.put("totalNodes", snapshot.size());
        try {
            return Json.MAPPER.writeValueAsString(root);
        } catch (Exception e) {
            throw new RuntimeException("DagTelemetry.toJson() serialisation failed", e);
        }
    }

    // =========================================================================
    // NodeExecutionRecord
    // =========================================================================

    /**
     * Immutable record of one DAG node's execution.
     *
     * <ul>
     *   <li>{@code stepId}            – unique node identifier from {@link io.fluxor.sdk.flow.StepConfig#id()}</li>
     *   <li>{@code inferenceMs}       – total wall-clock milliseconds spent inside
     *                                   {@link io.fluxor.sdk.provider.LlmProvider#complete}, summed
     *                                   across the tool loop and all retry attempts for this node</li>
     *   <li>{@code schemaValidationMs}– total wall-clock milliseconds spent inside
     *                                   {@link io.fluxor.sdk.validation.SchemaValidator#validate},
     *                                   summed across all attempts</li>
     *   <li>{@code attempts}          – number of times {@code attempt(...)} was entered (≥ 1)</li>
     *   <li>{@code retries}           – {@code attempts - 1}</li>
     *   <li>{@code status}            – {@code "ok"} on successful completion, {@code "failed"} if
     *                                   the node exhausted its retry budget</li>
     *   <li>{@code tokens}            – combined prompt + completion tokens if available from the
     *                                   provider's last response for this node; {@code null} otherwise</li>
     * </ul>
     */
    public record NodeExecutionRecord(
            String stepId,
            long inferenceMs,
            long schemaValidationMs,
            int attempts,
            int retries,
            String status,
            Integer tokens) {

        /** Convenience factory for a successful node. */
        public static NodeExecutionRecord ok(String stepId,
                                             long inferenceMs,
                                             long schemaValidationMs,
                                             int attempts,
                                             Integer tokens) {
            return new NodeExecutionRecord(stepId, inferenceMs, schemaValidationMs,
                    attempts, attempts - 1, "ok", tokens);
        }

        /** Convenience factory for a failed node. */
        public static NodeExecutionRecord failed(String stepId,
                                                 long inferenceMs,
                                                 long schemaValidationMs,
                                                 int attempts,
                                                 Integer tokens) {
            return new NodeExecutionRecord(stepId, inferenceMs, schemaValidationMs,
                    attempts, attempts - 1, "failed", tokens);
        }
    }
}
