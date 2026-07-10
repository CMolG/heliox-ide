package io.fluxor.sdk.engine;

import com.fasterxml.jackson.databind.JsonNode;
import io.fluxor.sdk.engine.DagTelemetry.NodeExecutionRecord;
import io.fluxor.sdk.flow.StepConfig;
import io.fluxor.sdk.internal.Json;
import io.fluxor.sdk.provider.ChatMessage;
import io.fluxor.sdk.provider.LlmProvider;
import io.fluxor.sdk.provider.LlmRequest;
import io.fluxor.sdk.provider.LlmResponse;
import io.fluxor.sdk.provider.ToolCall;
import io.fluxor.sdk.schema.JsonSchema;
import io.fluxor.sdk.schema.SchemaExtractor;
import io.fluxor.sdk.tool.ToolRegistry;
import io.fluxor.sdk.validation.SchemaValidationException;
import io.fluxor.sdk.validation.SchemaValidator;
import io.fluxor.sdk.validation.ValidationResult;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

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
 *
 * <h3>Telemetry instrumentation</h3>
 * The 4-argument overloads of {@link #executeStep} and {@link #executeStepText} accept a
 * {@link DagTelemetry} collector. Timing is captured with {@link System#nanoTime()} snapshots
 * inside the {@link CompletableFuture} closures and accumulated via thread-safe
 * {@link AtomicLong} counters. One {@link NodeExecutionRecord} is published per node via
 * {@code whenComplete}, which fires on both the success and failure paths. The 2- and 3-argument
 * overloads delegate to the 4-argument forms with {@link DagTelemetry#NOOP}.
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

    // =========================================================================
    // Public API — typed output
    // =========================================================================

    /**
     * Execute a step whose output must deserialize into {@code expectedType}.
     * Telemetry is discarded (delegates to {@link DagTelemetry#NOOP}).
     */
    public <T> CompletableFuture<T> executeStep(StepConfig step, Class<T> expectedType, int maxRetries) {
        return executeStep(step, expectedType, maxRetries, DagTelemetry.NOOP);
    }

    /**
     * Execute a step whose output must deserialize into {@code expectedType}, reporting
     * per-node timing, validation latency, and retry count to {@code telemetry}.
     *
     * <p>Exactly one {@link NodeExecutionRecord} for {@code step.id()} is published to
     * {@code telemetry} when the node terminates — on both success and failure.
     *
     * @param step        the step configuration to execute
     * @param expectedType the expected Java type of the deserialized output
     * @param maxRetries  maximum number of schema-validation retries
     * @param telemetry   collector for the node's execution metrics; use
     *                    {@link DagTelemetry#NOOP} to discard
     * @param <T>         the output type
     * @return a future that resolves to the typed result
     */
    public <T> CompletableFuture<T> executeStep(StepConfig step, Class<T> expectedType,
                                                 int maxRetries, DagTelemetry telemetry) {
        JsonSchema schema = schemaExtractor.extract(expectedType);
        List<ChatMessage> history = seedTypedMessages(step, schema);

        // Per-node accumulators — captured in closures, never shared across nodes.
        AtomicLong inferenceNs = new AtomicLong(0L);
        AtomicLong validationNs = new AtomicLong(0L);
        AtomicInteger attemptCount = new AtomicInteger(0);
        AtomicReference<LlmResponse> lastResponse = new AtomicReference<>();

        CompletableFuture<T> result = attempt(
                history, schema, expectedType, maxRetries,
                inferenceNs, validationNs, attemptCount, lastResponse);

        return result.whenComplete((value, error) -> {
            String status = error == null ? "ok" : "failed";
            long inferenceMs = inferenceNs.get() / 1_000_000L;
            long validationMs = validationNs.get() / 1_000_000L;
            int attempts = Math.max(1, attemptCount.get());
            Integer tokens = extractTokens(lastResponse.get());
            telemetry.record(new NodeExecutionRecord(
                    step.id(), inferenceMs, validationMs,
                    attempts, attempts - 1, status, tokens));
        }).thenApply(v -> v); // re-wrap so whenComplete's void return stays transparent
    }

    // =========================================================================
    // Public API — free-form text output
    // =========================================================================

    /**
     * Execute a step for its free-form text output (used by intermediate DAG nodes).
     * Telemetry is discarded (delegates to {@link DagTelemetry#NOOP}).
     */
    public CompletableFuture<String> executeStepText(StepConfig step, int maxRetries) {
        return executeStepText(step, maxRetries, DagTelemetry.NOOP);
    }

    /**
     * Execute a step for its free-form text output, reporting per-node timing to
     * {@code telemetry}. For text nodes there is no schema validation, so
     * {@code schemaValidationMs} is always 0 and {@code attempts} is always 1.
     *
     * @param step       the step configuration to execute
     * @param maxRetries maximum number of schema-validation retries (passed through
     *                   for consistency; text nodes do not validate)
     * @param telemetry  collector for the node's execution metrics
     * @return a future that resolves to the model's text output
     */
    public CompletableFuture<String> executeStepText(StepConfig step, int maxRetries, DagTelemetry telemetry) {
        AtomicLong inferenceNs = new AtomicLong(0L);
        AtomicReference<LlmResponse> lastResponse = new AtomicReference<>();

        CompletableFuture<String> result =
                runToolLoop(seedTextMessages(step), null, DEFAULT_TOOL_BUDGET, inferenceNs, lastResponse)
                        .thenApply(ConversationResult::finalText);

        return result.whenComplete((value, error) -> {
            String status = error == null ? "ok" : "failed";
            long inferenceMs = inferenceNs.get() / 1_000_000L;
            Integer tokens = extractTokens(lastResponse.get());
            telemetry.record(new NodeExecutionRecord(
                    step.id(), inferenceMs, 0L,
                    1, 0, status, tokens));
        }).thenApply(v -> v);
    }

    // =========================================================================
    // Internal — retry loop
    // =========================================================================

    private <T> CompletableFuture<T> attempt(List<ChatMessage> history, JsonSchema schema, Class<T> type,
                                              int retriesLeft,
                                              AtomicLong inferenceNs, AtomicLong validationNs,
                                              AtomicInteger attemptCount,
                                              AtomicReference<LlmResponse> lastResponse) {
        attemptCount.incrementAndGet();
        return runToolLoop(history, schema, DEFAULT_TOOL_BUDGET, inferenceNs, lastResponse)
                .thenCompose(conversation -> {
                    String jsonText = extractJson(conversation.finalText());

                    JsonNode parsed;
                    try {
                        parsed = Json.MAPPER.readTree(jsonText);
                    } catch (Exception e) {
                        return retryOrFail("El contenido no es JSON válido (" + e.getMessage() + ")",
                                conversation, schema, type, retriesLeft, null,
                                inferenceNs, validationNs, attemptCount, lastResponse);
                    }

                    long validationStart = System.nanoTime();
                    ValidationResult result = validator.validate(schema, parsed);
                    validationNs.addAndGet(System.nanoTime() - validationStart);

                    if (!result.valid()) {
                        return retryOrFail(result.toPromptMessage(), conversation, schema, type, retriesLeft, result,
                                inferenceNs, validationNs, attemptCount, lastResponse);
                    }

                    try {
                        return CompletableFuture.completedFuture(Json.MAPPER.treeToValue(parsed, type));
                    } catch (Exception e) {
                        return retryOrFail("La deserialización falló (" + e.getMessage() + ")",
                                conversation, schema, type, retriesLeft, result,
                                inferenceNs, validationNs, attemptCount, lastResponse);
                    }
                });
    }

    private <T> CompletableFuture<T> retryOrFail(String detail, ConversationResult conversation, JsonSchema schema,
                                                  Class<T> type, int retriesLeft, ValidationResult result,
                                                  AtomicLong inferenceNs, AtomicLong validationNs,
                                                  AtomicInteger attemptCount,
                                                  AtomicReference<LlmResponse> lastResponse) {
        if (retriesLeft <= 0) {
            ValidationResult finalResult = result != null
                ? result
                : ValidationResult.of(List.of(new ValidationResult.FieldError("$", detail)));
            return CompletableFuture.failedFuture(new SchemaValidationException(finalResult, conversation.finalText()));
        }

        List<ChatMessage> next = append(conversation.history(), ChatMessage.system(
            "El JSON falló en estos campos: " + detail
                + ". Corrige los errores y devuelve ÚNICAMENTE un JSON válido que cumpla el esquema."));
        return attempt(next, schema, type, retriesLeft - 1,
                inferenceNs, validationNs, attemptCount, lastResponse);
    }

    // =========================================================================
    // Internal — tool loop
    // =========================================================================

    /**
     * Drive the conversation until the model returns a final (non-tool) answer, executing any
     * requested tools along the way. Returns the full history (including the final assistant
     * turn) and the final text.
     *
     * <p>Every call to {@link LlmProvider#complete} is bracketed with {@link System#nanoTime()}
     * snapshots; the elapsed nanoseconds are accumulated into {@code inferenceNs}.
     * {@code lastResponse} is updated with every provider response so the caller can extract
     * token counts from the final turn.
     */
    private CompletableFuture<ConversationResult> runToolLoop(List<ChatMessage> history, JsonSchema schema,
                                                               int toolBudget,
                                                               AtomicLong inferenceNs,
                                                               AtomicReference<LlmResponse> lastResponse) {
        long callStart = System.nanoTime();
        LlmRequest request = new LlmRequest(history, schema, model, 0.0, toolRegistry.specs());
        return provider.complete(request).thenCompose(response -> {
            inferenceNs.addAndGet(System.nanoTime() - callStart);
            lastResponse.set(response);

            ChatMessage assistantMessage = response.hasToolCalls()
                ? ChatMessage.assistantToolCalls(response.content(), response.toolCalls())
                : ChatMessage.assistant(response.content());
            List<ChatMessage> withAssistant = append(history, assistantMessage);

            if (response.hasToolCalls() && toolBudget > 0) {
                return executeToolCalls(response.toolCalls()).thenCompose(toolMessages ->
                    runToolLoop(concat(withAssistant, toolMessages), schema, toolBudget - 1,
                            inferenceNs, lastResponse));
            }
            return CompletableFuture.completedFuture(new ConversationResult(withAssistant, response.content()));
        });
    }

    // =========================================================================
    // Internal — tool invocation
    // =========================================================================

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

    // =========================================================================
    // Internal — message builders
    // =========================================================================

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

    // =========================================================================
    // Internal — helpers
    // =========================================================================

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

    /**
     * Extracts combined token count from a provider response when available.
     * Returns {@code null} if the provider did not populate token fields (the
     * common case for {@link io.fluxor.sdk.testutil.FakeProvider} and providers
     * that do not report usage).
     */
    private static Integer extractTokens(LlmResponse response) {
        if (response == null) {
            return null;
        }
        Integer prompt = response.promptTokens();
        Integer completion = response.completionTokens();
        if (prompt == null && completion == null) {
            return null;
        }
        return (prompt != null ? prompt : 0) + (completion != null ? completion : 0);
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
