package io.fluxor.sdk.sandbox;

import java.time.Duration;
import java.util.List;

/**
 * An isolated execution environment for the system-level tools a flow step invokes (shell
 * commands, dependency installs, file I/O) — the port this SDK uses to keep untrusted or
 * potentially compromised code (corrupted/malicious dependencies, LLM-generated build scripts)
 * from touching the host running the flow.
 *
 * <p>Every {@code Sandbox} is born with <strong>no network access</strong>. {@link #exec} never
 * grants it. The only way a command gets network access is {@link #execWithNetwork}, which
 * attaches the sandbox's network immediately before the command and detaches it immediately
 * after — <em>always</em>, even if the command fails — so network access is a narrow, audited
 * exception rather than a default. A domain allowlist ("only npm's registry, nothing else") is
 * deliberately out of scope for v1: it would need an egress proxy sidecar, and the on/off switch
 * here already satisfies the motivating threat (a corrupted dependency shelling out to
 * exfiltrate data during a build gets no network at all unless that specific step opted in).
 *
 * <p>{@code Sandbox} is {@link AutoCloseable}; {@link #close()} destroys the underlying
 * container. Typical usage:
 *
 * <pre>{@code
 * try (Sandbox sandbox = DockerSandbox.start(SandboxSpec.forWorkspace(workDir))) {
 *     sandbox.putFile("package.json", packageJsonBytes);
 *     ExecResult install = sandbox.execWithNetwork(List.of("pnpm", "install"), Duration.ofMinutes(5));
 *     ExecResult build = sandbox.exec(List.of("pnpm", "run", "build"), Duration.ofMinutes(3));
 * }
 * }</pre>
 *
 * @see DockerSandbox
 * @see SandboxSpec
 * @see SandboxToolset
 */
public interface Sandbox extends AutoCloseable {

    /**
     * Runs {@code cmd} inside the sandbox with no network access, waiting up to {@code timeout}.
     *
     * <p>Never throws for a failing or misbehaving command — a non-zero exit code, non-empty
     * stderr, or a timeout are all reported via the returned {@link ExecResult}. If the command
     * does not finish within {@code timeout}, the sandbox's container is killed (see
     * {@link ExecResult#timedOut()}) and the sandbox is no longer usable for further calls.
     *
     * @param cmd     the command and its arguments, e.g. {@code List.of("pnpm", "run", "build")}
     * @param timeout maximum time to wait before killing the container
     * @return the captured outcome; never {@code null}
     * @throws SandboxException if Docker itself could not be invoked (infrastructure failure)
     */
    ExecResult exec(List<String> cmd, Duration timeout);

    /**
     * Runs {@code cmd} exactly like {@link #exec}, but first attaches the sandbox's network so
     * the command can reach the outside world, and detaches it again once the command finishes —
     * in a {@code finally}, so the network is always torn down, even if {@code cmd} fails, times
     * out, or throws.
     *
     * <p>This is the <em>only</em> path with network access; everything else in this interface
     * runs fully offline. Reserve it for the one step that genuinely needs the network (e.g.
     * installing dependencies) — never for running the dependency's own scripts afterwards.
     *
     * @param cmd     the command and its arguments
     * @param timeout maximum time to wait before killing the container
     * @return the captured outcome; never {@code null}
     * @throws SandboxException if the network could not be attached, or Docker itself could not
     *                          be invoked
     */
    ExecResult execWithNetwork(List<String> cmd, Duration timeout);

    /**
     * Writes {@code content} to {@code path} inside the sandbox's workspace, creating any
     * missing parent directories first.
     *
     * @param path    destination path; resolved against the workspace root ({@code /work}) when
     *                relative, used as-is when it starts with {@code /}
     * @param content bytes to write
     * @throws SandboxException if the transfer fails
     */
    void putFile(String path, byte[] content);

    /**
     * Reads the full contents of {@code path} from inside the sandbox.
     *
     * @param path source path; resolved the same way as {@link #putFile}
     * @return the file's bytes
     * @throws SandboxException if the file does not exist or the transfer fails
     */
    byte[] getFile(String path);

    /** Destroys the underlying container. Safe to call more than once. */
    @Override
    void close();
}
