# ds-shadcn: shadcn/ui Design System

Pins all UI to the shadcn/ui design language and Radix primitives composed with Tailwind.

> **Exclusive group: `design-system`.** This mod belongs to the `design-system` exclusive group. Only one design-system mod may be active in a session at a time — it cannot be stacked with `ds-tailwind` or any other design-system mod. The Heliox loader enforces this automatically and will reject configurations that activate more than one.

## Rules

1. **Build UI from shadcn/ui components and Radix primitives.** Every interactive widget — dialog, dropdown, tooltip, popover, checkbox, select, tabs — must use the shadcn/ui counterpart or its underlying Radix primitive. Do not hand-roll accessible widgets that shadcn already provides.

2. **Follow shadcn composition patterns and the `cn()` class-merge convention.** Combine base component styles with consumer overrides using the `cn()` utility (clsx + tailwind-merge). Never concatenate raw strings to extend class names; always route through `cn()` to avoid specificity conflicts.

3. **Theme via shadcn CSS variables and tokens.** All color and radius values must reference the shadcn CSS variable layer (`--background`, `--foreground`, `--primary`, `--radius`, etc.) defined in `globals.css`. Do not reach past this layer to raw Tailwind color palette values or hardcoded hex.

4. **Accessible primitives over hand-rolled widgets.** If a Radix primitive exists for the interaction pattern being built, it is mandatory. Hand-rolling focus traps, ARIA roles, or keyboard navigation that Radix already handles is a violation — it introduces maintenance debt and accessibility risk.

5. **Keep components in the shadcn structure.** Generated components must live in `components/ui/` following the shadcn file layout. Do not scatter shadcn-derived components into arbitrary directories or merge them with non-shadcn components in a way that obscures their origin.

6. **Extend shadcn variants, don't override them.** Use `cva` variant definitions to add new visual states to an existing shadcn component rather than forking the component file. Forks are only acceptable when the upstream component's API genuinely cannot accommodate the needed change.

7. **Pin to the project's installed shadcn version.** Do not upgrade or downgrade shadcn/ui or Radix packages as a side effect of adding components. If a newer primitive is required, flag it as a dependency upgrade for the project owner to approve.

## Behavioral Overrides

- The agent must check `components/ui/` before creating any new interactive element — if a shadcn equivalent already exists in the project, it must use that file rather than generating a duplicate.
- When modifying an existing shadcn component, the agent must preserve the original shadcn API surface (props, variants, `className` passthrough) so that callers do not break.
- The agent must not install any competing UI library (MUI, Mantine, Chakra, Headless UI) while this mod is active; all UI needs must be resolved through shadcn/ui and Radix.
- Any net-new shadcn component the agent adds must be generated via the official shadcn CLI command (`npx shadcn@latest add <component>`) rather than manually authored, so it stays aligned with the upstream template.
