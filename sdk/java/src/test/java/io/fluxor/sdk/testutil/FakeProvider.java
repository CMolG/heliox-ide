package io.fluxor.sdk.testutil;

import io.fluxor.sdk.provider.LlmProvider;
import io.fluxor.sdk.provider.LlmRequest;
import io.fluxor.sdk.provider.LlmResponse;
import io.fluxor.sdk.provider.ToolCall;

import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentLinkedDeque;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Function;

/**
 * Deterministic, offline {@link LlmProvider} for tests. Thread-safe so it can back the
 * concurrent DAG scheduler. Either script responses in order (text or tool calls) or supply
 * a {@code responder} that derives a response from each request.
 */
public final class FakeProvider implements LlmProvider {

    public final List<LlmRequest> requests = new CopyOnWriteArrayList<>();
    private final ConcurrentLinkedDeque<LlmResponse> scripted = new ConcurrentLinkedDeque<>();
    private volatile Function<LlmRequest, LlmResponse> responder;

    public FakeProvider respondWith(String... contents) {
        for (String content : contents) {
            scripted.add(LlmResponse.of(content));
        }
        return this;
    }

    public FakeProvider respondWithToolCall(String id, String name, String argumentsJson) {
        scripted.add(LlmResponse.withToolCalls("", List.of(new ToolCall(id, name, argumentsJson))));
        return this;
    }

    public FakeProvider responder(Function<LlmRequest, LlmResponse> responder) {
        this.responder = responder;
        return this;
    }

    @Override
    public CompletableFuture<LlmResponse> complete(LlmRequest request) {
        requests.add(request);
        if (responder != null) {
            return CompletableFuture.completedFuture(responder.apply(request));
        }
        LlmResponse response = scripted.poll();
        return CompletableFuture.completedFuture(response != null ? response : LlmResponse.of("{}"));
    }
}
