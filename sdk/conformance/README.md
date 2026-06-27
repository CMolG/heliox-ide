# Heliox Cross-Runtime Conformance Fixtures

This directory holds shared canonical fixtures consumed by the **three** Heliox runtime test
suites: the TypeScript IDE test suite (`src/main/flow-export/heliox-flow.test.ts`), the Java
runtime test suite (`sdk/java/`), and the Python runtime test suite (`sdk/python/`).

The golden DAG execution order for `conformance-chain.flow.json` is
`step-a, step-b, step-c, step-d, step-e`.

## Three-Runtime Conformance Contract (ARCH-074 + ARCH-075 + ARCH-076)

All three runtimes — **TypeScript**, **JVM (Java)**, and **Python** — must pass the same
conformance suite against these shared fixtures. The contract is:

| Guarantee | Proof |
|-----------|-------|
| Identical DAG topological order (deterministic Kahn + id-ascending tie-break) | TS: `heliox-flow.test.ts`; Java: `CrossRuntimeConformanceTest.dagOrderMatchesGoldenOrder`; Python: `test_dag_order_matches_golden_order` |
| Byte-identical per-step text output for schema-less flows | TS: `semantic-parity.test.ts`; Java: `CrossRuntimeConformanceTest.semanticParityMatchesGoldenTrace`; Python: `test_semantic_parity_matches_golden_trace` |
| Tool called with canonical arguments, result threaded back, post-tool output identical | TS: `semantic-parity.test.ts`; Java: `CrossRuntimeConformanceTest.toolCallingParityMatchesGoldenToolCalls`; Python: `test_tool_calling_parity_matches_golden_tool_calls` |

### Running all three suites

```bash
# TypeScript (Vitest)
npx vitest run src/main/flow-export

# Java (Maven)
mvn -f sdk/java/pom.xml test

# Python (pytest)
python3 -m pytest sdk/python -q
```

All three must be green before any change to the shared fixtures is merged.

## Canonical Typed-Output Rule (ARCH-074 — closed)

Both runtimes propagate **raw provider text by default**. JSON-schema typed extraction is an
**explicit opt-in**, triggered only when:

- (Java) the caller passes an expected `Class<T>` to `FlowExecutor.execute()` or declares a sink
  type in `FlowExecutor.executeMultiSink()`.
- (TypeScript) a step explicitly invokes a schema-extraction sink kind (future capability).

A step that declares **no output schema** must yield byte-identical text in both the TypeScript
and Java runtimes. This guarantee is proven by the conformance suite below.

The previously documented divergence — Java sink step auto-extracting JSON while TS propagated
plain text — is **closed**. The Java runtime now exposes `FlowExecutor.executeAllText()` as the
canonical default path for schema-less flows. The conformance parity test uses this path so both
runtimes produce identical `{ stepId, output }` entries with no normalization workaround.

## Tool-Calling Parity (ARCH-075 — closed)

Both runtimes call tools with the same arguments, integrate the same result, and produce the
same post-tool output. This is proven by the conformance suite for `step-e`, which invokes the
deterministic `uppercase` tool.

The `uppercase` tool is registered in both runtimes:

- **TypeScript** (`src/main/flow-export/semantic-parity.test.ts`): the `uppercase(text)` function
  is called directly with `{text: "hello conformance"}` inside the scripted `generateText` mock,
  returning `"HELLO CONFORMANCE"`.
- **Java** (`CrossRuntimeConformanceTest`, `ToolRegistry`): the `UppercaseTool.uppercase(String)`
  method is annotated with `@HelioxTool(name = "uppercase")` and registered in a `ToolRegistry`.
  The `FakeProvider` delivers a tool-call request; `StepExecutor` invokes the real tool via the
  registry, threads the result back, and the provider returns the final text.

The tool is **ACTUALLY INVOKED** in both runtimes — not bypassed by a fully-scripted output.

## Semantic Execution Parity Fixtures

These fixtures extend the conformance contract to cover **per-step output parity** — i.e., that
both runtimes produce identical outputs when fed identical scripted LLM responses:

- **`scripted-responses.json`** — a map from step id to the canned text the scripted LLM provider
  returns for that step (for step-e: the post-tool final text). Both runtimes inject these
  responses instead of calling a real LLM so the test is deterministic and network-free.
- **`golden-trace.json`** — the ordered expected execution trace: an array of `{ stepId, output }`
  objects in DAG traversal order. This is the normative per-step output contract.
- **`golden-tool-calls.json`** — the ordered expected tool-call events: an array of
  `{ stepId, toolName, arguments, result }` objects. This is the normative tool-calling contract.

The `golden-trace.json` **must be reproduced identically by both the TypeScript and Java runtimes**.
The TS proof lives in `src/main/flow-export/semantic-parity.test.ts`; the Java proof lives in
`CrossRuntimeConformanceTest.semanticParityMatchesGoldenTrace` (uses `executeAllText` — actual
runtime output, not a provider-text-level normalization workaround).

The `golden-tool-calls.json` **must be verified by both runtimes**. The TS proof is in
`semantic-parity.test.ts` (asserts `toolName`, `arguments`, and `result` against the fixture).
The Java proof lives in `CrossRuntimeConformanceTest.toolCallingParityMatchesGoldenToolCalls`
(asserts the FakeProvider received two turns, the tool result was fed back as a TOOL message,
and the output matches the fixture).
