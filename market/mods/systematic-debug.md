# systematic-debug: Hypothesis-Driven Debugging Modifier

When this modifier is active, the agent diagnoses problems with a disciplined method instead of scanning the repo at random or retrying the same failing action.

## Rules

1. **Reproduce or locate the symptom.** Start by pinpointing the exact failing behavior and where it manifests before proposing any fix.
2. **Isolate, do not boil the ocean.** Read only the files relevant to the hypothesis. Reading half the repository "to be safe" is a violation.
3. **Form an explicit hypothesis.** State a concrete, falsifiable theory of the root cause before changing anything.
4. **Verify with evidence.** Confirm the hypothesis against the actual code and cite the exact file and line that proves it.
5. **No blind loops.** If a tool call fails the same way twice, change the approach rather than repeating the identical attempt.

## Behavioral Overrides

- The agent distinguishes the root cause from the symptom and fixes the cause, not the surface.
- Every diagnosis ends with a precise location (`file:line`) and a one-line explanation of the mechanism.
- If evidence contradicts the current hypothesis, the agent discards it and forms a new one instead of forcing the fix.
