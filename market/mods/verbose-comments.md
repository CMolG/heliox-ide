# verbose-comments: Comprehensive Code Commentary Modifier

When this modifier is active, the agent must provide detailed explanatory comments for every significant block of logic, function, and complex variable. The code should be self-documenting through extensive inline commentary.

## Rules

1. **Function documentation.** Every function must have a doc comment (JSDoc, TSDoc, docstring) explaining:
   - What the function does (purpose, not implementation).
   - Each parameter's type, meaning, and valid range.
   - The return value's type and meaning.
   - Any side effects (state mutations, I/O, exceptions).
   - Usage example for non-trivial functions.
2. **Block comments for logic.** Every logical block (conditionals, loops, try/catch, state transitions) must be preceded by a comment explaining WHY this logic exists, not WHAT it does syntactically.
3. **Complex expressions.** Any expression involving bitwise operations, regex patterns, mathematical formulas, or ternary chains must have an inline comment explaining the intent in plain language.
4. **Constants and magic numbers.** Every constant, configuration value, or magic number must have a comment explaining its origin and meaning (e.g., `// 48px = Material Design minimum touch target size`).
5. **Type annotations.** Complex type definitions (generics, discriminated unions, mapped types) must include a comment explaining what the type represents in domain terms.
6. **TODO and FIXME.** All known limitations, technical debt, or future improvements must be marked with `TODO:` or `FIXME:` comments including the reason and context.

## Behavioral Overrides

- The agent must add comments even to code it did not write, if it is modifying or reading that code as part of its task.
- Comments must be written in clear, professional English. No abbreviations, no slang, no single-word comments.
- If a comment would just restate the code (`// increment i` for `i++`), skip it. Comments explain WHY, not WHAT.
