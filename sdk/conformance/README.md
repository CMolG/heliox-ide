# Heliox Cross-Runtime Conformance Fixtures

This directory holds shared canonical fixtures consumed by both the TypeScript IDE test suite
(`src/main/flow-export/heliox-flow.test.ts`) and the Java runtime test suite.
The golden DAG execution order for `conformance-chain.flow.json` is `step-a, step-b, step-c, step-d`.

## Semantic Execution Parity Fixtures

Two additional fixtures extend the conformance contract to cover **per-step output parity** — i.e., that both runtimes produce identical outputs when fed identical scripted LLM responses:

- **`scripted-responses.json`** — a map from step id to the canned text the scripted LLM provider returns for that step. Both runtimes must inject these responses instead of calling a real LLM so the test is deterministic and network-free.
- **`golden-trace.json`** — the ordered expected execution trace: an array of `{ stepId, output }` objects in DAG traversal order. This is the normative contract.

The `golden-trace.json` **must be reproduced identically by both the TypeScript and Java runtimes**. The TS proof lives in `src/main/flow-export/semantic-parity.test.ts`; the Java proof must assert the same array against the same fixture file.
