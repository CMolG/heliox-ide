# auto-optimizer: Continuous Performance & Algorithmic Evolution Agent

This is an autonomous experiment where the LLM analyzes, profiles, and iteratively optimizes an existing codebase. The goal is to reach a state of **blistering fast, mathematically sound, and highly efficient software** through relentless algorithmic upgrades and compute reduction — maintaining exact functionality while drastically improving performance.

## Setup

Before starting the loop, initialize the environment:
1.  **Verify the branch:** Confirm you are on the working branch. **Do not create new branches.** All work happens directly on current.
2.  **Analyze the execution paths:** Read all relevant entry-point files to understand the hot paths, render cycles, data processing pipelines, and animation frames.
3.  **Performance Profiling (The Bottleneck Inventory):** Scan for algorithmic inefficiencies (e.g., nested loops resulting in exponential time complexity), redundant recalculations, layout thrashing, or brute-force mathematical operations.
4.  **Extract the Optimization Backlog:** From your analysis, **autonomously generate a prioritized backlog** of performance improvements. Group them by computational impact: `critical (blocks UI/high CPU) / medium (noticeable delay) / low (micro-optimizations)`.
5.  **Initialize `results.tsv`:** Create the file with just the header row if it doesn't exist.
6.  **Confirm and go:** Report a summary of the bottlenecks found and the initial backlog. Once confirmed, kick off the infinite loop.


## The Goal: Algorithmic Excellence Backlog

You are not here to change _what_ the software does, but _how fast_ and _how efficiently_ it does it. You must swap brute-force logic for elegant math and superior data structures. Your backlog should target milestones such as: 
-   **Algorithmic Complexity Reduction:** Upgrade inefficient algorithms. E.g., replace an $O(N^2)$ Bubble Sort with an $O(N \log N)$ Quick/Merge sort, or replace $O(N)$ array lookups with $O(1)$ Hash Map/Set lookups.
-   **Mathematical Simplification:** Replace heavy, iterative loop-based calculations with closed-form mathematical equations (e.g., calculating a sequence sum using $\sum_{i=1}^{n} i = \frac{n(n+1)}{2}$ instead of a `for` loop).
-   **Caching & Memoization:** Implement Dynamic Programming approaches. Cache the results of expensive, pure functions so they are only calculated once.
-   **Animation & Rendering Efficiency:** Refactor complex animations to use GPU-accelerated properties (transform/opacity instead of top/left), implement `requestAnimationFrame`, and debounce or throttle high-frequency events (scroll, resize).
-   **Data Structure Swaps:** Identify places where arrays are misused for frequent insertions/deletions and swap them for Linked Lists, Trees, or Maps, ensuring the public interface remains identical.


**What you CAN do:**
-   Completely rewrite the internal logic of a function to use a faster algorithm.
-   Change internal data structures to optimize memory or speed.
-   Introduce caching layers (memoization) for expensive derivations.
-   Apply advanced mathematics to bypass programmatic loops entirely.
-   Implement complex math or dynamic programming, but you **must** map the algorithmic variables back to the highly descriptive business logic names used in the original file.


**What you CANNOT do (The Anti-Regression Constraints):**
-   **NO FUNCTIONAL CHANGES:** The input/output contract of the optimized module must remain exactly the same. Only the execution time or memory footprint should change.
-   **NO PREMATURE MICRO-OPTIMIZATION:** Do not sacrifice readability to save 0.001ms on a function that runs once a day. Focus on hot paths, large datasets, and render loops.
-   **Do not add heavy external libraries** just for a utility function (e.g., do not import Lodash just for memoization; write it natively).
-   **Do not create or switch branches.** Stay on current.
-   **NO VARIABLE OBFUSCATION (NO "ACADEMIC" NAMING):** You must strictly respect the existing naming conventions of the codebase. Do not rename descriptive variables (e.g., `userCartItems`) to single-letter mathematical notation (e.g., `i`, `n`, `ptr`, `x`) just because you are applying a mathematical algorithm. Production code must remain readable.


## Output Format & Logging

After each iteration, log the result to `results.tsv` (tab-separated, do not commit the TSV):

`commit target_module metric_delta status description`

**Column**

**Description**

`commit`

Short git hash (7 chars)

`target_module`

File, component, or algorithm modified

`metric_delta`

The performance gain (e.g., `O(N^2)->O(N)`, `FPS+15`, `Memory-20%`)

`status`

`keep`, `discard`, `crash`, or `rejected_regression`

`description`

One-line summary of the algorithm/math applied

## The Experiment Loop (Karpathy Infinite Optimization)

**LOOP FOREVER:**
1.  **Selection & Planning:** Review your optimization backlog. Select **ONE specific bottleneck**. Write a brief internal plan: what is the current Big O complexity, what data structure or mathematical equation will you apply, and what is the expected gain.
2.  **Execute:** Apply the algorithm. Implement the math.
3.  **Self-Audit (The Benchmark Test):**
    -   **Optimization Check:** _Did this actually improve time or space complexity? Is it mathematically sound?_ If the logic is just as slow but harder to read → instantly revert and log `rejected_regression`.
    -   Run a build/lint/type-check and the test suite to confirm the output is 100% identical to the pre-optimized version.
    -   **Lexical Check:** _Did I ruin the readability of the file by stripping out descriptive variable names and replacing them with `a`, `b`, `i`, `j`, or `temp`?_ If the code reads like a dense academic textbook rather than clean production code → instantly revert and log `rejected_regression`.

4.  **Commit:** `git commit -m "AutoOptimize: [<Module>] - <algorithm applied> (<metric_delta>)"`
5.  **Log:** Update `results.tsv`.
6.  **Evaluate:**
    -   Build passes + tests pass + mathematically/algorithmically faster → **keep the commit**.
    -   Tests fail, memory leaks introduced, or edge cases missed → `git reset --hard HEAD~1`, log as `discard` or `crash`, and retry with a corrected algorithm.

7.  **On Crashes/Errors:** Read the full stack trace. If a faster algorithm broke an edge case (e.g., you swapped a stable sort for an unstable sort and broke object ordering), diagnose the logical failure. Apply a better solution. Re-enter the loop.
8.  **Backlog Refresh:** Every 10 iterations, re-scan the codebase for new bottlenecks introduced by the integration of the optimized modules or missed in the initial scan.


**NEVER STOP:** Once the loop has begun, do not pause to ask for permission to continue. Run indefinitely through the backlog, upgrading the algorithmic complexity to production standards.