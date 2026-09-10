package io.fluxor.sdk.sandbox;

import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Duration;
import java.util.AbstractMap;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.function.Predicate;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Unit tests run against a {@link FakeProcessRunner} (no Docker required) and assert the exact
 * commands {@link DockerSandbox} issues, in order. {@link RealDockerTests} exercises the same
 * class against the real {@code docker} CLI and is skipped when Docker isn't available.
 */
class DockerSandboxTest {

    @TempDir
    Path workspace;

    // -------------------------------------------------------------------------
    // docker run command construction
    // -------------------------------------------------------------------------

    @Test
    void buildRunCommandIncludesAllSafetyFlags() {
        SandboxSpec spec = SandboxSpec.forWorkspace(workspace);
        List<String> cmd = DockerSandbox.buildRunCommand(spec, "test-container");

        assertEquals("docker", cmd.get(0));
        assertEquals("run", cmd.get(1));
        assertHasFlag(cmd, "-d");
        assertHasFlag(cmd, "--rm");
        assertFlagValue(cmd, "--name", "test-container");
        assertFlagValue(cmd, "--network", SandboxSpec.DEFAULT_NETWORK);
        assertFlagValue(cmd, "--memory", String.valueOf(SandboxSpec.DEFAULT_MEMORY_BYTES));
        assertFlagValue(cmd, "--cpus", String.valueOf(SandboxSpec.DEFAULT_CPUS));
        assertFlagValue(cmd, "--pids-limit", String.valueOf(SandboxSpec.DEFAULT_PIDS_LIMIT));
        assertHasFlag(cmd, "--read-only");
        assertFlagValue(cmd, "--tmpfs", "/tmp");
        assertFlagValue(cmd, "-v", workspace.toAbsolutePath() + ":/work:rw");
        assertFlagValue(cmd, "-w", "/work");
        assertFlagValue(cmd, "--user", SandboxSpec.DEFAULT_USER);
        assertTrue(cmd.contains("HOME=" + SandboxSpec.DEFAULT_HOME_DIR));
        assertEquals(SandboxSpec.DEFAULT_IMAGE, cmd.get(cmd.size() - 3));
        assertEquals("sleep", cmd.get(cmd.size() - 2));
        assertEquals("infinity", cmd.get(cmd.size() - 1));
    }

    @Test
    void buildRunCommandMergesCustomEnvVars() {
        SandboxSpec spec = new SandboxSpec(null, workspace, null, 0, 0, 0, null, null, Map.of("FOO", "bar"));
        List<String> cmd = DockerSandbox.buildRunCommand(spec, "c");

        int idx = cmd.indexOf("FOO=bar");
        assertTrue(idx > 0, () -> "expected FOO=bar in " + cmd);
        assertEquals("-e", cmd.get(idx - 1));
    }

    // -------------------------------------------------------------------------
    // start() sequencing and failure handling
    // -------------------------------------------------------------------------

    @Test
    void startRunsThenIsolatesNetworkThenPreparesHome() {
        FakeProcessRunner fake = new FakeProcessRunner();
        try (DockerSandbox sandbox = DockerSandbox.start(SandboxSpec.forWorkspace(workspace), fake)) {
            assertEquals(3, fake.invocations.size());

            List<String> run = fake.invocations.get(0);
            assertEquals("run", run.get(1));
            assertTrue(run.contains(sandbox.containerName()));

            assertEquals(
                List.of("docker", "network", "disconnect", "bridge", sandbox.containerName()),
                fake.invocations.get(1));

            assertEquals(
                List.of("docker", "exec", sandbox.containerName(), "mkdir", "-p", SandboxSpec.DEFAULT_HOME_DIR),
                fake.invocations.get(2));
        }
    }

    @Test
    void startFailsWhenWorkspaceMissing() {
        Path missing = workspace.resolve("does-not-exist");
        FakeProcessRunner fake = new FakeProcessRunner();

        SandboxException ex = assertThrows(SandboxException.class,
            () -> DockerSandbox.start(SandboxSpec.forWorkspace(missing), fake));

        assertTrue(ex.getMessage().contains("workspace"));
        assertTrue(fake.invocations.isEmpty(), "must not shell out before validating the workspace");
    }

    @Test
    void startThrowsAndKillsContainerWhenDockerRunFails() {
        FakeProcessRunner fake = new FakeProcessRunner()
            .whenReturn(cmd -> cmd.contains("run"), failure("image not found"));

        assertThrows(SandboxException.class, () -> DockerSandbox.start(SandboxSpec.forWorkspace(workspace), fake));

        // Nothing to kill: the container never started.
        assertEquals(1, fake.invocations.size());
    }

    @Test
    void startThrowsAndKillsContainerWhenNetworkDisconnectFails() {
        FakeProcessRunner fake = new FakeProcessRunner()
            .whenReturn(cmd -> cmd.contains("disconnect"), failure("no such network"));

        assertThrows(SandboxException.class, () -> DockerSandbox.start(SandboxSpec.forWorkspace(workspace), fake));

        // run, disconnect (fails), kill
        assertEquals(3, fake.invocations.size());
        assertEquals("kill", fake.invocations.get(2).get(1));
    }

    @Test
    void startThrowsAndKillsContainerWhenHomePrepFails() {
        FakeProcessRunner fake = new FakeProcessRunner()
            .whenReturn(cmd -> cmd.contains("mkdir"), failure("permission denied"));

        assertThrows(SandboxException.class, () -> DockerSandbox.start(SandboxSpec.forWorkspace(workspace), fake));

        // run, disconnect, mkdir (fails), kill
        assertEquals(4, fake.invocations.size());
        assertEquals("kill", fake.invocations.get(3).get(1));
    }

    // -------------------------------------------------------------------------
    // exec()
    // -------------------------------------------------------------------------

    @Test
    void execRunsDockerExecAndReturnsResult() {
        FakeProcessRunner fake = new FakeProcessRunner()
            .whenReturn(cmd -> cmd.contains("echo"), success("hi\n"));

        try (DockerSandbox sandbox = DockerSandbox.start(SandboxSpec.forWorkspace(workspace), fake)) {
            ExecResult result = sandbox.exec(List.of("echo", "hi"), Duration.ofSeconds(5));

            assertTrue(result.success());
            assertEquals("hi\n", result.stdout());
            assertEquals(
                List.of("docker", "exec", sandbox.containerName(), "echo", "hi"),
                fake.lastInvocation());
        }
    }

    @Test
    void execFailureIsReturnedNotThrown() {
        FakeProcessRunner fake = new FakeProcessRunner()
            .whenReturn(cmd -> cmd.contains("false"), failure("boom"));

        try (DockerSandbox sandbox = DockerSandbox.start(SandboxSpec.forWorkspace(workspace), fake)) {
            ExecResult result = sandbox.exec(List.of("false"), Duration.ofSeconds(5));

            assertFalse(result.success());
            assertEquals(1, result.exitCode());
            assertEquals("boom", result.stderr());
        }
    }

    @Test
    void execTimeoutKillsContainer() {
        FakeProcessRunner fake = new FakeProcessRunner()
            .whenReturn(cmd -> cmd.contains("sleep") && cmd.contains("100"),
                new DockerSandbox.ProcessRunner.ProcessOutcome(-1, "", "", true));

        try (DockerSandbox sandbox = DockerSandbox.start(SandboxSpec.forWorkspace(workspace), fake)) {
            ExecResult result = sandbox.exec(List.of("sleep", "100"), Duration.ofMillis(50));

            assertTrue(result.timedOut());
            assertEquals(List.of("docker", "kill", sandbox.containerName()), fake.lastInvocation());
        }
    }

    // -------------------------------------------------------------------------
    // execWithNetwork(): connect -> cmd -> disconnect, always, in that order
    // -------------------------------------------------------------------------

    @Test
    void execWithNetworkConnectsThenExecsThenDisconnects() {
        FakeProcessRunner fake = new FakeProcessRunner();

        try (DockerSandbox sandbox = DockerSandbox.start(SandboxSpec.forWorkspace(workspace), fake)) {
            int before = fake.invocations.size();
            ExecResult result = sandbox.execWithNetwork(List.of("pnpm", "install"), Duration.ofSeconds(5));

            assertTrue(result.success());
            List<List<String>> calls = fake.invocations.subList(before, fake.invocations.size());
            assertEquals(3, calls.size());
            assertEquals(List.of("docker", "network", "connect", "bridge", sandbox.containerName()), calls.get(0));
            assertEquals(List.of("docker", "exec", sandbox.containerName(), "pnpm", "install"), calls.get(1));
            assertEquals(List.of("docker", "network", "disconnect", "bridge", sandbox.containerName()), calls.get(2));
        }
    }

    @Test
    void execWithNetworkDisconnectsEvenWhenCommandFails() {
        FakeProcessRunner fake = new FakeProcessRunner()
            .whenReturn(cmd -> cmd.contains("exec") && cmd.contains("boom"), failure("command failed"));

        try (DockerSandbox sandbox = DockerSandbox.start(SandboxSpec.forWorkspace(workspace), fake)) {
            int before = fake.invocations.size();
            ExecResult result = sandbox.execWithNetwork(List.of("boom"), Duration.ofSeconds(5));

            assertFalse(result.success());
            List<List<String>> calls = fake.invocations.subList(before, fake.invocations.size());
            assertEquals(3, calls.size(), "connect, exec, disconnect must all run even on command failure");
            assertEquals("connect", calls.get(0).get(2));
            assertEquals("disconnect", calls.get(2).get(2));
        }
    }

    @Test
    void execWithNetworkDisconnectsEvenWhenCommandThrows() {
        FakeProcessRunner fake = new FakeProcessRunner()
            .whenThrow(cmd -> cmd.contains("exec") && cmd.contains("boom"),
                new SandboxException("docker binary vanished mid-run"));

        try (DockerSandbox sandbox = DockerSandbox.start(SandboxSpec.forWorkspace(workspace), fake)) {
            int before = fake.invocations.size();

            SandboxException ex = assertThrows(SandboxException.class,
                () -> sandbox.execWithNetwork(List.of("boom"), Duration.ofSeconds(5)));
            assertEquals("docker binary vanished mid-run", ex.getMessage());

            List<List<String>> calls = fake.invocations.subList(before, fake.invocations.size());
            assertEquals(3, calls.size(), "the finally block must still run the disconnect after an exception");
            assertEquals("connect", calls.get(0).get(2));
            assertEquals("disconnect", calls.get(2).get(2));
        }
    }

    @Test
    void execWithNetworkAbortsWithoutRunningCommandWhenConnectFails() {
        FakeProcessRunner fake = new FakeProcessRunner()
            .whenReturn(cmd -> cmd.contains("connect"), failure("network not found"));

        try (DockerSandbox sandbox = DockerSandbox.start(SandboxSpec.forWorkspace(workspace), fake)) {
            int before = fake.invocations.size();

            assertThrows(SandboxException.class,
                () -> sandbox.execWithNetwork(List.of("pnpm", "install"), Duration.ofSeconds(5)));

            List<List<String>> calls = fake.invocations.subList(before, fake.invocations.size());
            assertEquals(1, calls.size(), "must not run the command or attempt a disconnect when connect itself failed");
            assertEquals("connect", calls.get(0).get(2));
        }
    }

    // -------------------------------------------------------------------------
    // putFile() / getFile()
    // -------------------------------------------------------------------------

    @Test
    void putFileCreatesParentDirThenCopiesStagedFile() {
        FakeProcessRunner fake = new FakeProcessRunner();

        try (DockerSandbox sandbox = DockerSandbox.start(SandboxSpec.forWorkspace(workspace), fake)) {
            int before = fake.invocations.size();
            sandbox.putFile("src/lib/util.js", "console.log(1)".getBytes(StandardCharsets.UTF_8));

            List<List<String>> calls = fake.invocations.subList(before, fake.invocations.size());
            assertEquals(2, calls.size());
            assertEquals(
                List.of("docker", "exec", sandbox.containerName(), "mkdir", "-p", "/work/src/lib"),
                calls.get(0));

            List<String> cp = calls.get(1);
            assertEquals(List.of("docker", "cp"), cp.subList(0, 2));
            assertEquals(sandbox.containerName() + ":/work/src/lib/util.js", cp.get(3));
        }
    }

    @Test
    void putFileUsesAbsolutePathAsIs() {
        FakeProcessRunner fake = new FakeProcessRunner();

        try (DockerSandbox sandbox = DockerSandbox.start(SandboxSpec.forWorkspace(workspace), fake)) {
            int before = fake.invocations.size();
            sandbox.putFile("/etc/custom.conf", "x".getBytes(StandardCharsets.UTF_8));

            List<List<String>> calls = fake.invocations.subList(before, fake.invocations.size());
            assertEquals(List.of("docker", "exec", sandbox.containerName(), "mkdir", "-p", "/etc"), calls.get(0));
            assertEquals(sandbox.containerName() + ":/etc/custom.conf", calls.get(1).get(3));
        }
    }

    @Test
    void putFileThrowsWhenCopyFails() {
        FakeProcessRunner fake = new FakeProcessRunner()
            .whenReturn(cmd -> cmd.contains("cp"), failure("no space left on device"));

        try (DockerSandbox sandbox = DockerSandbox.start(SandboxSpec.forWorkspace(workspace), fake)) {
            assertThrows(SandboxException.class,
                () -> sandbox.putFile("a.txt", "x".getBytes(StandardCharsets.UTF_8)));
        }
    }

    @Test
    void getFileCopiesFromContainerAndReturnsBytes() {
        FakeProcessRunner fake = new FakeProcessRunner();

        try (DockerSandbox sandbox = DockerSandbox.start(SandboxSpec.forWorkspace(workspace), fake)) {
            int before = fake.invocations.size();
            byte[] result = sandbox.getFile("dist/out.txt");

            assertNotNull(result);
            List<List<String>> calls = fake.invocations.subList(before, fake.invocations.size());
            assertEquals(1, calls.size());
            List<String> cp = calls.get(0);
            assertEquals(List.of("docker", "cp"), cp.subList(0, 2));
            assertEquals(sandbox.containerName() + ":/work/dist/out.txt", cp.get(2));
        }
    }

    @Test
    void getFileThrowsWhenCopyFails() {
        FakeProcessRunner fake = new FakeProcessRunner()
            .whenReturn(cmd -> cmd.contains("cp"), failure("no such file or directory"));

        try (DockerSandbox sandbox = DockerSandbox.start(SandboxSpec.forWorkspace(workspace), fake)) {
            assertThrows(SandboxException.class, () -> sandbox.getFile("missing.txt"));
        }
    }

    // -------------------------------------------------------------------------
    // close()
    // -------------------------------------------------------------------------

    @Test
    void closeRemovesContainerAndIsIdempotent() {
        FakeProcessRunner fake = new FakeProcessRunner();
        DockerSandbox sandbox = DockerSandbox.start(SandboxSpec.forWorkspace(workspace), fake);

        int before = fake.invocations.size();
        sandbox.close();
        sandbox.close();

        List<List<String>> calls = fake.invocations.subList(before, fake.invocations.size());
        assertEquals(1, calls.size(), "close() must be idempotent: only one docker rm -f");
        assertEquals(List.of("docker", "rm", "-f", sandbox.containerName()), calls.get(0));
    }

    // -------------------------------------------------------------------------
    // Real Docker integration tests — gated, skipped when Docker isn't available
    // -------------------------------------------------------------------------

    @Nested
    @Tag("integration")
    @EnabledIfDockerAvailable
    class RealDockerTests {

        /**
         * Deliberately NOT the production default ({@code node:22-slim}) — a small image keeps
         * this suite's Docker pull fast. {@link SandboxSpec#forWorkspace(Path, String)} exists
         * precisely so callers (and this test) can override the image.
         */
        private static final String TEST_IMAGE = "alpine:3";

        @TempDir
        Path workspace;

        @Test
        void execEchoReturnsStdout() {
            try (DockerSandbox sandbox = DockerSandbox.start(SandboxSpec.forWorkspace(workspace, TEST_IMAGE))) {
                ExecResult result = sandbox.exec(List.of("echo", "hi"), Duration.ofSeconds(10));

                assertTrue(result.success(), result::stderr);
                assertEquals("hi\n", result.stdout());
            }
        }

        @Test
        void execWithoutNetworkFailsToReachTheNetwork() {
            try (DockerSandbox sandbox = DockerSandbox.start(SandboxSpec.forWorkspace(workspace, TEST_IMAGE))) {
                ExecResult result = sandbox.exec(
                    List.of("wget", "-T", "3", "-q", "-O-", "http://example.com"), Duration.ofSeconds(15));

                assertFalse(result.success(), "expected the request to fail: the sandbox has no network by default");
            }
        }

        @Test
        void putFileThenExecCatRoundTrips() {
            try (DockerSandbox sandbox = DockerSandbox.start(SandboxSpec.forWorkspace(workspace, TEST_IMAGE))) {
                sandbox.putFile("greeting.txt", "hola sandbox".getBytes(StandardCharsets.UTF_8));

                ExecResult result = sandbox.exec(List.of("cat", "greeting.txt"), Duration.ofSeconds(10));

                assertTrue(result.success(), result::stderr);
                assertEquals("hola sandbox", result.stdout());
            }
        }

        @Test
        void putFileThenGetFileRoundTrips() {
            try (DockerSandbox sandbox = DockerSandbox.start(SandboxSpec.forWorkspace(workspace, TEST_IMAGE))) {
                byte[] content = "round-trip-bytes".getBytes(StandardCharsets.UTF_8);
                sandbox.putFile("nested/dir/data.bin", content);

                byte[] roundTripped = sandbox.getFile("nested/dir/data.bin");

                assertArrayEquals(content, roundTripped);
            }
        }

        @Test
        void timeoutKillsTheRealContainer() throws IOException, InterruptedException {
            try (DockerSandbox sandbox = DockerSandbox.start(SandboxSpec.forWorkspace(workspace, TEST_IMAGE))) {
                ExecResult result = sandbox.exec(List.of("sleep", "100"), Duration.ofSeconds(2));

                assertTrue(result.timedOut());

                // Independently verify (bypassing the SDK's own reporting) that the container is
                // actually gone — docker kill combined with --rm removes it entirely.
                Process ps = new ProcessBuilder(
                    "docker", "ps", "-a",
                    "--filter", "name=" + sandbox.containerName(),
                    "--format", "{{.Names}}").start();
                ps.waitFor(10, TimeUnit.SECONDS);
                String output = new String(ps.getInputStream().readAllBytes(), StandardCharsets.UTF_8).trim();
                assertEquals("", output, "the timed-out container must have been killed and removed");
            }
        }
    }

    // -------------------------------------------------------------------------
    // Test doubles
    // -------------------------------------------------------------------------

    private static DockerSandbox.ProcessRunner.ProcessOutcome success(String stdout) {
        return new DockerSandbox.ProcessRunner.ProcessOutcome(0, stdout, "", false);
    }

    private static DockerSandbox.ProcessRunner.ProcessOutcome failure(String stderr) {
        return new DockerSandbox.ProcessRunner.ProcessOutcome(1, "", stderr, false);
    }

    private static void assertHasFlag(List<String> cmd, String flag) {
        assertTrue(cmd.contains(flag), () -> "expected flag " + flag + " in " + cmd);
    }

    private static void assertFlagValue(List<String> cmd, String flag, String expectedValue) {
        int idx = cmd.indexOf(flag);
        assertTrue(idx >= 0, () -> "expected flag " + flag + " in " + cmd);
        assertTrue(idx + 1 < cmd.size(), () -> "flag " + flag + " has no value in " + cmd);
        assertEquals(expectedValue, cmd.get(idx + 1));
    }

    /**
     * Scriptable {@link DockerSandbox.ProcessRunner} fake: matches invocations by predicate over
     * the full argv (order-independent to set up, but every call — including ones that only
     * happen to match by accident — is still recorded in {@link #invocations} in call order, so
     * tests can assert sequencing precisely).
     */
    static final class FakeProcessRunner implements DockerSandbox.ProcessRunner {

        final List<List<String>> invocations = new ArrayList<>();
        private final List<Map.Entry<Predicate<List<String>>, ProcessOutcome>> outcomeScripts = new ArrayList<>();
        private final List<Map.Entry<Predicate<List<String>>, RuntimeException>> throwScripts = new ArrayList<>();
        private final ProcessOutcome defaultOutcome = new ProcessOutcome(0, "", "", false);

        FakeProcessRunner whenReturn(Predicate<List<String>> matcher, ProcessOutcome outcome) {
            outcomeScripts.add(new AbstractMap.SimpleEntry<>(matcher, outcome));
            return this;
        }

        FakeProcessRunner whenThrow(Predicate<List<String>> matcher, RuntimeException exception) {
            throwScripts.add(new AbstractMap.SimpleEntry<>(matcher, exception));
            return this;
        }

        @Override
        public ProcessOutcome run(List<String> command, Duration timeout) {
            invocations.add(List.copyOf(command));
            for (var entry : throwScripts) {
                if (entry.getKey().test(command)) {
                    throw entry.getValue();
                }
            }
            for (var entry : outcomeScripts) {
                if (entry.getKey().test(command)) {
                    return entry.getValue();
                }
            }
            return defaultOutcome;
        }

        List<String> lastInvocation() {
            return invocations.get(invocations.size() - 1);
        }
    }
}
