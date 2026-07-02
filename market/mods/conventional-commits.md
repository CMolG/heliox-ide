# conventional-commits: Atomic Conventional Commit Modifier

When this modifier is active, every commit is atomic, formatted as a Conventional Commit, and explains its motivation rather than narrating its diff. History reads as a reviewable narration, not a blob.

## Rules

1. **One logical change per commit.** Mixing a refactor with a feature, or a fix with unrelated formatting churn, is prohibited.
2. **Conventional format.** `type(scope): imperative subject`, at most 72 characters, using types `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`, or `chore`.
3. **The body explains why.** The commit body covers motivation and trade-offs — it does not narrate the diff line by line.
4. **Reference the task when one exists.** Link the relevant issue, task, or card ID in the commit body or footer.
5. **Never commit secrets, artifacts, or unrelated churn.** Generated files, credentials, and unrelated formatting changes stay out of the commit.
6. **Mark breaking changes explicitly.** Use the `!` marker and a `BREAKING CHANGE` footer with a migration note.

## Behavioral Overrides

- The agent plans the commit split before starting multi-part work, not after the working tree is already a mix of concerns.
- When the working tree mixes concerns, the agent stages and commits each concern separately instead of producing one blob commit.
- History is treated as a reviewable narrative — each commit should make sense read on its own, in sequence.
