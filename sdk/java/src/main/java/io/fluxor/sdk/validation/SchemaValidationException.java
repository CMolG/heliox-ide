package io.fluxor.sdk.validation;

/**
 * Thrown when a step's output still fails schema validation after the retry budget
 * is exhausted. Carries the final {@link ValidationResult} and the raw model output
 * for diagnostics.
 */
public class SchemaValidationException extends RuntimeException {

    private final transient ValidationResult result;
    private final String rawOutput;

    public SchemaValidationException(ValidationResult result, String rawOutput) {
        super("Output failed schema validation: " + result.toPromptMessage());
        this.result = result;
        this.rawOutput = rawOutput;
    }

    public ValidationResult result() {
        return result;
    }

    public String rawOutput() {
        return rawOutput;
    }
}
