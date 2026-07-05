# dark-mode: Tokenized Theming & Dark Mode

Requires tokenized light/dark/system theming via CSS custom properties and `prefers-color-scheme`; forbids hardcoded colors. Every color in the product must flow through the design-token layer so that switching themes requires no component changes — only a root attribute flip.

## Rules

1. **All colors via design tokens — never hardcoded hex or rgb.** Every color value used in a component must reference a CSS custom property (e.g., `var(--color-surface-primary)`). Raw `#rrggbb`, `rgb()`, `hsl()`, or Tailwind arbitrary color values that bypass the token system are forbidden.

2. **Support light, dark, AND system with a user override.** The theming system must respond to `prefers-color-scheme: dark` by default (system mode) and allow the user to pin light or dark via a persistent override stored in `localStorage` or a cookie. Three states, not two.

3. **Maintain WCAG AA contrast in both themes.** Every foreground/background pairing must pass a minimum 4.5 : 1 contrast ratio for body text and 3 : 1 for large text and UI components in both light and dark variants. Do not assume a color that passes in one theme passes in the other.

4. **Apply the theme via a `data-theme` attribute or a class on the root element.** Theme tokens must be scoped to `[data-theme="dark"]` or `.dark` on `<html>` or a top-level wrapper. Component files must never contain theme-specific overrides inside their own selectors.

5. **No flash of incorrect theme (FOIT/FOCS).** The correct theme class or attribute must be resolved and applied before the first paint — either via a blocking inline script in `<head>` or via a server-rendered class. Loading the theme after hydration is not acceptable.

6. **Theme illustrations, images, and shadows.** Decorative images and illustrations must have dark-mode alternatives or use `mix-blend-mode`/`filter` where a single asset is used. Box shadows must use token values that are visible against dark surfaces (typically lower opacity, lighter color) rather than the same values used in light mode.

7. **Respect `prefers-contrast` where relevant.** When the OS signals high-contrast mode, the agent must not override it. Ensure tokens include a high-contrast variant or gracefully inherit system forced-colors without hiding borders or focus rings.

## Behavioral Overrides

- The agent must scan every CSS rule and JSX/TSX style prop it writes for raw color values and replace them with token references before output is finalized.
- When creating a new color role (e.g., a one-off decorative tint), the agent must define the token in both light and dark theme blocks — not just the theme currently being worked on.
- If an existing component contains hardcoded colors, the agent must tokenize those values in the same change rather than leaving the inconsistency in place.
- Any generated `<script>` block responsible for theme resolution must be marked as blocking (no `defer`/`async`) and must include a comment explaining why it is blocking.
