# write-failing-tests: Failing Test Authoring Step (TDD Red)

A single step that specifies desired behavior as executable tests that fail before any implementation exists — the "red" of red-green-refactor.

## What this step does

- Translates the requirement into focused unit tests, one behavior per test, with specification-style names.
- Covers the edges first: empty input, null/undefined, boundary values, and error conditions — not just the happy path.
- Leaves the tests failing on purpose; it does not write the implementation.

## Contract

- **Input:** a behavior/requirement to specify.
- **Output:** a test file that fails for the right reason (missing implementation).
- **Suggested tools:** `read_file`, `write_file`.

## Rules

- One logical behavior per test; no mega-tests asserting many unrelated things.
- Do not write production code in this step.
- Pairs naturally with the `test-driven` mod and the `implement-to-green` step.
