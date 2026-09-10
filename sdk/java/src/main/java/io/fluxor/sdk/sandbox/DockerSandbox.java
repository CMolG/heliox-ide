package io.fluxor.sdk.sandbox;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * {@link Sandbox} backed by the {@code docker} CLI, invoked via {@link ProcessBuilder} — no
 * Docker client library, matching this SDK's "JDK only" philosophy for its providers.
 *
 * <h2>Lifecycle</h2>
 * {@link #start(SandboxSpec)} runs a container with the resource limits from the spec, sleeping
 * forever ({@code sleep infinity}) so it stays alive between calls; every {@link #exec} /
 * {@link #execWithNetwork} call then runs its command via {@code docker exec} against that same
 * container. {@link #close()} force-removes it.
 *
 * <h2>Why the container isn't created with {@code --network none}</h2>
 * Docker treats {@code none} as a special network mode: a container started with
 * {@code --network none} can never be connected to another network afterwards — {@code docker
 * network connect} is rejected outright ("container cannot be connected to multiple networks
 * with one of the networks in private (none) mode", verified against Docker Engine 29 / Desktop
 * 4.60). Since {@link #execWithNetwork} needs to attach a real network at runtime, the container
 * instead starts attached to {@link SandboxSpec#networkName()} (the ordinary {@code bridge}
 * network by default) and is immediately disconnected from it as the last step of
 * {@link #start}. A container that is merely <em>disconnected</em> from every network is
 * behaviorally identical to one born with {@code --network none} — no route, no DNS, connect
 * attempts fail immediately (verified empirically: {@code NetworkSettings.Networks} is empty and
 * an outbound request fails instantly, same as under {@code --network none}) — but unlike the
 * special mode it can be reconnected, which is exactly what {@link #execWithNetwork} does.
 *
 * <h2>Timeouts kill the container, not just the command</h2>
 * {@code docker exec} has no native timeout. When a command does not finish within the caller's
 * {@link Duration}, this class kills the underlying container ({@code docker kill}, which —
 * combined with {@code --rm} — also removes it). This is a deliberate defense-in-depth choice: a
 * command that runs past its budget is treated as compromised or hung, and the whole sandbox is
 * discarded rather than just the one process. The {@link Sandbox} is no longer usable for
 * further calls after this; callers needing to continue should start a new one.
 */
public final class DockerSandbox implements Sandbox {

    /**
     * Timeout for Docker control-plane operations that aren't the caller's command: container
     * start, network connect/disconnect, {@code docker cp}, {@code docker rm}.
     */
    private static final Duration INFRA_TIMEOUT = Duration.ofSeconds(30);

    private final String containerName;
    private final SandboxSpec spec;
    private final ProcessRunner runner;
    private final AtomicBoolean closed = new AtomicBoolean(false);

    private DockerSandbox(String containerName, SandboxSpec spec, ProcessRunner runner) {
        this.containerName = containerName;
        this.spec = spec;
        this.runner = runner;
    }

    /** Starts a new sandboxed container for {@code spec} using the real {@code docker} CLI. */
    public static DockerSandbox start(SandboxSpec spec) {
        return start(spec, new JdkProcessRunner());
    }

    /**
     * Package-private seam: starts a sandbox against an injected {@link ProcessRunner}. Tests
     * use this to assert the exact commands issued without requiring Docker to be installed.
     */
    static DockerSandbox start(SandboxSpec spec, ProcessRunner runner) {
        Objects.requireNonNull(spec, "spec must not be null");
        Objects.requireNonNull(runner, "runner must not be null");
        if (!Files.isDirectory(spec.workspace())) {
            throw new SandboxException("workspace does not exist or is not a directory: " + spec.workspace());
        }

        String containerName = "fluxor-sandbox-" + UUID.randomUUID();
        DockerSandbox sandbox = new DockerSandbox(containerName, spec, runner);

        ProcessRunner.ProcessOutcome runOutcome = runner.run(buildRunCommand(spec, containerName), INFRA_TIMEOUT);
        if (runOutcome.exitCode() != 0 || runOutcome.timedOut()) {
            throw new SandboxException("failed to start sandbox container: " + runOutcome.stderr());
        }

        // The container starts attached to spec.networkName() (see class javadoc for why) —
        // strip it immediately so the default posture is "no network", same as every other
        // command until execWithNetwork explicitly asks for one.
        ProcessRunner.ProcessOutcome disconnectOutcome = runner.run(
            List.of("docker", "network", "disconnect", spec.networkName(), containerName), INFRA_TIMEOUT);
        if (disconnectOutcome.exitCode() != 0 || disconnectOutcome.timedOut()) {
            sandbox.killContainer();
            throw new SandboxException("failed to isolate sandbox network: " + disconnectOutcome.stderr());
        }

        // Pre-create $HOME inside the (writable) workspace mount so tools never hit a missing
        // directory under a read-only root (pnpm/npm/... write caches there).
        ProcessRunner.ProcessOutcome homeOutcome = sandbox.runInContainer(List.of("mkdir", "-p", spec.homeDir()), INFRA_TIMEOUT);
        if (homeOutcome.exitCode() != 0 || homeOutcome.timedOut()) {
            sandbox.killContainer();
            throw new SandboxException("failed to prepare sandbox HOME: " + homeOutcome.stderr());
        }

        return sandbox;
    }

    @Override
    public ExecResult exec(List<String> cmd, Duration timeout) {
        return toExecResult(runInContainer(cmd, timeout));
    }

    @Override
    public ExecResult execWithNetwork(List<String> cmd, Duration timeout) {
        ProcessRunner.ProcessOutcome connectOutcome = runner.run(
            List.of("docker", "network", "connect", spec.networkName(), containerName), INFRA_TIMEOUT);
        if (connectOutcome.exitCode() != 0 || connectOutcome.timedOut()) {
            throw new SandboxException("failed to attach network for execWithNetwork: " + connectOutcome.stderr());
        }
        try {
            return toExecResult(runInContainer(cmd, timeout));
        } finally {
            // Always detach — even if the command above failed, timed out (which already killed
            // the container; this disconnect will then itself fail against a gone container,
            // which is fine and intentionally swallowed below) or threw.
            try {
                runner.run(List.of("docker", "network", "disconnect", spec.networkName(), containerName), INFRA_TIMEOUT);
            } catch (RuntimeException ignored) {
                // Best-effort: a disconnect failure must never mask the real outcome/exception.
            }
        }
    }

    @Override
    public void putFile(String path, byte[] content) {
        String resolved = resolvePath(path);
        String parent = parentOf(resolved);
        ProcessRunner.ProcessOutcome mkdirOutcome = runInContainer(List.of("mkdir", "-p", parent), INFRA_TIMEOUT);
        if (mkdirOutcome.exitCode() != 0 || mkdirOutcome.timedOut()) {
            throw new SandboxException("failed to create parent directory " + parent + ": " + mkdirOutcome.stderr());
        }

        Path staging;
        try {
            staging = Files.createTempFile("fluxor-sandbox-put-", ".tmp");
            Files.write(staging, content);
        } catch (IOException e) {
            throw new SandboxException("failed to stage file for putFile: " + path, e);
        }
        try {
            ProcessRunner.ProcessOutcome cpOutcome = runner.run(
                List.of("docker", "cp", staging.toString(), containerName + ":" + resolved), INFRA_TIMEOUT);
            if (cpOutcome.exitCode() != 0 || cpOutcome.timedOut()) {
                throw new SandboxException("docker cp into sandbox failed for " + path + ": " + cpOutcome.stderr());
            }
        } finally {
            deleteQuietly(staging);
        }
    }

    @Override
    public byte[] getFile(String path) {
        String resolved = resolvePath(path);
        Path staging;
        try {
            staging = Files.createTempFile("fluxor-sandbox-get-", ".tmp");
        } catch (IOException e) {
            throw new SandboxException("failed to stage local file for getFile: " + path, e);
        }
        try {
            ProcessRunner.ProcessOutcome cpOutcome = runner.run(
                List.of("docker", "cp", containerName + ":" + resolved, staging.toString()), INFRA_TIMEOUT);
            if (cpOutcome.exitCode() != 0 || cpOutcome.timedOut()) {
                throw new SandboxException("docker cp from sandbox failed for " + path + ": " + cpOutcome.stderr());
            }
            return Files.readAllBytes(staging);
        } catch (IOException e) {
            throw new SandboxException("failed to read staged file for getFile: " + path, e);
        } finally {
            deleteQuietly(staging);
        }
    }

    @Override
    public void close() {
        if (closed.compareAndSet(false, true)) {
            try {
                runner.run(List.of("docker", "rm", "-f", containerName), INFRA_TIMEOUT);
            } catch (RuntimeException ignored) {
                // Best-effort: Sandbox#close() narrows AutoCloseable's throws to none — it must not throw.
            }
        }
    }

    /** Test-only accessor: lets DockerSandboxTest assert the generated container name shape. */
    String containerName() {
        return containerName;
    }

    // -------------------------------------------------------------------------
    // Internals
    // -------------------------------------------------------------------------

    private ProcessRunner.ProcessOutcome runInContainer(List<String> cmd, Duration timeout) {
        List<String> full = new ArrayList<>(cmd.size() + 3);
        full.add("docker");
        full.add("exec");
        full.add(containerName);
        full.addAll(cmd);
        ProcessRunner.ProcessOutcome outcome = runner.run(full, timeout);
        if (outcome.timedOut()) {
            killContainer();
        }
        return outcome;
    }

    private void killContainer() {
        try {
            runner.run(List.of("docker", "kill", containerName), INFRA_TIMEOUT);
        } catch (RuntimeException ignored) {
            // Best-effort: the container may already be gone.
        }
    }

    private static ExecResult toExecResult(ProcessRunner.ProcessOutcome outcome) {
        return new ExecResult(outcome.exitCode(), outcome.stdout(), outcome.stderr(), outcome.timedOut());
    }

    private String resolvePath(String path) {
        return path.startsWith("/") ? path : "/work/" + path;
    }

    private static String parentOf(String absolutePath) {
        int slash = absolutePath.lastIndexOf('/');
        return slash <= 0 ? "/" : absolutePath.substring(0, slash);
    }

    private static void deleteQuietly(Path path) {
        try {
            Files.deleteIfExists(path);
        } catch (IOException ignored) {
            // Best-effort scratch-file cleanup.
        }
    }

    /** Builds the {@code docker run} argv for {@code spec}. Package-private so tests can assert flags directly. */
    static List<String> buildRunCommand(SandboxSpec spec, String containerName) {
        List<String> cmd = new ArrayList<>();
        cmd.add("docker");
        cmd.add("run");
        cmd.add("-d");
        cmd.add("--rm");
        cmd.add("--name");
        cmd.add(containerName);
        cmd.add("--network");
        cmd.add(spec.networkName());
        cmd.add("--memory");
        cmd.add(Long.toString(spec.memoryBytes()));
        cmd.add("--cpus");
        cmd.add(String.valueOf(spec.cpus()));
        cmd.add("--pids-limit");
        cmd.add(Integer.toString(spec.pidsLimit()));
        cmd.add("--read-only");
        cmd.add("--tmpfs");
        cmd.add("/tmp");
        cmd.add("-v");
        cmd.add(spec.workspace().toAbsolutePath() + ":/work:rw");
        cmd.add("-w");
        cmd.add("/work");
        cmd.add("--user");
        cmd.add(spec.user());
        cmd.add("-e");
        cmd.add("HOME=" + spec.homeDir());
        for (Map.Entry<String, String> entry : spec.env().entrySet()) {
            cmd.add("-e");
            cmd.add(entry.getKey() + "=" + entry.getValue());
        }
        cmd.add(spec.image());
        cmd.add("sleep");
        cmd.add("infinity");
        return cmd;
    }

    // -------------------------------------------------------------------------
    // Process execution seam (injected in tests to avoid requiring Docker)
    // -------------------------------------------------------------------------

    /** Runs an OS-level command and captures its outcome. Real impl: {@link JdkProcessRunner}; fakeable in tests. */
    interface ProcessRunner {

        ProcessOutcome run(List<String> command, Duration timeout);

        record ProcessOutcome(int exitCode, String stdout, String stderr, boolean timedOut) {
            public ProcessOutcome {
                stdout = stdout == null ? "" : stdout;
                stderr = stderr == null ? "" : stderr;
            }
        }
    }

    /** Real {@link ProcessRunner}: shells out via {@link ProcessBuilder}. No Docker client library. */
    static final class JdkProcessRunner implements ProcessRunner {

        @Override
        public ProcessOutcome run(List<String> command, Duration timeout) {
            Process process;
            try {
                process = new ProcessBuilder(command).start();
            } catch (IOException e) {
                throw new SandboxException("failed to launch process: " + command, e);
            }

            // Drain both streams concurrently so a chatty command can't deadlock on a full pipe
            // buffer while the calling thread waits on it.
            CompletableFuture<String> stdout = CompletableFuture.supplyAsync(() -> readAll(process.getInputStream()));
            CompletableFuture<String> stderr = CompletableFuture.supplyAsync(() -> readAll(process.getErrorStream()));

            boolean finished;
            try {
                finished = process.waitFor(timeout.toMillis(), TimeUnit.MILLISECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new SandboxException("interrupted while waiting for process: " + command, e);
            }

            if (!finished) {
                process.destroyForcibly();
                return new ProcessOutcome(-1, stdout.join(), stderr.join(), true);
            }
            return new ProcessOutcome(process.exitValue(), stdout.join(), stderr.join(), false);
        }

        private static String readAll(InputStream in) {
            try (ByteArrayOutputStream buffer = new ByteArrayOutputStream()) {
                in.transferTo(buffer);
                return buffer.toString(StandardCharsets.UTF_8);
            } catch (IOException e) {
                return "";
            }
        }
    }
}
