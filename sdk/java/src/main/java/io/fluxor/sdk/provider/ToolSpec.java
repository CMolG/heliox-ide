package io.fluxor.sdk.provider;

import io.fluxor.sdk.schema.JsonSchema;

/**
 * Provider-facing description of a callable tool. Serialized into the OpenAI
 * {@code tools: [{type:"function", function:{name, description, parameters}}]} shape.
 */
public record ToolSpec(String name, String description, JsonSchema parameters) {
}
