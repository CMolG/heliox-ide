package io.heliox.sdk.provider;

import io.heliox.sdk.schema.JsonSchema;

import java.util.List;

/**
 * A provider-agnostic completion request. {@code responseSchema} is the schema the
 * output must satisfy; {@code tools} advertises the callable functions for this turn.
 */
public record LlmRequest(
    List<ChatMessage> messages,
    JsonSchema responseSchema,
    String model,
    Double temperature,
    List<ToolSpec> tools
) {
    public LlmRequest {
        messages = List.copyOf(messages);
        tools = tools == null ? List.of() : List.copyOf(tools);
    }

    public LlmRequest(List<ChatMessage> messages, JsonSchema responseSchema, String model, Double temperature) {
        this(messages, responseSchema, model, temperature, List.of());
    }
}
