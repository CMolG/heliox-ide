/**
 * hook-endpoint.test.ts — The loopback hook endpoint, against a real listener
 *
 * What is pinned here, and why each one is worth a test:
 *
 *   1. A valid POST answers `200 {}` and produces exactly ONE event, carrying
 *      the session id from the URL PATH rather than from the payload — which is
 *      the whole reason the token is bound to the path.
 *   2. A wrong token is a **404**, not a 401. A 401 would confirm the session id
 *      exists, which is the one bit worth guessing.
 *   3. Any other route or verb is a 404 with no body detail.
 *   4. A body over 64 KiB is a 413 and never reaches the parser.
 *   5. Malformed JSON is a 400 and pushes NOTHING — a hook that cannot be read
 *      must not become an event that says something.
 *   6. A revoked token (the PTY exited) stops authenticating immediately.
 *   7. Non-loopback is refused, pinned through `isLoopback` because a server
 *      bound to 127.0.0.1 cannot be reached from anywhere else to prove it.
 *
 * Plus the tolerant parsing: the binary's field names and the docs page's
 * disagree (`source`/`startup_reason`, `reason`/`end_reason`,
 * `prompt`/`user_prompt`), and BOTH spellings have to work or the endpoint is
 * one release away from silently reading nothing.
 *
 * The server is real and bound on port 0. There is no double here on purpose:
 * everything this module can get wrong — status codes, streaming limits,
 * routing — is exactly what a double would paper over.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { request } from 'node:http';
import {
  AGENT_HOOK_EVENT_CHANNEL,
  HookEndpoint,
  MAX_BODY_BYTES,
  LAST_MESSAGE_MAX,
  hookSettingsFor,
  hookUrlFor,
  isLoopback,
  parseHookPayload,
  type AgentHookEvent,
} from './hook-endpoint';

// ─── A minimal HTTP client, so no environment global is assumed ──────────────

interface Response { status: number; body: string }

function post(port: number, path: string, body: string, method = 'POST'): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, method, headers: { 'Content-Type': 'application/json' } },
      (res) => {
        let text = '';
        res.setEncoding('utf-8');
        res.on('data', (chunk: string) => { text += chunk; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

// ─── The server ─────────────────────────────────────────────────────────────

describe('HookEndpoint over a real listener', () => {
  let endpoint: HookEndpoint;
  let port: number;
  let pushed: Array<{ channel: string; payload: AgentHookEvent }>;

  beforeEach(async () => {
    pushed = [];
    endpoint = new HookEndpoint((channel, payload) => { pushed.push({ channel, payload }); });
    port = await endpoint.listen(0);
  });

  afterEach(async () => {
    await endpoint.close();
  });

  it('binds loopback on an OS-assigned port', () => {
    expect(port).toBeGreaterThan(0);
    expect(endpoint.port).toBe(port);
  });

  it('accepts a valid POST, answers 200 {}, and pushes one event', async () => {
    const token = endpoint.issueToken('sess-1');
    const res = await post(port, `/hooks/sess-1/${token}`, JSON.stringify({
      hook_event_name: 'Stop',
      // Deliberately a DIFFERENT id: the CLI's own session id is not ours when
      // `--session-id` was not accepted, and the path is what is authenticated.
      session_id: 'the-clis-own-id',
      stop_hook_active: false,
      last_assistant_message: 'done for now',
    }));

    expect(res.status).toBe(200);
    expect(res.body).toBe('{}');
    expect(pushed).toHaveLength(1);
    expect(pushed[0].channel).toBe(AGENT_HOOK_EVENT_CHANNEL);
    expect(pushed[0].payload.sessionId).toBe('sess-1');
    expect(pushed[0].payload.kind).toBe('stop');
    expect(pushed[0].payload.lastMessage).toBe('done for now');
  });

  it('answers a wrong token with 404 — not 401 — and pushes nothing', async () => {
    endpoint.issueToken('sess-1');
    const res = await post(port, '/hooks/sess-1/deadbeefdeadbeefdeadbeefdeadbeef', '{}');
    expect(res.status).toBe(404);
    expect(pushed).toHaveLength(0);
  });

  it('answers an unknown session with 404', async () => {
    const res = await post(port, '/hooks/nobody/whatever', '{}');
    expect(res.status).toBe(404);
    expect(pushed).toHaveLength(0);
  });

  it('answers any other route or verb with 404 and no body detail', async () => {
    const token = endpoint.issueToken('sess-1');
    const wrongPath = await post(port, '/', '{}');
    const wrongDepth = await post(port, `/hooks/${token}`, '{}');
    const wrongVerb = await post(port, `/hooks/sess-1/${token}`, '', 'GET');

    expect([wrongPath.status, wrongDepth.status, wrongVerb.status]).toEqual([404, 404, 404]);
    expect(wrongPath.body).toBe('{}');
    expect(pushed).toHaveLength(0);
  });

  it('answers a body over 64 KiB with 413 and never parses it', async () => {
    const token = endpoint.issueToken('sess-1');
    const huge = JSON.stringify({ hook_event_name: 'Stop', pad: 'x'.repeat(MAX_BODY_BYTES + 1024) });
    const res = await post(port, `/hooks/sess-1/${token}`, huge);
    expect(res.status).toBe(413);
    expect(pushed).toHaveLength(0);
  });

  it('answers malformed JSON with 400 and pushes no event', async () => {
    const token = endpoint.issueToken('sess-1');
    const res = await post(port, `/hooks/sess-1/${token}`, '{"hook_event_name": ');
    expect(res.status).toBe(400);
    expect(pushed).toHaveLength(0);
  });

  it('stops authenticating a token once its session is revoked', async () => {
    const token = endpoint.issueToken('sess-1');
    expect((await post(port, `/hooks/sess-1/${token}`, '{}')).status).toBe(200);
    endpoint.revokeToken('sess-1');
    expect((await post(port, `/hooks/sess-1/${token}`, '{}')).status).toBe(404);
  });

  it('mints a different secret per session', () => {
    expect(endpoint.issueToken('a')).not.toBe(endpoint.issueToken('b'));
  });

  it('is idempotent on listen and safe on a double close', async () => {
    expect(await endpoint.listen(0)).toBe(port);
    await endpoint.close();
    await endpoint.close();
    expect(endpoint.port).toBeNull();
  });
});

describe('isLoopback', () => {
  it('accepts the three shapes a loopback socket reports', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true);
  });

  it('refuses anything else, including an unknown remote', () => {
    expect(isLoopback('192.168.1.20')).toBe(false);
    expect(isLoopback('10.0.0.1')).toBe(false);
    expect(isLoopback(undefined)).toBe(false);
    expect(isLoopback('')).toBe(false);
  });
});

// ─── Tolerant parsing ───────────────────────────────────────────────────────

describe('parseHookPayload', () => {
  it('maps the five armed events to their kinds', () => {
    const kinds = ['SessionStart', 'UserPromptSubmit', 'Stop', 'Notification', 'SessionEnd']
      .map((name) => parseHookPayload('s', { hook_event_name: name }).kind);
    expect(kinds).toEqual(['session_start', 'user_prompt', 'stop', 'notification', 'session_end']);
  });

  it('calls anything it does not know `other` rather than dropping it', () => {
    const event = parseHookPayload('s', { hook_event_name: 'PreCompact' });
    expect(event.kind).toBe('other');
    expect(event.hookEventName).toBe('PreCompact');
  });

  it('reads SessionEnd under BOTH spellings — the binary and the docs disagree', () => {
    expect(parseHookPayload('s', { hook_event_name: 'SessionEnd', reason: 'clear' }).reason)
      .toBe('clear');
    expect(parseHookPayload('s', { hook_event_name: 'SessionEnd', end_reason: 'clear' }).reason)
      .toBe('clear');
  });

  it('reads SessionStart under BOTH spellings', () => {
    expect(parseHookPayload('s', { hook_event_name: 'SessionStart', source: 'startup' }).reason)
      .toBe('startup');
    expect(parseHookPayload('s', { hook_event_name: 'SessionStart', startup_reason: 'resume' }).reason)
      .toBe('resume');
  });

  it('reads UserPromptSubmit under BOTH spellings', () => {
    expect(parseHookPayload('s', { hook_event_name: 'UserPromptSubmit', prompt: 'go' }).lastMessage)
      .toBe('go');
    expect(parseHookPayload('s', { hook_event_name: 'UserPromptSubmit', user_prompt: 'go' }).lastMessage)
      .toBe('go');
  });

  it('carries the notification type, under either spelling', () => {
    expect(parseHookPayload('s', { hook_event_name: 'Notification', notification_type: 'permission_prompt' })
      .notificationType).toBe('permission_prompt');
    expect(parseHookPayload('s', { hook_event_name: 'Notification', notificationType: 'idle_prompt' })
      .notificationType).toBe('idle_prompt');
  });

  it('truncates the last message — the badge is not a transcript', () => {
    const event = parseHookPayload('s', {
      hook_event_name: 'Stop', last_assistant_message: 'y'.repeat(LAST_MESSAGE_MAX + 500),
    });
    expect(event.lastMessage).toHaveLength(LAST_MESSAGE_MAX);
  });

  it('survives a body that is not an object at all', () => {
    expect(parseHookPayload('s', null).kind).toBe('other');
    expect(parseHookPayload('s', 42).hookEventName).toBe('');
    expect(parseHookPayload('s', 'nope').sessionId).toBe('s');
  });

  it('never takes the session id from the payload', () => {
    expect(parseHookPayload('ours', { session_id: 'theirs', hook_event_name: 'Stop' }).sessionId)
      .toBe('ours');
  });
});

// ─── The --settings string ──────────────────────────────────────────────────

describe('hookSettingsFor', () => {
  const settings = JSON.parse(hookSettingsFor('sess-1', 'tok', 41234)) as {
    hooks: Record<string, Array<{ matcher?: string; hooks: Array<Record<string, unknown>> }>>;
  };

  it('arms exactly the five events, and no others', () => {
    expect(Object.keys(settings.hooks).sort())
      .toEqual(['Notification', 'SessionEnd', 'SessionStart', 'Stop', 'UserPromptSubmit']);
  });

  it('gives every event one http hook at this session\'s URL, with a timeout', () => {
    for (const groups of Object.values(settings.hooks)) {
      expect(groups).toHaveLength(1);
      expect(groups[0].hooks).toEqual([
        { type: 'http', url: hookUrlFor('sess-1', 'tok', 41234), timeout: 5 },
      ]);
    }
  });

  it('declares no matcher — an omitted matcher means every occurrence', () => {
    for (const groups of Object.values(settings.hooks)) {
      expect(groups[0]).not.toHaveProperty('matcher');
    }
  });

  it('binds the URL to loopback and escapes what goes in the path', () => {
    expect(hookUrlFor('a/b', 'tok', 1)).toBe('http://127.0.0.1:1/hooks/a%2Fb/tok');
  });
});
