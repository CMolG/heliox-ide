package io.fluxor.sdk.provider;

import java.util.List;

/**
 * A provider-agnostic completion response. When {@link #toolCalls()} is non-empty the
 * model is requesting tool execution rather than producing a final answer.
 */
public record LlmResponse(String content, List<ToolCall> toolCalls, Integer promptTokens, Integer completionTokens) {

    public LlmResponse {
        toolCalls = toolCalls == null ? List.of() : List.copyOf(toolCalls);
    }

    public static LlmResponse of(String content) {
        return new LlmResponse(content, List.of(), null, null);
    }

    public static LlmResponse withToolCalls(String content, List<ToolCall> toolCalls) {
        return new LlmResponse(content, toolCalls, null, null);
    }

    public boolean hasToolCalls() {
        return !toolCalls.isEmpty();
    }
}
