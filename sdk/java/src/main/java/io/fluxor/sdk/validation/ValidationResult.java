package io.fluxor.sdk.validation;

import java.util.List;
import java.util.stream.Collectors;

/**
 * Outcome of validating an instance against a {@link io.fluxor.sdk.schema.JsonSchema}.
 * When invalid, {@link #errors()} carries one {@link FieldError} per offending location.
 */
public record ValidationResult(boolean valid, List<FieldError> errors) {

    public ValidationResult {
        errors = List.copyOf(errors);
    }

    public static ValidationResult ok() {
        return new ValidationResult(true, List.of());
    }

    public static ValidationResult of(List<FieldError> errors) {
        return new ValidationResult(errors.isEmpty(), errors);
    }

    /**
     * Compact, human/LLM-readable summary used to seed the self-correction message,
     * e.g. {@code "$.user.age: se esperaba integer; $.role: valor no permitido 'X'"}.
     */
    public String toPromptMessage() {
        return errors.stream()
            .map(e -> e.path() + ": " + e.message())
            .collect(Collectors.joining("; "));
    }

    /** A single validation failure at a JSON path. */
    public record FieldError(String path, String message) {
    }
}
