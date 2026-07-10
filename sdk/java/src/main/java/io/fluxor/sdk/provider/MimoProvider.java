package io.fluxor.sdk.provider;

import com.fasterxml.jackson.databind.node.ObjectNode;

import java.net.http.HttpClient;

/**
 * Xiaomi MiMo provider, routed through the Amsterdam token-plan endpoint used by
 * Fluxor IDE. The API key falls back to the {@code MIMO_API_KEY} / {@code AGENT_API_KEY}
 * environment variables to match the IDE's harness runner.
 */
public class MimoProvider extends OpenAiCompatibleProvider {

    private static final String BASE_URL = "https://token-plan-ams.xiaomimimo.com/v1";
    private static final String DEFAULT_MODEL = "mimo-v2-pro";

    public MimoProvider(String apiKey) {
        super(BASE_URL, resolveKey(apiKey), DEFAULT_MODEL);
    }

    public MimoProvider(String apiKey, String model) {
        super(BASE_URL, resolveKey(apiKey), model);
    }

    public MimoProvider(String apiKey, String model, HttpClient httpClient) {
        super(BASE_URL, resolveKey(apiKey), model, httpClient);
    }

    /** MiMo follows the OpenAI {@code json_object} contract; schema lives in the prompt. */
    @Override
    protected void applyResponseFormat(ObjectNode body, LlmRequest request) {
        body.putObject("response_format").put("type", "json_object");
    }

    private static String resolveKey(String apiKey) {
        if (apiKey != null && !apiKey.isBlank()) {
            return apiKey;
        }
        String env = System.getenv("MIMO_API_KEY");
        if (env == null || env.isBlank()) {
            env = System.getenv("AGENT_API_KEY");
        }
        return env;
    }
}
