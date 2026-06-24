package io.heliox.sdk.engine;

import io.heliox.sdk.flow.FlowDefinition;
import io.heliox.sdk.flow.StepConfig;
import io.heliox.sdk.provider.ChatMessage;
import io.heliox.sdk.provider.LlmResponse;
import io.heliox.sdk.testutil.FakeProvider;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class FlowExecutorTest {

    record Summary(String result) {
    }

    private static String userPrompt(io.heliox.sdk.provider.LlmRequest request) {
        return request.messages().stream()
            .filter(m -> m.role() == ChatMessage.Role.USER)
            .map(ChatMessage::content)
            .findFirst().orElse("");
    }

    /**
     * Diamond DAG: A -> {B, C} -> D. B and C run concurrently; D must observe both their
     * outputs in its accumulated context.
     */
    @Test
    void executesDiamondDagAndAggregatesParentResults() throws Exception {
        FakeProvider provider = new FakeProvider().responder(request -> {
            String prompt = userPrompt(request);
            if (prompt.contains("node:D")) {
                boolean sawParents = prompt.contains("out-B") && prompt.contains("out-C");
                return LlmResponse.of("{\"result\":\"" + (sawParents ? "ok" : "missing-parents") + "\"}");
            }
            if (prompt.contains("node:A")) {
                return LlmResponse.of("out-A");
            }
            if (prompt.contains("node:B")) {
                return LlmResponse.of("out-B");
            }
            if (prompt.contains("node:C")) {
                return LlmResponse.of("out-C");
            }
            return LlmResponse.of("?");
        });

        FlowExecutor flowExecutor = new FlowExecutor(new StepExecutor(provider));
        FlowDefinition flow = new FlowDefinition("diamond", List.of(
            new StepConfig("A", null, "node:A", Map.of(), List.of()),
            new StepConfig("B", null, "node:B", Map.of(), List.of("A")),
            new StepConfig("C", null, "node:C", Map.of(), List.of("A")),
            new StepConfig("D", null, "node:D", Map.of(), List.of("B", "C"))));

        Summary result = flowExecutor.execute(flow, Summary.class, 2, Map.of()).get();

        assertEquals("ok", result.result());
        assertEquals(4, provider.requests.size());
    }

    @Test
    void detectsDependencyCycle() {
        FlowExecutor flowExecutor = new FlowExecutor(new StepExecutor(new FakeProvider()));
        FlowDefinition flow = new FlowDefinition("cyclic", List.of(
            new StepConfig("A", null, "a", Map.of(), List.of("B")),
            new StepConfig("B", null, "b", Map.of(), List.of("A"))));

        assertThrows(IllegalStateException.class,
            () -> flowExecutor.execute(flow, Summary.class, 1, Map.of()));
    }

    @Test
    void rejectsUnknownDependency() {
        FlowExecutor flowExecutor = new FlowExecutor(new StepExecutor(new FakeProvider()));
        FlowDefinition flow = new FlowDefinition("broken", List.of(
            new StepConfig("A", null, "a", Map.of(), List.of("ghost"))));

        assertThrows(IllegalArgumentException.class,
            () -> flowExecutor.execute(flow, Summary.class, 1, Map.of()));
    }
}
