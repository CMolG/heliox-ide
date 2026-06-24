package io.heliox.sdk.engine;

import com.fasterxml.jackson.databind.JsonNode;
import io.heliox.sdk.flow.StepConfig;
import io.heliox.sdk.internal.Json;
import io.heliox.sdk.provider.ChatMessage;
import io.heliox.sdk.provider.LlmProvider;
import io.heliox.sdk.provider.LlmRequest;
import io.heliox.sdk.provider.ToolCall;
import io.heliox.sdk.schema.JsonSchema;
import io.heliox.sdk.schema.SchemaExtractor;
import io.heliox.sdk.tool.ToolRegistry;
import io.heliox.sdk.validation.SchemaValidationException;
import io.heliox.sdk.validation.SchemaValidator;
import io.heliox.sdk.validation.ValidationResult;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;

/**
 * Executes a single {@link StepConfig}. Two concerns are interleaved, both fully async
 * (no blocking, no {@code join()}/{@code get()} on the hot path):
 *
 * <ol>
 *   <li><b>Tool loop</b> — while the model returns {@code tool_calls}, schema validation is
 *       paused: each tool is invoked via {@link ToolRegistry}, its JSON result is appended as
 *       a {@code tool} message, and the conversation is replayed ({@code thenCompose}) so the
 *       model can keep reasoning.</li>
 *   <li><b>Schema retry loop</b> — once the model produces a final answer, it is validated and
 *       deserialized; on failure the offending fields are injected as a corrective system
 *       message and the step retries, up to {@code maxRetries}.</li>
 * </ol>
 */
public final class StepExecutor {

    private static final int DEFAULT_TOOL_BUDGET = 8;

    private final LlmProvider provider;
    private final SchemaExtractor schemaExtractor;
    private final SchemaValidator validator;
    private final ToolRegistry toolRegistry;
    private final String model;

    public StepExecutor(LlmProvider provider) {
        this(provider, new SchemaExtractor(), new SchemaValidator(), new ToolRegistry(), null);
    }

    public StepExecutor(LlmProvider provider, ToolRegistry toolRegistry) {
        this(provider, new SchemaExtractor(), new SchemaValidator(), toolRegistry, null);
    }

    public StepExecutor(LlmProvider provider, SchemaExtractor schemaExtractor, SchemaValidator validator,
                        ToolRegistry toolRegistry, String model) {
        this.provider = provider;
        this.schemaExtractor = schemaExtractor;
        this.validator = validator;
        this.toolRegistry = toolRegistry == null ? new ToolRegistry() : toolRegistry;
        this.model = model;
    }

    /** Execute a step whose output must deserialize into {@code expectedType}. */
    public <T> CompletableFuture<T> executeStep(StepConfig step, Class<T> expectedType, int maxRetries) {
        JsonSchema schema = schemaExtractor.extract(expectedType);
        List<ChatMessage> history = seedTypedMessages(step, schema);
        return attempt(history, schema, expectedType, maxRetries);
    }

    /** Execute a step for its free-form text output (used by intermediate DAG nodes). */
    public CompletableFuture<String> executeStepText(StepConfig step, int maxRetries) {
        return runToolLoop(seedTextMessages(step), null, DEFAULT_TOOL_BUDGET)
            .thenApply(ConversationResult::finalText);
    }

    private <T> CompletableFuture<T> attempt(List<ChatMessage> history, JsonSchema schema, Class<T> type, int retriesLeft) {
        return runToolLoop(history, schema, DEFAULT_TOOL_BUDGET).thenCompose(conversation -> {
            String jsonText = extractJson(conversation.finalText());

            JsonNode parsed;
            try {
                parsed = Json.MAPPER.readTree(jsonText);
            } catch (Exception e) {
                return retryOrFail("El contenido no es JSON válido (" + e.getMessage() + ")",
                    conversation, schema, type, retriesLeft, null);
            }

            ValidationResult result = validator.validate(schema, parsed);
            if (!result.valid()) {
                return retryOrFail(result.toPromptMessage(), conversation, schema, type, retriesLeft, result);
            }

            try {
                return CompletableFuture.completedFuture(Json.MAPPER.treeToValue(parsed, type));
            } catch (Exception e) {
                return retryOrFail("La deserialización falló (" + e.getMessage() + ")",
                    conversation, schema, type, retriesLeft, result);
            }
        });
    }

    private <T> CompletableFuture<T> retryOrFail(String detail, ConversationResult conversation, JsonSchema schema,
                                                 Class<T> type, int retriesLeft, ValidationResult result) {
        if (retriesLeft <= 0) {
            ValidationResult finalResult = result != null
                ? result
                : ValidationResult.of(List.of(new ValidationResult.FieldError("$", detail)));
            return CompletableFuture.failedFuture(new SchemaValidationException(finalResult, conversation.finalText()));
        }

        List<ChatMessage> next = append(conversation.history(), ChatMessage.system(
            "El JSON falló en estos campos: " + detail
                + ". Corrige los errores y devuelve ÚNICAMENTE un JSON válido que cumpla el esquema."));
        return attempt(next, schema, type, retriesLeft - 1);
    }

    /**
     * Drive the conversation until the model returns a final (non-tool) answer, executing any
     * requested tools along the way. Returns the full history (including the final assistant
     * turn) and the final text.
     */
    private CompletableFuture<ConversationResult> runToolLoop(List<ChatMessage> history, JsonSchema schema, int toolBudget) {
        LlmRequest request = new LlmRequest(history, schema, model, 0.0, toolRegistry.specs());
        return provider.complete(request).thenCompose(response -> {
            ChatMessage assistantMessage = response.hasToolCalls()
                ? ChatMessage.assistantToolCalls(response.content(), response.toolCalls())
                : ChatMessage.assistant(response.content());
            List<ChatMessage> withAssistant = append(history, assistantMessage);

            if (response.hasToolCalls() && toolBudget > 0) {
                return executeToolCalls(response.toolCalls()).thenCompose(toolMessages ->
                    runToolLoop(concat(withAssistant, toolMessages), schema, toolBudget - 1));
            }
            return CompletableFuture.completedFuture(new ConversationResult(withAssistant, response.content()));
        });
    }

    private CompletableFuture<List<ChatMessage>> executeToolCalls(List<ToolCall> calls) {
        List<CompletableFuture<ChatMessage>> futures = new ArrayList<>(calls.size());
        for (ToolCall call : calls) {
            futures.add(toolRegistry.invoke(call.name(), call.argumentsJson())
                .handle((result, error) -> ChatMessage.tool(call.id(),
                    error == null
                        ? result
                        : "ERROR ejecutando la herramienta '" + call.name() + "': " + rootMessage(error))));
        }
        return CompletableFuture.allOf(futures.toArray(CompletableFuture[]::new))
            .thenApply(ignored -> futures.stream().map(CompletableFuture::join).toList());
    }

    private List<ChatMessage> seedTypedMessages(StepConfig step, JsonSchema schema) {
        StringBuilder system = new StringBuilder();
        if (step.systemPrompt() != null && !step.systemPrompt().isBlank()) {
            system.append(step.systemPrompt()).append("\n\n");
        }
        system.append("Responde ÚNICAMENTE con un objeto JSON válido que cumpla EXACTAMENTE este JSON Schema. ")
            .append("No incluyas explicaciones ni texto fuera del JSON.\n\nJSON Schema:\n")
            .append(schema.toJson());

        List<ChatMessage> messages = new ArrayList<>();
        messages.add(ChatMessage.system(system.toString()));
        messages.add(ChatMessage.user(step.renderUserPrompt()));
        return messages;
    }

    private List<ChatMessage> seedTextMessages(StepConfig step) {
        List<ChatMessage> messages = new ArrayList<>();
        if (step.systemPrompt() != null && !step.systemPrompt().isBlank()) {
            messages.add(ChatMessage.system(step.systemPrompt()));
        }
        messages.add(ChatMessage.user(step.renderUserPrompt()));
        return messages;
    }

    /** Final history plus the model's last textual answer. */
    record ConversationResult(List<ChatMessage> history, String finalText) {
    }

    private static List<ChatMessage> append(List<ChatMessage> base, ChatMessage extra) {
        List<ChatMessage> copy = new ArrayList<>(base);
        copy.add(extra);
        return copy;
    }

    private static List<ChatMessage> concat(List<ChatMessage> base, List<ChatMessage> extra) {
        List<ChatMessage> copy = new ArrayList<>(base);
        copy.addAll(extra);
        return copy;
    }

    private static String rootMessage(Throwable error) {
        Throwable cause = error;
        while (cause.getCause() != null) {
            cause = cause.getCause();
        }
        return cause.getMessage();
    }

    /** Extract a JSON document from raw model content, tolerating {@code ```json} fences and surrounding prose. */
    static String extractJson(String raw) {
        if (raw == null) {
            return "";
        }
        String trimmed = raw.trim();
        if (trimmed.startsWith("```")) {
            int firstNewline = trimmed.indexOf('\n');
            int lastFence = trimmed.lastIndexOf("```");
            if (firstNewline >= 0 && lastFence > firstNewline) {
                trimmed = trimmed.substring(firstNewline + 1, lastFence).trim();
            }
        }
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
            return trimmed;
        }
        int objectStart = trimmed.indexOf('{');
        int objectEnd = trimmed.lastIndexOf('}');
        if (objectStart >= 0 && objectEnd > objectStart) {
            return trimmed.substring(objectStart, objectEnd + 1);
        }
        return trimmed;
    }
}
