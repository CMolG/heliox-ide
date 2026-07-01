<div align="center">
  <img src="assets/heliox-logo.png" alt="Heliox IDE" width="160" />
  <h1>Heliox IDE</h1>

  <p>
    <a href="https://github.com/CMolG/heliox-ide/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/CMolG/heliox-ide/ci.yml?label=CI" alt="CI status" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/github/license/CMolG/heliox-ide" alt="License: Apache-2.0" /></a>
    <a href="https://github.com/CMolG/heliox-ide/releases"><img src="https://img.shields.io/github/v/release/CMolG/heliox-ide?include_prereleases&label=release" alt="Latest release" /></a>
    <a href="CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs welcome" /></a>
  </p>

  <p><strong>Visual-first agentic IDE with E2E snapshot validation.</strong></p>
  <p>
    An open-source desktop IDE that orchestrates AI agents on a spatial canvas,<br/>
    validating every change with visual regression snapshots and Core Web Vitals.
  </p>

  <br/>

  <p>
    <a href="https://www.helioxide.com">Website</a> ·
    <a href="#getting-started">Getting Started</a> ·
    <a href="#features">Features</a> ·
    <a href="#architecture">Architecture</a> ·
    <a href="#marketplace">Marketplace</a> ·
    <a href="#contributing">Contributing</a>
  </p>
</div>

<br/>

---

## Why Heliox?

Most AI coding tools are chat windows bolted onto editors. Heliox is different:

- **Spatial canvas** — Arrange agent sessions, file explorers, and Kanban boards as windows on an infinite, pannable desktop. Connect them visually. Drag roles and modifiers onto sessions like a design tool.
- **Snapshot-verified agents** — Every agent run is validated against Playwright E2E snapshots and Core Web Vitals. If a change causes visual regression or metric degradation, Heliox auto-corrects up to 3 times before reverting.
- **Provider-agnostic** — Switch between GitHub Copilot, Claude, Gemini, Codex, or any custom CLI with a single setting. No vendor lock-in.
- **Market system** — A built-in library of flows (autonomous loops), roles (specialized personas), and modifiers (constraint layers) that compose together on the canvas.

---

## Project Status (July 2026)

| Area | Status | Notes |
|------|--------|-------|
| Release channel | **Alpha** (`v0.1.0`, pre-release) | Core workflows are usable, but internal APIs and UI behavior are still evolving quickly. |
| Desktop IDE core | **Implemented** | Spatial desktop canvas, agent chat sessions, marketplace, file explorer/editor, backlog, design-system editor, and mental graph are all in active use. |
| Bridge companion | **Implemented (beta)** | Remote bridge server + QR auth + mobile companion app (`src/main/bridge`, `src/bridge-app`). |
| Context map + attachables | **Implemented** | Project graph, session sync, attach/detach flows, and export/search IPC are available. |
| Persistence stack | **Implemented** | Startup initializes SQLite (with migrations), settings storage, and filesystem storage before window boot. |
| Unit tests | **873/873 passing** | 65 files, full `npm test` (Vitest) run completes in ~8s. |
| Lint | **0 errors** | `npm run lint` (ESLint flat config) reports 242 warnings and 0 errors. |
| E2E tests | **14 active suites** | `npm run test:e2e` (Playwright + Electron); a full run takes ~21 min, so CI (`.github/workflows/ci.yml`) only runs a smoke subset on every push/PR. |
| Stability | **Active development** | Ongoing refactors expected; treat this branch as fast-moving rather than frozen/stable. |

---

## Features

### Seamless Desktop Canvas

A Figma-inspired spatial workspace where every panel is a draggable, resizable window.

- Pan and zoom with mouse wheel or trackpad gestures
- Snap alignment guides when positioning windows
- Multi-select and batch move
- Z-index management with focus-to-front
- Visual connection arrows between related windows
- Window states: normal, minimized, maximized with restore

### Agentic Chat Sessions

Each chat window is a full agent session with streaming output, tool-use visualization, and token tracking.

- Real-time streaming with thinking deltas
- Model and effort level selection per session
- File context attachment via slash commands (`/file`, `/project`, `/flows`)
- Approve/reject diffs with keyboard shortcuts (`A` / `R`)
- Auto-commit after successful agent runs (configurable)
- Role and modifier assignment per window

### File Explorer and Editor

A split-pane file manager with a tabbed Monaco editor.

- Hierarchical directory tree with expand/collapse
- Extension-aware file icons with color coding
- Tabbed editor with dirty-state indicator
- Drag a tab out of the window to spawn a standalone file viewer
- Context menu: create, rename, delete, refresh
- Save with `Cmd+S` / `Ctrl+S`
- Monaco configured with Heliox dark theme, `Liberation Mono` / `JetBrains Mono` font

### E2E Snapshot Engine

Playwright-based visual regression and performance monitoring built into the IDE.

- Define E2E flows with steps: `navigate`, `click`, `type`, `screenshot`, `wait`, `scroll`
- Capture baseline snapshots with pixel-level diffing (pixelmatch)
- Collect Core Web Vitals per step: LCP, INP, CLS, TBT, TTFB
- Measure JS heap usage and network stats via Chrome DevTools Protocol
- Impact scoring (-100 to +100) and severity classification: `ok`, `warning`, `block`, `escalate`
- Visual diff overlay for before/after comparison

### Backlog Kanban

A multi-project Kanban board with drag-and-drop card management.

- Columns: Pending, In Progress, Done, Failed
- Priority badges: critical, high, medium, low
- Cards parsed from `.backlog/*.md` files in your projects
- Drag cards between columns to update status
- Filter by priority and status

### Marketplace

Browse and deploy flows, roles, and modifiers from a built-in plugin catalog.

- Category tabs: All, Flows, Roles, Modifiers
- Full-text search across names and descriptions
- One-click deploy spawns the item on your canvas
- Color-coded badges by type

### Design System Editor

A window-based design system authoring tool with live preview.

- **Live BrandIdentityCard preview** — See your design system rendered as a brand card in real time as you edit
- **Randomizer** — One-click generation of complete design systems from curated palette archetypes, brand names, and typography pairings
- **Interactive editor** — Color pickers for all 11 color tokens, font selectors for display/body/mono, and free-text fields for radius, spacing, tracking, and borders
- **Export** — Copy as JSON (full theme + brand data) or as a constraint prompt for AI agents
- **Session linking** — Attach a design system to any active agentic chat session
- **Singleton window** — Only one editor instance at a time, accessible from the Dock

### Mental Graph

A spatial mind-mapping layer overlaid on the desktop canvas.

- **Shapes mode** — Double-click on empty canvas to create sticky-note cards with color and text
- **Lines mode** — Draw connections between mental cards to visualize relationships
- **Always visible** — Mental cards remain visible on the canvas regardless of whether the drawing tools are active
- **Dock toggle** — Click the Mental dock button to enable/disable creation tools; hover for a popover to switch between Shapes and Lines modes
- **NodeTree integration** — Mental cards and connections appear in the sidebar tree with edge count badges, navigation, and delete actions

### Prompt Dev Zone

An experimental prompt development workspace for iterating on agent prompts.

- Edit and test prompts in isolation
- Compare outputs across different models
- Accessible as a singleton window from the Dock

### Notification Center

Centralized notification system with OS-level integration.

- Bell icon with unread count badge
- Mark all as read / clear all
- Native OS notifications via Electron

### Settings and Configuration

- **CLI provider**: Copilot, Claude, Gemini, Codex, or custom binary path
- **Behavior toggles**: auto-commit, run E2E after changes, send-on-enter
- **Canvas settings**: click animations, snap threshold
- **Onboarding**: guided quick tour with replay option

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     RENDERER (React + Zustand)               │
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────┐ │
│  │  Seamless    │  │  Agentic    │  │  Marketplace /       │ │
│  │  Desktop     │  │  Chat       │  │  Backlog / Explorer  │ │
│  │  Canvas      │  │  Sessions   │  │  Widgets & Apps      │ │
│  └──────┬───────┘  └──────┬──────┘  └──────────┬───────────┘ │
│         └──────────────────┼───────────────────┘             │
│                            │ IPC (context-isolated)          │
├────────────────────────────┼─────────────────────────────────┤
│                     MAIN PROCESS (Electron)                  │
│                            │                                 │
│  ┌─────────────┐  ┌───────┴───────┐  ┌────────────────────┐ │
│  │  Agent       │  │  IPC Handlers │  │  File / Git / OS   │ │
│  │  Manager     │  │  (60+ routes) │  │  Operations        │ │
│  └──────┬───────┘  └───────────────┘  └────────────────────┘ │
│         │                                                    │
│  ┌──────┴────────────────────────────────────────┐           │
│  │           SNAPSHOT ENGINE (Playwright)         │           │
│  │  Runner · Metrics Collector · Diff Engine     │           │
│  └──────┬────────────────────────────────────────┘           │
│         │                                                    │
│  ┌──────┴────────────────────────────────────────┐           │
│  │           CLI ADAPTER (JSONL streaming)        │           │
│  │  Copilot · Claude · Gemini · Codex · Custom   │           │
│  └───────────────────────────────────────────────┘           │
└──────────────────────────────────────────────────────────────┘
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Electron 41 + Vite 8 + TypeScript 5 |
| UI Framework | React 19 + Tailwind CSS 4 + Zustand 5 |
| Code Editor | Monaco Editor (VS Code engine) |
| E2E Testing | Playwright (headless browser automation) |
| Visual Diff | pixelmatch + PNG.js |
| Performance | PerformanceObserver API + Chrome DevTools Protocol |
| AI Backend | CLI adapters (GitHub Copilot, Claude, Gemini, Codex, custom) |
| Icons | Lucide React + Material Design icons (react-icons) |
| Drag & Drop | dnd-kit (core, sortable, modifiers) |
| Build | Electron Forge (Squirrel, DMG, DEB, RPM) |

---

## Getting Started

### Prerequisites

- **Node.js** 20+
- **Git**
- At least one AI CLI installed:
  - [GitHub Copilot CLI](https://docs.github.com/en/copilot) (`gh copilot`)
  - [Claude CLI](https://docs.anthropic.com/en/docs/claude-cli) (`claude`)
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli) (`gemini`)
  - [Codex CLI](https://github.com/openai/codex) (`codex`)

### Install and Run

```bash
git clone https://github.com/CMolG/heliox-ide.git
cd heliox-ide
npm install
npm start
```

The IDE opens with a guided quick tour on first launch.

### Initialize Heliox for a Project

Open any project folder from the IDE, then initialize the Heliox config:

```bash
npm run heliox:init
```

This creates a `heliox/` directory with:

- `flows.json` — E2E flow definitions (pages, clicks, screenshots)
- `metrics.config.json` — Performance thresholds and regression policy

### Build for Distribution

```bash
# macOS
npm run make -- --platform=darwin

# Windows
npm run make -- --platform=win32

# Linux
npm run make -- --platform=linux
```

Installers are generated in `out/make/`.

---

## Marketplace

The marketplace ships with a curated library of **flows**, **roles**, and **modifiers** authored as Markdown prompt files in the `market/` directory.

### Flows — Autonomous Agent Loops

Flows are multi-step orchestration prompts that run agents in continuous or single-shot mode.

| Flow | Mode | Description |
|------|------|-------------|
| `auto-refiner` | Infinite | Continuously refines UX and architecture, validated by E2E snapshots |
| `auto-optimizer` | Infinite | Profiles and upgrades algorithmic complexity (Big-O, caching, memoization) |
| `auto-reducer` | Infinite | Simplifies and deduplicates code while preserving behavior |
| `auto-visual-fixer` | Infinite | Audits and fixes UI/accessibility issues |
| `auto-architect` | Infinite | Generates backlog cards for structural improvements |
| `auto-feature-engineer` | Finite | Adds production-ready features with tests |
| `auto-saas-cost-reducer` | Finite | Identifies and fixes performance bottlenecks |

Each flow also has a `-finite` variant for single-run execution where applicable.

### Roles — Specialized Agent Personas

Roles inject a system prompt that shapes agent behavior and expertise.

| Role | Focus |
|------|-------|
| Frontend Engineer | UI components, responsive design, CSS |
| Backend Engineer | APIs, databases, server logic |
| QA Engineer | Testing, regression prevention |
| DevOps Engineer | Infrastructure, CI/CD, deployment |
| Security Researcher | Vulnerability audits, hardening |
| Software Architect | System design, refactoring |
| Data Scientist | Data pipelines, ML models |
| Product Manager | Feature prioritization, specs |
| Technical Writer | Documentation, READMEs, JSDoc |

### Modifiers — Constraint Layers

Modifiers stack on top of roles to enforce coding constraints.

| Modifier | Effect |
|----------|--------|
| `test-driven` | Write tests before implementation (TDD) |
| `dry-run` | Simulate changes without committing |
| `a11y-enforcer` | Enforce WCAG accessibility (ARIA, semantic HTML) |
| `extreme-performance` | Aggressive caching, memoization, worker threads |
| `security-hardened` | CSP headers, input validation, no eval |
| `strict-linting` | Enforce strict ESLint rules |
| `legacy-compat` | Maintain backward compatibility |
| `verbose-comments` | Add detailed code documentation |
| `zero-dependencies` | No external npm packages |

Flows, roles, and modifiers compose together: drag a role onto a chat window, stack modifiers on the bottom edge, and attach a flow on the right.

---

## E2E Snapshot Validation

Heliox validates agent changes against visual snapshots and performance metrics. This is the core feedback loop that prevents regressions.

### How It Works

```
1.  Agent receives a task
2.  Agent makes code changes
3.  Heliox runs E2E flows (Playwright)
4.  Captures screenshots + Core Web Vitals
5.  Compares against baseline snapshots (pixelmatch)
6.  If regression detected:
    a.  Auto-correct (up to 3 attempts)
    b.  If all attempts fail → revert changes
7.  If pass → commit and log to heliox-results.tsv
```

### Metrics Thresholds

| Metric | Limit | Description |
|--------|-------|-------------|
| LCP | 2500 ms | Largest Contentful Paint |
| INP | 200 ms | Interaction to Next Paint |
| CLS | 0.10 | Cumulative Layout Shift |
| TBT | 300 ms | Total Blocking Time |
| JS Heap | 150 MB | Memory usage |

### Regression Policy

| Setting | Default |
|---------|---------|
| Max auto-corrections | 3 |
| Critical degradation threshold | 50% |
| Block on critical | Yes |
| Revert on exhausted attempts | Yes |
| Pixel diff threshold | 0.1% |

### Results Log

Every agent run is logged to `heliox-results.tsv`:

```
commit      target                  status    lcp_delta  visual_diff  description
68ebc959    ipc-handlers/store      merged    n/a        0.0%         Fix IPC listener memory leak
a4010b98    metrics-collector       merged    n/a        0.0%         Implement real INP/TBT collection
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+O` | Open project |
| `Cmd+N` | New agent session |
| `Cmd+K` | Focus chat input |
| `Cmd+L` | Toggle logs panel |
| `Cmd+T` | Toggle terminal output |
| `Cmd+B` | Toggle sidebar |
| `Cmd+\` | Toggle chat panel |
| `Cmd+/` | Toggle help |
| `Cmd+S` | Save current file |
| `Cmd+1-5` | Switch to session by index |
| `A` | Approve diff (during review) |
| `R` | Reject diff (during review) |
| `Esc` | Close active modal |

---

## Project Structure

```
heliox-ide/
├── src/
│   ├── main/                    # Electron main process
│   │   ├── index.ts             # App entry, storage bootstrap, window lifecycle
│   │   ├── ipc-handlers.ts      # Core IPC routes (file, git, agent, market)
│   │   ├── context-map/         # Context graph + attachable injection IPC
│   │   ├── storage/             # SQLite migrations + settings + fs storage
│   │   ├── bridge/              # Remote bridge server (QR auth + websocket relay)
│   │   ├── agent-manager.ts     # Agent orchestration with auto-correction
│   │   └── file-patcher.ts      # Unified diff application
│   ├── preload/
│   │   └── index.ts             # Context-isolated bridge (Heliox + storage APIs)
│   ├── renderer/
│   │   ├── App.tsx              # Root component
│   │   ├── index.css            # Tailwind + Heliox design tokens
│   │   ├── store/               # Zustand stores (app + desktop)
│   │   └── components/
│   │       ├── desktop/         # Canvas, windows, dock, snap guides
│   │       ├── atoms/apps/      # Chat, explorer, marketplace, notifications, design system editor
│   │       ├── atoms/widgets/   # Backlog Kanban
│   │       ├── atoms/plugins/   # Window content renderers
│   │       ├── atoms/attachment/ # Role, flow, modifier attachments
│   │       └── desktop/mental/  # Mental graph canvas (React Flow sticky notes + edges)
│   ├── ai-adapter/              # Multi-provider adapter layer
│   ├── copilot-adapter/         # Legacy Copilot-specific adapter
│   ├── bridge-app/              # Mobile companion PWA (Bridge client UI)
│   ├── snapshot-engine/         # Playwright runner, metrics, diff engine
│   └── types/                   # TypeScript type definitions
├── market/
│   ├── inventory.json           # Plugin catalog (flows, roles, mods)
│   ├── flows/                   # Autonomous loop prompt definitions
│   ├── roles/                   # Agent persona prompt definitions
│   └── mods/                    # Constraint modifier prompt definitions
├── e2e/                         # Playwright E2E tests (30+ suites including design system editor)
├── assets/
│   ├── heliox-logo.png
│   └── heliox-templates/        # Project init templates
├── forge.config.ts              # Electron Forge packaging config
├── vite.main.config.ts
├── vite.preload.config.ts
├── vite.renderer.config.ts
└── vitest.config.ts
```

---

## Testing

```bash
# Unit tests (Vitest)
npm test

# E2E tests (Playwright + Electron)
npm run test:e2e
```

The E2E suite covers 30+ test suites including window management, drag-and-drop, marketplace deployment, agent lifecycle, keyboard shortcuts, canvas navigation, and the full attachment system.

---

## Contributing

We welcome contributions. Please read these guidelines before opening a PR.

### Rules

1. **No emoji as icons.** All icons must be SVG-based via [Lucide React](https://lucide.dev). Use `<LucideIcon name="..." />` from `src/renderer/components/desktop/LucideIcon.tsx`.

2. **Market prompts are human-authored only.** Files in `market/flows/`, `market/roles/`, and `market/mods/` are prompt definitions written by humans. AI agents must not create, modify, or delete these files. Only human contributors may edit the marketplace content.

### Development Workflow

```bash
npm install          # Install dependencies
npm start            # Launch in development mode (hot reload)
npm test             # Run unit tests
npm run test:e2e     # Run E2E tests
```

### Design Principles

- **Dark theme only** — The UI is designed around a dark palette (`#0a0a0a` background, `#111` surfaces). Do not introduce light themes.
- **Cognitive minimalism** — Every element must earn its place. Prefer command-palette actions and inline interactions over new panels.
- **Accessibility** — All interactive elements must have `focus-visible` outlines, ARIA labels, and keyboard navigation.
- **Reduced motion** — Respect `prefers-reduced-motion` for all animations.

---

## License

[Apache License 2.0](LICENSE)

---

## Credits

The dotted canvas wave animation is inspired by the work of **Stijn Van Minnebruggen** ([@donotfold](https://codepen.io/donotfold)) — original pen: [codepen.io/donotfold/pen/yyapzOP](https://codepen.io/donotfold/pen/yyapzOP).
