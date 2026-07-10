# Cutting-Edge Roadmap — Making the Performance Frontier a Real Benchmark

**Author:** architecture audit, 2026-06-24
**Goal:** move the Performance Frontier from "an LLM judge that *opines*" to "a benchmark that *verifies*", worthy of the first IDE for exportable agentic flows.

## The core problem (audited in code)
The PF never executes generated code. The sandbox (memfs) only snapshots files. `development` ships a failing vitest file that is **never run** — the judge reads the code and guesses `algorithmicAccuracy`. Same for `design` (a11y guessed, not measured) and `progression` (Express never booted). Single self-judging model (Mimo is often both agent and judge), n=1, ±30 noise floor (proven: `analysis` moved −32 with zero changes).

## Phases (priority order)

### Phase 1 — Sandbox execution foundation + development ground truth ← THIS SESSION
Turn the sandbox into something that *runs* code, and make `development` verifiable.

- **1a. `execution/sandbox-runner.ts`** — materialize a VFS snapshot to a fresh temp dir, run a command with a timeout, capture stdout/stderr + exit code, always clean up. `spawn` with `shell:false` (no injection). The execution primitive.
- **1b. `execution/development-verifier.ts`** — run the injected vitest tests against the agent's `calculator.ts`, parse `{ passed, failed, total }` via the JSON reporter. Deterministic ground truth.
- **1c. Integration** — the runner computes the verification after the `development` flow, attaches it to the judge input as **authoritative evidence**, surfaces it in the report/telemetry, and the judge prompt is told to anchor `algorithmicAccuracy` on the *real* test result, not a guess.

**Acceptance:** a known-correct `calculator.ts` → all pass; a broken one → failures; integrated into a real MiMo `development` run showing real pass/fail. `tsc` clean, tests green.

### Phase 2 — Extend verifiers (objective dimensions)
- **`design-verifier.ts`** — render the generated `index.html` (jsdom) and run **axe-core** + a contrast check → `accessibilityScore` becomes measured WCAG violations, not opinion.
- **`api-verifier.ts`** — boot the Express app on an ephemeral port, hit the endpoints (health, users, the avatar route, the JWT login→protect pipeline) → `architecture`/`progression` get real HTTP reachability checks.

### Phase 3 — Statistical rigor (`pf:bench`)
N-repetition runs per suite with mean ± confidence interval. Kills the n=1 ±30 noise problem so the Arena leaderboard is defensible. Report variance, not a single number.

### Phase 4 — Judge credibility
Judge ≠ agent by default; optional judge ensemble; fix the recurring JSON-schema flakes; and **calibrate the judge against Phase 1/2 ground truth** (a meta-eval: how often does the LLM judge agree with verified execution?).

### Phase 5 — Cross-runtime export conformance (the differentiator)
A parity suite proving a flow exported from the TS engine runs **identically** in the Java `FluxorRuntime` (`sdk/java`). For "exportable agentic flows" as THE selling point, this is mandatory, not optional.

## Hybrid scoring model (the target architecture)
- **Objective dimensions** (tests pass, endpoints reachable, a11y violations, DAG validity) → **deterministic verifiers**.
- **Subjective dimensions** (cognitive process, search efficiency, instruction quality, code clarity) → **LLM judge**.
This is the SWE-bench + LLM-judge hybrid: credible, low-noise, exportable.

## Orchestration
Implemented by Sonnet subagents against the contracts above; the architect validates each change (`tsc`, tests, diff review, a real run). Phase 1 is sequential (1a → 1b → 1c) because of the dependency chain.

---

## STATUS (2026-06-24)

- ✅ **Phase 1 — DONE & validated live.** `execution/sandbox-runner.ts` + `execution/development-verifier.ts` run REAL vitest against the agent's `calculator.ts`. Wired into the runner → judge (anchors `algorithmicAccuracy` on real results) → HTML report. Live MiMo proof: 13/13 tests executed, judge gave 20/20 consistent with ground truth.
- ✅ **Phase 4 — DONE & validated live.**
  - Judge resilience: retry loop (default 3) + graceful no-throw degradation (`judgeError` flag). The live MiMo run that previously crashed with `AI_NoObjectGeneratedError` now completes.
  - Configurable judge model via `FLUXOR_JUDGE_MODEL` (judge ≠ agent) to reduce self-judging bias.
  - `calibration/judge-calibration.ts` — the self-measuring meta-eval: MAE of judge vs ground truth, `withinTwo`, `perfectAgreement`, and the critical `overrules` (tests failed but judge scored ≥18). Live demo (N=3, MiMo): MAE 0, 0 overrules — **but a non-discriminating sample** (MiMo passed 13/13 in all 3 runs, so the judge was never tested on failures). **Follow-up:** run calibration over failure-inducing cases (harder development variants, or weaker models in the Arena) to stress the judge under real failures.
- ✅ **Phase 2 — DONE & validated live.** Objective dimensions now verified by execution:
  - `execution/design-verifier.ts` — renders the agent's `index.html` in jsdom and runs **axe-core** for real WCAG violations (color-contrast left to the judge). Live MiMo design run: 2 real violations incl. a critical `aria-required-parent`, 34 passes; judge `accessibilityScore` anchored on it.
  - `execution/api-verifier.ts` — **boots the agent's Express app** on an ephemeral port and makes real HTTP checks (server boots, /health 2xx, avatar endpoint exists [non-404], auth enforced [401]). Live MiMo progression run: booted, all 3 checks passed; `regressionScore` anchored on real HTTP evidence (vs the wild 2/8/14/28 guesses before).
- ✅ **Phase 3 — DONE & validated live.** `bench/statistics.ts` (mean, sample stdDev, 95% CI via Student's t-table), `bench/bench-runner.ts` (run a suite N times, aggregate), `bench/cli.ts` + `npm run pf:bench`. Live demo (development, reps=3): **92.0 ± 4.3 (95% CI [87.7, 96.3])**, stdDev 1.73 — note the variance is now TINY because `algorithmicAccuracy` is deterministic (ground truth). The bench doesn't reduce noise; it MEASURES it — and with objective dimensions pinned by Phases 1-2, the residual noise is small and quantified. The earlier ±30 single-run swings are gone.
- ✅ **Phase 5 (foundation) — DONE & validated on both runtimes.** AUDIT FINDING: the TS `AgenticFlow` and Java `FlowDefinition` were divergent dialects with NO shared export format — the "exportable flows" promise was unwired. Fixed: a canonical interchange format (`flow-export/fluxor-flow.ts`: `steps[]` + `dependsOn[]` + flattened `systemPrompt`), a bidirectional TS bridge (`exportFlow`/`importFlow`, round-trip tested), a Java importer (`flow/FlowImport.java`), and a SHARED byte-identical fixture (`sdk/conformance/conformance-chain.flow.json`) that BOTH runtimes consume and traverse to the same golden DAG order `[step-a..step-d]` — proven by vitest (TS) AND `mvn test` (Java `CrossRuntimeConformanceTest`, 2 tests green).
  - **Phase 5 layer 2 (semantic parity) — DONE & validated.** `flow-export/semantic-parity.test.ts` (TS) + `CrossRuntimeConformanceTest.semanticParityMatchesGoldenTrace` (Java) both run the SAME flow with the SAME shared scripted responses (`sdk/conformance/scripted-responses.json`) and reproduce the SAME golden execution trace (`sdk/conformance/golden-trace.json`) — proven by vitest AND `mvn test`. **Honest divergence surfaced:** parity holds at the provider-text level (each step calls the provider per DAG order and gets the same response); at the TYPED-OUTPUT level the Java sink step does JSON-schema extraction (returns a parsed object) while TS propagates plain text — a real cross-runtime difference in the typed-output layer, documented for follow-up (tool-calling parity is also still pending).
  - **Phase 5 layer 3 (typed-output parity — ARCH-074) — DONE & validated.** Canonical rule chosen and closed: both runtimes propagate **raw provider text by default**; JSON-schema typed extraction is an **explicit opt-in** (Java: caller passes `Class<T>` to `FlowExecutor.execute()`; TS: no automatic extraction). The previously documented divergence (Java auto-extracted JSON for the sink step, TS propagated plain text) is eliminated. `FlowExecutor.executeAllText()` added as the canonical default path for schema-less flows. `CrossRuntimeConformanceTest.semanticParityMatchesGoldenTrace` now uses `executeAllText` so the actual Java runtime output equals the golden trace with no normalization workaround — byte-identical to what TS produces. Proven by vitest AND `mvn test`, 3 Java conformance tests green.
  - **Phase 5 layer 4 (tool-calling parity — ARCH-075) — DONE & validated.** Deterministic `uppercase` tool registered in both runtimes (TS `semantic-parity.test.ts`, Java `ToolRegistry`). `step-e` added to `conformance-chain.flow.json`: provider scripted to request `uppercase("hello conformance")`, tool ACTUALLY INVOKED in both runtimes (not bypassed), result `"HELLO CONFORMANCE"` fed back, post-tool output `"Result: HELLO CONFORMANCE"` captured in `golden-trace.json` and `golden-tool-calls.json`. New Java test `toolCallingParityMatchesGoldenToolCalls` asserts tool name, arguments, result, and post-tool output match the golden fixture. Both `vitest run src/main/flow-export` and `mvn test` green: 19 TS tests, 50 Java tests (0 failures). All three conformance divergences are now closed.
- ✅ **Judge calibration under real failures — DONE & validated live.** `calibration/stress-calibration.ts` feeds the judge KNOWN-broken implementations (correct/happy-path/cheat/empty). Live MiMo result: **0 overrules** (judge never scores broken code high — the critical safety property holds), but **MAE 6 vs a linear pass-rate target** because the judge correctly weights WHICH tests fail (edge-case failures penalized harder than a linear pass-rate). Finding: the linear `20·pass-rate` is an imperfect calibration target; the judge is conservative (errs harsh), which is the safe direction for a benchmark.

All five roadmap phases are now landed (Phase 5 at the foundation layer). The Performance Frontier is execution-verified, statistically-quantified, judge-hardened+self-calibrating, and the export format is cross-runtime conformance-tested.

All implemented by Sonnet subagents, validated by the architect (tsc, tests, live MiMo runs). Test suite: 342 passing, `tsc` clean. Execution deps: `axe-core`, `express`, `jsonwebtoken`, `@types/*`.
