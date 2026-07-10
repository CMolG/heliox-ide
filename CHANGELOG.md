# Changelog

All notable changes to Fluxor IDE are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

See `docs/RELEASE_CHECKLIST.md` for how a version graduates from this
`[Unreleased]` section to a tagged, published release.

## [Unreleased]

### Added
- Performance Frontier: the full 5-phase roadmap — a sandboxed execution
  verifier that runs real `vitest` suites, a design verifier (axe-core against
  real DOM), an API verifier that boots a real Express app, a statistical
  bench (Student-t confidence intervals), an LLM judge with calibration, and
  byte-identical TS↔JVM↔Python cross-runtime conformance (DAG order, per-step
  output, tool-calling, and loop-execution parity all proven across the three
  runtimes — see `sdk/conformance/README.md`).
- Loop-back edges: a step can connect back to an earlier step to form a
  bounded loop (1-50 iterations, default 3), set by the user (a dashed amber
  edge with an editable ×N badge) or by the auto flow-generator
  (`loopBackTo`). The compiler keeps the forward graph an acyclic DAG; the
  executor schedules bounded per-iteration instances.
- Smart model routing: an opt-in, per-flow Model policy — **Fixed** (default),
  **Smart (Local)** (routes only among Arena-**Benchmarked** models, by
  best-score/cheapest/fastest/best-value), or **Smart (External)** (delegates
  to OpenRouter's `openrouter/auto` and records the model actually served).
  Every routing decision is recorded with a human-readable reason.
- Export Flow: the canvas compiles to a portable `*.flow.json`
  (`FluxorFlowExport` v1) via a Frame header Export button — the same format
  `fluxor serve` and the SDKs consume; `contract`, `model`, and `loops`
  round-trip.
- `fluxor serve`: flows as an HTTP service (Bearer auth, loopback bind by
  default), cron/webhook triggers with an overlap guard, local RAG (vector
  store + ingestion + a `retriever` step), and time-travel checkpoints/replay.
- MCP client support (stdio/HTTP/SSE transports) with a curated server
  directory.
- Marketplace: web-element atoms and steps surfaced directly in the
  marketplace UI.
- Arena: visual benchmarking dashboard with per-model average latency.
- Java SDK (`sdk/java`, bumped to **0.2.0**): dedicated tool executor,
  multi-sink DAG, per-node telemetry — joined by a new **Python SDK**
  (`sdk/python`, `fluxor-sdk` **0.2.0**) as the third cross-runtime
  conformance implementation, enforced by a new CI workflow
  (`.github/workflows/sdk-conformance.yml`: mvn + pytest + the flow-export
  vitest slice).
- Embedded `<webview>` preview and an agentic Browser Mod (native CDP +
  accessibility-tree access).
- CI: a 3-OS (Ubuntu/macOS/Windows) lint + unit test matrix, plus a reduced
  E2E smoke job under `xvfb`.
- Community files: `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`,
  issue templates.
- macOS code signing + notarization and Windows Authenticode signing, both
  env-gated — builds stay unsigned when the relevant secrets aren't
  configured (they aren't yet; see `docs/RELEASE_CHECKLIST.md`).
- On-demand Chromium download for the snapshot engine: packaged installers no
  longer bundle Playwright's browsers, cutting installer size; the one-time
  download happens the first time a snapshot run actually needs it.
- Auto-update via `update-electron-app`, inert until this repository is
  public with at least one published release (a hard requirement of
  update.electronjs.org).
- Local crash reporting (`crashReporter`, dumps never leave the machine) and
  an anonymous, **opt-in** (default off) install/launch telemetry ping.
- Release engineering: a draft-release CI pipeline that attaches a
  `SHA256SUMS` manifest to every tagged build, this changelog, and
  `docs/RELEASE_CHECKLIST.md`.

### Changed
- **Rebranding: Heliox → Fluxor.** The project is renamed end-to-end: repo
  (`CMolG/fluxor-ide`), product name (**Fluxor IDE**), CLI/package
  (`fluxor-ide`), preload API (`window.fluxorAPI`), IPC channels (`fluxor:*`),
  env vars (`FLUXOR_*`), the flow export format (`fluxor-flow`), and the
  `fluxor`/`.fluxor` project and config directories. **Migration:** uninstall
  Heliox IDE, install Fluxor IDE. `HELIOX_*` env vars still work (deprecated,
  logging a one-time warning) until v0.4.0; existing `heliox`/`.heliox`
  project directories migrate to `fluxor`/`.fluxor` automatically on first
  run; legacy `heliox-flow` exports still import (with a warning).
- ESLint migrated to flat config (ESLint 10).
- `release.yml` now runs `npm ci` (was `npm install`) for reproducible builds,
  and produces a **draft** GitHub Release per tag instead of publishing
  straight to users.
- Large dead-code cleanup consolidating several weeks of working-tree changes
  (dead components, unused flows, stale tests removed).

### Security
- MCP tool-provider spawn allowlist: a stdio MCP server config may only spawn
  a command that matches the curated directory or that the user has
  explicitly approved — closes an arbitrary-command-execution surface from
  uncurated market items.
- Market item signing / source-of-truth verification.
- A strict Content-Security-Policy is enforced in packaged builds; fonts are
  self-hosted (`@fontsource-*`) instead of loaded from an external CDN.
- Crash dumps are collected locally only (`uploadToServer: false`); telemetry
  defaults to off and requires both explicit opt-in and a configured
  endpoint before it ever sends a request.

[Unreleased]: https://github.com/CMolG/fluxor-ide/commits/main
