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
 */
public final class FlowExecutor {

    private final StepExecutor stepExecutor;

    public FlowExecutor(StepExecutor stepExecutor) {
        this.stepExecutor = stepExecutor;
    }

    public <T> CompletableFuture<T> execute(FlowDefinition flow, Class<T> expectedType, int maxRetries,
                                            Map<String, Object> seedContext) {
        Map<String, StepConfig> byId = index(flow);
        validateDependencies(byId);
        List<StepConfig> order = topologicalOrder(byId); // throws on cycle
        String terminalId = resolveTerminal(byId);

        Map<String, Object> seed = seedContext == null ? Map.of() : seedContext;
        ConcurrentHashMap<String, String> results = new ConcurrentHashMap<>();
        Map<String, CompletableFuture<String>> textFutures = new HashMap<>();

        // Wire every non-terminal node (single-threaded, topological order).
        for (StepConfig node : order) {
            if (node.id().equals(terminalId)) {
                continue;
            }
            textFutures.put(node.id(), scheduleTextNode(node, textFutures, results, seed, maxRetries));
        }

        // The terminal node carries the flow's typed, schema-enforced output.
        StepConfig terminal = byId.get(terminalId);
        return gate(parentFutures(terminal, textFutures)).thenCompose(ignored -> {
            StepConfig effective = withParentResults(terminal, seed, results);
            return stepExecutor.executeStep(effective, expectedType, maxRetries);
        });
    }

    private CompletableFuture<String> scheduleTextNode(StepConfig node,
                                                       Map<String, CompletableFuture<String>> textFutures,
                                                       ConcurrentHashMap<String, String> results,
                                                       Map<String, Object> seed, int maxRetries) {
        return gate(parentFutures(node, textFutures)).thenCompose(ignored -> {
            StepConfig effective = withParentResults(node, seed, results);
            return stepExecutor.executeStepText(effective, maxRetries)
                .thenApply(text -> {
                    results.put(node.id(), text); // disjoint key; published before this future completes
                    return text;
                });
        });
    }

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

    // --- graph helpers ----------------------------------------------------------------

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

    private String resolveTerminal(Map<String, StepConfig> byId) {
        Set<String> hasDependents = new HashSet<>();
        for (StepConfig step : byId.values()) {
            hasDependents.addAll(step.dependencies());
        }
        List<String> sinks = byId.keySet().stream().filter(id -> !hasDependents.contains(id)).toList();
        if (sinks.size() == 1) {
            return sinks.get(0);
        }
        throw new IllegalStateException(
            "Flow must have exactly one terminal (sink) step; found: " + sinks
                + ". Add a final aggregation step that depends on the others.");
    }
}
