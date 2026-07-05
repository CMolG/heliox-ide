package io.heliox.sdk.engine;

import io.heliox.sdk.flow.FlowDefinition;
import io.heliox.sdk.flow.LoopConfig;
import io.heliox.sdk.flow.StepConfig;
import io.heliox.sdk.provider.ChatMessage;
import io.heliox.sdk.provider.LlmRequest;
import io.heliox.sdk.provider.LlmResponse;
import io.heliox.sdk.testutil.FakeProvider;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Focused unit tests for {@link FlowExecutor}'s bounded loop-back edge expansion (Phase 4a),
 * exercised only through the public {@code executeAllTextTrace} API — the loop-plan internals
 * ({@code expandInstances}, {@code validateLoops}, {@code instanceExecutionOrder}) are private,
 * so these are black-box/behavioral, mirroring the scenarios covered by the normative
 * {@code src/main/harness-engine/loop-plan.test.ts} suite.
 *
 * <p>The cross-runtime golden-fixture proof (a chain-shaped, single-loop flow) lives in
 * {@code CrossRuntimeConformanceTest.loopExecutionMatchesGoldenTrace}; these tests cover
 * structural edge cases that fixture does not reach: loop-free parity, a degenerate
 * single-pass loop, cross-pass context threading, and loop-body-overlap validation.
 */
class FlowExecutorLoopTest {

    private static String userPrompt(LlmRequest request) {
        return request.messages().stream()
            .filter(m -> m.role() == ChatMessage.Role.USER)
            .map(ChatMessage::content)
            .findFirst().orElse("");
    }

    /**
     * A provider that returns {@code "<node prompt>-pass<N>"}, where N is a per-prompt call
     * counter — so distinct passes of the same step produce distinguishable, order-revealing
     * output without needing any real LLM.
     */
    private static FakeProvider countingProvider() {
        Map<String, AtomicInteger> counters = new ConcurrentHashMap<>();
        return new FakeProvider().responder(request -> {
            String prompt = userPrompt(request);
            String stepPrompt = prompt.split("\n\n", 2)[0]; // strip any appended "## Context" block
            int pass = counters.computeIfAbsent(stepPrompt, k -> new AtomicInteger(0)).incrementAndGet();
            return LlmResponse.of(stepPrompt + "-pass" + pass);
        });
    }

    @Test
    void loopFreeFlowYieldsOnePassPerStepInTopologicalOrder() throws Exception {
        FlowDefinition flow = new FlowDefinition("chain", List.of(
            new StepConfig("a", null, "node:a", Map.of(), List.of()),
            new StepConfig("b", null, "node:b", Map.of(), List.of("a")),
            new StepConfig("c", null, "node:c", Map.of(), List.of("b"))));

        FlowExecutor executor = new FlowExecutor(new StepExecutor(countingProvider()));
        List<FlowExecutor.TraceEntry> trace = executor.executeAllTextTrace(flow, 1, Map.of()).get();

        assertEquals(3, trace.size(), "a loop-free flow must yield exactly one instance per step");
        assertEquals(List.of("a", "b", "c"),
            trace.stream().map(FlowExecutor.TraceEntry::stepId).toList());
        assertEquals(List.of(1, 1, 1),
            trace.stream().map(FlowExecutor.TraceEntry::iteration).toList(),
            "every instance must be iteration 1 when the flow declares no loops");
        assertEquals(List.of("node:a-pass1", "node:b-pass1", "node:c-pass1"),
            trace.stream().map(FlowExecutor.TraceEntry::output).toList());
    }

    /**
     * root -&gt; b1 -&gt; b2 -&gt; down, loop-1 (source=b2, target=b1, maxIterations=2). Proves:
     * (a) the loop body interleaves pass-by-pass rather than running all of b1 then all of b2;
     * (b) {@code down} — outside the body — runs exactly once, after the loop's FINAL pass; and
     * (c) {@code down}'s context reflects b2's LAST pass, not an earlier one (the "final pass
     * wins" contract for downstream context threading).
     */
    @Test
    void chainLoopInterleavesPassesAndDownstreamSeesFinalPass() throws Exception {
        FlowDefinition flow = new FlowDefinition("chain-loop",
            List.of(
                new StepConfig("root", null, "node:root", Map.of(), List.of()),
                new StepConfig("b1", null, "node:b1", Map.of(), List.of("root")),
                new StepConfig("b2", null, "node:b2", Map.of(), List.of("b1")),
                new StepConfig("down", null, "node:down", Map.of(), List.of("b2"))),
            List.of(new LoopConfig("loop-1", "b2", "b1", 2)));

        FakeProvider provider = countingProvider();
        FlowExecutor executor = new FlowExecutor(new StepExecutor(provider));
        List<FlowExecutor.TraceEntry> trace = executor.executeAllTextTrace(flow, 1, Map.of()).get();

        assertEquals(6, trace.size());
        assertEquals(
            List.of("root@1", "b1@1", "b2@1", "b1@2", "b2@2", "down@1"),
            trace.stream().map(e -> e.stepId() + "@" + e.iteration()).toList(),
            "loop body must interleave pass-by-pass (b1@1,b2@1,b1@2,b2@2), not step-by-step");

        assertEquals("node:root-pass1", trace.get(0).output());
        assertEquals("node:b1-pass1", trace.get(1).output());
        assertEquals("node:b2-pass1", trace.get(2).output());
        assertEquals("node:b1-pass2", trace.get(3).output());
        assertEquals("node:b2-pass2", trace.get(4).output());
        assertEquals("node:down-pass1", trace.get(5).output());

        // down must have been called exactly once (not once per loop pass).
        long downCalls = provider.requests.stream().filter(r -> userPrompt(r).startsWith("node:down")).count();
        assertEquals(1, downCalls, "a step outside the loop body must run exactly once");

        // down's rendered context must carry b2's LAST pass, not the first.
        String downPrompt = provider.requests.stream()
            .map(FlowExecutorLoopTest::userPrompt)
            .filter(p -> p.startsWith("node:down"))
            .findFirst()
            .orElseThrow();
        assertTrue(downPrompt.contains("node:b2-pass2"), "down must see b2's final pass: " + downPrompt);
        assertTrue(!downPrompt.contains("node:b2-pass1"),
            "down must not see b2's stale first pass — only the final pass survives in context: " + downPrompt);
    }

    /**
     * root -&gt; a -&gt; b -&gt; down, loop-1 (source=b, target=a, maxIterations=1). A
     * single-pass loop must degenerate to exactly one instance per body step (no {@code @2}
     * pass is ever created) and produce no chain edge — mirrors
     * {@code loop-plan.test.ts}'s "degenerate maxIterations" case.
     */
    @Test
    void degenerateMaxIterationsOneYieldsSinglePassPerBodyStep() throws Exception {
        FlowDefinition flow = new FlowDefinition("degenerate-loop",
            List.of(
                new StepConfig("root", null, "node:root", Map.of(), List.of()),
                new StepConfig("a", null, "node:a", Map.of(), List.of("root")),
                new StepConfig("b", null, "node:b", Map.of(), List.of("a")),
                new StepConfig("down", null, "node:down", Map.of(), List.of("b"))),
            List.of(new LoopConfig("loop-1", "b", "a", 1)));

        FlowExecutor executor = new FlowExecutor(new StepExecutor(countingProvider()));
        List<FlowExecutor.TraceEntry> trace = executor.executeAllTextTrace(flow, 1, Map.of()).get();

        assertEquals(4, trace.size(), "maxIterations=1 must not create any '@2' instance");
        assertEquals(Set.of("root@1", "a@1", "b@1", "down@1"),
            trace.stream().map(e -> e.stepId() + "@" + e.iteration()).collect(Collectors.toSet()));
    }

    /**
     * root -&gt; a -&gt; b -&gt; c -&gt; d, loop-1 body {a,b,c} (source=c,target=a) and loop-2
     * body {b,c,d} (source=d,target=b) overlap at {b,c}. Nested/overlapping loops are
     * unsupported — {@code executeAllTextTrace} must throw synchronously (validation runs
     * before any future is returned), naming both offending loop ids.
     */
    @Test
    void overlappingLoopBodiesThrowIllegalArgumentException() {
        FlowDefinition flow = new FlowDefinition("overlap-test",
            List.of(
                new StepConfig("root", null, "node:root", Map.of(), List.of()),
                new StepConfig("a", null, "node:a", Map.of(), List.of("root")),
                new StepConfig("b", null, "node:b", Map.of(), List.of("a")),
                new StepConfig("c", null, "node:c", Map.of(), List.of("b")),
                new StepConfig("d", null, "node:d", Map.of(), List.of("c"))),
            List.of(
                new LoopConfig("loop-1", "c", "a", 2),
                new LoopConfig("loop-2", "d", "b", 2)));

        FlowExecutor executor = new FlowExecutor(new StepExecutor(new FakeProvider()));

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
            () -> executor.executeAllTextTrace(flow, 1, Map.of()));
        assertTrue(ex.getMessage().contains("nested or overlapping loops"), "message: " + ex.getMessage());
        assertTrue(ex.getMessage().contains("loop-1") && ex.getMessage().contains("loop-2"),
            "message must name both offending loop ids: " + ex.getMessage());
    }
}
