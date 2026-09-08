/**
 * hook-endpoint.ts — The loopback endpoint Claude Code's hooks POST to (F4)
 *
 * Responsibility:
 * - Runs one `http` server on `127.0.0.1`, on an OS-assigned port, for the
 *   lifetime of the app.
 * - Mints and revokes a per-session secret, authenticates every request against
 *   it, and turns an accepted hook payload into one `AgentHookEvent` pushed to
 *   the renderer.
 * - Builds the inline `--settings` JSON that arms those hooks for one session.
 *
 * Boundaries:
 * - Owns: the route, the token, the wire format, and the tolerant parsing of a
 *   payload whose field names are not the ones the docs page publishes.
 * - Does NOT own: spawning (ipc-pty.ts), what a hook MEANS for a session
 *   (src/renderer/lib/attention-machine.ts), or any UI.
 *
 * Architectural role:
 * - Main-process service with NO Electron import: the push target is injected,
 *   which is what lets the whole server be unit-tested against a real listener
 *   on port 0 instead of against a mocked `BrowserWindow`.
 *
 * Why an HTTP endpoint at all, and why no file is written:
 * Claude Code 2.1.263 accepts `"type": "http"` hooks — the same JSON payload a
 * command hook receives on stdin, POSTed to a URL — and `--settings <inline
 * JSON>` MERGES with the project's own hooks instead of replacing them. So the
 * Cockpit arms its listeners as a launch ARGUMENT and writes nothing anywhere:
 * not `settings.local.json`, not a temp file, nothing to clean up and nothing
 * that can outlive the session. Docs: https://code.claude.com/docs/en/hooks
 * (verified 2026-09-08). Plan: `.harness/plans/2026-09-08-fluxor-cockpit-reduced-harness.md`,
 * decision 8 as amended.
 *
 * Why a token in the PATH rather than a header: the hook entry does accept
 * `headers`, but only with `$VAR` interpolation out of an `allowedEnvVars`
 * list — which would mean putting the secret in the agent's environment, where
 * the agent itself can read it. The path is the same shape `serve-flow.ts`
 * already uses for its dynamic routes, and it never leaves this process's
 * argv. It is never logged.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';

// ─── Wire types ──────────────────────────────────────────────────

/**
 * One hook event, normalised.
 *
 * `sessionId` is taken from the URL PATH, never from the payload's own
 * `session_id`: the path is what the token authenticates, so a session cannot
 * claim to be another one — and when `--session-id` was not accepted (see
 * `isUuid` in ipc-pty.ts) the CLI's own id is not ours anyway.
 */
export interface AgentHookEvent {
  sessionId: string;
  kind: 'session_start' | 'user_prompt' | 'stop' | 'notification' | 'session_end' | 'other';
  hookEventName: string;
  notificationType?: string;
  reason?: string;
  transcriptPath?: string;
  /** Truncated — this is a badge tooltip, not a transcript. */
  lastMessage?: string;
  at: number;
}

export const AGENT_HOOK_EVENT_CHANNEL = 'fluxor:agent-hook-event';

/** A hook body is a few hundred bytes; 64 KiB is already absurdly generous. */
export const MAX_BODY_BYTES = 64 * 1024;

/** `last_assistant_message` can be a whole answer. The badge shows a hint. */
export const LAST_MESSAGE_MAX = 200;

/**
 * The five events the Cockpit arms, and the only ones.
 *
 * `PreToolUse`/`PostToolUse` are deliberately absent: they fire on every single
 * tool call, which on one busy session is hundreds of round trips per minute
 * for a signal — "the agent is working" — that the terminal's own output
 * already carries for free.
 */
export const HOOK_EVENTS = [
  'SessionStart', 'UserPromptSubmit', 'Stop', 'Notification', 'SessionEnd',
] as const;

/**
 * Per-hook timeout, in seconds.
 *
 * Not a tuning knob — it is the one number that makes `SessionEnd` usable.
 * `SessionEnd` hooks share a 1.5 s budget across ALL of them unless a per-hook
 * `timeout` raises it, and the project's own `SessionEnd` hooks are in that
 * same budget. This endpoint answers in microseconds, so 5 s is not a wait, it
 * is headroom against a machine under load.
 */
export const HOOK_TIMEOUT_SECONDS = 5;

// ─── The inline --settings builder ───────────────────────────────

export function hookUrlFor(sessionId: string, token: string, port: number): string {
  return `http://127.0.0.1:${port}/hooks/${encodeURIComponent(sessionId)}/${encodeURIComponent(token)}`;
}

/**
 * The exact string handed to `claude --settings`.
 *
 * No `matcher` on any group: an omitted matcher means "every occurrence of
 * this event", which is what we want on all five — including `Notification`,
 * whose matcher would otherwise have to enumerate a notification-type list
 * that the binary is free to grow between releases.
 */
export function hookSettingsFor(sessionId: string, token: string, port: number): string {
  const url = hookUrlFor(sessionId, token, port);
  const group = () => [{
    hooks: [{ type: 'http', url, timeout: HOOK_TIMEOUT_SECONDS }],
  }];
  return JSON.stringify({
    hooks: Object.fromEntries(HOOK_EVENTS.map((event) => [event, group()])),
  });
}

// ─── Tolerant parsing ────────────────────────────────────────────

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function kindOf(hookEventName: string): AgentHookEvent['kind'] {
  switch (hookEventName) {
    case 'SessionStart': return 'session_start';
    case 'UserPromptSubmit': return 'user_prompt';
    case 'Stop': return 'stop';
    case 'Notification': return 'notification';
    case 'SessionEnd': return 'session_end';
    default: return 'other';
  }
}

/**
 * Turns a parsed JSON body into an `AgentHookEvent`.
 *
 * Every field is read under BOTH spellings on purpose. Measured against Claude
 * Code 2.1.263 on 2026-09-08, the binary's payloads and the docs page disagree
 * on three names — the binary sends `source`, `reason` and `prompt` where the
 * page documents `startup_reason`, `end_reason` and `user_prompt`. Picking one
 * spelling would make this endpoint silently correct today and silently broken
 * on whichever side changes; reading both costs a `??`.
 *
 * Never throws and never returns null: an unrecognised body still produces an
 * event of kind `'other'`, which the attention machine ignores. Dropping it
 * instead would lose the one thing it does prove — that the hooks are wired.
 */
export function parseHookPayload(sessionId: string, raw: unknown, now = Date.now()): AgentHookEvent {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const hookEventName = str(body.hook_event_name) ?? str(body.hookEventName) ?? '';
  const lastMessage = str(body.last_assistant_message)
    ?? str(body.lastAssistantMessage)
    // UserPromptSubmit carries the person's own text under either spelling; it
    // is the same slot in the UI ("what this session is on"), so it lands here.
    ?? str(body.prompt)
    ?? str(body.user_prompt);

  return {
    sessionId,
    kind: kindOf(hookEventName),
    hookEventName,
    notificationType: str(body.notification_type) ?? str(body.notificationType),
    // SessionEnd's `reason`/`end_reason` and SessionStart's `source`/
    // `startup_reason` are the same question — "why did this happen" — and
    // never both present, so one field carries them.
    reason: str(body.reason) ?? str(body.end_reason)
      ?? str(body.source) ?? str(body.startup_reason),
    transcriptPath: str(body.transcript_path) ?? str(body.transcriptPath),
    lastMessage: lastMessage ? lastMessage.slice(0, LAST_MESSAGE_MAX) : undefined,
    at: now,
  };
}

// ─── The server ──────────────────────────────────────────────────

export type HookPush = (channel: string, payload: AgentHookEvent) => void;

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Exported so the refusal is pinned by a test rather than by trusting that the
 * bind address will stay `127.0.0.1` forever. A socket with no remote address
 * (a destroyed one) is not loopback: unknown is not the same as safe.
 */
export function isLoopback(remoteAddress: string | undefined): boolean {
  return !!remoteAddress && LOOPBACK.has(remoteAddress);
}

/**
 * Constant-time comparison, with a length mismatch answered up front because
 * `timingSafeEqual` throws on unequal buffers. Same helper `serve-flow.ts`
 * carries, written again rather than imported: coupling this endpoint to the
 * flow server would drag the whole harness runtime behind it.
 */
function tokenEquals(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf-8');
  const b = Buffer.from(expected, 'utf-8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function endJson(res: ServerResponse, status: number, body = '{}'): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

interface BodyResult { ok: boolean; text: string }

function readBody(req: IncomingMessage): Promise<BodyResult> {
  return new Promise((resolve) => {
    const declared = Number(req.headers['content-length'] ?? NaN);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      req.resume();
      resolve({ ok: false, text: '' });
      return;
    }
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // Stop accumulating, but keep draining: destroying the socket here
        // makes the CLI see a transport error instead of the 413 we are about
        // to send it.
        chunks.length = 0;
        req.removeAllListeners('data');
        req.resume();
        req.once('end', () => resolve({ ok: false, text: '' }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve({ ok: true, text: Buffer.concat(chunks).toString('utf-8') }));
    req.on('error', () => resolve({ ok: true, text: '' }));
  });
}

export class HookEndpoint {
  private server: Server | null = null;
  private boundPort: number | null = null;
  /** sessionId → secret. Revoked on PTY exit, so a dead session's URL is 404. */
  private readonly tokens = new Map<string, string>();
  private push: HookPush;

  constructor(push: HookPush) {
    this.push = push;
  }

  /** The window to push to changes when macOS recreates it — same as ipc-pty. */
  setPush(push: HookPush): void {
    this.push = push;
  }

  get port(): number | null {
    return this.boundPort;
  }

  issueToken(sessionId: string): string {
    const token = randomBytes(16).toString('hex');
    this.tokens.set(sessionId, token);
    return token;
  }

  revokeToken(sessionId: string): void {
    this.tokens.delete(sessionId);
  }

  /** Binds loopback on an OS-assigned port. Idempotent: a second call is a no-op. */
  async listen(port = 0): Promise<number> {
    if (this.server && this.boundPort !== null) return this.boundPort;
    const server = createServer((req, res) => { void this.handle(req, res); });
    this.server = server;
    return new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        const addr = server.address();
        this.boundPort = addr && typeof addr === 'object' ? addr.port : port;
        resolve(this.boundPort);
      });
    });
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.boundPort = null;
    this.tokens.clear();
    if (!server) return;
    await new Promise<void>((resolve) => { server.close(() => resolve()); });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Bound to 127.0.0.1, so this can only ever be loopback — which is exactly
    // why it is checked: the guarantee must not rest on the bind address
    // staying what it is today.
    if (!isLoopback(req.socket.remoteAddress)) {
      req.resume();
      endJson(res, 403);
      return;
    }

    const urlPath = (req.url ?? '/').split('?')[0] ?? '/';
    const parts = urlPath.split('/');
    const method = (req.method ?? 'GET').toUpperCase();

    // `['', 'hooks', <sessionId>, <token>]` and nothing else. Every other
    // shape — a probe, a wrong verb, a truncated path — is a 404 with no body
    // detail, so an unauthenticated caller cannot tell them apart.
    if (method !== 'POST' || parts.length !== 4 || parts[1] !== 'hooks') {
      req.resume();
      endJson(res, 404);
      return;
    }

    const sessionId = decodeURIComponent(parts[2] ?? '');
    const token = decodeURIComponent(parts[3] ?? '');
    const expected = this.tokens.get(sessionId);
    // 404 rather than 401 on a bad token, deliberately: a 401 confirms the
    // session id exists, which is the one bit an attacker would want.
    if (!expected || !tokenEquals(token, expected)) {
      req.resume();
      endJson(res, 404);
      return;
    }

    const body = await readBody(req);
    if (!body.ok) {
      endJson(res, 413);
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body.text) as unknown;
    } catch {
      endJson(res, 400);
      return;
    }

    // 200 FIRST, then the work. A `Stop` hook must never delay stopping and a
    // `Notification` hook cannot block at all, so the answer goes out before
    // anything touches the renderer — an empty JSON object, which is the
    // "no opinion" response for every one of the five events.
    endJson(res, 200);

    try {
      this.push(AGENT_HOOK_EVENT_CHANNEL, parseHookPayload(sessionId, parsed));
    } catch {
      // A destroyed window between the answer and the push is ordinary.
    }
  }
}

// ─── App-lifetime singleton ──────────────────────────────────────
//
// One endpoint for the whole app, started from `app.whenReady` after the IPC
// registrars and closed on `will-quit`. Module level for the same reason
// `liveSessions` is in ipc-pty.ts: it survives macOS recreating the window,
// which runs every registrar a second time.

let endpoint: HookEndpoint | null = null;

/** Idempotent. Returns the bound port, or `null` if the port could not be taken. */
export async function startHookEndpoint(push: HookPush): Promise<number | null> {
  if (endpoint) {
    endpoint.setPush(push);
    return endpoint.port;
  }
  const created = new HookEndpoint(push);
  try {
    const port = await created.listen();
    endpoint = created;
    return port;
  } catch {
    // A session simply runs without hooks then — `hooksArmed: false`, and the
    // window falls back to the output/idle heuristic. Not a startup failure.
    return null;
  }
}

export async function stopHookEndpoint(): Promise<void> {
  const current = endpoint;
  endpoint = null;
  await current?.close();
}

export function hookEndpointPort(): number | null {
  return endpoint?.port ?? null;
}

export function issueHookToken(sessionId: string): string | null {
  return endpoint ? endpoint.issueToken(sessionId) : null;
}

export function revokeHookToken(sessionId: string): void {
  endpoint?.revokeToken(sessionId);
}
