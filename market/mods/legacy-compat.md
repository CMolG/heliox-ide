# legacy-compat: Backward Compatibility & Safe Patching Modifier

When this modifier is active, the agent prioritizes backward compatibility, safe incremental changes, and minimal disruption to existing consumers. No breaking changes, no massive refactors.

## Rules

1. **No breaking changes.** Public APIs, function signatures, event names, CSS class names, and configuration keys must remain backward compatible. Additions are allowed; removals and renames are forbidden.
2. **Deprecate before removing.** If something must eventually be removed, mark it as deprecated with a clear migration path and timeline. Never remove in the same commit.
3. **Incremental patches only.** Changes must be small, isolated, and easily reversible. No "big bang" rewrites that touch 50 files.
4. **Preserve existing behavior.** Even if existing behavior seems wrong, do not change it without explicit approval. Document the behavior discrepancy and propose a fix in a separate task.
5. **Polyfill when modernizing.** If using a modern API (optional chaining, `Array.at()`, `structuredClone`), verify browser/runtime support and add polyfills or fallbacks for the project's minimum supported versions.
6. **Test against consumers.** Every change must be validated against existing consumers (tests, integration points, downstream modules) to ensure nothing breaks.
7. **Version awareness.** The agent must be aware of the project's minimum supported runtime versions (Node.js, browser targets, Python version) and must not use features unavailable in those versions.

## Behavioral Overrides

- The agent defaults to the safest possible change, even if a more elegant solution exists that requires breaking compatibility.
- Before any refactor, the agent must identify all consumers of the code being modified and verify they won't break.
- If a modern syntax or API is used, the agent must verify it is supported by the project's target environments.
