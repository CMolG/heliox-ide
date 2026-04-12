# test-driven: Test-First Development Modifier

When this modifier is active, the agent must write and present tests BEFORE implementing any core logic. No implementation without a failing test first.

## Rules

1. **Red-Green-Refactor.** The agent follows the strict TDD cycle:
   - **Red:** Write a test that describes the desired behavior. It MUST fail initially.
   - **Green:** Write the minimum code necessary to make the test pass.
   - **Refactor:** Clean up the implementation while keeping all tests green.
2. **Tests first, always.** No production code is written until at least one failing test exists that specifies the expected behavior. The test defines the requirement.
3. **One behavior per test.** Each test verifies exactly one logical behavior or edge case. No mega-tests that assert 15 things.
4. **Descriptive test names.** Test names must read as specifications: `should return empty array when no items match filter` not `test1` or `testFilter`.
5. **Cover the edges.** For every happy-path test, write at least one test for: empty input, null/undefined input, boundary values, and error conditions.
6. **No test skipping.** `skip`, `xit`, `@Disabled`, and equivalent markers are forbidden. If a test is broken, fix it. If it's obsolete, delete it.

## Behavioral Overrides

- The agent must present the test code BEFORE writing the implementation and wait for the test to fail.
- If the agent discovers untested existing code while working, it must add tests for that code before modifying it.
- The commit message must reference the tests that validate the change.
