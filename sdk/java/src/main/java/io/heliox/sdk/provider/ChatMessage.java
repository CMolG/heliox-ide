package io.heliox.sdk.provider;

import java.util.List;

/**
 * A single chat message. Supports the four OpenAI roles, including assistant messages
 * that carry {@code tool_calls} and {@code tool} messages that carry a {@code tool_call_id}.
 */
public record ChatMessage(Role role, String content, String toolCallId, List<ToolCall> toolCalls) {

    public enum Role {
        SYSTEM, USER, ASSISTANT, TOOL
    }

    public ChatMessage {
        toolCalls = toolCalls == null ? List.of() : List.copyOf(toolCalls);
    }

    public static ChatMessage system(String content) {
        return new ChatMessage(Role.SYSTEM, content, null, List.of());
    }

    public static ChatMessage user(String content) {
        return new ChatMessage(Role.USER, content, null, List.of());
    }

    public static ChatMessage assistant(String content) {
        return new ChatMessage(Role.ASSISTANT, content, null, List.of());
    }

    /** An assistant turn that requests one or more tool calls. */
    public static ChatMessage assistantToolCalls(String content, List<ToolCall> toolCalls) {
        return new ChatMessage(Role.ASSISTANT, content, null, toolCalls);
    }

    /** The result of executing a tool, threaded back to the model. */
    public static ChatMessage tool(String toolCallId, String content) {
        return new ChatMessage(Role.TOOL, content, toolCallId, List.of());
    }

    public boolean hasToolCalls() {
        return !toolCalls.isEmpty();
    }

    /** OpenAI-compatible wire role ({@code "system"}, {@code "user"}, {@code "assistant"}, {@code "tool"}). */
    public String roleWire() {
        return role.name().toLowerCase();
    }
}
