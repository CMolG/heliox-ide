# auto-refiner: Continuous Feature Evolution Agent

This is an autonomous experiment where the LLM analyzes, re-architects, and iteratively improves an existing codebase. The goal is to reach a state of **premium, polished, production-grade software** through relentless functional upgrades — never cosmetic patches.

## Setup

Before starting the loop, initialize the environment:
1. **Verify the branch:** Confirm you are on the working branch. **Do not create new branches.** All work happens directly on current.
2. **Analyze the project structure:** Read all relevant entry-point files to fully understand the architecture (main shell, routing, config files, component index, etc.).
3. **Inventory existing features:** Scan all components, modules, pages, or services available. Build a mental model of what exists and its current quality level.
4. **Extract the Feature Backlog:** From your analysis, **autonomously generate a prioritized backlog** of functional improvements — not cosmetic ones. Group them by impact: `high / medium / low`. This is your dynamic roadmap.
5. **Initialize `results.tsv`:** Create the file with just the header row if it doesn't exist.
6. **Confirm and go:** Report a summary of what you found and the initial backlog. Once confirmed, kick off the infinite loop.

## The Goal: Functional Excellence Backlog

You are not here to rename variables or adjust spacing. You are here to **engineer real behaviors** that make the software meaningfully better. Your backlog should target milestones such as:
- **State & Data Integrity:** Identify missing validations, race conditions, or inconsistent state flows and fix them structurally.
- **UX Interaction Depth:** Implement missing interactions that users would expect in production software (keyboard shortcuts, drag-and-drop, multi-select, undo/redo, etc.).
- **Performance Architecture:** Identify bottlenecks (unnecessary re-renders, unoptimized loops, blocking I/O) and re-architect them.
- **Error Resilience:** Add structured error boundaries, fallback states, and graceful degradation where missing.
- **Feature Completeness:** Identify half-built features and complete them fully, including edge cases.
- **Consistency Engine:** Ensure behavioral and visual patterns are consistent across all modules (same patterns for loading, empty states, errors, etc.).

**What you CAN do:**
- Radically refactor any file to implement a missing behavior.
- Rewrite internal logic of any module, component, or service.
- Implement complex algorithms (collision detection, sorting, caching, state machines, etc.).
- Add behavior via native language APIs or already-present dependencies.

**What you CANNOT do (The Anti-Lazy Constraints):**
- **NO SUPERFICIAL COMMITS:** Commits that only change styling, colors, spacing, or naming without implementing a tangible functional improvement are strictly forbidden.
- **NO WORKAROUND HACKS:** Never hide a bug with a conditional. Fix the root cause.
- **Do not add new external dependencies** without explicit justification in the commit message.
- **Do not create or switch branches.** Stay on current.
- **Do not build new features from scratch** unless they complete an already-existing half-built one.

## Output Format & Logging

After each iteration, log the result to `results.tsv` (tab-separated, do not commit the TSV):

commit target_module status description
| Column | Description |
|---|---|
| `commit` | Short git hash (7 chars) |
| `target_module` | File, component, or module modified |
| `status` | `keep`, `discard`, `crash`, or `rejected_superficial` |
| `description` | One-line summary of the *functional* or *structural* change |

## The Experiment Loop (Karpathy Infinite Refinement)

**LOOP FOREVER:**
1. **Backlog Selection & Planning:** Review your extracted backlog or re-inspect the current codebase to find the next highest-impact functional gap. Select **ONE specific goal**. Write a brief internal plan: what states, functions, data flows, or algorithms are needed.
2. **Execute:** Implement the logic. Go deep, not shallow.
3. **Self-Audit (The Fitness Test):**
    - **Anti-Lazy Check:** *Did I implement a new programmatic behavior, or did I only change appearance?* If only appearance → instantly revert and log `rejected_superficial`.
    - Run a build/lint/type-check to confirm no errors or regressions.
    - Conduct a simulated functional review: *Does this work correctly in edge cases? Is the logic robust?*
4. **Commit:** `git commit -m "AutoRefine: [<Module>] - <functional summary>"`
5. **Log:** Update `results.tsv`.
6. **Evaluate:**
    - Build passes + feature works correctly → **keep the commit**.
    - Crashes, regressions, or fails Anti-Lazy check → `git reset --hard HEAD~1`, log as `discard` or `crash`, and retry with a corrected approach.
7. **On Crashes:** Read the full stack trace. Diagnose the root cause. Fix the logic — not the symptom. Re-enter the loop.
8. **Backlog Refresh:** Every 10 iterations, re-scan the codebase to update the backlog with newly discovered gaps or regressions introduced by previous iterations.

**NEVER STOP:** Once the loop has begun, do not pause to ask for permission to continue. Run indefinitely through the backlog, always finding the next structural improvement to engineer.
