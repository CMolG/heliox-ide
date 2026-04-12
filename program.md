# Heliox Auto-Refiner: The Infinite E2E Feedback Loop

This is an autonomous experimental loop running inside **Heliox IDE**. The goal is to continuously evolve, optimize, and polish a web application while strictly maintaining its functional integrity and performance baseline.

We are not building new features blindly. **We are relentlessly overhauling the existing architecture, UI, and performance, using Heliox's E2E visual and metric snapshots as our ground truth.**

## Setup & Heliox Integration

To set up a new refinement experiment, verify the Heliox environment:

1. **Verify the Baseline:** Ensure Heliox has successfully recorded the baseline E2E flows (`npm run heliox:baseline`). All `snapshot_eval` thresholds must be calibrated.
2. **Read the in-scope files:**
    - `./heliox/flows.json` — The registered E2E flows we must protect.
    - `./heliox/metrics.config.json` — The hard limits for LCP, CLS, INP, and JS Heap.
3. **Initialize `heliox-results.tsv`:** Create it with the header row if it doesn't exist.
4. **Confirm and go:** Once confirmed, kick off the infinite loop. The AgentManager will handle your sandboxing.

## The Goal: Architectural & UX Perfection

You are here to engineer complex, premium behaviors and eliminate technical debt. Work through the following architectural milestones one by one:

* **Visual Regression Eradication:** Find hardcoded margins/paddings and replace them with robust responsive Grid/Flexbox layouts that survive viewport changes.
* **Core Web Vitals Optimization:** Identify components causing high LCP or CLS (check Heliox metrics) and rewrite them (e.g., implement lazy loading, stable image placeholders, dynamic imports).
* **Component De-duplication:** Consolidate redundant UI components into single, highly configurable polymorphic components without breaking visual snapshots.
* **Complex Interactions:** Add premium micro-interactions (drag-and-drop, context menus, keyboard navigation) while ensuring the Playwright E2E flows still pass.
* **State Management Overhaul:** Migrate local prop-drilling to a robust global state (Zustand/Context) without altering the end-user visual output.

**What you CAN do:**
* Radically refactor existing React/TypeScript components.
* Implement advanced performance techniques (memoization, suspense, worker offloading).
* Modify CSS/Tailwind logic to create highly fluid, responsive designs.

**What you CANNOT do (The Anti-Lazy Constraints):**
* **NO SUPERFICIAL COMMITS:** Do not just change a hex color, font size, or opacity. If your commit does not solve a structural problem, optimize a metric, or implement a real interaction, it is a failure.
* **DO NOT IGNORE METRICS:** If your change increases LCP by >20% or CLS by >0.1, it is a failure, even if the code looks cleaner.
* **DO NOT BREAK ARIA/ACCESSIBILITY:** Heliox uses ARIA snapshots. Do not remove `aria-` tags or semantic HTML just to make the DOM smaller.
* **Do not add heavy external dependencies.** Use standard React features or lightweight libraries already in `package.json`.

## Output Format & Logging

When an iteration is done, log it to `heliox-results.tsv` (tab-separated).

The TSV has a header row and 6 columns:
commit | target | status | lcp_delta | visual_diff_% | description

1. **commit:** Git commit hash (short, 7 chars).
2. **target:** The main component/file modified.
3. **status:** `merged`, `discarded_visual_break`, `discarded_metric_regression`, or `rejected_superficial`.
4. **lcp_delta:** e.g., `-150ms` or `+20ms` (from Heliox output).
5. **visual_diff_%:** e.g., `0.0%` (refactor) or `12.5%` (UX upgrade).
6. **description:** A short text description of the upgrade.

## The Experiment Loop (The Heliox Engineering Logic)

The experiment runs continuously inside the Heliox sandbox.

**LOOP FOREVER:**

1. **Backlog Selection & Planning:** Review the goals above. Select ONE specific goal (e.g., "Refactor Product Grid to fix layout shifts"). Write a brief internal plan of the exact DOM/State changes.
2. **Execute:** Hack the code. Build the logic.
3. **Heliox E2E Audit (The Reality Check):**
    - Emit your changes to the Heliox AgentManager.
    - Wait for the `snapshot_eval` tool response.
    - **Analyze the Feedback:**
        - *Did the visual diff match expectations?* (If doing a pure code refactor, visual diff should be 0%).
        - *Did metrics regress?* (Check `LCP`, `CLS`, `TBT`).
        - *Did any Playwright step fail?*
4. **Auto-Correction Cycle (Max 3 attempts):**
    - If Heliox reports a `METRICS_REGRESSION` or a broken flow, **do not commit**. Read the `likely_cause` from the payload, fix the code, and submit again.
5. **Self-Audit (Anti-Lazy Check):** *Did I just tweak CSS variables?* If yes -> `rejected_superficial`.
6. **Commit:** `git commit -m "AutoRefine: [<Component>] - <summary>"`
7. **Log:** Update `heliox-results.tsv`.
8. **Evaluate & Reset:**
    - If Heliox returns `status: OK` and the Anti-Lazy check passes, **keep the commit**.
    - If you exhaust your 3 auto-correction attempts and Heliox still blocks due to regressions, `git reset --hard HEAD~1` to **discard and revert**.
9. **Next:** Immediately start the next task.

**NEVER STOP:** You run indefinitely. Your success is measured by the continuous stream of merged, fully verified commits logged in the TSV, backed by green Heliox E2E metrics.
The app needs to be felt like a superpowered terminal, see projects like Air (from JetBrains), OpenCoode, Claude Code, Codex, Cursor.