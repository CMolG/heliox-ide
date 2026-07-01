# Changelog

All notable changes to Heliox IDE are documented in this file.

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
  byte-identical TS↔JVM cross-runtime conformance.
- `heliox serve`: flows as an HTTP service (Bearer auth, loopback bind by
  default), cron/webhook triggers with an overlap guard, local RAG (vector
  store + ingestion + a `retriever` step), and time-travel checkpoints/replay.
- MCP client support (stdio/HTTP/SSE transports) with a curated server
  directory.
- Marketplace: web-element atoms and steps surfaced directly in the
  marketplace UI.
- Arena: visual benchmarking dashboard with per-model average latency.
- Java SDK: dedicated tool executor, multi-sink DAG, per-node telemetry.
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

[Unreleased]: https://github.com/CMolG/heliox-ide/commits/main
