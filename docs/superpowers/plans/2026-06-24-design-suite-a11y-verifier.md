# Design Suite A11y Verifier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anchor the `design` suite's `accessibilityScore` on real axe-core WCAG violations from a deterministic static jsdom analysis, instead of LLM guesswork.

**Architecture:** A new `design-verifier.ts` parses `/workspace/index.html` from the VFS snapshot into a jsdom DOM (offline, no network, no script execution from HTML), injects the axe-core bundle into the jsdom window context, runs WCAG 2a/2aa + best-practice structural rules (excluding `color-contrast` which needs real CSS rendering), and returns a machine-readable `A11yVerificationResult`. The result flows into `PFGroundTruth`, the judge prompt (as `<ground_truth_a11y_json>`), and the HTML report panel — mirroring the existing `development` suite's `verifyDevelopment` pattern exactly.

**Tech Stack:** axe-core 4.12.1, jsdom (already in devDependencies), @types/jsdom, TypeScript, Vitest

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/main/performance-frontier/execution/design-verifier.ts` | **Create** | axe-core runner returning `A11yVerificationResult` |
| `src/main/performance-frontier/execution/design-verifier.test.ts` | **Create** | Proves axe discriminates accessible vs inaccessible HTML |
| `src/main/performance-frontier/types.ts` | **Modify** | Add `a11y?` field to `PFGroundTruth` |
| `src/main/performance-frontier/runner.ts` | **Modify** | Add `if (suite === 'design')` ground-truth block + import |
| `src/main/performance-frontier/judge/judge-prompt.ts` | **Modify** | Add `<ground_truth_a11y_json>` evidence + system anchoring instruction |
| `src/main/performance-frontier/report/html-report.ts` | **Modify** | Extend `renderGroundTruth` to surface a11y panel |
| `package.json` / `package-lock.json` | **Modify** | `axe-core` + `@types/jsdom` devDependencies |

---

## STATUS: COMPLETED ✅

All tasks were implemented in a single session. Final validation:

- `npx tsc --noEmit` → 0 errors
- `npx vitest run src/main/performance-frontier` → **113 tests passed, 13 test files**
- Accessible HTML: `violations=0, critical=[], passes=23`
- Inaccessible HTML: `violations=4, critical=["document-title","html-has-lang","image-alt"], passes=6`

---

## Task 1: Install axe-core dependency

**Files:**
- Modify: `package.json`

- [x] **Step 1: Install axe-core and @types/jsdom**

```bash
npm install --save-dev axe-core @types/jsdom
```

Expected: both appear in `devDependencies` in package.json.

- [x] **Step 2: Verify axe.source is available**

```bash
node -e "const axe = require('./node_modules/axe-core'); console.log('version:', axe.version, 'source:', typeof axe.source)"
```

Expected: `version: 4.x.x source: string`

---

## Task 2: Create `design-verifier.ts`

**Files:**
- Create: `src/main/performance-frontier/execution/design-verifier.ts`

Key implementation decisions:
- Parse `/workspace/index.html` from VFS snapshot.
- Build `new JSDOM(html)` with NO resource loading and NO script execution from HTML.
- Set `globalThis.window` and `globalThis.document` to jsdom's, restore in `finally`.
- Inject `axe.source` into the jsdom window via `new window.Function(axe.source)()`.
- Call `windowAxe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','best-practice'] }, rules: { 'color-contrast': { enabled: false } } })`.
- Map result: `violations.length`, `critical = violations.filter(impact critical/serious).map(id)`, `passes.length`.
- NEVER throw — wrap in try/catch returning `ran:false`.

- [x] **Step 3: Write the verifier**

See: `src/main/performance-frontier/execution/design-verifier.ts`

---

## Task 3: Create `design-verifier.test.ts`

**Files:**
- Create: `src/main/performance-frontier/execution/design-verifier.test.ts`

Two HTML fixtures:
1. **Accessible** — `<html lang>`, `<title>`, `<main>`, `<h1>`, labelled `<input>`, `<button aria-label>`, `<img alt>` → expect `ran:true`, `critical.length === 0`.
2. **Inaccessible** — no `<html lang>`, no `<title>`, `<div onclick>` no role, unlabelled `<input>`, `<img>` no alt → expect `ran:true`, `violations > 0`, `critical.length > 0`.

- [x] **Step 4: Write the tests**

See: `src/main/performance-frontier/execution/design-verifier.test.ts`

- [x] **Step 5: Verify tests pass**

```bash
npx vitest run src/main/performance-frontier/execution/design-verifier.test.ts --reporter=verbose
```

Expected: 5 tests pass.

---

## Task 4: Update `types.ts`

**Files:**
- Modify: `src/main/performance-frontier/types.ts:161-170`

- [x] **Step 6: Add `a11y?` to `PFGroundTruth`**

```ts
a11y?: {
  ran: boolean;
  violations: number;
  critical: string[];
  passes: number;
  errorMessage?: string;
};
```

---

## Task 5: Wire `runner.ts`

**Files:**
- Modify: `src/main/performance-frontier/runner.ts`

- [x] **Step 7: Import and add `verifyDesign?` option**

Add import + `verifyDesign?: (vfsSnapshot: Record<string, string>) => Promise<A11yVerificationResult>` to `RunPerformanceFrontierOptions`.

- [x] **Step 8: Add `if (suite === 'design')` block**

Mirrors the `if (suite === 'development')` block exactly. Calls `options.verifyDesign ?? verifyDesign(vfsSnapshot)`, sets `groundTruth = { a11y: {...} }`. Wrapped in try/catch, never crashes the run.

---

## Task 6: Update `judge-prompt.ts`

**Files:**
- Modify: `src/main/performance-frontier/judge/judge-prompt.ts`

- [x] **Step 9: Add system anchoring instruction for a11y ground truth**

When `input.groundTruth?.a11y` is present, push a Spanish system instruction explaining these are REAL axe-core results and `accessibilityScore` MUST be anchored on them; note color-contrast is not captured statically.

- [x] **Step 10: Add `<ground_truth_a11y_json>` evidence block**

Parallel to `groundTruthEvidence`, build `groundTruthA11yEvidence` and spread it into the prompt array.

---

## Task 7: Update `html-report.ts`

**Files:**
- Modify: `src/main/performance-frontier/report/html-report.ts`

- [x] **Step 11: Extend `renderGroundTruth`**

Render a separate "Ground Truth — Accessibility (axe-core WCAG)" panel when `groundTruth.a11y` is present, showing violations/passes/status in the same metric grid style. Critical rule IDs rendered in red.

---

## Task 8: Final validation

- [x] **Step 12: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [x] **Step 13: Full test suite**

```bash
npx vitest run src/main/performance-frontier
```

Expected: all tests pass (113 tests, 13 files).
