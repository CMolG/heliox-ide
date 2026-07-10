package io.fluxor.sdk.provider;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.fluxor.sdk.internal.Json;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;

/**
 * Base provider that speaks the OpenAI {@code /chat/completions} dialect over the JDK
 * {@link HttpClient} — no third-party HTTP library. Handles native tool calling: it
 * serializes {@code tools}, assistant {@code tool_calls} and {@code tool} result messages,
 * and parses {@code tool_calls} back out of the response.
 */
public abstract class OpenAiCompatibleProvider implements LlmProvider {

    private final String baseUrl;
    private final String apiKey;
    private final String defaultModel;
    private final HttpClient httpClient;

    protected OpenAiCompatibleProvider(String baseUrl, String apiKey, String defaultModel) {
        this(baseUrl, apiKey, defaultModel,
            HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(30)).build());
    }

    protected OpenAiCompatibleProvider(String baseUrl, String apiKey, String defaultModel, HttpClient httpClient) {
        this.baseUrl = stripTrailingSlash(baseUrl);
        this.apiKey = apiKey;
        this.defaultModel = defaultModel;
        this.httpClient = httpClient;
    }

    /**
     * Inject the provider-specific {@code response_format}. Default forces a JSON object;
     * providers with native structured-output support may override to forward the schema.
     */
    protected void applyResponseFormat(ObjectNode body, LlmRequest request) {
        body.putObject("response_format").put("type", "json_object");
    }

    @Override
    public CompletableFuture<LlmResponse> complete(LlmRequest request) {
        final String payload;
        try {
            payload = Json.MAPPER.writeValueAsString(buildBody(request));
        } catch (JsonProcessingException e) {
            return CompletableFuture.failedFuture(new ProviderException("Failed to serialize request body", e));
        }

        HttpRequest httpRequest = HttpRequest.newBuilder()
            .uri(URI.create(baseUrl + "/chat/completions"))
            .timeout(Duration.ofSeconds(120))
            .header("Content-Type", "application/json")
            .header("Authorization", "Bearer " + apiKey)
            .POST(HttpRequest.BodyPublishers.ofString(payload))
            .build();

        return httpClient.sendAsync(httpRequest, HttpResponse.BodyHandlers.ofString())
            .thenApply(this::parseResponse);
    }

    private ObjectNode buildBody(LlmRequest request) {
        ObjectNode body = Json.MAPPER.createObjectNode();
        body.put("model", request.model() != null ? request.model() : defaultModel);
        if (request.temperature() != null) {
            body.put("temperature", request.temperature());
        }

        ArrayNode messages = body.putArray("messages");
        for (ChatMessage message : request.messages()) {
            messages.add(serializeMessage(message));
        }

        if (!request.tools().isEmpty()) {
            ArrayNode tools = body.putArray("tools");
            for (ToolSpec spec : request.tools()) {
                ObjectNode tool = tools.addObject();
                tool.put("type", "function");
                ObjectNode function = tool.putObject("function");
                function.put("name", spec.name());
                if (spec.description() != null && !spec.description().isEmpty()) {
                    function.put("description", spec.description());
                }
                function.set("parameters", spec.parameters().node());
            }
        }

        applyResponseFormat(body, request);
        return body;
    }

    private ObjectNode serializeMessage(ChatMessage message) {
        ObjectNode node = Json.MAPPER.createObjectNode();
        node.put("role", message.roleWire());

        if (message.role() == ChatMessage.Role.TOOL) {
            node.put("tool_call_id", message.toolCallId());
            node.put("content", message.content() == null ? "" : message.content());
            return node;
        }

        if (message.hasToolCalls()) {
            if (message.content() == null || message.content().isEmpty()) {
                node.putNull("content");
            } else {
                node.put("content", message.content());
            }
            ArrayNode toolCalls = node.putArray("tool_calls");
            for (ToolCall call : message.toolCalls()) {
                ObjectNode tc = toolCalls.addObject();
                tc.put("id", call.id());
                tc.put("type", "function");
                ObjectNode function = tc.putObject("function");
                function.put("name", call.name());
                function.put("arguments", call.argumentsJson());
            }
            return node;
        }

        node.put("content", message.content() == null ? "" : message.content());
        return node;
    }

    private LlmResponse parseResponse(HttpResponse<String> response) {
        if (response.statusCode() / 100 != 2) {
            throw new ProviderException(
                "LLM provider returned HTTP " + response.statusCode() + ": " + response.body());
        }
        try {
            JsonNode root = Json.MAPPER.readTree(response.body());
            JsonNode choices = root.path("choices");
            if (!choices.isArray() || choices.isEmpty()) {
                throw new ProviderException("LLM response contained no choices: " + response.body());
            }
            JsonNode message = choices.get(0).path("message");
            String content = message.path("content").asText("");

            List<ToolCall> toolCalls = new ArrayList<>();
            JsonNode toolCallsNode = message.path("tool_calls");
            if (toolCallsNode.isArray()) {
                for (JsonNode call : toolCallsNode) {
                    JsonNode function = call.path("function");
                    toolCalls.add(new ToolCall(
                        call.path("id").asText(""),
                        function.path("name").asText(""),
                        function.path("arguments").asText("{}")));
                }
            }

            JsonNode usage = root.path("usage");
            Integer promptTokens = usage.hasNonNull("prompt_tokens") ? usage.get("prompt_tokens").asInt() : null;
            Integer completionTokens = usage.hasNonNull("completion_tokens") ? usage.get("completion_tokens").asInt() : null;
            return new LlmResponse(content, toolCalls, promptTokens, completionTokens);
        } catch (JsonProcessingException e) {
            throw new ProviderException("Failed to parse LLM response body", e);
        }
    }

    protected String defaultModel() {
        return defaultModel;
    }

    private static String stripTrailingSlash(String url) {
        return url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
    }
}
