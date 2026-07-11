package io.fluxor.sdk.sandbox;

import org.junit.jupiter.api.extension.ExtendWith;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Skips the annotated test method unless a working {@code docker} CLI is on {@code PATH} and its
 * daemon answers. Mirrors the built-in {@code @EnabledIfEnvironmentVariable} style already used
 * by {@code MimoLiveTest} for gating live/integration tests that a default {@code mvn test} run
 * should never fail just because the environment lacks a dependency.
 */
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.METHOD, ElementType.TYPE})
@ExtendWith(DockerAvailableCondition.class)
public @interface EnabledIfDockerAvailable {
}
