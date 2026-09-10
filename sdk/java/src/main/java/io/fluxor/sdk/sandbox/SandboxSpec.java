package io.fluxor.sdk.sandbox;

import java.nio.file.Path;
import java.util.Map;
import java.util.Objects;

/**
 * Configuration for a {@link DockerSandbox}, with safe defaults for every field except
 * {@link #workspace()}. Use {@link #forWorkspace(Path)} for the common case, or the canonical
 * constructor to override individual limits.
 *
 * <p>Not customizing anything still yields a sandbox that cannot see the network, cannot exhaust
 * the host, and cannot write outside its workspace:
 * <ul>
 *   <li>{@link #image()} — {@value #DEFAULT_IMAGE}, a Node LTS image. It ships Corepack, so
 *       {@code corepack enable} activates pnpm on demand — see the SDK README's sandbox section
 *       for the web-build use case this exists for.</li>
 *   <li>{@link #memoryBytes()} — {@value #DEFAULT_MEMORY_BYTES} bytes (2 GiB).</li>
 *   <li>{@link #cpus()} — {@value #DEFAULT_CPUS}.</li>
 *   <li>{@link #pidsLimit()} — {@value #DEFAULT_PIDS_LIMIT} (fork-bomb guard).</li>
 *   <li>{@link #user()} — {@value #DEFAULT_USER}, a non-root numeric UID:GID that needs no
 *       {@code /etc/passwd} entry in the image (works even on minimal images with no named
 *       users).</li>
 *   <li>{@link #networkName()} — {@value #DEFAULT_NETWORK}, the Docker network
 *       {@code execWithNetwork} attaches/detaches per call.</li>
 *   <li>{@link #homeDir()} — {@value #DEFAULT_HOME_DIR}, <em>inside</em> the workspace mount so
 *       tools that write to {@code $HOME} (pnpm's store, npm's cache, ...) don't need a writable
 *       root filesystem.</li>
 * </ul>
 *
 * <p>The container's root filesystem is always mounted read-only with a {@code tmpfs} at
 * {@code /tmp}; only the workspace (mounted at {@code /work}) and {@code /tmp} are writable.
 * That is not configurable here — it is the whole point of the sandbox.
 *
 * @param image       Docker image reference to run
 * @param workspace   host directory mounted read-write at {@code /work} inside the container;
 *                    must already exist
 * @param user        {@code docker run --user} value, e.g. {@code "1000:1000"}
 * @param memoryBytes {@code docker run --memory} limit, in bytes
 * @param cpus        {@code docker run --cpus} limit
 * @param pidsLimit   {@code docker run --pids-limit} value
 * @param networkName Docker network attached/detached by {@code execWithNetwork}
 * @param homeDir     value exported as {@code $HOME} inside the container; created before first
 *                    use so tools never see a missing {@code $HOME}
 * @param env         additional environment variables merged into every {@code docker run}
 */
public record SandboxSpec(
    String image,
    Path workspace,
    String user,
    long memoryBytes,
    double cpus,
    int pidsLimit,
    String networkName,
    String homeDir,
    Map<String, String> env
) {

    /** Default image: Node LTS (slim) — ships Corepack for on-demand pnpm/yarn activation. */
    public static final String DEFAULT_IMAGE = "node:22-slim";
    /** Default memory limit: 2 GiB. */
    public static final long DEFAULT_MEMORY_BYTES = 2L * 1024 * 1024 * 1024;
    /** Default CPU limit. */
    public static final double DEFAULT_CPUS = 2.0;
    /** Default {@code --pids-limit} (fork-bomb guard). */
    public static final int DEFAULT_PIDS_LIMIT = 512;
    /** Default non-root user: a bare UID:GID needs no passwd entry in the image. */
    public static final String DEFAULT_USER = "1000:1000";
    /** Default Docker network name used by {@code execWithNetwork}. */
    public static final String DEFAULT_NETWORK = "bridge";
    /** Default {@code $HOME}, inside the workspace mount so it survives a read-only root. */
    public static final String DEFAULT_HOME_DIR = "/work/.sandbox-home";

    /** Fills in every unset/invalid field with its documented default. */
    public SandboxSpec {
        Objects.requireNonNull(workspace, "workspace must not be null");
        if (image == null || image.isBlank()) {
            image = DEFAULT_IMAGE;
        }
        if (user == null || user.isBlank()) {
            user = DEFAULT_USER;
        }
        if (memoryBytes <= 0) {
            memoryBytes = DEFAULT_MEMORY_BYTES;
        }
        if (cpus <= 0) {
            cpus = DEFAULT_CPUS;
        }
        if (pidsLimit <= 0) {
            pidsLimit = DEFAULT_PIDS_LIMIT;
        }
        if (networkName == null || networkName.isBlank()) {
            networkName = DEFAULT_NETWORK;
        }
        if (homeDir == null || homeDir.isBlank()) {
            homeDir = DEFAULT_HOME_DIR;
        }
        env = env == null ? Map.of() : Map.copyOf(env);
    }

    /** A spec for {@code workspace} with every other field defaulted — the common case. */
    public static SandboxSpec forWorkspace(Path workspace) {
        return new SandboxSpec(null, workspace, null, 0, 0, 0, null, null, null);
    }

    /** Like {@link #forWorkspace(Path)}, overriding just the image (tests use a small one). */
    public static SandboxSpec forWorkspace(Path workspace, String image) {
        return new SandboxSpec(image, workspace, null, 0, 0, 0, null, null, null);
    }
}
