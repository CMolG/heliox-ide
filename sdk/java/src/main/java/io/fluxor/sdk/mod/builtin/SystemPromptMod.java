package io.fluxor.sdk.mod.builtin;

import io.fluxor.sdk.mod.ModContext;
import io.fluxor.sdk.mod.StepMod;
import io.fluxor.sdk.provider.ChatMessage;
import io.fluxor.sdk.provider.LlmRequest;

import java.util.ArrayList;
import java.util.List;

/**
 * Injects {@code text} into the step's system framing — the Java analogue of the TS
 * {@code system_override} mod kind. With {@link Position#PREPEND} the text goes before the
 * existing system content (highest priority — a hard constraint); with {@link Position#APPEND}
 * it goes after (a closing reminder).
 *
 * <p>When the request already carries a system message, {@code text} is merged into it
 * (separated by a blank line) so the wire still carries exactly one system message. When it
 * carries none (a text step with no {@code systemPrompt}), a new system message is inserted at
 * the head of the conversation, regardless of {@code position}.
 */
public final class SystemPromptMod implements StepMod {

    /** Where {@code text} lands relative to the step's existing system content. */
    public enum Position { PREPEND, APPEND }

    private final String text;
    private final Position position;

    public SystemPromptMod(String text, Position position) {
        this.text = text;
        this.position = position;
    }

    @Override
    public String id() {
        return "system-prompt";
    }

    @Override
    public LlmRequest onRequest(LlmRequest request, ModContext ctx) {
        List<ChatMessage> messages = new ArrayList<>(request.messages());
        int systemIndex = indexOfSystemMessage(messages);

        if (systemIndex < 0) {
            messages.add(0, ChatMessage.system(text));
        } else {
            ChatMessage existing = messages.get(systemIndex);
            String merged = position == Position.PREPEND
                ? text + "\n\n" + existing.content()
                : existing.content() + "\n\n" + text;
            messages.set(systemIndex, ChatMessage.system(merged));
        }

        return new LlmRequest(messages, request.responseSchema(), request.model(), request.temperature(), request.tools());
    }

    private static int indexOfSystemMessage(List<ChatMessage> messages) {
        for (int i = 0; i < messages.size(); i++) {
            if (messages.get(i).role() == ChatMessage.Role.SYSTEM) {
                return i;
            }
        }
        return -1;
    }
}
