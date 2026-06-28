# ds-tailwind: Tailwind CSS Design System

Pins all styling to Tailwind CSS utility classes and design tokens; no ad-hoc CSS or competing styling systems.

> **Exclusive group: `design-system`.** This mod belongs to the `design-system` exclusive group. Only one design-system mod may be active in a session at a time — it cannot be stacked with `ds-shadcn` or any other design-system mod. The Heliox loader enforces this automatically and will reject configurations that activate more than one.

## Rules

1. **Style exclusively with Tailwind utility classes.** Every visual property — layout, spacing, color, typography, borders, shadows — must be expressed through Tailwind classes applied directly to JSX/HTML elements. No separate `.css` files for component-level styling, no CSS Modules, no styled-components, no emotion.

2. **Use theme tokens, not arbitrary values.** Pull spacing, color, and type from `tailwind.config` (or `@theme` in v4) tokens — `p-4`, `text-primary`, `bg-surface`. Arbitrary values in square brackets (`w-[372px]`, `text-[#e03e3e]`) are a last resort and must be accompanied by an inline comment explaining why no token satisfies the need.

3. **No inline style objects for what utilities can express.** `style={{ marginTop: '12px' }}` when `mt-3` exists is a violation. Inline styles are permitted only for dynamic values that cannot be expressed as utilities (e.g., a runtime-computed `width` derived from a drag handle).

4. **Compose repeated patterns via components or `@apply`, not copy-paste.** If the same cluster of utilities appears three or more times, extract it into a shared component or — if purely CSS — a single `@apply` rule in a utility layer. Repetition defeats the purpose of a design system.

5. **Respect the configured spacing, color, and type scale.** Do not introduce spacing values, font sizes, or colors that fall outside the project's `tailwind.config` scale. If a new token is genuinely needed, add it to the config rather than patching it inline across components.

6. **Prefix class names consistently.** If the project uses a Tailwind prefix or a `dark:` variant strategy, apply it everywhere. Never mix prefixed and unprefixed utilities in the same project.

7. **Purge-safe class references only.** Never construct class names through string interpolation (e.g., `` `text-${color}-500` ``). Always reference complete, static class strings so the Tailwind content scanner can detect them at build time.

## Behavioral Overrides

- The agent must remove any non-Tailwind CSS it encounters in files it edits and replace it with equivalent utility classes, flagging anything it cannot translate.
- Before introducing an arbitrary value, the agent must first search `tailwind.config` (or `@theme`) for an existing token that satisfies the need. Only if none exists may it use an arbitrary value, and it must add a `// TODO: add token` comment.
- The agent must not install or import any additional CSS-in-JS library, CSS framework, or component library that ships its own styling system while this mod is active.
- Any new component the agent creates must include a brief comment at the top of the file noting the Tailwind version and config file path it targets, so future maintainers can resolve token references unambiguously.
