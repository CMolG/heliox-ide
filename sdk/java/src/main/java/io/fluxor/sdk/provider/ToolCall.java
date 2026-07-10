package io.fluxor.sdk.provider;

/**
 * A tool invocation requested by the model. {@code argumentsJson} is the raw JSON
 * string of arguments as emitted by the provider (OpenAI encodes it as a string).
 */
public record ToolCall(String id, String name, String argumentsJson) {
}
