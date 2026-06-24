package io.heliox.sdk.engine;

import io.heliox.sdk.flow.FlowDefinition;
import io.heliox.sdk.flow.StepConfig;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Orchestrates a {@link FlowDefinition} as a DAG.
 *
 * <p><b>Scheduling vs. execution.</b> The future graph is wired on a single thread in
 * topological order, so a child's parent futures already exist when it is wired. The node
 * <em>bodies</em> then run concurrently on the async pool: a dependency-free node starts
 * immediately, a dependent node is {@code allOf(parents).thenCompose(...)}.
 *
 * <p><b>Shared context safety.</b> Node outputs land in a {@link ConcurrentHashMap} keyed by
 * step id; each node writes only its own key (no read-modify-write races). A child reads its
 * parents' entries inside {@code thenCompose}, which runs strictly after {@code allOf(parents)}
 * completes — the {@code CompletableFuture} completion plus the concurrent map both establish the
 * needed happens-before, so no locks are required.
 *
 * <h3>Telemetry</h3>
 * The {@link #execute(FlowDefinition, Class, int, Map, DagTelemetry)} and
 * {@link #executeMultiSink(FlowDefinition, Map, int, Map, DagTelemetry)} overloads accept a
 * {@link DagTelemetry} collector and forward it to every {@link StepExecutor} call. The
 * 4-argument (no-telemetry) overloads preserve the existing public API by delegating to
 * {@link DagTelemetry#NOOP}. {@code FlowExecutor} itself computes no metrics; all timing is
 * captured inside {@link StepExecutor}.
 */
public final class FlowExecutor {

    private final StepExecutor stepExecutor;

    public FlowExecutor(StepExecutor stepExecutor) {
        this.stepExecutor = stepExecutor;
    }

    // =========================================================================
    // execute — single-sink, typed output
    // =========================================================================

    /**
     * Executes a flow with a single sink, returning a typed result.
     * Telemetry is discarded (delegates to {@link DagTelemetry#NOOP}).
     */
    public <T> CompletableFuture<T> execute(FlowDefinition flow, Class<T> expectedType, int maxRetries,
                                            Map<String, Object> seedContext) {
        return execute(flow, expectedType, maxRetries, seedContext, DagTelemetry.NOOP);
    }

    /**
     * Executes a flow with a single sink, returning a typed result and forwarding per-node
     * metrics to {@code telemetry}.
     *
     * @param flow         the flow definition to execute
     * @param expectedType the Java type of the terminal node's output
     * @param maxRetries   schema-validation retry budget per step
     * @param seedContext  optional key/value pairs injected into every step's context
     * @param telemetry    collector for per-node execution metrics
     * @param <T>          the output type
     * @return a future that resolves to the terminal node's typed result
     */
    public <T> CompletableFuture<T> execute(FlowDefinition flow, Class<T> expectedType, int maxRetries,
                                            Map<String, Object> seedContext, DagTelemetry telemetry) {
        Map<String, StepConfig> byId = index(flow);
        validateDependencies(byId);
        List<StepConfig> order = topologicalOrder(byId); // throws on cycle
        String terminalId = resolveTerminal(byId);

        Map<String, Object> seed = seedContext == null ? Map.of() : seedContext;
        ConcurrentHashMap<String, String> results = new ConcurrentHashMap<>();
        Map<String, CompletableFuture<String>> textFutures = new HashMap<>();

        // Wire every non-terminal node as a text future (single-threaded, topological order).
        scheduleNonSinkNodes(order, Set.of(terminalId), textFutures, results, seed, maxRetries, telemetry);

        // The terminal node carries the flow's typed, schema-enforced output.
        StepConfig terminal = byId.get(terminalId);
        return gate(parentFutures(terminal, textFutures)).thenCompose(ignored -> {
            StepConfig effective = withParentResults(terminal, seed, results);
            return stepExecutor.executeStep(effective, expectedType, maxRetries, telemetry);
        });
    }

    // =========================================================================
    // executeMultiSink — multiple typed sinks
    // =========================================================================

    /**
     * Executes a flow that has multiple sink nodes, returning one typed result per declared sink.
     *
     * <p>Non-sink nodes are run as text (same as {@link #execute}); each sink node is driven
     * through the typed/schema-enforced path using the type declared in {@code sinkTypes}.
     * Telemetry is discarded (delegates to {@link DagTelemetry#NOOP}).
     *
     * <p><b>Validation:</b>
     * <ul>
     *   <li>{@code sinkTypes} must be non-empty.</li>
     *   <li>Every key in {@code sinkTypes} must correspond to an actual DAG sink (a step that
     *       no other step depends on).</li>
     *   <li>Every resolved DAG sink must appear in {@code sinkTypes} (callers must declare a
     *       type for all sinks; if aggregation is desired add a final step).</li>
     * </ul>
     *
     * <p><b>Double-execution prevention:</b> sink nodes are never added to {@code textFutures},
     * so the shared {@link #scheduleNonSinkNodes} helper skips them; each sink is then wired
     * exactly once via {@link StepExecutor#executeStep}.
     *
     * @param flow        the flow definition to execute
     * @param sinkTypes   map of sink step-id → expected output type
     * @param maxRetries  schema-validation retry budget per step
     * @param seedContext optional key/value pairs injected into every step's context
     * @return a future that resolves to a {@link LinkedHashMap} of sinkId → typed result,
     *         in the same iteration order as {@code sinkTypes}
     */
    public CompletableFuture<Map<String, Object>> executeMultiSink(FlowDefinition flow,
                                                                   Map<String, Class<?>> sinkTypes,
                                                                   int maxRetries,
                                                                   Map<String, Object> seedContext) {
        return executeMultiSink(flow, sinkTypes, maxRetries, seedContext, DagTelemetry.NOOP);
    }

    /**
     * Executes a flow that has multiple sink nodes, returning one typed result per declared sink
     * and forwarding per-node metrics to {@code telemetry}.
     *
     * @param flow        the flow definition to execute
     * @param sinkTypes   map of sink step-id → expected output type
     * @param maxRetries  schema-validation retry budget per step
     * @param seedContext optional key/value pairs injected into every step's context
     * @param telemetry   collector for per-node execution metrics
     * @return a future that resolves to a {@link LinkedHashMap} of sinkId → typed result
     */
    public CompletableFuture<Map<String, Object>> executeMultiSink(FlowDefinition flow,
                                                                   Map<String, Class<?>> sinkTypes,
                                                                   int maxRetries,
                                                                   Map<String, Object> seedContext,
                                                                   DagTelemetry telemetry) {
        Map<String, StepConfig> byId = index(flow);
        validateDependencies(byId);
        List<StepConfig> order = topologicalOrder(byId); // throws on cycle

        // --- validate sinkTypes against the actual resolved sinks ---
        if (sinkTypes == null || sinkTypes.isEmpty()) {
            throw new IllegalArgumentException(
                "sinkTypes must be non-empty; provide at least one sink step id and its expected type.");
        }
        List<String> resolvedSinks = resolveSinks(byId);
        Set<String> resolvedSinkSet = new HashSet<>(resolvedSinks);

        for (String declaredSink : sinkTypes.keySet()) {
            if (!resolvedSinkSet.contains(declaredSink)) {
                throw new IllegalArgumentException(
                    "Step '" + declaredSink + "' is declared in sinkTypes but is not a DAG sink "
                        + "(it has dependents, or does not exist). Actual sinks: " + resolvedSinks);
            }
        }
        for (String actualSink : resolvedSinks) {
            if (!sinkTypes.containsKey(actualSink)) {
                throw new IllegalStateException(
                    "DAG sink '" + actualSink + "' is missing from sinkTypes. "
                        + "Declare an expected type for every sink, or add an aggregation step.");
            }
        }

        Map<String, Object> seed = seedContext == null ? Map.of() : seedContext;
        ConcurrentHashMap<String, String> results = new ConcurrentHashMap<>();
        Map<String, CompletableFuture<String>> textFutures = new HashMap<>();

        // Wire all non-sink nodes as text futures (sinks are excluded to prevent double-execution).
        scheduleNonSinkNodes(order, resolvedSinkSet, textFutures, results, seed, maxRetries, telemetry);

        // Wire each sink as a typed future, gated on its own parents.
        List<String> sinkIds = new ArrayList<>(sinkTypes.keySet());
        @SuppressWarnings("unchecked")
        CompletableFuture<Object>[] sinkFutures = new CompletableFuture[sinkIds.size()];

        for (int i = 0; i < sinkIds.size(); i++) {
            final String sinkId = sinkIds.get(i);
            final StepConfig sinkNode = byId.get(sinkId);
            final Class<?> sinkType = sinkTypes.get(sinkId);
            sinkFutures[i] = gate(parentFutures(sinkNode, textFutures)).thenCompose(ignored -> {
                StepConfig effective = withParentResults(sinkNode, seed, results);
                return stepExecutor.executeStep(effective, sinkType, maxRetries, telemetry)
                    .thenApply(typed -> (Object) typed);
            });
        }

        // Combine all sink futures into a LinkedHashMap, preserving sinkTypes iteration order.
        return CompletableFuture.allOf(sinkFutures).thenApply(ignored -> {
            Map<String, Object> out = new LinkedHashMap<>();
            for (int i = 0; i < sinkIds.size(); i++) {
                out.put(sinkIds.get(i), sinkFutures[i].join());
            }
            return out;
        });
    }

    // =========================================================================
    // Shared scheduling helper
    // =========================================================================

    /**
     * Schedules every node whose id is NOT in {@code sinkIds} as a text future, in the given
     * topological order. Shared by {@link #execute} (one sink) and {@link #executeMultiSink}
     * (multiple sinks) so the per-node wiring logic lives in exactly one place.
     *
     * <p>Sink nodes are skipped here intentionally — they must never be scheduled as text nodes,
     * since the caller will wire them as typed futures. Placing them in {@code textFutures} would
     * cause double-execution.
     */
    private void scheduleNonSinkNodes(List<StepConfig> order,
                                      Set<String> sinkIds,
                                      Map<String, CompletableFuture<String>> textFutures,
                                      ConcurrentHashMap<String, String> results,
                                      Map<String, Object> seed, int maxRetries, DagTelemetry telemetry) {
        for (StepConfig node : order) {
            if (sinkIds.contains(node.id())) {
                continue; // sink — will be wired as a typed future by the caller
            }
            textFutures.put(node.id(),
                    scheduleTextNode(node, textFutures, results, seed, maxRetries, telemetry));
        }
    }

    private CompletableFuture<String> scheduleTextNode(StepConfig node,
                                                       Map<String, CompletableFuture<String>> textFutures,
                                                       ConcurrentHashMap<String, String> results,
                                                       Map<String, Object> seed, int maxRetries,
                                                       DagTelemetry telemetry) {
        return gate(parentFutures(node, textFutures)).thenCompose(ignored -> {
            StepConfig effective = withParentResults(node, seed, results);
            return stepExecutor.executeStepText(effective, maxRetries, telemetry)
                .thenApply(text -> {
                    results.put(node.id(), text); // disjoint key; published before this future completes
                    return text;
                });
        });
    }

    // =========================================================================
    // Graph helpers
    // =========================================================================

    private List<CompletableFuture<String>> parentFutures(StepConfig node,
                                                          Map<String, CompletableFuture<String>> textFutures) {
        List<CompletableFuture<String>> parents = new ArrayList<>();
        for (String dependency : node.dependencies()) {
            CompletableFuture<String> future = textFutures.get(dependency);
            if (future != null) {
                parents.add(future);
            }
        }
        return parents;
    }

    private CompletableFuture<Void> gate(List<CompletableFuture<String>> parents) {
        return parents.isEmpty()
            ? CompletableFuture.completedFuture(null)
            : CompletableFuture.allOf(parents.toArray(CompletableFuture[]::new));
    }

    /** Build the child's context: static context, then seed, then parent outputs (most specific). */
    private StepConfig withParentResults(StepConfig node, Map<String, Object> seed,
                                         ConcurrentHashMap<String, String> results) {
        Map<String, Object> context = new LinkedHashMap<>(node.context());
        context.putAll(seed);
        for (String dependency : node.dependencies()) {
            String result = results.get(dependency);
            if (result != null) {
                context.put(dependency, result);
            }
        }
        return new StepConfig(node.id(), node.systemPrompt(), node.promptTemplate(), context, node.dependencies());
    }

    private Map<String, StepConfig> index(FlowDefinition flow) {
        Map<String, StepConfig> byId = new LinkedHashMap<>();
        for (StepConfig step : flow.steps()) {
            if (byId.put(step.id(), step) != null) {
                throw new IllegalArgumentException("Duplicate step id in flow '" + flow.id() + "': " + step.id());
            }
        }
        if (byId.isEmpty()) {
            throw new IllegalArgumentException("Flow '" + flow.id() + "' has no steps.");
        }
        return byId;
    }

    private void validateDependencies(Map<String, StepConfig> byId) {
        for (StepConfig step : byId.values()) {
            for (String dependency : step.dependencies()) {
                if (!byId.containsKey(dependency)) {
                    throw new IllegalArgumentException(
                        "Step '" + step.id() + "' depends on unknown step '" + dependency + "'.");
                }
            }
        }
    }

    private List<StepConfig> topologicalOrder(Map<String, StepConfig> byId) {
        Map<String, Integer> indegree = new HashMap<>();
        Map<String, List<String>> children = new HashMap<>();
        for (String id : byId.keySet()) {
            indegree.put(id, 0);
            children.put(id, new ArrayList<>());
        }
        for (StepConfig step : byId.values()) {
            for (String dependency : step.dependencies()) {
                indegree.merge(step.id(), 1, Integer::sum);
                children.get(dependency).add(step.id());
            }
        }

        Deque<String> ready = new ArrayDeque<>();
        indegree.forEach((id, degree) -> {
            if (degree == 0) {
                ready.add(id);
            }
        });

        List<StepConfig> order = new ArrayList<>();
        while (!ready.isEmpty()) {
            String id = ready.poll();
            order.add(byId.get(id));
            for (String child : children.get(id)) {
                if (indegree.merge(child, -1, Integer::sum) == 0) {
                    ready.add(child);
                }
            }
        }

        if (order.size() != byId.size()) {
            throw new IllegalStateException("Flow has a dependency cycle.");
        }
        return order;
    }

    /**
     * Returns all step ids that have no dependents (i.e., no other step lists them as a
     * dependency). A well-formed non-empty DAG always has at least one sink.
     *
     * @throws IllegalStateException if the resolved set is somehow empty (defensive; cannot
     *                               occur for a non-empty DAG that passes cycle detection)
     */
    private List<String> resolveSinks(Map<String, StepConfig> byId) {
        Set<String> hasDependents = new HashSet<>();
        for (StepConfig step : byId.values()) {
            hasDependents.addAll(step.dependencies());
        }
        List<String> sinks = byId.keySet().stream().filter(id -> !hasDependents.contains(id)).toList();
        if (sinks.isEmpty()) {
            throw new IllegalStateException("Flow has no sink nodes — this indicates an internal error.");
        }
        return sinks;
    }

    private String resolveTerminal(Map<String, StepConfig> byId) {
        List<String> sinks = resolveSinks(byId);
        if (sinks.size() == 1) {
            return sinks.get(0);
        }
        throw new IllegalStateException(
            "Flow must have exactly one terminal (sink) step; found: " + sinks
                + ". Add a final aggregation step that depends on the others.");
    }
}
