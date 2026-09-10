package io.fluxor.sdk.sandbox;

/**
 * Thrown for {@link Sandbox} infrastructure failures — the {@code docker} CLI could not be
 * invoked, a container failed to start or be isolated from the network, or a
 * {@link Sandbox#putFile}/{@link Sandbox#getFile} transfer failed.
 *
 * <p>Never thrown for a command that ran <em>inside</em> the sandbox and failed: that is a
 * normal, expected outcome captured by a non-zero {@link ExecResult#exitCode()}, not an
 * infrastructure error. This distinction matters to callers — infrastructure failures mean the
 * sandbox itself is broken and should be discarded; a non-zero {@code ExecResult} just means the
 * command the model asked for didn't work, and the model should see why.
 */
public final class SandboxException extends RuntimeException {

    public SandboxException(String message) {
        super(message);
    }

    public SandboxException(String message, Throwable cause) {
        super(message, cause);
    }
}
