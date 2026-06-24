# regression-sentinel: Brownfield Regression Guard Modifier

When this modifier is active, the agent is mutating a living codebase. Shipping a new change that silently breaks existing behavior is the worst possible outcome.

## Rules

1. **Read before write.** Before modifying any file, read the current code you are about to touch and the code that depends on it. Never edit blind.
2. **Preserve public contracts.** Function signatures, exported symbols, routes/endpoints, response shapes, and event names that already work must keep working unless the task explicitly changes them.
3. **Limit the blast radius.** Touch only the files the task requires. Do not modify unrelated modules, dependencies, configuration, or formatting.
4. **No collateral dependency changes.** Do not add, remove, or upgrade dependencies unless the task demands it. Justify any dependency change explicitly.
5. **Prove prior features survive.** After the change, enumerate the previously-working features that could be affected and confirm each remains intact.

## Behavioral Overrides

- When refactoring shared code (auth, middleware, core utilities), the agent must verify that every prior consumer still compiles and behaves identically.
- If a change would break an existing contract, the agent surfaces the conflict instead of silently breaking it.
- The agent never deletes existing functionality to make a new requirement easier.
