# Fluxor Cross-Runtime Conformance Fixtures

This directory holds shared canonical fixtures consumed by the **three** Fluxor runtime test
suites: the TypeScript IDE test suite (`src/main/flow-export/fluxor-flow.test.ts`), the Java
runtime test suite (`sdk/java/`), and the Python runtime test suite (`sdk/python/`).

The golden DAG execution order for `conformance-chain.flow.json` is
`step-a, step-b, step-c, step-d, step-e`.

The golden **loop** execution order for `conformance-loop.flow.json` is documented in
`golden-loop-trace.json` — see [Loop Conformance Fixtures](#loop-conformance-fixtures-phase-4a)
below. Loop fixtures require **fluxor-sdk ≥ 0.2.0** (the version that introduced bounded
loop-back edges to the wire format).

## Three-Runtime Conformance Contract (ARCH-074 + ARCH-075 + ARCH-076)

All three runtimes — **TypeScript**, **JVM (Java)**, and **Python** — must pass the same
conformance suite against these shared fixtures. The contract is:

| Guarantee | Proof |
|-----------|-------|
| Identical DAG topological order (deterministic Kahn + id-ascending tie-break) | TS: `fluxor-flow.test.ts`; Java: `CrossRuntimeConformanceTest.dagOrderMatchesGoldenOrder`; Python: `test_dag_order_matches_golden_order` |
| Byte-identical per-step text output for schema-less flows | TS: `semantic-parity.test.ts`; Java: `CrossRuntimeConformanceTest.semanticParityMatchesGoldenTrace`; Python: `test_semantic_parity_matches_golden_trace` |
| Tool called with canonical arguments, result threaded back, post-tool output identical | TS: `semantic-parity.test.ts`; Java: `CrossRuntimeConformanceTest.toolCallingParityMatchesGoldenToolCalls`; Python: `test_tool_calling_parity_matches_golden_tool_calls` |
| Loop execution parity (expansion algorithm → golden loop trace) | TS: `semantic-parity.test.ts`; Java: `CrossRuntimeConformanceTest.loopExecutionMatchesGoldenTrace`; Python: `test_loop_execution_matches_golden_trace` |
| `contract`/`model` carried opaquely round-trip | TS: `fluxor-flow.test.ts`; Java: `CrossRuntimeConformanceTest.contractAndModelAreCarried`; Python: `test_contract_and_model_are_carried` |
| Legacy/absent `format` tag imports with one deprecation warning — `"fluxor-flow"` is silent, absent/null is assumed `"heliox-flow"`, any other value is reported as seen; never blocks parsing | TS: `fluxor-flow.test.ts` suite 7 ("legacy format tag compat"); Java: `CrossRuntimeConformanceTest.legacyFormatImportsWithDeprecationWarning` / `currentFormatFlowsNeverWarn` / `absentFormatWarnsAssumingLegacyHelioxFlow` / `unknownFormatWarnsMentioningSeenValue` / `legacyWarningIsEmittedOncePerDistinctValue`; Python: `test_legacy_format_imports_with_deprecation_warning` / `test_current_format_flows_never_warn` / `test_absent_format_warns_assuming_legacy_heliox_flow` / `test_unknown_format_warns_mentioning_seen_value` |
| `contextMode: "feedback"` imports on Java/Python with ONE downgrade-to-blind warning (TS executes it natively); the value is preserved verbatim; `"blind"`/absent/any other value is silent; never blocks parsing | TS: `fluxor-flow.test.ts` suite 8 ("contextMode export/import round-trip") + `semantic-parity.test.ts` ("feedback-mode contextMode is additive"); Java: `CrossRuntimeConformanceTest.feedbackContextModeDowngradesToBlindWithWarning` / `blindContextModeNeverWarns` / `absentContextModeNeverWarns` / `unknownContextModeValueNeverWarns` / `feedbackDowngradeWarningIsEmittedOncePerProcess`; Python: `test_feedback_context_mode_downgrades_to_blind_with_warning` / `test_blind_context_mode_never_warns` / `test_absent_context_mode_never_warns` / `test_unknown_context_mode_value_never_warns` / `test_feedback_downgrade_warning_is_emitted_once` — see [Context modes](#context-modes--rosetta-downgrade-on-javapython-2026-07-10) |

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
  method is annotated with `@FluxorTool(name = "uppercase")` and registered in a `ToolRegistry`.
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

## Loop Conformance Fixtures

These fixtures extend the conformance contract to cover **bounded loop-back edge execution** —
the per-iteration expansion algorithm implemented in `src/main/harness-engine/loop-plan.ts` (TS)
and mirrored by the Java and Python runtimes; all three reproduce `golden-loop-trace.json`. **Requires fluxor-sdk ≥
0.2.0** — the version that added `AgenticFlow.loops` / `FluxorFlowExport.loops` to the wire
format (`src/types/harness.ts`, `src/main/flow-export/fluxor-flow.ts`).

- **`conformance-loop.flow.json`** — a 4-step flow (`step-a → step-b1 → step-b2 → step-c`) with
  one bounded loop (`loop-1`: source `step-b2`, target `step-b1`, `maxIterations: 3`). The loop
  body is `{step-b1, step-b2}`; `step-c` depends on `step-b2` and so waits for the loop's final
  pass before it runs.
- **`scripted-loop-responses.json`** — a map from step id to an **array** of canned responses, one
  entry per iteration (`step-b1`/`step-b2` each have 3 entries; `step-a`/`step-c`, outside the
  loop body, have exactly 1). A scripted `runStep`/provider pops the next entry off the
  per-step queue on each call.
- **`golden-loop-trace.json`** — the normative ordered execution trace: an array of
  `{ stepId, iteration, output }` objects. This is the canonical order the Kahn-scheduler-driven
  expansion algorithm produces: the loop body interleaves pass-by-pass
  (`b1@1, b2@1, b1@2, b2@2, b1@3, b2@3`) rather than running all of `step-b1`'s passes before any
  of `step-b2`'s — each loop chain edge (`source@k → target@(k+1)`) only unblocks the next pass
  after both steps in that pass have completed.

The TS proof lives in `src/main/flow-export/semantic-parity.test.ts`: it loads
`conformance-loop.flow.json` via `importFlow`, runs it through the real `executeAgenticFlow` with
a scripted `runStep`, records `{ stepId, output }` in completion order, and asserts the recording
matches `golden-loop-trace.json` (`stepId` + `output`, with per-step call count cross-checking
`iteration`). The Java/Python proofs (`CrossRuntimeConformanceTest.loopExecutionMatchesGoldenLoopTrace`
/ `test_loop_execution_matches_golden_loop_trace`) land once each runtime implements the same
expansion algorithm.

## Contract/Model Round-Trip Fixtures (Phase 4a)

- **`conformance-contract.flow.json`** — a 2-step flow where `step-b` carries a completion
  `contract` (`StepContract`: `mustWriteFiles: true`, `maxAttempts: 2`) and a per-step `model`
  override (`"openai/gpt-4o-mini"`).
- **`golden-contract-roundtrip.json`** — the expected re-exported JSON after
  `importFlow` → `exportFlow`. Both fields are carried **opaquely**: this format never
  interprets `contract` or `model` (only the TS guardrail engine does, executor-side), it only
  guarantees they survive the round trip unchanged.

The TS proof lives in `src/main/flow-export/fluxor-flow.test.ts`: it asserts
`exportFlow(importFlow(conformance-contract.flow.json))` deep-equals
`golden-contract-roundtrip.json`, plus a synthetic-flow round-trip covering `loops` alongside
`contract`/`model` on the same step. The Java/Python proofs parse the fixture and assert they
preserve both fields byte-for-byte, even though neither runtime interprets `contract` itself yet.

## Legacy Format Compat — Rebranding Heliox → Fluxor (2026-07-10)

The wire format never carried a self-identifying name before the rebrand — no field in any
pre-2026-07-10 export ever said `"heliox"` anywhere; "heliox-flow" was purely a module/type
naming convention (`heliox-flow.ts`, `HelioxFlowExport`), not a JSON value. The rebrand
therefore added an explicit **top-level `"format"` string tag** to the wire format, and with it
a detectable legacy state: **a flow with no `format` field IS a legacy export**, because only
pre-rebrand code produced tag-less flows.

The frozen cross-runtime contract (orchestrator ruling 2026-07-10; the canonical reference
implementation is `warnIfLegacyFormat` in `src/main/flow-export/fluxor-flow.ts`, and
`exportFlow` in the same module stamps `"format": "fluxor-flow"` into every export):

1. **`format === "fluxor-flow"`** → silence. This is the current wire format; the canonical
   fixtures in this directory (`conformance-chain/loop/contract.flow.json`) all carry it.
2. **`format` absent or null** → the import succeeds unchanged, but emits **one deprecation
   warning** reporting the assumed legacy `"heliox-flow"` format.
3. **Any other value** (including the literal `"heliox-flow"`) → the import succeeds unchanged,
   but emits **one deprecation warning mentioning the value actually seen**.

In every case the tag is advisory: it never blocks parsing and never changes structural
behaviour — an unrecognized or absent format is a deprecation signal, not a validation failure,
since the rest of the schema hasn't changed shape. The warning fires **once per distinct seen
value per process**: TS via `warnOnce`, Java via an internal seen-value set in `FlowImport`
(reset hook for tests), Python by delegating to the stdlib `warnings` filter (whose default
action dedups repeated identical warnings — the Pythonic equivalent).

Warning channels per runtime: TS `log.warn` via `warnOnce`; Java one line to `System.err`;
Python one `DeprecationWarning` via `warnings.warn`. Message wording may vary per runtime
idiom; the trigger conditions and the reported value may not.

- **`conformance-legacy-heliox-flow.flow.json`** — a minimal 1-step flow carrying the explicit
  legacy tag `"format": "heliox-flow"` (rule 3). Proof: Java
  `CrossRuntimeConformanceTest.legacyFormatImportsWithDeprecationWarning` /
  `legacyWarningIsEmittedOncePerDistinctValue`; Python
  `test_legacy_format_imports_with_deprecation_warning`; TS `fluxor-flow.test.ts` suite 7.
- The **absent-tag case** (rule 2) is proven with inline JSON rather than a fixture: Java
  `absentFormatWarnsAssumingLegacyHelioxFlow`; Python
  `test_absent_format_warns_assuming_legacy_heliox_flow`; TS suite 7 (deletes `format` from a
  fresh export). The **unknown-value case** (rule 3, arbitrary value) likewise: Java
  `unknownFormatWarnsMentioningSeenValue`; Python `test_unknown_format_warns_mentioning_seen_value`.

Note: `golden-contract-roundtrip.json` intentionally does **not** carry the `format` key — it
predates the tag, and the TS round-trip test compensates by spreading
`format: FLUXOR_FLOW_FORMAT_NAME` onto the golden at compare time (`fluxor-flow.test.ts`
suite 5, "importFlow(conformance-contract.flow.json) → exportFlow deep-equals
golden-contract-roundtrip.json"). Regenerate the golden with the tag if that workaround is
ever retired.

## Context modes — Rosetta downgrade on Java/Python (2026-07-10)

The wire format carries an optional top-level `contextMode` string (`AgenticFlow.contextMode`
in `src/types/harness.ts`; spec:
`docs/superpowers/specs/2026-07-10-rosetta-context-manifest.md`). It selects how a run threads
context between steps: **blind** (the default — steps only see their declared upstream
outputs, exactly as before the field existed) or **feedback** (the TS harness materializes a
`.fluxor/run-context/<runId>/` directory with a Rosetta manifest and per-step context files,
and injects a deterministic `<flow_awareness>` block). The exporter omits the key entirely for
blind/absent flows and stamps only the literal `"feedback"`, so blind exports stay
byte-identical to every pre-Rosetta export.

### Runtime × mode support matrix

| Runtime | `contextMode` absent / `"blind"` | `contextMode: "feedback"` |
|---|---|---|
| **TypeScript** (IDE / serve) | Native (byte-identical to pre-Rosetta behaviour) | **Native** — run-context genesis, manifest, `<flow_awareness>`, briefing guardrail |
| **Java** (`sdk/java`) | Native (blind is the only implemented mode) | **Downgrade to blind** — one warning on `System.err`, then executes blind |
| **Python** (`sdk/python`) | Native (blind is the only implemented mode) | **Downgrade to blind** — one `DeprecationWarning`, then executes blind |

### The downgrade contract (spec decision 2 — frozen)

Feedback-mode parity in Java/Python is a **v2** concern (the PF measurement campaign runs on
the TS runtime); in v1 both SDKs perform an explicit, documented downgrade at import:

1. **`contextMode === "feedback"`** → the import succeeds unchanged and emits **one** warning
   with the exact wording:

   > feedback mode is not supported by this runtime yet; downgrading to blind

   Execution then proceeds in blind mode — the only mode these executors implement (they have
   no run-context manifest/briefing machinery; neither executor ever reads `contextMode`, so
   blind execution is structural, not a branch).
2. **`"blind"`, absent/null, or any other value** → total silence: there is nothing to
   downgrade. The SDKs do not validate the enum (only the TS IDE authoring surface does); an
   unrecognized value is carried like any other opaque field.

In every case `contextMode` is **preserved verbatim** on the parsed definition
(`FlowDefinition.contextMode()` in Java, `FlowDefinition.context_mode` in Python — `null`/
`None` when absent). The downgrade changes runtime behaviour, never the recorded value, so
the definition round-trips without loss.

Warning channels and once-semantics mirror the legacy-format shim exactly: Java prints one
line to `System.err`, deduped by a once-per-process flag (test reset hook
`resetContextModeWarningsForTests`); Python raises one `DeprecationWarning` via
`warnings.warn`, dedup delegated to the stdlib warnings filter. Unlike the format shim's
message, the downgrade wording above is itself part of the frozen contract — it may **not**
vary per runtime.

- **`conformance-feedback-mode.flow.json`** — a minimal 1-step flow carrying
  `"format": "fluxor-flow"` and `"contextMode": "feedback"` (rule 1). Proof: Java
  `CrossRuntimeConformanceTest.feedbackContextModeDowngradesToBlindWithWarning` /
  `feedbackDowngradeWarningIsEmittedOncePerProcess`; Python
  `test_feedback_context_mode_downgrades_to_blind_with_warning` /
  `test_feedback_downgrade_warning_is_emitted_once`.
- The **silent cases** (rule 2) are proven with inline JSON and the existing chain fixture:
  Java `blindContextModeNeverWarns` / `absentContextModeNeverWarns` /
  `unknownContextModeValueNeverWarns`; Python `test_blind_context_mode_never_warns` /
  `test_absent_context_mode_never_warns` / `test_unknown_context_mode_value_never_warns`.
- The **TS side** (native execution, no downgrade) is proven by `fluxor-flow.test.ts` suite 8
  ("contextMode export/import round-trip" — omit-when-blind, stamp-only-`"feedback"`) and
  `semantic-parity.test.ts` ("feedback-mode contextMode is additive — does not perturb the
  golden trace", which also materializes a real run-context manifest).
