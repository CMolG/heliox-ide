package io.heliox.sdk.provider;

import com.fasterxml.jackson.databind.node.ObjectNode;

import java.net.http.HttpClient;

/**
 * OpenAI provider. When a response schema is present it upgrades to native strict
 * structured outputs ({@code response_format: json_schema, strict: true}); otherwise
 * it forces a JSON object. The API key falls back to {@code OPENAI_API_KEY}.
 */
public class OpenAiProvider extends OpenAiCompatibleProvider {

    private static final String BASE_URL = "https://api.openai.com/v1";
    private static final String DEFAULT_MODEL = "gpt-4o-mini";

    public OpenAiProvider(String apiKey) {
        super(BASE_URL, resolveKey(apiKey), DEFAULT_MODEL);
    }

    public OpenAiProvider(String apiKey, String model) {
        super(BASE_URL, resolveKey(apiKey), model);
    }

    public OpenAiProvider(String apiKey, String model, HttpClient httpClient) {
        super(BASE_URL, resolveKey(apiKey), model, httpClient);
    }

    @Override
    protected void applyResponseFormat(ObjectNode body, LlmRequest request) {
        if (request.responseSchema() == null) {
            body.putObject("response_format").put("type", "json_object");
            return;
        }
        ObjectNode responseFormat = body.putObject("response_format");
        responseFormat.put("type", "json_schema");
        ObjectNode jsonSchema = responseFormat.putObject("json_schema");
        jsonSchema.put("name", "structured_output");
        jsonSchema.put("strict", true);
        jsonSchema.set("schema", request.responseSchema().node());
    }

    private static String resolveKey(String apiKey) {
        if (apiKey != null && !apiKey.isBlank()) {
            return apiKey;
        }
        return System.getenv("OPENAI_API_KEY");
    }
}
