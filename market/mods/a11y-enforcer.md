# a11y-enforcer: WCAG AAA Accessibility Enforcement Modifier

When this modifier is active, all generated UI elements must meet WCAG 2.1 Level AAA standards. Accessibility is not a feature — it is a non-negotiable requirement.

## Rules

1. **ARIA labels required.** Every interactive element (button, link, input, select, checkbox, radio) must have an accessible name via visible text content, `aria-label`, or `aria-labelledby`. No unnamed interactive elements.
2. **Semantic HTML first.** Use native HTML elements (`<button>`, `<nav>`, `<main>`, `<article>`, `<header>`) before reaching for ARIA roles. A `<div onClick>` is never acceptable — use `<button>`.
3. **Focus management.** All interactive elements must be keyboard-accessible via Tab/Shift+Tab. Custom focus order is set via `tabIndex` only when the DOM order is insufficient. Focus traps are implemented for modals and dialogs.
4. **Color contrast AAA.** Normal text must have a contrast ratio of at least 7:1. Large text (18pt+ or 14pt+ bold) must have at least 4.5:1. Use tools or manual calculation to verify.
5. **No information by color alone.** Color must not be the only means of conveying information. Use icons, patterns, text labels, or underlines in addition to color.
6. **Screen reader compatibility.** Dynamic content changes must be announced via `aria-live` regions. Form errors must be associated with their inputs via `aria-describedby`. Loading states must be communicated via `aria-busy`.
7. **Motion and animation.** Respect `prefers-reduced-motion`. All animations must have a reduced-motion alternative that conveys the same information without movement.
8. **Touch targets.** All interactive elements must have a minimum touch target of 44x44 CSS pixels (WCAG AAA) with adequate spacing between adjacent targets.
9. **Composite widgets follow WAI-ARIA Authoring Practices exactly.** For grids, listboxes, comboboxes, menus, tabs, tree views, and date pickers:
   - Mark selectable items with `aria-selected` (or `aria-checked`) — a screen reader must be able to tell which items are selected. Missing `aria-selected` on a selected cell is a hard failure.
   - Use **roving `tabindex`**: exactly one tab stop for the whole widget, with arrow keys (and Home/End/PageUp/PageDown where appropriate) moving focus inside it.
   - Use **semantic headings** (`<h1>`–`<h6>`), never `role="heading"` on a `<div>`.
   - Avoid `role="application"` unless you fully reimplement browser keyboard semantics; it traps assistive-tech navigation otherwise.
   - Every ARIA state you style in CSS must actually be set in JS — no dead `aria-*` rules.

## Behavioral Overrides

- The agent must audit every UI element it creates or modifies for WCAG AAA compliance before committing.
- If an existing component fails accessibility standards and the agent is modifying it, the agent must fix the accessibility violation in the same commit.
- The agent must test keyboard navigation flow after every UI change and verify logical tab order.
