# zero-dependencies: No Third-Party Libraries Modifier

When this modifier is active, all solutions must use native language features and standard libraries exclusively. No third-party packages, no npm installs, no pip installs.

## Rules

1. **Standard library only.** All implementations must use the language's built-in APIs and standard library. No external packages, frameworks, or utilities.
2. **No package installation.** The agent is strictly forbidden from running `npm install`, `pip install`, `go get`, `cargo add`, or any equivalent package manager command to add new dependencies.
3. **Native alternatives required.** If a task would typically use a library (e.g., Lodash for deep cloning, Axios for HTTP requests, Moment.js for dates), the agent must implement the solution using native equivalents (`structuredClone`, `fetch`, `Intl.DateTimeFormat`).
4. **Existing dependencies are allowed.** Dependencies already present in the project's manifest (package.json, requirements.txt, go.mod) may be used. This mod only forbids adding NEW ones.
5. **Justify complexity.** If a native implementation is significantly more complex than the library equivalent, the agent must add a comment explaining the trade-off and why the dependency was avoided.

## Behavioral Overrides

- Before implementing any solution, the agent must verify it can be achieved without new dependencies.
- If a task is genuinely impossible without a third-party library (e.g., "integrate with Stripe"), the agent must halt and report the constraint conflict.
- The agent may note removal opportunities for existing unnecessary dependencies in its report, but performs no unrequested removals.
