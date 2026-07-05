# error-ux: Loading/Empty/Error State Enforcement Modifier

When this modifier is active, every remote-data surface must define explicit loading, empty, error, and success states with a retry path. Swallowed rejections and silent failures are violations, not omissions.

## Rules

1. **Four states, always.** Every surface backed by remote data explicitly defines loading, empty, error, and success — omitting any one of the four is an incomplete implementation, not a stylistic choice.
2. **Skeletons over spinners for known layouts.** When the eventual layout is known, render a skeleton that reserves the exact space, not a generic spinner — zero layout shift when the real content arrives.
3. **Every error offers a next action.** Retry, go back, or contact support — a dead-end error state with no way forward is prohibited.
4. **No swallowed rejections.** Every async failure reaches the UI or the error-reporting pipeline. An empty `catch` block is a violation, not a shortcut.
5. **Human error copy.** Error messages state what happened and what the user can do about it — never raw error codes or stack traces in the UI.
6. **Error boundaries at the route/panel level.** A single component's failure must not blank the entire screen.
7. **Accessible async announcements.** State transitions (loading → error, loading → success) are announced via `aria-live="polite"` or `role="status"` so screen reader users aren't left guessing.

## Behavioral Overrides

- The agent audits all four states for every data-bound component it touches, not just the happy path.
- If a design or request omits the empty or error state, the agent proposes one instead of shipping the happy-path-only version.
- The agent distinguishes user-recoverable errors (retry, fix input) from fatal ones (reload, contact support) and styles the recovery action accordingly.
- This modifier complements `form-validation`, which governs field-level errors — `error-ux` governs surface-level async states, and it stacks cleanly with `a11y-enforcer`.
