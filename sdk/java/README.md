# Heliox SDK for Java

`heliox-sdk-java` is the async inference & execution runtime for the cognitive flows
designed in **Heliox IDE**. It runs a flow's steps outside the IDE on any JVM, with these
guarantees:

1. **Async / non-blocking** — every execution returns a `CompletableFuture<T>`.
2. **Structured outputs** — a step's output is forced to match a schema derived by reflection
   from your expected Java type.
3. **Self-correction** — when the model's output fails validation, the failing fields are
   injected back as a system message and the step is retried up to *n* times.
4. **Native tool calling** — annotate Java methods with `@HelioxTool`; the SDK advertises them
   to the model, executes the requested calls via reflection, and threads results back.
5. **DAG orchestration** — a flow is a graph; independent nodes run concurrently and dependent
   nodes wait on their parents, accumulating parent outputs into the child's context.

It depends only on **Jackson** (JSON + reflection) and the **JDK `java.net.http.HttpClient`** —
no Retrofit, no Apache HttpClient, no third-party JSON Schema validator.

## Requirements

- Java 21+
- Maven 3.9+

## Quick start

```java
import io.heliox.sdk.HelioxRuntime;
import io.heliox.sdk.provider.MimoProvider;
import java.util.concurrent.CompletableFuture;

record AuditResult(String verdict, int riskScore, java.util.List<String> findings) {}

HelioxRuntime runtime = HelioxRuntime.builder()
    .llmProvider(new MimoProvider("API_KEY"))   // or new OpenAiProvider("sk-...")
    .build();

CompletableFuture<AuditResult> result = runtime.flow("auth-audit")
    .withContext("jwt", tokenString)
    .withExpectedOutput(AuditResult.class)
    .withRetries(3)
    .executeAsync();

result.thenAccept(audit -> System.out.println(audit.verdict()));
```

`MimoProvider` targets Xiaomi MiMo via the Amsterdam token-plan endpoint and falls back to the
`MIMO_API_KEY` / `AGENT_API_KEY` environment variables, matching the IDE's harness runner.

## Tool calling

Annotate methods, register the holder object, and the model can call them mid-step:

```java
public final class WeatherService {
    @HelioxTool(name = "get_weather", description = "Clima actual de una ciudad")
    public String getWeather(String city) { /* ... call your backend ... */ }
}

HelioxRuntime runtime = HelioxRuntime.builder()
    .llmProvider(new MimoProvider("API_KEY"))
    .registerTool(new WeatherService())
    .build();
```

`ToolRegistry` scans `@HelioxTool` methods, derives each tool's parameter schema by reusing
`SchemaExtractor`, and binds the model's JSON arguments back to parameters by name (compiled
with `-parameters`). While the model emits `tool_calls`, `StepExecutor` pauses final-schema
validation, invokes the tools, appends `tool` messages, and replays the conversation — all async.

## DAG flows

A `FlowDefinition` is a graph of `StepConfig` nodes wired by `dependencies`:

```java
var flow = new FlowDefinition("triage", List.of(
    new StepConfig("fetch",   null, "Recupera los logs",            Map.of(), List.of()),
    new StepConfig("classify",null, "Clasifica la severidad",       Map.of(), List.of("fetch")),
    new StepConfig("enrich",  null, "Añade contexto de negocio",    Map.of(), List.of("fetch")),
    new StepConfig("report",  null, "Resume el incidente",          Map.of(), List.of("classify", "enrich"))));
```

`FlowExecutor` runs it as a DAG: `fetch` starts immediately; `classify` and `enrich` run
concurrently once `fetch` finishes; `report` (the terminal/sink node, schema-enforced to your
expected type) runs after both via `CompletableFuture.allOf(...).thenCompose(...)`. Each child's
context accumulates its parents' outputs. The scheduler is lock-free: the future graph is wired
single-threaded in topological order, and node results land in a `ConcurrentHashMap` under
disjoint keys with happens-before guaranteed by the future graph.

## How it works

```
HelioxRuntime ─► FlowExecution (fluent) ─► FlowExecutor (DAG) ─► StepExecutor ─► LlmProvider
                                                                      │  ▲
                                            SchemaExtractor ──────────┤  │ tool loop
                                            SchemaValidator ──────────┘  └── ToolRegistry (reflection)
```

- **`schema/SchemaExtractor`** turns a `Class<?>` into a Draft 2020-12 schema. Collections become
  arrays, maps become open objects, enums become string enums, and nested types are factored into
  `$defs`/`$ref`. Circular types (e.g. `record Node(String id, List<Node> children)`) terminate
  because a type's `$defs` name is reserved *before* its members are visited. An overload accepts a
  raw predefined schema string.
- **`validation/SchemaValidator`** walks that schema against the model's JSON and reports one
  error per offending field — this is what seeds the corrective `"El JSON falló en estos campos: …"`
  message.
- **`engine/StepExecutor`** owns the async retry loop. Its signature is exactly:
  ```java
  public <T> CompletableFuture<T> executeStep(StepConfig step, Class<T> expectedType, int maxRetries)
  ```
- **`provider/`** — `LlmProvider` interface plus `OpenAiCompatibleProvider` (JDK HTTP) and the
  `MimoProvider` / `OpenAiProvider` concretions. `OpenAiProvider` upgrades to native strict
  `json_schema` structured outputs when a schema is present.

## Build & test

```bash
cd sdk/java
mvn test
```

The unit suite runs fully offline using a scripted `FakeProvider` — no network or API key required.
Schema, validation, retry, tool calling and DAG paths are all covered.

### Live integration test

`MimoLiveTest` is a real sanity check against Xiaomi MiMo. It is annotated
`@EnabledIfEnvironmentVariable(named = "AGENT_API_KEY", ...)`, so it is **skipped by default** and
never breaks CI. Run it explicitly with a key exported:

```bash
AGENT_API_KEY=your_key mvn -Dtest=MimoLiveTest test
```

It registers a Java tool, asks for the weather (forcing a tool call), and requires a strict
structured `WeatherReport` record back.

## Custom providers

Implement `LlmProvider` to plug in any backend:

```java
public interface LlmProvider {
    CompletableFuture<LlmResponse> complete(LlmRequest request);
}
```
