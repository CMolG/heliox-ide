# responsive-design: Mobile-First Responsive Layout

Forces mobile-first, fluid layouts with container queries and relative units; forbids fixed pixel widths that break on resize. Every UI surface generated under this modifier must degrade gracefully from a narrow widget to a full-screen viewport — the IDE renders all panels inside a resizable wrapper, so there is no safe assumption about available width.

## Rules

1. **Design mobile-first, then enhance upward.** Write base styles for the smallest target width first and layer complexity upward with `min-width` breakpoints or container query ranges. Never begin from a desktop assumption and strip down.

2. **Fluid units only — no fixed pixel widths.** Use `%`, `rem`, `ch`, `fr`, and `clamp()` for widths, font sizes, and spacing. Hard-coded `px` widths on layout elements are forbidden; `px` is acceptable only for borders, outlines, and shadow blur values.

3. **Prefer container queries for component-level responsiveness.** Use `@container` rules to let components respond to their own available space rather than the global viewport. Viewport media queries are a last resort for page-level structural shifts only.

4. **Responsive images with `srcset` and `sizes`.** Every `<img>` that is not a decorative icon must declare `srcset` and `sizes` attributes so the browser fetches the appropriately sized asset. Use `width` and `height` attributes to prevent layout shift.

5. **Zero horizontal overflow at any viewport width ≥ 320 px.** No element may cause a horizontal scrollbar on any screen at or above 320 px. Use `overflow-x: hidden` only as a last resort and only on a scoping wrapper, never on `body`.

6. **Tap targets must be at least 44 × 44 px.** All interactive elements — buttons, links, toggles, menu items — must meet the WCAG 2.5.5 target-size minimum. Apply `min-height`/`min-width` or padding rather than expanding the visual footprint where design demands compactness.

7. **Test layout from smallest widget to full screen.** Verify the component at 320 px, at the IDE's default panel widths, and at full-screen before considering the implementation complete. Include comments that document tested breakpoints when non-obvious container-query thresholds are used.

8. **Avoid layout patterns that collapse badly.** Multi-column grids must define a sensible `min-width` per column so they reflow to a single column rather than overflow. Absolute-positioned elements must be accounted for in mobile stacking order.

## Behavioral Overrides

- The agent must audit every layout-affecting CSS rule it produces for hardcoded pixel widths and replace any found with fluid equivalents before finalizing output.
- If an existing component uses fixed widths, the agent must migrate those values to fluid units in the same change — do not leave regressions in place while the new code is fluid.
- When a design token or variable resolves to a fixed pixel width at the theme level, the agent must flag the token as a blocker and propose a fluid replacement rather than silently inheriting the breakage.
