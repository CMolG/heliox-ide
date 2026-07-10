<div align="center">
  <img src="assets/fluxor-logo.png" alt="Fluxor IDE" width="160" />
  <h1>Fluxor IDE</h1>

  <p>
    <a href="https://github.com/CMolG/fluxor-ide/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/CMolG/fluxor-ide/ci.yml?label=CI" alt="CI status" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/github/license/CMolG/fluxor-ide" alt="License: Apache-2.0" /></a>
    <a href="https://github.com/CMolG/fluxor-ide/releases"><img src="https://img.shields.io/github/v/release/CMolG/fluxor-ide?include_prereleases&label=release" alt="Latest release" /></a>
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

## Why Fluxor?

Most AI coding tools are chat windows bolted onto editors. Fluxor is different:

- **Spatial canvas** — Arrange agent sessions, file explorers, and Kanban boards as windows on an infinite, pannable desktop. Connect them visually. Drag roles and mods onto sessions like a design tool.
- **Snapshot-verified agents** — Every agent run is validated against Playwright E2E snapshots and Core Web Vitals. If a change causes visual regression or metric degradation, Fluxor auto-corrects up to 3 times before reverting.
- **OpenCode-backed** — A single [OpenCode](https://opencode.ai) adapter drives every model — Anthropic, OpenAI, or any provider in OpenCode's own catalog — through one settings picker instead of juggling separate CLI integrations.
- **Market system** — A built-in library of flows (autonomous loops), roles (specialized personas), mods (constraint layers), and steps (reusable step templates) that compose together on the canvas.

---

## Project Status (July 2026)

| Area | Status | Notes |
|------|--------|-------|
| Release channel | **Alpha** (`v0.1.0`, pre-release) | Core workflows are usable, but internal APIs and UI behavior are still evolving quickly. |
| Desktop IDE core | **Implemented** | Spatial desktop canvas, agent chat sessions, marketplace, file explorer/editor, backlog, agentic pipelines (loop-back edges, smart model routing), Arena dashboard, and mental graph are all in active use. |
| Bridge companion | **Implemented (beta)** | Remote bridge server + QR auth + mobile companion app (`src/main/bridge`, `src/bridge-app`). |
| Context map + attachables | **Implemented** | Project graph, session sync, attach/detach flows, and export/search IPC are available. |
| Persistence stack | **Implemented** | Startup initializes SQLite (with migrations), settings storage, and filesystem storage before window boot. |
| Unit tests | **~1,055 tests across 73 files** | Full `npm test` (Vitest) run; counts are approximate (static count of `it`/`test` call sites) — run `npm test` for the exact total. |
| Lint | **0 errors** | `npm run lint` (ESLint flat config) reports 0 errors. |
| E2E tests | **14 active suites** | `npm run test:e2e` (Playwright + Electron); a full run takes ~21 min, so CI (`.github/workflows/ci.yml`) only runs a smoke subset on every push/PR. |
| SDK conformance | **3 runtimes** | TypeScript, Java (`sdk/java`), and Python (`sdk/python`) prove parity against shared golden fixtures in `.github/workflows/sdk-conformance.yml`. |
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
- Role and mod assignment per window

### File Explorer and Editor

A split-pane file manager with a tabbed Monaco editor.

- Hierarchical directory tree with expand/collapse
- Extension-aware file icons with color coding
- Tabbed editor with dirty-state indicator
- Drag a tab out of the window to spawn a standalone file viewer
- Context menu: create, rename, delete, refresh
- Save with `Cmd+S` / `Ctrl+S`
- Monaco configured with Fluxor dark theme, `Liberation Mono` / `JetBrains Mono` font

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

Browse and deploy flows, roles, mods, and steps from a built-in plugin catalog (`market/inventory.json`): **12 flows**, **14 roles**, **33 mods**, and **7 steps** as of this writing.

- Category tabs: All, Flows, Roles, Mods, Steps
- Full-text search across names and descriptions
- One-click deploy spawns the item on your canvas
- Color-coded badges by type
- Every role and mod declares **domains** (`frontend`, `backend`, `web`, `data`, `infra`, or `universal`) — informational hints the UI and the Meta-Agent use to suggest a good fit; never a hard enforcement boundary
- Design systems (e.g. `ds-tailwind`, `ds-shadcn`) are modeled as mods in a mutually-exclusive `design-system` group, not a separate category
- Market content is signed: a sha256 manifest of every `market/**/*.md` file plus `inventory.json` is ed25519-signed (`market/.signature.json`), so tampering with marketplace content is detectable before it ever reaches an agent prompt

### Agentic Pipelines (Flows)

A pipeline is a DAG of steps inside a Frame window — build one by dragging step connections on the canvas, or generate one from a sentence.

- **Text to Flow** — describe an intent in natural language and the Meta-Agent compiles it into a full step DAG on the canvas in one shot
- **Per-step run** — "Run this step" executes a single step in isolation; "Run from here" replays from that step to the end of the pipeline, without a full pipeline re-run
- **Editable Step Config** — an accessible panel to edit a step's instructions and attach or remove roles/mods inline, without leaving the canvas
- **Loop-back edges** — drag a connection from a later step back to an earlier one to form a bounded loop: a dashed amber edge with an editable ×N badge (1–50, default 3). The compiler keeps the forward graph an acyclic DAG; loops are tracked separately and the executor schedules bounded per-iteration instances. The auto flow-generator can also emit loops (`loopBackTo`).
- **Smart model routing** — an opt-in, per-flow **Model policy**: **Fixed** (default, uses the flow's configured model), **Smart (Local)** (routes only among Arena-**Benchmarked** models, by best-score/cheapest/fastest/best-value), or **Smart (External)** (delegates the pick to OpenRouter's `openrouter/auto` and records the model actually served). Every routed decision is recorded with a human-readable reason (e.g. `"best-score winner: score 92 at $0.004/run"`) — routing never blocks a run; it fails open to the flow's own model.
- **Time-travel checkpoints** — an immutable snapshot is recorded after every step completes, enabling rewind → edit → fork debugging of a run
- **Export Flow** — the Frame header's Export button compiles the canvas to a portable `*.flow.json` (`FluxorFlowExport` v1), the same format `fluxor serve` and all three SDKs consume; `contract`, `model`, and `loops` round-trip intact

### Arena Leaderboard

A sortable, filterable dashboard of AI model benchmark results, opened from the Dock.

- Run benchmarks with `npm run pf:arena`; the dashboard reads results read-only over the `arena:read-leaderboard` IPC channel
- Per-model score, average latency, and cost — the same evidence Smart (Local) routing uses to pick a model
- A model only earns the **Benchmarked** seal after it completes an Arena run — Fluxor records benchmark results, it never claims a model is "verified"

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

### fluxor serve, Triggers & MCP

Flows exported from the canvas run outside the IDE too.

- **`fluxor serve <flow.json>`** (`npm run fluxor:serve`) runs an exported flow as an HTTP service on port 7878, bound to `127.0.0.1` by default (pass `--host` to expose it further). `/run` and `/flow` require a Bearer token (`--token`, else `FLUXOR_SERVE_TOKEN`, else a random token generated and printed at startup); `/health` does not. Pass `--mcp` to expose the flow as an MCP server over stdio instead of HTTP, or `--select best-score|cheapest|fastest|best-value` to resolve the model from the latest Arena leaderboard instead of hardcoding one.
- **Triggers** — cron (5-field) and webhook triggers can fire a served flow on a schedule or on an inbound request, with an overlap guard so a slow-running trigger can't double-fire.
- **MCP client** — attach external MCP servers (stdio or HTTP/SSE) to a step as tool providers, picked from a curated directory. A spawn allowlist blocks any stdio command that isn't in the curated set or explicitly approved by the user, closing an arbitrary-command-execution surface.

### Settings and Configuration

- **Model provider**: a single OpenCode picker (provider + model, e.g. `opencode/claude-sonnet-4-6`) backed by the `opencode` CLI
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
│  │  Manager     │  │ (~100 routes) │  │  Operations        │ │
│  └──────┬───────┘  └───────────────┘  └────────────────────┘ │
│         │                                                    │
│  ┌──────┴────────────────────────────────────────┐           │
│  │           SNAPSHOT ENGINE (Playwright)         │           │
│  │  Runner · Metrics Collector · Diff Engine     │           │
│  └──────┬────────────────────────────────────────┘           │
│         │                                                    │
│  ┌──────┴────────────────────────────────────────┐           │
│  │            AI ADAPTER (JSONL streaming)        │           │
│  │       OpenCode (single CLI, multi-provider)    │           │
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
| AI Backend | [OpenCode](https://opencode.ai) adapter — single CLI, multi-provider catalog |
| SDKs | TypeScript (in-repo), Python (`sdk/python`, `fluxor-sdk` 0.2.0), Java (`sdk/java`, 0.2.0) |
| Icons | react-icons — Lucide (`lu`) + Material Design (`md`) sets, via `LucideIcon.tsx` |
| Drag & Drop | dnd-kit (core, sortable, modifiers) |
| Build | Electron Forge (Squirrel, DMG, DEB, RPM) |

---

## Getting Started

### Prerequisites

- **Node.js** 24+
- **Git**
- The [OpenCode CLI](https://opencode.ai/docs/installation) (`opencode`) installed and on `PATH` — Fluxor shells out to it for every agent run; without it, the IDE loads but agent commands fail

### Install and Run

```bash
git clone https://github.com/CMolG/fluxor-ide.git
cd fluxor-ide
npm install
npm start
```

The IDE opens with a guided quick tour on first launch.

### Initialize Fluxor for a Project

Open any project folder from the IDE, then initialize the Fluxor config:

```bash
npm run fluxor:init
```

This creates a `fluxor/` directory with:

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

The marketplace ships with a curated library of **flows**, **roles**, **mods**, and **steps** authored as Markdown prompt files in the `market/` directory — 12 flows, 14 roles, 33 mods, and 7 steps (`market/inventory.json`). The tables below are a representative sample, not the full catalog — browse everything from the Marketplace window's All/Flows/Roles/Mods/Steps tabs.

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
| `brainstorm-cards` | Finite | Turns a rough idea into Agentic Cards in `.backlog/` |

Each flow also has a `-finite` variant for single-run execution where applicable.

### Roles — Specialized Agent Personas

Roles inject a system prompt that shapes agent behavior and expertise. Exactly one role is active per session — the engine rejects a step with more than one attached role.

| Role | Focus |
|------|-------|
| Frontend Engineer | UI components, responsive design, CSS |
| Backend Engineer | APIs, databases, server logic |
| Full-Stack Engineer | End-to-end vertical slices: UI, API, and data model together |
| Design Engineer | UX/UI, frontend architecture, and DX; minimalist interfaces |
| AI Engineer | LLM apps: prompts, agent loops, RAG, structured outputs |
| Mobile Engineer | React Native/Expo or Flutter, offline-first, store-ready |
| QA Engineer | Testing, regression prevention |
| DevOps Engineer | Infrastructure, CI/CD, deployment |
| Incident Responder | Live-failure triage, log forensics, rollbacks |
| Security Researcher | Vulnerability audits, hardening |
| Software Architect | System design, refactoring |
| Data Scientist | Data pipelines, ML models |
| Product Manager | Feature prioritization, specs |
| Technical Writer | Documentation, READMEs, JSDoc |

### Mods — Constraint Layers

Mods stack on top of a role to enforce coding constraints — multiple mods can be active at once, unless they share an `exclusiveGroup` (design systems like `ds-tailwind`/`ds-shadcn` are modeled this way, so two can never blend). Each mod also declares `domains` (`frontend`, `backend`, `web`, `data`, `infra`, `universal`) as an informational fit hint.

| Mod | Effect |
|-----|--------|
| `test-driven` | Write tests before implementation (TDD) |
| `dry-run` | Simulate changes without committing |
| `a11y-enforcer` | Enforce WCAG accessibility (ARIA, semantic HTML) |
| `extreme-performance` | Aggressive caching, memoization, worker threads |
| `security-hardened` | CSP headers, input validation, no eval |
| `strict-linting` | Enforce strict ESLint rules |
| `legacy-compat` | Maintain backward compatibility |
| `verbose-comments` | Add detailed code documentation |
| `zero-dependencies` | No external npm packages |
| `docs-sync` | Every change updates the README/API refs/changelog it invalidates |
| `web-vitals` | Holds rendering to Core Web Vitals budgets |
| `auth-guarded` | Default-deny auth/authorization on every route and action |
| `api-contract-first` | The API contract is written and validated before implementation |
| `db-migrations-safe` | Reversible, expand-contract schema migrations only |

19 more mods cover i18n, SEO, privacy, observability, commit hygiene, and the design-system exclusive group — see the Marketplace's Mods tab or `market/mods/`.

### Steps — Reusable Step Templates

Steps are pre-built, droppable pipeline-step prompts for common jobs, so a pipeline doesn't start from a blank step every time.

| Step | Purpose |
|------|---------|
| `scaffold-structure` | Lays down the folder/file skeleton for a feature, before any logic |
| `write-failing-tests` | Specifies behavior as tests that fail before implementation exists (TDD red) |
| `implement-to-green` | Writes the smallest correct implementation to pass failing tests (TDD green) |
| `review-diff` | Reviews a change against a quality rubric; reports findings without rewriting |
| `refactor-safely` | Improves internal structure without changing observable behavior |
| `landing-page` | A single conversion-focused landing page matching the project's design system |
| `auth-pages` | Login, signup, and password-reset screens wired to the project's auth provider |

Flows, roles, mods, and steps compose together: drag a role onto a chat window, stack mods on the bottom edge, and attach a flow or step on the right.

---

## E2E Snapshot Validation

Fluxor validates agent changes against visual snapshots and performance metrics. This is the core feedback loop that prevents regressions.

### How It Works

```
1.  Agent receives a task
2.  Agent makes code changes
3.  Fluxor runs E2E flows (Playwright)
4.  Captures screenshots + Core Web Vitals
5.  Compares against baseline snapshots (pixelmatch)
6.  If regression detected:
    a.  Auto-correct (up to 3 attempts)
    b.  If all attempts fail → revert changes
7.  If pass → commit and log to fluxor-results.tsv
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

Every agent run is logged to `fluxor-results.tsv`:

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
fluxor-ide/
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
│   │   └── index.ts             # Context-isolated bridge (Fluxor + storage APIs)
│   ├── renderer/
│   │   ├── App.tsx              # Root component
│   │   ├── index.css            # Tailwind + Fluxor design tokens
│   │   ├── store/               # Zustand stores (app + desktop + harness)
│   │   └── components/
│   │       ├── desktop/         # Canvas, windows, dock, snap guides, step/loop nodes
│   │       ├── atoms/apps/      # Chat, explorer, marketplace, notifications, Arena dashboard
│   │       ├── atoms/widgets/   # Backlog Kanban, Text to Flow
│   │       ├── atoms/plugins/   # Window content renderers
│   │       ├── atoms/attachment/ # Role, flow, mod attachments
│   │       └── desktop/mental/  # Mental graph canvas (React Flow sticky notes + edges)
│   ├── ai-adapter/              # OpenCode adapter (JSONL streaming)
│   ├── bridge-app/              # Mobile companion PWA (Bridge client UI)
│   ├── snapshot-engine/         # Playwright runner, metrics, diff engine
│   └── types/                   # TypeScript type definitions
├── market/
│   ├── inventory.json           # Plugin catalog (flows, roles, mods, steps)
│   ├── flows/                   # Autonomous loop prompt definitions
│   ├── roles/                   # Agent persona prompt definitions
│   ├── mods/                    # Constraint mod prompt definitions
│   └── steps/                   # Reusable step-template prompt definitions
├── sdk/
│   ├── python/                  # fluxor-sdk (Python runtime), 0.2.0
│   ├── java/                    # fluxor-sdk-java (Java runtime), 0.2.0
│   └── conformance/             # Shared golden fixtures for TS/Java/Python parity
├── e2e/                         # Playwright E2E tests (14 suites)
├── assets/
│   ├── fluxor-logo.png
│   └── fluxor-templates/        # Project init templates
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

The E2E suite covers 14 spec files, including window/desktop management, drag-and-drop (Kanban + canvas), the marketplace, agent session and attachment lifecycle, keyboard shortcuts, canvas pan/zoom, the mental graph, Bridge pairing, and IPC responsiveness. See [`sdk/conformance/README.md`](sdk/conformance/README.md) for the separate cross-runtime SDK conformance suite (TypeScript, Java, Python).

---

## Contributing

We welcome contributions. Please read these guidelines before opening a PR.

### Rules

1. **No emoji as icons.** All icons must be SVG-based via [react-icons](https://react-icons.github.io/react-icons/) (the Lucide `lu` and Material Design `md` sets). Use `<LucideIcon name="..." />` from `src/renderer/components/desktop/LucideIcon.tsx`.

2. **Market prompts are human-authored only.** Files in `market/flows/`, `market/roles/`, `market/mods/`, and `market/steps/` are prompt definitions written by humans. AI agents must not create, modify, or delete these files. Only human contributors may edit the marketplace content.

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
