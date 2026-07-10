package io.fluxor.sdk.tool;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Marks a method as a tool the LLM may call during a step. Discovered by
 * {@link ToolRegistry}, which derives the tool's parameter schema from the method
 * signature via reflection.
 */
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface FluxorTool {

    /** Tool name exposed to the model. Defaults to the method name when blank. */
    String name() default "";

    /** Natural-language description that helps the model decide when to call the tool. */
    String description() default "";
}
