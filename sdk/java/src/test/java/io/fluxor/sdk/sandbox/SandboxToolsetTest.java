package io.fluxor.sdk.sandbox;

import com.fasterxml.jackson.databind.JsonNode;
import io.fluxor.sdk.internal.Json;
import io.fluxor.sdk.provider.ToolSpec;
import io.fluxor.sdk.tool.ToolRegistry;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SandboxToolsetTest {

    @Test
    void constructorRejectsNullSandbox() {
        assertThrows(NullPointerException.class, () -> new SandboxToolset(null));
    }

    // -------------------------------------------------------------------------
    // Registration: all five tools, correct schema shape
    // -------------------------------------------------------------------------

    @Test
    void registersAllFiveToolsWithCorrectSpecs() {
        ToolRegistry registry = new ToolRegistry().register(new SandboxToolset(new FakeSandbox()));
        try {
            List<ToolSpec> specs = registry.specs();
            Set<String> names = specs.stream().map(ToolSpec::name).collect(Collectors.toSet());
            assertEquals(Set.of("run_command", "write_file", "read_file", "list_files", "install_deps"), names);

            ToolSpec runCommand = findSpec(specs, "run_command");
            JsonNode runCommandParams = runCommand.parameters().node();
            assertEquals("array", runCommandParams.at("/properties/command/type").asText());
            assertTrue(runCommandParams.get("required").toString().contains("command"));
            // timeoutSeconds is a plain nullable Long, not Optional<Long> — see SandboxToolset's
            // class javadoc ("Why the optional parameters aren't Optional<T>") for why: it *is*
            // listed in `required` by SchemaExtractor's Optional-only exemption rule, but its
            // description tells the model null is accepted and defaults sensibly.
            assertTrue(runCommandParams.get("required").toString().contains("timeoutSeconds"));
            assertTrue(runCommandParams.at("/properties/timeoutSeconds/description").asText().contains("null"));

            ToolSpec installDeps = findSpec(specs, "install_deps");
            assertTrue(installDeps.description().toLowerCase().contains("red"),
                "install_deps must document that it is the one tool with network access");

            ToolSpec writeFile = findSpec(specs, "write_file");
            JsonNode writeFileParams = writeFile.parameters().node();
            assertEquals("string", writeFileParams.at("/properties/path/type").asText());
            assertEquals("string", writeFileParams.at("/properties/content/type").asText());
        } finally {
            registry.shutdown();
        }
    }

    // -------------------------------------------------------------------------
    // run_command
    // -------------------------------------------------------------------------

    @Test
    void runCommandDelegatesToExecAndSerializesExecResult() throws Exception {
        FakeSandbox fake = new FakeSandbox();
        fake.scriptedExecResult = new ExecResult(0, "built\n", "", false);
        ToolRegistry registry = new ToolRegistry().register(new SandboxToolset(fake));
        try {
            String json = registry.invoke("run_command", "{\"command\":[\"pnpm\",\"run\",\"build\"]}").get();

            JsonNode node = Json.MAPPER.readTree(json);
            assertEquals(0, node.get("exitCode").asInt());
            assertEquals("built\n", node.get("stdout").asText());
            assertFalse(node.get("timedOut").asBoolean());

            assertEquals(1, fake.execCalls.size());
            assertEquals(0, fake.execWithNetworkCalls.size(), "run_command must never touch the network");
            assertEquals(List.of("pnpm", "run", "build"), fake.execCalls.get(0).cmd());
            assertEquals(Duration.ofSeconds(120), fake.execCalls.get(0).timeout());
        } finally {
            registry.shutdown();
        }
    }

    @Test
    void runCommandFailureIsReturnedInJsonNotThrown() throws Exception {
        FakeSandbox fake = new FakeSandbox();
        fake.scriptedExecResult = new ExecResult(127, "", "command not found", false);
        ToolRegistry registry = new ToolRegistry().register(new SandboxToolset(fake));
        try {
            // Must complete normally (no ExecutionException) even though the command "failed".
            String json = registry.invoke("run_command", "{\"command\":[\"doesnotexist\"]}").get();

            JsonNode node = Json.MAPPER.readTree(json);
            assertEquals(127, node.get("exitCode").asInt());
            assertEquals("command not found", node.get("stderr").asText());
        } finally {
            registry.shutdown();
        }
    }

    @Test
    void runCommandHonorsExplicitTimeoutOverride() throws Exception {
        FakeSandbox fake = new FakeSandbox();
        ToolRegistry registry = new ToolRegistry().register(new SandboxToolset(fake));
        try {
            registry.invoke("run_command", "{\"command\":[\"echo\",\"hi\"],\"timeoutSeconds\":5}").get();

            assertEquals(Duration.ofSeconds(5), fake.execCalls.get(0).timeout());
        } finally {
            registry.shutdown();
        }
    }

    // -------------------------------------------------------------------------
    // install_deps — the only tool with network
    // -------------------------------------------------------------------------

    @Test
    void installDepsUsesExecWithNetworkOnlyWithDefaultTimeout() throws Exception {
        FakeSandbox fake = new FakeSandbox();
        ToolRegistry registry = new ToolRegistry().register(new SandboxToolset(fake));
        try {
            registry.invoke("install_deps", "{\"command\":[\"pnpm\",\"install\"]}").get();

            assertEquals(0, fake.execCalls.size(), "install_deps must never call plain exec");
            assertEquals(1, fake.execWithNetworkCalls.size());
            assertEquals(List.of("pnpm", "install"), fake.execWithNetworkCalls.get(0).cmd());
            assertEquals(Duration.ofMinutes(5), fake.execWithNetworkCalls.get(0).timeout());
        } finally {
            registry.shutdown();
        }
    }

    // -------------------------------------------------------------------------
    // write_file / read_file
    // -------------------------------------------------------------------------

    @Test
    void writeFileWritesThroughSandboxAndReturnsOk() throws Exception {
        FakeSandbox fake = new FakeSandbox();
        ToolRegistry registry = new ToolRegistry().register(new SandboxToolset(fake));
        try {
            String json = registry.invoke("write_file", "{\"path\":\"src/a.js\",\"content\":\"1\"}").get();

            JsonNode node = Json.MAPPER.readTree(json);
            assertTrue(node.get("ok").asBoolean());
            assertEquals("src/a.js", node.get("path").asText());
            assertTrue(node.get("error").isNull());
            assertArrayEquals("1".getBytes(StandardCharsets.UTF_8), fake.files.get("src/a.js"));
        } finally {
            registry.shutdown();
        }
    }

    @Test
    void writeFileFailureIsReturnedInJsonNotThrown() throws Exception {
        FakeSandbox fake = new FakeSandbox();
        fake.putFileException = new SandboxException("disk full");
        ToolRegistry registry = new ToolRegistry().register(new SandboxToolset(fake));
        try {
            // Must complete normally even though the underlying Sandbox call threw.
            String json = registry.invoke("write_file", "{\"path\":\"a.txt\",\"content\":\"x\"}").get();

            JsonNode node = Json.MAPPER.readTree(json);
            assertFalse(node.get("ok").asBoolean());
            assertEquals("disk full", node.get("error").asText());
        } finally {
            registry.shutdown();
        }
    }

    @Test
    void readFileReturnsContentWhenPresent() throws Exception {
        FakeSandbox fake = new FakeSandbox();
        fake.files.put("a.txt", "hello".getBytes(StandardCharsets.UTF_8));
        ToolRegistry registry = new ToolRegistry().register(new SandboxToolset(fake));
        try {
            String json = registry.invoke("read_file", "{\"path\":\"a.txt\"}").get();

            JsonNode node = Json.MAPPER.readTree(json);
            assertTrue(node.get("ok").asBoolean());
            assertEquals("hello", node.get("content").asText());
        } finally {
            registry.shutdown();
        }
    }

    @Test
    void readFileMissingFileReturnsErrorNotThrown() throws Exception {
        FakeSandbox fake = new FakeSandbox();
        ToolRegistry registry = new ToolRegistry().register(new SandboxToolset(fake));
        try {
            // Must complete normally: a missing file is an everyday condition, not a tool-call failure.
            String json = registry.invoke("read_file", "{\"path\":\"missing.txt\"}").get();

            JsonNode node = Json.MAPPER.readTree(json);
            assertFalse(node.get("ok").asBoolean());
            assertTrue(node.get("error").asText().contains("missing.txt"));
        } finally {
            registry.shutdown();
        }
    }

    // -------------------------------------------------------------------------
    // list_files
    // -------------------------------------------------------------------------

    @Test
    void listFilesDefaultsToNonRecursiveLsAtWorkspaceRoot() throws Exception {
        FakeSandbox fake = new FakeSandbox();
        fake.scriptedExecResult = new ExecResult(0, "a.txt\nb.txt\n", "", false);
        ToolRegistry registry = new ToolRegistry().register(new SandboxToolset(fake));
        try {
            registry.invoke("list_files", "{}").get();

            assertEquals(1, fake.execCalls.size());
            assertEquals(List.of("ls", "-1a", "."), fake.execCalls.get(0).cmd());
        } finally {
            registry.shutdown();
        }
    }

    @Test
    void listFilesRecursiveUsesFind() throws Exception {
        FakeSandbox fake = new FakeSandbox();
        ToolRegistry registry = new ToolRegistry().register(new SandboxToolset(fake));
        try {
            registry.invoke("list_files", "{\"path\":\"src\",\"recursive\":true}").get();

            assertEquals(List.of("find", "src"), fake.execCalls.get(0).cmd());
        } finally {
            registry.shutdown();
        }
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private static ToolSpec findSpec(List<ToolSpec> specs, String name) {
        return specs.stream().filter(s -> s.name().equals(name)).findFirst()
            .orElseThrow(() -> new AssertionError("no tool spec named " + name));
    }

    /** Hand-rolled {@link Sandbox} fake: records every call and lets tests script outcomes/failures. */
    static final class FakeSandbox implements Sandbox {

        record Call(List<String> cmd, Duration timeout) {
        }

        final List<Call> execCalls = new ArrayList<>();
        final List<Call> execWithNetworkCalls = new ArrayList<>();
        final Map<String, byte[]> files = new LinkedHashMap<>();

        ExecResult scriptedExecResult = new ExecResult(0, "", "", false);
        RuntimeException putFileException;
        RuntimeException getFileException;

        @Override
        public ExecResult exec(List<String> cmd, Duration timeout) {
            execCalls.add(new Call(cmd, timeout));
            return scriptedExecResult;
        }

        @Override
        public ExecResult execWithNetwork(List<String> cmd, Duration timeout) {
            execWithNetworkCalls.add(new Call(cmd, timeout));
            return scriptedExecResult;
        }

        @Override
        public void putFile(String path, byte[] content) {
            if (putFileException != null) {
                throw putFileException;
            }
            files.put(path, content);
        }

        @Override
        public byte[] getFile(String path) {
            if (getFileException != null) {
                throw getFileException;
            }
            byte[] bytes = files.get(path);
            if (bytes == null) {
                throw new SandboxException("no such file: " + path);
            }
            return bytes;
        }

        @Override
        public void close() {
            // No resources to release in the fake.
        }
    }
}
