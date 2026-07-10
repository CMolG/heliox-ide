package io.fluxor.sdk.engine;

import io.fluxor.sdk.flow.FlowDefinition;
import io.fluxor.sdk.flow.LoopConfig;
import io.fluxor.sdk.flow.StepConfig;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
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
    // executeAllText — all steps propagate raw provider text (canonical default)
    // =========================================================================

    /**
     * Executes a flow where ALL steps — including the terminal sink — propagate raw provider
     * text. No JSON-schema extraction is performed. This is the canonical default behaviour
     * when no step declares an output schema.
     *
     * <p><b>Canonical typed-output rule:</b> JSON-schema extraction is an explicit opt-in
     * (via {@link #execute(FlowDefinition, Class, int, Map)} or
     * {@link #executeMultiSink(FlowDefinition, Map, int, Map)}). A flow whose steps carry no
     * declared output schema must produce byte-identical text in both the TypeScript and Java
     * runtimes — this method is the Java-side proof of that guarantee.
     *
     * @param flow        the flow definition to execute
     * @param maxRetries  retry budget forwarded to {@link StepExecutor#executeStepText}
     *                    (text steps do not validate; the budget is carried for API consistency)
     * @param seedContext optional key/value pairs injected into every step's context
     * @return a future that resolves to a {@link LinkedHashMap} of stepId → raw text, in
     *         topological (DAG) execution order
     */
    public CompletableFuture<Map<String, String>> executeAllText(FlowDefinition flow,
                                                                  int maxRetries,
                                                                  Map<String, Object> seedContext) {
        return executeAllText(flow, maxRetries, seedContext, DagTelemetry.NOOP);
    }

    /**
     * Executes a flow where ALL steps propagate raw provider text, forwarding per-node metrics
     * to {@code telemetry}.
     *
     * @param flow        the flow definition to execute
     * @param maxRetries  retry budget (text steps do not validate; carried for API consistency)
     * @param seedContext optional key/value pairs injected into every step's context
     * @param telemetry   collector for per-node execution metrics
     * @return a future that resolves to a {@link LinkedHashMap} of stepId → raw text
     */
    public CompletableFuture<Map<String, String>> executeAllText(FlowDefinition flow,
                                                                  int maxRetries,
                                                                  Map<String, Object> seedContext,
                                                                  DagTelemetry telemetry) {
        Map<String, StepConfig> byId = index(flow);
        validateDependencies(byId);
        List<StepConfig> order = topologicalOrder(byId);

        Map<String, Object> seed = seedContext == null ? Map.of() : seedContext;
        ConcurrentHashMap<String, String> results = new ConcurrentHashMap<>();
        Map<String, CompletableFuture<String>> textFutures = new HashMap<>();

        // Schedule every node — including the sink — as a text future.
        scheduleNonSinkNodes(order, Set.of(), textFutures, results, seed, maxRetries, telemetry);

        // All futures are already wired; combine them in topological order.
        List<CompletableFuture<String>> allFutures = order.stream()
                .map(step -> textFutures.get(step.id()))
                .toList();

        return CompletableFuture.allOf(allFutures.toArray(CompletableFuture[]::new))
                .thenApply(ignored -> {
                    Map<String, String> out = new LinkedHashMap<>();
                    for (StepConfig step : order) {
                        out.put(step.id(), results.get(step.id()));
                    }
                    return out;
                });
    }

    // =========================================================================
    // executeAllTextTrace — bounded loop-back edge expansion (Phase 4a)
    // =========================================================================

    /**
     * Executes a flow exactly like {@link #executeAllText}, but first expands any
     * {@code flow.loops()} bounded loop-back edges into a per-iteration instance graph (see
     * {@code src/main/harness-engine/loop-plan.ts} — the normative, cross-runtime algorithm
     * this method mirrors) before scheduling. A loop-free flow expands to exactly one instance
     * per step, so its trace is identical in content and order to {@link #executeAllText}'s
     * single-pass result.
     *
     * <p><b>Concurrency vs. determinism.</b> Instance futures are wired with the same
     * {@code CompletableFuture} dependency-gating style as {@link #executeAllText} — independent
     * branches genuinely run concurrently on the async pool. The returned trace, however, is
     * assembled AFTER {@code CompletableFuture.allOf} completes, by walking a canonical
     * {@code (stepId, iteration)}-tie-broken topological order computed once, statically, from
     * the instance graph (see {@link #instanceExecutionOrder}) — so pool scheduling jitter can
     * never perturb trace order.
     *
     * <p>Telemetry is discarded (delegates to {@link DagTelemetry#NOOP}).
     */
    public CompletableFuture<List<TraceEntry>> executeAllTextTrace(FlowDefinition flow,
                                                                    int maxRetries,
                                                                    Map<String, Object> seedContext) {
        return executeAllTextTrace(flow, maxRetries, seedContext, DagTelemetry.NOOP);
    }

    /**
     * {@link #executeAllTextTrace(FlowDefinition, int, Map)}, forwarding per-instance metrics to
     * {@code telemetry} (recorded under the instance's real step id — a step with N loop passes
     * reports N {@link DagTelemetry.NodeExecutionRecord}s, one per pass).
     *
     * @param flow        the flow definition to execute (loops expanded per {@code flow.loops()})
     * @param maxRetries  retry budget forwarded to {@link StepExecutor#executeStepText}
     * @param seedContext optional key/value pairs injected into every step instance's context
     * @param telemetry   collector for per-instance execution metrics
     * @return a future that resolves to the ordered {@link TraceEntry} list — one entry per
     *         step instance, in canonical execution order
     * @throws IllegalArgumentException if {@code flow.loops()} is structurally invalid
     *         (missing/self-referential source or target, a source that does not
     *         forward-reach its target, or overlapping loop bodies) — thrown synchronously,
     *         before any future is returned, mirroring {@link #execute}'s validation style
     */
    public CompletableFuture<List<TraceEntry>> executeAllTextTrace(FlowDefinition flow,
                                                                    int maxRetries,
                                                                    Map<String, Object> seedContext,
                                                                    DagTelemetry telemetry) {
        Map<String, StepConfig> byId = index(flow);
        validateDependencies(byId);

        ExecutionPlan plan = expandInstances(byId, flow.loops());
        List<InstanceKey> canonicalOrder = instanceExecutionOrder(plan);

        Map<String, Object> seed = seedContext == null ? Map.of() : seedContext;
        ConcurrentHashMap<String, String> resultsByStep = new ConcurrentHashMap<>();
        ConcurrentHashMap<InstanceKey, String> resultsByInstance = new ConcurrentHashMap<>();
        Map<InstanceKey, CompletableFuture<String>> instanceFutures = new HashMap<>();

        // Wire every instance's future in canonical order — a valid topological order of the
        // instance graph, so every parent future already exists when a child instance is wired.
        for (InstanceKey key : canonicalOrder) {
            StepConfig node = byId.get(key.stepId());
            List<CompletableFuture<String>> parents = plan.parentKeys()
                .getOrDefault(key, List.of())
                .stream()
                .map(instanceFutures::get)
                .toList();

            CompletableFuture<String> future = gate(parents).thenCompose(ignored -> {
                StepConfig effective = withParentResults(node, seed, resultsByStep);
                return stepExecutor.executeStepText(effective, maxRetries, telemetry)
                    .thenApply(text -> {
                        resultsByStep.put(node.id(), text); // real-stepId key; final pass wins downstream
                        resultsByInstance.put(key, text);    // instance key is always unique — no races
                        return text;
                    });
            });
            instanceFutures.put(key, future);
        }

        List<CompletableFuture<String>> allFutures = canonicalOrder.stream()
            .map(instanceFutures::get)
            .toList();

        return CompletableFuture.allOf(allFutures.toArray(CompletableFuture[]::new))
            .thenApply(ignored -> {
                List<TraceEntry> trace = new ArrayList<>(canonicalOrder.size());
                for (InstanceKey key : canonicalOrder) {
                    trace.add(new TraceEntry(key.stepId(), key.iteration(), resultsByInstance.get(key)));
                }
                return trace;
            });
    }

    /** One scheduled pass of a step in an {@link #executeAllTextTrace} result. */
    public record TraceEntry(String stepId, int iteration, String output) {
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
        // contract/model are carry-opaque — preserve them on the effective copy too, so a
        // caller reading them off the step actually being executed still sees the declared
        // value (the pre-existing 5-arg constructor silently defaulted both to null here).
        return new StepConfig(node.id(), node.systemPrompt(), node.promptTemplate(), context,
            node.dependencies(), node.contract(), node.model());
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

    // =========================================================================
    // Loop-back edge expansion — faithful port of loop-plan.ts (Phase 4a)
    //
    // Normative algorithm (kept in sync with src/main/harness-engine/loop-plan.ts):
    //   1. Validate every loop and compute its body (forward-descendants of target ∩
    //      forward-ancestors of source, inclusive); bodies must be pairwise disjoint —
    //      nested/overlapping loops are unsupported.
    //   2. Every step in a loop body gets maxIterations passes; every other step gets
    //      exactly 1.
    //   3. Instance edges: a same-body forward edge fans out per-iteration; any other
    //      edge (plain, loop-entry, loop-exit, or cross-loop) connects the tail's LAST
    //      pass to the head's FIRST pass.
    //   4. Chain edges: a loop's source@k connects to its target@(k+1), i.e. completing
    //      a pass re-triggers the body.
    //   5. Kahn-schedule the resulting instance graph, tie-broken ascending by
    //      (stepId, iteration).
    // =========================================================================

    /** One scheduled pass of a step — the unique node id in the expanded instance graph. */
    private record InstanceKey(String stepId, int iteration) implements Comparable<InstanceKey> {
        @Override
        public int compareTo(InstanceKey other) {
            int cmp = stepId.compareTo(other.stepId);
            return cmp != 0 ? cmp : Integer.compare(iteration, other.iteration);
        }

        @Override
        public String toString() {
            return stepId + "@" + iteration;
        }
    }

    /** A defensively re-validated loop with its computed body (see {@link #validateLoops}). */
    private record ValidatedLoop(String id, String sourceStepId, String targetStepId,
                                  int maxIterations, Set<String> body) {
    }

    /** The expanded, Kahn-scheduler-ready instance graph for one {@link FlowDefinition}. */
    private record ExecutionPlan(List<InstanceKey> allInstances,
                                  Map<InstanceKey, Integer> remainingDeps,
                                  Map<InstanceKey, List<InstanceKey>> nextKeys,
                                  Map<InstanceKey, List<InstanceKey>> parentKeys,
                                  List<InstanceKey> readyKeys) {
    }

    /**
     * Defensively re-validates {@code loops} against {@code byId} (the compiler/{@link
     * io.fluxor.sdk.flow.FlowImport} already validates well-formed loops, but a hand-built
     * {@link FlowDefinition} may not have gone through it) and recomputes each loop's body.
     * Bodies are required to be pairwise disjoint — nested/overlapping loops are not supported.
     *
     * @throws IllegalArgumentException on a missing/self-referential source or target, a source
     *         that is not a forward-descendant of its target, or overlapping loop bodies
     *         (message names both offending loop ids)
     */
    private static List<ValidatedLoop> validateLoops(Map<String, StepConfig> byId, List<LoopConfig> loops) {
        if (loops == null || loops.isEmpty()) {
            return List.of();
        }

        Map<String, List<String>> nextByStepId = new HashMap<>();
        Map<String, List<String>> prevByStepId = new HashMap<>();
        for (String id : byId.keySet()) {
            nextByStepId.put(id, new ArrayList<>());
        }
        for (StepConfig step : byId.values()) {
            prevByStepId.put(step.id(), step.dependencies());
            for (String dependency : step.dependencies()) {
                nextByStepId.get(dependency).add(step.id());
            }
        }

        List<ValidatedLoop> validated = new ArrayList<>();
        Map<String, Set<String>> bodyByLoopId = new LinkedHashMap<>();

        for (LoopConfig loop : loops) {
            if (!byId.containsKey(loop.sourceStepId())) {
                throw new IllegalArgumentException("loop-plan: loop \"" + loop.id()
                    + "\" source step \"" + loop.sourceStepId() + "\" does not exist in flow.");
            }
            if (!byId.containsKey(loop.targetStepId())) {
                throw new IllegalArgumentException("loop-plan: loop \"" + loop.id()
                    + "\" target step \"" + loop.targetStepId() + "\" does not exist in flow.");
            }
            if (loop.sourceStepId().equals(loop.targetStepId())) {
                throw new IllegalArgumentException("loop-plan: loop \"" + loop.id()
                    + "\" source and target are the same step \"" + loop.sourceStepId() + "\".");
            }

            Set<String> reachFromTarget = reachableSet(loop.targetStepId(), nextByStepId);
            if (!reachFromTarget.contains(loop.sourceStepId())) {
                throw new IllegalArgumentException("loop-plan: loop \"" + loop.id()
                    + "\" source is not a forward-descendant of target");
            }

            Set<String> coReachToSource = reachableSet(loop.sourceStepId(), prevByStepId);
            Set<String> body = new HashSet<>(reachFromTarget);
            body.retainAll(coReachToSource);

            for (Map.Entry<String, Set<String>> entry : bodyByLoopId.entrySet()) {
                List<String> shared = new ArrayList<>(body);
                shared.retainAll(entry.getValue());
                if (!shared.isEmpty()) {
                    Collections.sort(shared);
                    throw new IllegalArgumentException(
                        "loop-plan: nested or overlapping loops are not supported: steps "
                            + String.join(", ", shared) + " belong to both loop \"" + entry.getKey()
                            + "\" and loop \"" + loop.id() + "\".");
                }
            }
            bodyByLoopId.put(loop.id(), body);

            validated.add(new ValidatedLoop(loop.id(), loop.sourceStepId(), loop.targetStepId(),
                clampLoopIterations(loop.maxIterations()), body));
        }

        return validated;
    }

    /** BFS over {@code adjacency}, inclusive of {@code start}. */
    private static Set<String> reachableSet(String start, Map<String, List<String>> adjacency) {
        Set<String> visited = new HashSet<>();
        visited.add(start);
        Deque<String> queue = new ArrayDeque<>();
        queue.add(start);
        while (!queue.isEmpty()) {
            String current = queue.poll();
            for (String next : adjacency.getOrDefault(current, List.of())) {
                if (visited.add(next)) {
                    queue.add(next);
                }
            }
        }
        return visited;
    }

    /**
     * Defensive re-clamp into [1, 50] — mirrors the TypeScript {@code clampLoopIterations}.
     * {@link io.fluxor.sdk.flow.FlowImport} already clamps at parse time; this protects
     * hand-built {@link FlowDefinition}s that bypass it.
     */
    private static int clampLoopIterations(int value) {
        return Math.min(50, Math.max(1, value));
    }

    /**
     * Expands {@code byId} (the forward graph) + {@code loops} into a per-iteration
     * {@link ExecutionPlan}. A loop-free flow yields exactly one instance per step, with
     * {@code remainingDeps} equal to {@code dependencies().size()} — structural parity with
     * the pre-loop scheduler.
     */
    private static ExecutionPlan expandInstances(Map<String, StepConfig> byId, List<LoopConfig> loops) {
        List<ValidatedLoop> validatedLoops = validateLoops(byId, loops);

        Map<String, ValidatedLoop> loopByStepId = new HashMap<>();
        for (ValidatedLoop loop : validatedLoops) {
            for (String stepId : loop.body()) {
                loopByStepId.put(stepId, loop);
            }
        }

        Map<String, Integer> countByStepId = new LinkedHashMap<>();
        for (String stepId : byId.keySet()) {
            ValidatedLoop loop = loopByStepId.get(stepId);
            countByStepId.put(stepId, loop != null ? loop.maxIterations() : 1);
        }

        List<InstanceKey> allInstances = new ArrayList<>();
        for (String stepId : byId.keySet()) {
            int total = countByStepId.get(stepId);
            for (int k = 1; k <= total; k++) {
                allInstances.add(new InstanceKey(stepId, k));
            }
        }

        Map<InstanceKey, List<InstanceKey>> nextKeys = new HashMap<>();
        Map<InstanceKey, Integer> remainingDeps = new HashMap<>();
        for (InstanceKey key : allInstances) {
            nextKeys.put(key, new ArrayList<>());
            remainingDeps.put(key, 0);
        }

        // Children (forward pointer) map, derived from dependencies (dependsOn).
        Map<String, List<String>> childrenByStep = new LinkedHashMap<>();
        for (String stepId : byId.keySet()) {
            childrenByStep.put(stepId, new ArrayList<>());
        }
        for (StepConfig step : byId.values()) {
            for (String dependency : step.dependencies()) {
                childrenByStep.get(dependency).add(step.id());
            }
        }

        // Instance edges, derived from the forward graph.
        for (String aId : byId.keySet()) {
            ValidatedLoop aLoop = loopByStepId.get(aId);
            int aCount = countByStepId.get(aId);

            for (String bId : childrenByStep.get(aId)) {
                ValidatedLoop bLoop = loopByStepId.get(bId);
                boolean sameBody = aLoop != null && bLoop != null && aLoop.id().equals(bLoop.id());

                if (sameBody) {
                    for (int k = 1; k <= aCount; k++) {
                        addInstanceEdge(nextKeys, remainingDeps, new InstanceKey(aId, k), new InstanceKey(bId, k));
                    }
                } else {
                    int tailK = aLoop != null ? aCount : 1;
                    addInstanceEdge(nextKeys, remainingDeps, new InstanceKey(aId, tailK), new InstanceKey(bId, 1));
                }
            }
        }

        // Chain edges: completing pass k of the loop body re-triggers pass k+1.
        for (ValidatedLoop loop : validatedLoops) {
            for (int k = 1; k < loop.maxIterations(); k++) {
                addInstanceEdge(nextKeys, remainingDeps,
                    new InstanceKey(loop.sourceStepId(), k), new InstanceKey(loop.targetStepId(), k + 1));
            }
        }

        // Parent (reverse) map — lets executeAllTextTrace gate an instance's future on its
        // predecessor instance futures without re-deriving edges.
        Map<InstanceKey, List<InstanceKey>> parentKeys = new HashMap<>();
        for (InstanceKey key : allInstances) {
            parentKeys.put(key, new ArrayList<>());
        }
        for (Map.Entry<InstanceKey, List<InstanceKey>> entry : nextKeys.entrySet()) {
            for (InstanceKey child : entry.getValue()) {
                parentKeys.get(child).add(entry.getKey());
            }
        }

        List<InstanceKey> readyKeys = new ArrayList<>();
        for (InstanceKey key : allInstances) {
            if (remainingDeps.getOrDefault(key, 0) == 0) {
                readyKeys.add(key);
            }
        }
        Collections.sort(readyKeys);

        return new ExecutionPlan(allInstances, remainingDeps, nextKeys, parentKeys, readyKeys);
    }

    private static void addInstanceEdge(Map<InstanceKey, List<InstanceKey>> nextKeys,
                                        Map<InstanceKey, Integer> remainingDeps,
                                        InstanceKey from, InstanceKey to) {
        nextKeys.get(from).add(to);
        remainingDeps.merge(to, 1, Integer::sum);
    }

    /**
     * Pure (non-executing) Kahn traversal of {@code plan}'s instance graph, producing the
     * canonical {@code (stepId, iteration)}-tie-broken execution order. Computed statically from
     * the graph structure alone, so it never depends on real {@code CompletableFuture}
     * completion timing — see {@link #executeAllTextTrace}'s class-level note on determinism.
     */
    private static List<InstanceKey> instanceExecutionOrder(ExecutionPlan plan) {
        Map<InstanceKey, Integer> remaining = new HashMap<>(plan.remainingDeps());
        Deque<InstanceKey> ready = new ArrayDeque<>(plan.readyKeys());
        List<InstanceKey> order = new ArrayList<>();

        while (!ready.isEmpty()) {
            InstanceKey key = ready.poll();
            order.add(key);

            List<InstanceKey> newlyFree = new ArrayList<>();
            for (InstanceKey child : plan.nextKeys().getOrDefault(key, List.of())) {
                int remainingCount = remaining.merge(child, -1, Integer::sum);
                if (remainingCount == 0) {
                    newlyFree.add(child);
                }
            }
            Collections.sort(newlyFree);
            ready.addAll(newlyFree);
        }

        if (order.size() != plan.allInstances().size()) {
            throw new IllegalStateException(
                "Flow's loop-expanded instance graph has a dependency cycle — this indicates an internal error.");
        }
        return order;
    }
}
