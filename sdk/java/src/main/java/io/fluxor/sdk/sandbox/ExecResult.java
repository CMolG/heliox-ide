package io.fluxor.sdk.sandbox;

/**
 * Outcome of a single command executed inside a {@link Sandbox}.
 *
 * <p>A non-zero {@link #exitCode()} is a normal, expected outcome (the command the LLM asked
 * for simply failed) and is <em>never</em> surfaced as a Java exception — {@link Sandbox#exec}
 * and {@link Sandbox#execWithNetwork} always return an {@code ExecResult}, letting the caller
 * (typically a {@code SandboxToolset} tool method) serialize it back to the model so it can read
 * the failure and correct itself. Only infrastructure failures (Docker unavailable, the
 * container failed to start, a file transfer failed, ...) throw {@link SandboxException}.
 *
 * @param exitCode the process exit code, or {@code -1} when {@link #timedOut()} is {@code true}
 *                 and no real exit code could be observed
 * @param stdout   captured standard output — or as much of it as was captured before a timeout
 * @param stderr   captured standard error — or as much of it as was captured before a timeout
 * @param timedOut {@code true} if the command did not finish within the requested
 *                 {@link java.time.Duration}; when this is {@code true} the sandbox's container
 *                 has been killed as a consequence (see {@link DockerSandbox})
 */
public record ExecResult(int exitCode, String stdout, String stderr, boolean timedOut) {

    public ExecResult {
        stdout = stdout == null ? "" : stdout;
        stderr = stderr == null ? "" : stderr;
    }

    /** {@code true} iff the command completed (no timeout) with exit code {@code 0}. */
    public boolean success() {
        return !timedOut && exitCode == 0;
    }
}
