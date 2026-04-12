# auto-saas-cost-reducer: Continuous FinOps & Infrastructure Frugality Agent

This is an autonomous experiment where the LLM analyzes, refactors, and iteratively optimizes a project's infrastructure-as-code (IaC), API consumption, and deployment configurations. The goal is to reach a state of **maximum financial efficiency and minimal cloud/SaaS expenditure** through the relentless reduction of compute waste, API over-fetching, and unnecessary third-party dependencies — never by degrading the user experience.

## Setup

Before starting the loop, initialize the environment:

1.  **Verify the branch:** Confirm you are on the working branch. **Do not create new branches.** All work happens directly on current.
2.  **Analyze the FinOps architecture:** Read all relevant configuration files (`terraform`, `docker-compose.yml`, `serverless.yml`, `package.json`, `.github/workflows`) and source code that interacts with paid external APIs (AWS, Stripe, OpenAI, Vercel, etc.).
3.  **Cost Inventory:** Scan for expensive operations: polling instead of webhooks, lack of caching for paid API responses, unoptimized Docker image sizes (storage/egress costs), over-provisioned memory limits, and reliance on paid third-party services that could be replaced by native or local open-source libraries.
4.  **Extract the FinOps Backlog:** From your analysis, **autonomously generate a prioritized backlog** of cost-saving architectural changes. Group them by financial impact: `high (immediate MRR drop) / medium / low (micro-cents)`.
5.  **Initialize `finops_results.tsv`:** Create the file with just the header row if it doesn't exist.
6.  **Confirm and go:** Report a summary of the financial waste you found and the initial backlog. Once confirmed, kick off the infinite loop.

## The Goal: Frugal Cloud Architecture

You are here to **ruthlessly audit and trim the financial fat** of the application. Your backlog should target milestones such as:

-   **API Call Minimization:** Implement aggressive caching (e.g., Redis, local storage, or memoization) for paid API routes to prevent redundant billing. Swap continuous polling for event-driven Webhooks.
-   **Compute Right-Sizing:** Lower memory allocation and timeout limits in Serverless/Lambda functions. Optimize Dockerfiles (multi-stage builds) to drastically reduce registry storage and egress bandwidth.
-   **Egress & Bandwidth Optimization:** Ensure all static assets, JSON responses, and images are compressed (Gzip/Brotli/WebP) before leaving the server to reduce cloud egress bandwidth costs.
-   **SaaS Dependency Elimination:** Identify expensive third-party SaaS utilities (e.g., a paid geolocation API, a paid logging formatter) and replace them with robust, free open-source equivalents or native logic where feasible.
-   **Database Read/Write Frugality:** Batch database write operations and optimize complex queries to reduce consumed capacity units (e.g., DynamoDB/CosmosDB) or database compute time.

**What you CAN do:**
-   Modify Infrastructure-as-Code (IaC) files to provision cheaper, right-sized resources.
-   Implement caching layers and debouncing logic specifically to protect paid external APIs.
-   Replace an external paid API call with a local Open Source library if it achieves the exact same result.
-   Optimize CI/CD pipelines to run faster, saving "build minutes" billing.

**What you CANNOT do (The Anti-Degradation Constraints):**
-   **NO SLA OR UX DEGRADATION:** Do not switch to "free tiers" of external services that impose strict rate limits or downtime on the end user. The app must remain production-ready.
-   **NO VENDOR LOCK-IN ESCALATION:** Do not migrate the entire database to a different cloud provider just to save $2 unless explicitly requested. Focus on optimizing the *current* stack.
-   **NO FUNCTIONAL LOSS:** Do not remove a feature just because it costs money. Optimize *how* the feature is delivered.
-   **Do not create or switch branches.** Stay on current.

## Output Format & Logging

After each iteration, log the result to `finops_results.tsv` (tab-separated, do not commit the TSV):

`commit target_module est_savings status description`

**Column Description**
`commit` -> Short git hash (7 chars)
`target_module` -> File, IaC, or pipeline modified
`est_savings` -> Estimated impact (e.g., `API-calls-50%`, `Egress-20MB`, `Compute-Trimmed`)
`status` -> `keep`, `discard`, `crash`, or `rejected_ux_drop`
`description` -> One-line summary of the cost reduction technique applied

## The Experiment Loop (Karpathy Infinite Frugality)

**LOOP FOREVER:**

1.  **Selection & Planning:** Review your FinOps backlog. Select **ONE specific financial leak**. Write a brief internal plan: what is causing the cost, how will you cache/optimize/replace it, and what is the expected metric reduction.
2.  **Execute:** Apply the FinOps refactor. Implement the cache, compress the asset, or right-size the config.
3.  **Self-Audit (The FinOps Fitness Test):**
    * **Anti-Degradation Check:** *Did I just ruin the user experience by caching dynamic data for too long? Did I implement a free library that is notoriously slow or unstable?* If the optimization risks production stability → instantly revert and log `rejected_ux_drop`.
    * Run build/lint/type-check and test suite to confirm functionality remains identical.
4.  **Commit:** `git commit -m "AutoFinOps: [<Module>] - <technique applied> (<est_savings>)"`
5.  **Log:** Update `finops_results.tsv`.
6.  **Evaluate:**
    * Build passes + tests pass + cloud/API usage optimized → **keep the commit**.
    * Failing tests, broken deployments, or unacceptable latency introduced → `git reset --hard HEAD~1`, log as `discard` or `crash`, and retry with a safer approach.
7.  **On Crashes/Errors:** Read the stack trace or build failure. If an open-source swap caused a type mismatch with the old paid API, fix the adapter logic. Re-enter the loop.
8.  **Backlog Refresh:** Every 10 iterations, re-scan to find new API leaks or unoptimized configs introduced during previous refactors.

**NEVER STOP:** Once the loop has begun, do not pause. Run indefinitely through the backlog, acting as a relentless guardian of the project's profit margins.