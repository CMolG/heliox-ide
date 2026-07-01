# Security Policy

## Support status

Heliox IDE is in **alpha** (`v0.1.0`) and under active development. There is
no LTS or backported-fix policy at this stage — security fixes land on the
latest `main` only. This policy will gain supported-version guidance once
stable releases begin.

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Report privately through
[GitHub Security Advisories](https://github.com/CMolG/heliox-ide/security/advisories/new)
for `CMolG/heliox-ide`. This opens a private discussion with maintainers
before anything becomes public.

Please include:

- A description of the vulnerability and its potential impact
- Steps to reproduce (a minimal repro is ideal)
- The affected version or commit
- Any suggested mitigation, if you have one

We aim to acknowledge new reports within 5 business days.

## Coordinated disclosure

We follow a **90-day coordinated disclosure** timeline from the day a report
is confirmed: we'll work with you on a fix and a disclosure date, and default
to public disclosure at 90 days even if a fix is still in progress, unless we
agree together on an extension.

## In-scope areas

Heliox executes agent-authored code and third-party marketplace content on
your machine, so the following areas are treated as high-severity by default:

- **MCP tool-provider spawning** (`src/main/harness-engine/mcp-adapter.ts`) —
  launching MCP server processes from configuration (command/argument
  injection, arbitrary process execution)
- **Market content loading** (`market/`, `src/main/market/`) — parsing,
  loading, and injecting flows/roles/modifiers into agent prompts (prompt
  injection, content trust and authenticity)
- **Bridge pairing** (`src/main/bridge/`) — QR/PIN pairing and the remote
  companion relay (auth bypass, session hijacking, PIN/credential exposure)
- **Serve endpoints** (`src/main/serve/`) — `heliox serve`'s HTTP API for
  running flows as a service (auth bypass, SSRF, unauthorized flow execution)

Reports touching Electron sandboxing/`contextIsolation`, IPC handlers, or the
storage layer (SQLite, settings, filesystem) are also welcome even though
they are not listed above.

## Out of scope

- Issues that require local filesystem access the attacker already has
  (Heliox is a local-first desktop IDE; the local user is a trusted
  principal)
- Vulnerabilities in third-party AI CLIs (Copilot, Claude, Gemini, Codex)
  themselves — please report those upstream, to their respective maintainers
