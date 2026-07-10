package io.fluxor.sdk.schema;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Optional annotation that enriches a generated schema property with a
 * {@code description}. Apply to a record component, field or accessor.
 */
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.RECORD_COMPONENT, ElementType.FIELD, ElementType.METHOD, ElementType.PARAMETER})
public @interface Schema {

    /** Human/LLM-facing description injected as the property's {@code description}. */
    String description() default "";
}
