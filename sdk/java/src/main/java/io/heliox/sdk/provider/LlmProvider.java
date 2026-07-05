package io.heliox.sdk.provider;

import java.util.concurrent.CompletableFuture;

/**
 * A pluggable LLM backend. Implementations must be non-blocking: {@link #complete}
 * returns immediately with a future that completes when the model responds.
 */
public interface LlmProvider {

    CompletableFuture<LlmResponse> complete(LlmRequest request);
}
