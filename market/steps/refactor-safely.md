# refactor-safely: Behavior-Preserving Refactor Step

A single step that improves the internal structure of existing code without changing its observable behavior.

## What this step does

- Reads the target code and its callers/tests to lock in the current contract.
- Restructures for clarity, deduplication, or simplicity while keeping every public behavior identical.
- Confirms the change is behavior-preserving (tests still green, signatures unchanged).

## Contract

- **Input:** code to improve and its existing contract/tests.
- **Output:** refactored code with identical external behavior.
- **Suggested tools:** `list_directory`, `read_file`, `write_file`.

## Rules

- Never change public signatures, routes, or response shapes unless the task explicitly asks.
- Limit the blast radius to the refactor target; do not touch unrelated modules.
- If a "refactor" would change behavior, stop and surface it instead.
