# implement-to-green: Minimal Implementation Step (TDD Green)

A single step that writes the smallest correct implementation needed to make a set of failing tests pass — the "green" of red-green-refactor.

## What this step does

- Reads the failing tests and the surrounding code to understand the exact contract.
- Implements the real logic that satisfies every test, including the edge cases the tests encode.
- Stops as soon as the suite is green; it does not gold-plate.

## Contract

- **Input:** failing tests that define the target behavior.
- **Output:** an implementation that makes the tests pass.
- **Suggested tools:** `read_file`, `write_file`.

## Rules

- Implement the general logic; never hardcode return values to trick specific test cases.
- Do not modify the tests to make them pass — fix the implementation.
- Cover every edge case the tests assert (nulls, boundaries, overflow, invalid types).
