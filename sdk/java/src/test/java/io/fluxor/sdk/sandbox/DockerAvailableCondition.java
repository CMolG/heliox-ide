package io.fluxor.sdk.sandbox;

import org.junit.jupiter.api.extension.ConditionEvaluationResult;
import org.junit.jupiter.api.extension.ExecutionCondition;
import org.junit.jupiter.api.extension.ExtensionContext;

/**
 * Backing {@link ExecutionCondition} for {@link EnabledIfDockerAvailable}: enabled iff
 * {@code docker version} exits {@code 0} (the CLI is installed and the daemon is reachable).
 * The check runs at most once per JVM — its result is cached, since it can't change mid-run and
 * shelling out for every gated test method would be wasteful.
 */
final class DockerAvailableCondition implements ExecutionCondition {

    private static volatile Boolean available;

    @Override
    public ConditionEvaluationResult evaluateExecutionCondition(ExtensionContext context) {
        return isDockerAvailable()
            ? ConditionEvaluationResult.enabled("docker CLI is available")
            : ConditionEvaluationResult.disabled("docker CLI is not available or the daemon is unreachable");
    }

    private static boolean isDockerAvailable() {
        Boolean cached = available;
        if (cached != null) {
            return cached;
        }
        boolean result;
        try {
            Process process = new ProcessBuilder("docker", "version").redirectErrorStream(true).start();
            boolean finished = process.waitFor(10, java.util.concurrent.TimeUnit.SECONDS);
            result = finished && process.exitValue() == 0;
        } catch (Exception e) {
            result = false;
        }
        available = result;
        return result;
    }
}
