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

## Bridge threat model

The mobile Bridge (`src/main/bridge/`) pairs a phone to the desktop IDE over
an HTTP + WebSocket server bound to the LAN. This section documents what the
pairing design protects against today and what it deliberately does not.

**What's protected:**

- No durable secret travels in a URL. The QR encodes a single-use pairing
  token in the URL fragment (`#pt=...`) rather than a query string —
  fragments are stripped by the browser before a request leaves the client,
  so they never reach server logs, LAN middleboxes, or `Referer` headers.
  The companion app exchanges the token for a session token over a POST
  body, and the session token itself travels as a WebSocket subprotocol
  rather than `?token=` for the same reason.
- Pairing is one-time. The QR's pairing token is invalidated on its first
  exchange attempt, success or failure; the manual PIN is invalidated after
  its first successful use. Both expire on a 2-minute TTL even if never
  presented, a sharp reduction from the previous 30-minute reusable PIN.
- Brute-force resistance. The exchange endpoint tracks failed attempts
  per-IP and globally; 5 failures trigger a 60-second lockout, all failure
  responses are identical in shape (no distinguishing "expired" from "wrong
  PIN" from "locked out"), and every secret comparison runs through
  `crypto.timingSafeEqual` over fixed-length hashes so a wrong guess can't
  be timed or crash the comparison on a length mismatch.
- Session hygiene. Session tokens are freshly issued on every successful
  pairing, expiry is enforced server-side on every request (not only when
  the periodic sweep runs), and starting or refreshing the bridge revokes
  all previously issued sessions.

**What's NOT protected yet:**

- The bridge server is plaintext HTTP. An attacker who can passively sniff
  LAN traffic during the pairing exchange, or during an active session, can
  read the pairing token/PIN and the session token as they cross the wire,
  then reuse a captured session token until it expires. This is the gap
  tracked as action 1.6 in `docs/auditoria-integral-2026-07.md`; closing it
  fully needs either TLS (a locally-trusted certificate) or a
  password-authenticated key exchange (PAKE/SRP) so the shared secret never
  appears on the wire even in transit, encrypted or not. Both remain
  follow-up work.
- No protection against an on-path attacker who can inject or modify
  packets, not just observe them — that also requires TLS or PAKE.

**Operating recommendation:** enable the Bridge only on networks you trust
(home or office WiFi you control). Avoid public, shared, or otherwise
untrusted LAN/hotel/coworking networks until TLS or PAKE pairing lands.
