# landing-page: Landing Page

Builds a single conversion-focused landing page — hero, value props, social proof, CTA — as one artifact, matching the project's design system. This step produces a complete, visually finished page that can go live; it does not wire up backends, forms, or analytics — those belong to later steps or dedicated mods.

## What this step does

- Reads the project's existing component library, design tokens, and routing conventions before writing a single line to ensure the new page speaks the same visual language.
- Assembles a conversion-focused layout: a hero section (headline + supporting subhead + primary CTA), a value-props section (three to four benefit statements), a social-proof section (testimonials, logos, or metrics), a secondary CTA, and a footer — all in a single page artifact.
- Reuses existing components and tokens throughout; does not introduce a new visual language or one-off styles outside the project's design system.
- Leaves form submissions, authentication, analytics events, and any server interactions as clearly-marked stubs with `// TODO` comments pointing to the appropriate next step.

## Contract

- **Input:** a product or offer description (name, core value proposition, target audience, key benefit statements, any supplied copy or brand assets) and the target project.
- **Output:** one landing page component or route, wired into the project's router, containing no backend logic or real data fetching. All placeholder text must be specific and plausible — no "Lorem ipsum."
- **Suggested tools:** `read_file`, `write_file`, `list_directory`.

## Rules

- Reuse the project's existing design system and components; never invent a new color palette, type scale, or component style for this one page.
- Include exactly one primary CTA — a single, unmistakable conversion action. Secondary CTAs must be visually subordinate.
- All copy must be specific to the product described in the input; generic placeholder text is a failure condition.
- Do not implement real form handling, auth, or analytics in this step — stub those interactions and annotate them clearly so the next step or mod can complete them.
- Ensure the page is accessible (semantic HTML, descriptive alt text, keyboard-navigable) and responsive out of the box; do not defer this to a later step.
