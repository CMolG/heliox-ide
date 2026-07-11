package io.fluxor.sdk.sandbox;

import io.fluxor.sdk.schema.Schema;
import io.fluxor.sdk.tool.FluxorTool;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Objects;

/**
 * Exposes an active {@link Sandbox} as {@link FluxorTool}-annotated methods a step can register
 * so the model drives all of its system-level work — shell commands, dependency installs, file
 * I/O — confined to the container instead of the host running the flow.
 *
 * <pre>{@code
 * try (Sandbox sandbox = DockerSandbox.start(SandboxSpec.forWorkspace(workDir))) {
 *     FluxorRuntime runtime = FluxorRuntime.builder()
 *         .llmProvider(provider)
 *         .registerTool(new SandboxToolset(sandbox))
 *         .build();
 *     runtime.flow("build-site").executeAsync().join();
 * }
 * }</pre>
 *
 * <h2>Network</h2>
 * Every tool here runs fully offline (plain {@link Sandbox#exec}) except
 * {@link #installDeps}, the one tool wired to {@link Sandbox#execWithNetwork}. This mirrors the
 * SDK-level default: network access is the narrow exception, not the norm, and it is scoped to
 * exactly the step that needs it (installing dependencies), never to the dependency's own
 * scripts or to arbitrary commands.
 *
 * <h2>Errors never throw across the tool boundary</h2>
 * A failing command is ordinary data, not an exception: {@link #runCommand} and
 * {@link #installDeps} return the sandbox's {@link ExecResult} as-is (a non-zero
 * {@code exitCode} and {@code stderr} are right there in the JSON the model sees), and
 * {@link #writeFile}/{@link #readFile} catch {@link SandboxException} (e.g. "no such file" — an
 * everyday condition while a model is exploring or hasn't created a file yet) and fold it into
 * their result's {@code error} field instead of failing the tool call. This lets the model read
 * what went wrong and correct itself on the next turn, per {@link io.fluxor.sdk.tool.ToolRegistry}'s
 * retry-friendly design.
 *
 * <h2>Why the optional parameters aren't {@code Optional<T>}</h2>
 * {@link io.fluxor.sdk.schema.SchemaExtractor} special-cases {@code Optional<T>} parameters when
 * <em>advertising</em> a tool's schema (they're left out of {@code required}), but
 * {@link io.fluxor.sdk.tool.ToolRegistry}'s argument binding goes through the shared Jackson
 * {@code ObjectMapper}, which does not have {@code jackson-datatype-jdk8} registered — so a
 * supplied (non-absent) {@code Optional<T>} argument fails to bind at invocation time (verified:
 * {@code IllegalArgumentException: Java 8 optional type ... not supported by default}). Adding
 * that module would be a new dependency for the whole SDK, and fixing the binder is a
 * cross-cutting change outside this package — both out of scope here. {@code timeoutSeconds},
 * {@code path} (on {@link #listFiles}) and {@code recursive} instead use plain nullable boxed
 * types: Jackson binds those natively whether the key is present or absent, at the cost of
 * {@code SchemaExtractor} listing them as {@code required} even though {@code null} is accepted
 * and documented as such in each parameter's description.
 */
public final class SandboxToolset {

    private static final Duration DEFAULT_EXEC_TIMEOUT = Duration.ofSeconds(120);
    private static final Duration DEFAULT_INSTALL_TIMEOUT = Duration.ofMinutes(5);

    private final Sandbox sandbox;

    public SandboxToolset(Sandbox sandbox) {
        this.sandbox = Objects.requireNonNull(sandbox, "sandbox must not be null");
    }

    @FluxorTool(
        name = "run_command",
        description = "Ejecuta un comando dentro del sandbox aislado, SIN acceso a red (--network none). "
            + "Usa install_deps si el comando necesita red (p. ej. instalar dependencias). "
            + "El resultado incluye exitCode/stdout/stderr/timedOut: un exitCode distinto de 0 es un fallo "
            + "normal del comando, no un error de la herramienta — léelo y corrige."
    )
    public ExecResult runCommand(
        @Schema(description = "Comando y argumentos como lista, p. ej. [\"pnpm\",\"run\",\"build\"]. "
            + "No pasa por una shell: sin globbing, pipes ni redirecciones.")
        List<String> command,
        @Schema(description = "Tiempo máximo en segundos antes de matar el sandbox entero. "
            + "Pasa null para usar el valor por defecto (120).")
        Long timeoutSeconds
    ) {
        return sandbox.exec(command, timeoutOf(timeoutSeconds, DEFAULT_EXEC_TIMEOUT));
    }

    @FluxorTool(
        name = "install_deps",
        description = "Instala dependencias con acceso a red TEMPORAL (única tool de este conjunto con red; "
            + "se conecta antes del comando y se desconecta siempre después, incluso si falla). "
            + "Ej.: [\"pnpm\",\"install\"] o [\"npm\",\"ci\"]. Para ejecutar el build ya instalado usa run_command."
    )
    public ExecResult installDeps(
        @Schema(description = "Comando de instalación como lista, p. ej. [\"pnpm\",\"install\"].")
        List<String> command,
        @Schema(description = "Tiempo máximo en segundos. Pasa null para usar el valor por defecto "
            + "(300 — instalar tarda más que compilar).")
        Long timeoutSeconds
    ) {
        return sandbox.execWithNetwork(command, timeoutOf(timeoutSeconds, DEFAULT_INSTALL_TIMEOUT));
    }

    @FluxorTool(
        name = "write_file",
        description = "Escribe (o sobrescribe) un fichero de texto dentro del workspace del sandbox, "
            + "creando los directorios padre que hagan falta."
    )
    public WriteFileResult writeFile(
        @Schema(description = "Ruta destino, relativa al workspace (o absoluta si empieza por /).")
        String path,
        @Schema(description = "Contenido de texto a escribir, codificado en UTF-8.")
        String content
    ) {
        try {
            sandbox.putFile(path, content.getBytes(StandardCharsets.UTF_8));
            return new WriteFileResult(true, path, null);
        } catch (SandboxException e) {
            return new WriteFileResult(false, path, e.getMessage());
        }
    }

    @FluxorTool(
        name = "read_file",
        description = "Lee el contenido de texto de un fichero dentro del workspace del sandbox. "
            + "Si el fichero no existe, ok=false y error lo explica — no es una excepción."
    )
    public ReadFileResult readFile(
        @Schema(description = "Ruta a leer, relativa al workspace (o absoluta si empieza por /).")
        String path
    ) {
        try {
            byte[] bytes = sandbox.getFile(path);
            return new ReadFileResult(true, path, new String(bytes, StandardCharsets.UTF_8), null);
        } catch (SandboxException e) {
            return new ReadFileResult(false, path, null, e.getMessage());
        }
    }

    @FluxorTool(
        name = "list_files",
        description = "Lista ficheros y directorios dentro de una ruta del workspace del sandbox."
    )
    public ExecResult listFiles(
        @Schema(description = "Directorio a listar, relativo al workspace. Pasa null (o \"\") para la raíz del workspace.")
        String path,
        @Schema(description = "Si es true, lista recursivamente (equivalente a find). Pasa null para el "
            + "valor por defecto (false — un nivel, como ls).")
        Boolean recursive
    ) {
        String target = (path == null || path.isBlank()) ? "." : path;
        List<String> command = Boolean.TRUE.equals(recursive)
            ? List.of("find", target)
            : List.of("ls", "-1a", target);
        return sandbox.exec(command, DEFAULT_EXEC_TIMEOUT);
    }

    private static Duration timeoutOf(Long seconds, Duration fallback) {
        return seconds == null ? fallback : Duration.ofSeconds(seconds);
    }

    /** Result of {@link #writeFile}. {@code error} is {@code null} iff {@code ok} is {@code true}. */
    public record WriteFileResult(boolean ok, String path, String error) {
    }

    /** Result of {@link #readFile}. {@code content}/{@code error} are mutually exclusive with {@code ok}. */
    public record ReadFileResult(boolean ok, String path, String content, String error) {
    }
}
