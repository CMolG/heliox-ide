package io.fluxor.sdk.tool;

import io.fluxor.sdk.schema.SchemaExtractor;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Verifies the thread-isolation guarantees introduced by the dedicated tool executor in
 * {@link ToolRegistry}:
 *
 * <ol>
 *   <li>Tool invocations run on the {@code fluxor-tool-N} pool, <em>not</em> on the
 *       calling thread.</li>
 *   <li>Tools that return a {@link CompletableFuture} still resolve correctly when composed
 *       through the executor.</li>
 *   <li>A tool method that throws propagates as the root cause of the failed future
 *       (unchanged error semantics).</li>
 * </ol>
 */
class ToolExecutorIsolationTest {

    /** Holder for tools that record or manipulate the executing thread. */
    static final class ThreadAwareTool {

        private final AtomicReference<String> capturedThreadName = new AtomicReference<>();

        /**
         * Records the name of the thread that executes the tool method and returns a
         * deterministic result so callers can verify the future also resolves correctly.
         */
        @FluxorTool(name = "capture_thread", description = "Captura el nombre del hilo de ejecución")
        public String captureThread(String input) {
            capturedThreadName.set(Thread.currentThread().getName());
            return "processed:" + input;
        }

        String capturedThreadName() {
            return capturedThreadName.get();
        }
    }

    /** Tool whose method returns a {@link CompletableFuture} (async tool). */
    static final class AsyncTool {

        @FluxorTool(name = "async_echo", description = "Devuelve la entrada de forma asíncrona")
        public CompletableFuture<String> asyncEcho(String value) {
            // Simulate async work completed on a different thread.
            return CompletableFuture.supplyAsync(() -> "async:" + value);
        }
    }

    /** Tool whose method always throws. */
    static final class ThrowingTool {

        @FluxorTool(name = "boom", description = "Siempre lanza una excepción")
        public String boom(String ignored) {
            throw new IllegalStateException("intentional-failure");
        }
    }

    private ToolRegistry registry;

    @AfterEach
    void tearDown() {
        if (registry != null) {
            registry.shutdown();
            registry = null;
        }
    }

    // -------------------------------------------------------------------------
    // Test 1 — thread isolation
    // -------------------------------------------------------------------------

    /**
     * Confirms that the reflective invocation occurs on a thread whose name starts with
     * {@code fluxor-tool}, proving that tool execution was offloaded onto the dedicated
     * pool rather than running on the calling (test main) thread.
     */
    @Test
    void toolRunsOnDedicatedFluxorToolThread() throws Exception {
        ThreadAwareTool tool = new ThreadAwareTool();
        registry = new ToolRegistry().register(tool);

        String callerThreadName = Thread.currentThread().getName();
        String result = registry.invoke("capture_thread", "{\"input\":\"hello\"}").get();

        String toolThreadName = tool.capturedThreadName();

        // The result must be the expected value.
        assertEquals("processed:hello", result);

        // The tool must NOT have run on the calling thread.
        assertNotEquals(callerThreadName, toolThreadName,
            "Tool should not run on the calling thread");

        // The tool must have run on the dedicated fluxor pool.
        assertTrue(toolThreadName.startsWith("fluxor-tool"),
            "Expected thread name to start with 'fluxor-tool' but was: " + toolThreadName);
    }

    // -------------------------------------------------------------------------
    // Test 2 — async tool (returns CompletableFuture) resolves correctly
    // -------------------------------------------------------------------------

    /**
     * Verifies that a tool method returning a {@link CompletableFuture} is properly composed
     * and the final future resolves with the correct serialized value.
     */
    @Test
    void asyncToolResolvesThroughExecutor() throws Exception {
        registry = new ToolRegistry().register(new AsyncTool());

        String result = registry.invoke("async_echo", "{\"value\":\"world\"}").get();

        assertEquals("async:world", result);
    }

    // -------------------------------------------------------------------------
    // Test 3 — error path: tool exception propagates as root cause
    // -------------------------------------------------------------------------

    /**
     * Confirms that when a tool method throws, the returned future completes exceptionally
     * with the original exception as the root cause (not wrapped in extra runtime exceptions).
     */
    @Test
    void throwingToolPropagatesRootCause() {
        registry = new ToolRegistry().register(new ThrowingTool());

        ExecutionException executionException = assertThrows(
            ExecutionException.class,
            () -> registry.invoke("boom", "{\"ignored\":\"x\"}").get()
        );

        Throwable cause = executionException.getCause();
        assertInstanceOf(IllegalStateException.class, cause,
            "Root cause should be the IllegalStateException thrown by the tool");
        assertEquals("intentional-failure", cause.getMessage());
    }

    // -------------------------------------------------------------------------
    // Test 4 — injected executor is not shut down by the registry
    // -------------------------------------------------------------------------

    /**
     * When a custom {@link ExecutorService} is injected, the registry must not shut it down
     * when {@link ToolRegistry#shutdown()} is called — the caller retains ownership.
     */
    @Test
    void injectedExecutorIsNotShutDownByRegistry() throws Exception {
        ExecutorService external = Executors.newSingleThreadExecutor();
        try {
            ToolRegistry localRegistry = new ToolRegistry(new SchemaExtractor(), external);
            localRegistry.register(new ThreadAwareTool());

            // Invoke once to confirm it works.
            String result = localRegistry.invoke("capture_thread", "{\"input\":\"test\"}").get();
            assertEquals("processed:test", result);

            // Shutdown the registry — must NOT shut down the external executor.
            localRegistry.shutdown();

            // The external executor must still be usable (submit a task and get a result).
            CompletableFuture<String> probe = CompletableFuture.supplyAsync(
                () -> "still-alive", external);
            assertEquals("still-alive", probe.get());
        } finally {
            external.shutdown();
        }
    }
}
