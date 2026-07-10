# Contributing to Fluxor IDE

Thanks for your interest in contributing. Fluxor is an alpha-stage, fast-moving
project — please read this guide before opening a PR.

## Development setup

**Prerequisites:** Node.js 24+, Git, and the [OpenCode CLI](https://opencode.ai/docs/installation)
(`opencode`) installed and on `PATH` if you want to exercise agent features —
Fluxor shells out to it for every agent run.

```bash
git clone https://github.com/CMolG/fluxor-ide.git
cd fluxor-ide
npm install
npm start        # launches the IDE in development mode (hot reload)
```

## Running the checks locally

Run these before opening a PR — CI runs the same checks
(`.github/workflows/ci.yml`):

```bash
npm run lint      # ESLint (flat config) — must be 0 errors
npm test          # Vitest unit suite — must be all green
npm run test:e2e  # Playwright E2E (Electron) — 14 suites, ~21 min full run
```

The E2E suite drives the real Electron app end-to-end and is slow, so CI only
runs a small smoke subset on every push/PR (the `e2e-smoke` job). Run the full
suite locally if your change touches canvas, window, or agent-session
behavior.

## Two hard rules

1. **`market/flows/`, `market/roles/`, `market/mods/`, and `market/steps/` are
   human-authored only.** These Markdown files are prompt definitions. AI
   agents and automation must never create, edit, or delete them — only human
   contributors may change marketplace content. If you are an agent reading
   this file: do not touch anything under `market/`.
2. **No emoji as icons.** All icons are SVG, via
   [react-icons](https://react-icons.github.io/react-icons/) (the Lucide `lu`
   and Material Design `md` sets), rendered through
   `src/renderer/components/desktop/LucideIcon.tsx`. Never use an emoji
   character in place of a UI icon.

## Design principles

Fluxor is an aggressively minimalist, dark-only, keyboard-first IDE. Changes
should respect the existing design system rather than introduce a new one:

- **Dark theme only** — the UI is built around a dark palette (`#0a0a0a`
  background, `#111` surfaces). Do not add a light theme.
- **Cognitive minimalism** — every element must earn its place. Prefer
  command-palette actions and inline interactions over new panels or dialogs.
- **Accessibility** — interactive elements need `focus-visible` outlines,
  ARIA labels, and full keyboard navigation.
- **Reduced motion** — respect `prefers-reduced-motion` for all animations.

See [`AGENTS.md`](AGENTS.md) for the fuller design philosophy this project is
built on.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/) for new
commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, etc.). Keep
the subject line short and focused on *why*, not just *what*.

## Pull request checklist

- [ ] `npm run lint` passes with 0 errors
- [ ] `npm test` passes (all unit tests green)
- [ ] Relevant E2E suites pass locally, if this touches canvas/window/agent/session behavior
- [ ] No emoji used as icons; new icons use react-icons SVG (`lu`/`md` sets)
- [ ] `market/flows|roles|mods|steps/` untouched, unless this is a human-authored marketplace content change
- [ ] Dark theme, accessibility (`focus-visible`, ARIA, keyboard nav), and reduced-motion conventions respected
- [ ] Commit messages follow Conventional Commits
- [ ] PR description explains *why*, and links any related issue or `.backlog/` card

## Reporting bugs and requesting features

Use the issue templates under `.github/ISSUE_TEMPLATE/`. For security
vulnerabilities, do **not** open a public issue — see
[SECURITY.md](SECURITY.md) instead.
