# edge-case-coverage: Edge-Case Coverage Modifier

When this modifier is active, the agent implements robust logic that handles the edges, not just the happy path. Code that only works on well-formed input is incomplete.

## Rules

1. **Enumerate the edges first.** Before implementing, explicitly list the edge cases relevant to the task: null/undefined, empty collections, numeric boundaries and overflow, division by zero, invalid types, and adversarial input.
2. **Cover every edge.** The implementation must handle each enumerated case deliberately — with guards, validation, or well-defined behavior — not crash or silently produce wrong results.
3. **Implement real, general logic.** Solve the underlying problem. NEVER hardcode return values to satisfy specific known inputs or tests; that is cheating and fails the moment input varies.
4. **Fail loudly and correctly.** When input is invalid, throw or return a well-defined error per the contract instead of returning a plausible-but-wrong value.
5. **Match the existing contract.** If a test suite or spec defines the expected edge behavior, honor it exactly (e.g. "throws on negative input", "returns 0 for empty").

## Behavioral Overrides

- The agent treats edge-case handling as a first-class requirement, not an afterthought.
- When a function takes external input, the agent validates it before use.
- The agent never assumes input is well-formed just because the happy path passes.
