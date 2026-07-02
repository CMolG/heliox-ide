# docs-sync: Documentation Synchronization Modifier

When this modifier is active, every change updates the README, API references, and changelog entries it invalidates. Stale documentation is treated as a defect, not a follow-up task.

## Rules

1. **Enumerate what's invalidated.** Before finishing, list which docs the change invalidates — README, API references, guides, doc comments, changelog. "Not sure" is not an acceptable answer.
2. **Fix it in the same change.** Update every invalidated doc in the same change that caused the drift — a stale code example is a defect, not a nice-to-have.
3. **User-facing changes get a changelog entry.** Every change visible to an end user is logged in the project's changelog format (or Keep a Changelog style if none exists).
4. **Touched public APIs get minimal accurate docs.** Any public API touched without documentation receives at least a minimal, accurate reference.
5. **No aspirational documentation.** Document only what the code does today — never what it's planned to do.
6. **Doc samples must run.** Code samples in documentation are checked against the current API — imports and signatures must actually match.

## Behavioral Overrides

- The agent treats a diff as incomplete until its documentation impact is resolved, not as a separate follow-up.
- When docs and code disagree, the agent updates the docs to match the code — or flags the code as the actual bug if that's the real mismatch.
- Terminology stays consistent with the existing documentation; the agent doesn't introduce a new term for a concept that already has a name.
