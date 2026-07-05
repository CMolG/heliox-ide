# review-diff: Critical Change Review Step

A single step that reviews a change (a diff or a set of edited files) against a quality rubric before it is accepted — a reviewer, not an author.

## What this step does

- Reads the changed files and the code they touch.
- Evaluates correctness, edge-case handling, contract preservation, and clarity.
- Reports concrete findings (`file:line` + issue + suggested fix), separating must-fix defects from optional improvements.

## Contract

- **Input:** a change set to review.
- **Output:** a structured review (findings list); it does not silently rewrite the code.
- **Suggested tools:** `list_directory`, `read_file`.

## Rules

- Be specific: every finding cites a location and explains the risk.
- Distinguish correctness bugs from style preferences; do not drown signal in nitpicks.
- Verify the change did not break an existing contract or feature.
