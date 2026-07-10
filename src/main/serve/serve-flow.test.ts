/**
 * serve-flow.test.ts — Parity test for the REST serving layer
 *
 * Verifies that:
 *   1. POST /run produces stepOutputs and completion order identical to a
 *      direct executeAgenticFlow call (with the same scripted runStep).
 *   2. GET /health returns { ok: true } — with no auth required.
 *   3. GET /flow returns the expected flow metadata — when authorized.
 *   4. SSE streaming emits step events when Accept: text/event-stream.
 *   5. /run and /flow require `Authorization: Bearer <token>`; every
 *      rejection edge case (missing/malformed/empty/wrong token) is denied
 *      with 401 and never reaches execution.
 *   6. listen() binds loopback by default and honors an explicit host opt-in.
 *
 * The conformance fixture is sdk/conformance/conformance-chain.flow.json — a
 * four-step linear chain: step-a → step-b → step-c → step-d.
 *
 * No real LLM is involved; runStep is fully scripted.
 */

import { readFileSync } from 'node:fs';
import { mkdtemp, readFile as nodeReadFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgenticStep } from '@/types/harness';
import type { HarnessEventPayload } from '@/types/ipc-events';
import type { LLMStepResult } from '../harness-engine/llm-runner';
import type { HarnessStepRunnerInput } from '../harness-engine/executor';
import { harnessEventBus, HARNESS_EVENT_NAME } from '../harness-engine/event-bus';
import { executeAgenticFlow } from '../harness-engine/executor';
import { importFlow, type FluxorFlowExport } from '../flow-export/fluxor-flow';
import { createFlowServer } from './serve-flow';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const FIXTURE_PATH = resolve(
  __dirname,
  '../../../sdk/conformance/conformance-chain.flow.json',
);

const exported: FluxorFlowExport = JSON.parse(
  readFileSync(FIXTURE_PATH, 'utf-8'),
) as FluxorFlowExport;

// The scripted runner returns deterministic output for each step.
function makeScriptedRunStep() {
  return vi.fn(async ({ step }: HarnessStepRunnerInput): Promise<LLMStepResult> => ({
    text: `scripted-output:${step.id}`,
    usage: null,
    toolCalls: [],
    toolResults: [],
  }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pick a free ephemeral port by binding to :0 then releasing it. */
async function pickFreePort(): Promise<number> {
  const { createServer } = await import('node:http');
  return new Promise<number>((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        srv.close(() => reject(new Error('Could not determine assigned port')));
        return;
      }
      const { port } = addr;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
    srv.on('error', reject);
  });
}

interface RunViaHttp {
  status: number;
  body: unknown;
}

async function postRun(
  baseUrl: string,
  payload: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Promise<RunViaHttp> {
  const res = await fetch(`${baseUrl}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
  const body: unknown = await res.json();
  return { status: res.status, body };
}

async function getEndpoint(
  baseUrl: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<RunViaHttp> {
  const res = await fetch(`${baseUrl}${path}`, { headers });
  const body: unknown = await res.json();
  return { status: res.status, body };
}

/** Build an `Authorization: Bearer <token>` header map for postRun/getEndpoint. */
function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------

let baseUrl: string;
let port: number;
let serverHandle: ReturnType<typeof createFlowServer>;

beforeEach(async () => {
  harnessEventBus.removeAllListeners();
  port = await pickFreePort();
  serverHandle = createFlowServer(exported);
  await serverHandle.listen(port);
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  harnessEventBus.removeAllListeners();
  await serverHandle.close();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /health', () => {
  it('returns 200 { ok: true }', async () => {
    const { status, body } = await getEndpoint(baseUrl, '/health');
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
  });
});

describe('GET /flow', () => {
  it('returns the loaded flow metadata when authorized', async () => {
    const { status, body } = await getEndpoint(baseUrl, '/flow', authHeader(serverHandle.token));
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(b.id).toBe(exported.id);
    expect(b.name).toBe(exported.name);
    expect(b.rootStepId).toBe(exported.rootStepId);
    expect(Array.isArray(b.steps)).toBe(true);
    const steps = b.steps as unknown[];
    expect(steps).toHaveLength(exported.steps.length);
  });
});

describe('POST /run — parity', () => {
  it('returns identical stepOutputs to a direct executeAgenticFlow call', async () => {
    const scriptedRunStep = makeScriptedRunStep();

    // -----------------------------------------------------------------------
    // (a) Direct execution path — capture completedStepIds and stepOutputs.
    // -----------------------------------------------------------------------
    const directEvents: HarnessEventPayload[] = [];
    harnessEventBus.on(HARNESS_EVENT_NAME, (e: HarnessEventPayload) =>
      directEvents.push(e),
    );

    const directFlow = importFlow(exported);
    await executeAgenticFlow(directFlow, { runStep: scriptedRunStep });

    const directCompleted = directEvents.find(
      (e): e is Extract<HarnessEventPayload, { type: 'FlowCompleted' }> =>
        e.type === 'FlowCompleted',
    )!;
    const directOutput = directCompleted.finalOutput as {
      completedStepIds: string[];
      stepOutputs: Record<string, string>;
    };

    harnessEventBus.removeAllListeners();

    // -----------------------------------------------------------------------
    // (b) Served path — wire the SAME scripted runner through createFlowServer.
    // -----------------------------------------------------------------------
    const servedPort = await pickFreePort();
    const servedHandle = createFlowServer(exported, {
      runStep: scriptedRunStep as (input: HarnessStepRunnerInput) => Promise<LLMStepResult>,
    });
    await servedHandle.listen(servedPort);

    let servedResult: Record<string, unknown>;
    try {
      const { status, body } = await postRun(
        `http://127.0.0.1:${servedPort}`,
        {},
        authHeader(servedHandle.token),
      );
      expect(status).toBe(200);
      servedResult = body as Record<string, unknown>;
    } finally {
      await servedHandle.close();
    }

    // -----------------------------------------------------------------------
    // Assertions: served output === direct output.
    // -----------------------------------------------------------------------
    expect(servedResult.stepOutputs).toEqual(directOutput.stepOutputs);
    expect(servedResult.completedStepIds).toEqual(directOutput.completedStepIds);

    // Every step in the flow must complete; the exact order is already pinned by
    // the served-vs-direct parity assertion above. Derive the expected set from
    // the fixture so this stays correct as the conformance flow grows.
    const ids = servedResult.completedStepIds as string[];
    expect([...ids].sort()).toEqual(exported.steps.map((s) => s.id).sort());
  });

  it('returns 500 with an error body when execution fails', async () => {
    const failingPort = await pickFreePort();
    const failingHandle = createFlowServer(exported, {
      runStep: async ({ step }: HarnessStepRunnerInput): Promise<LLMStepResult> => {
        if (step.id === 'step-b') throw new Error('scripted failure');
        return {
          text: `ok:${step.id}`,
          usage: null,
          toolCalls: [],
          toolResults: [],
        };
      },
    });
    await failingHandle.listen(failingPort);

    let result: RunViaHttp;
    try {
      result = await postRun(
        `http://127.0.0.1:${failingPort}`,
        {},
        authHeader(failingHandle.token),
      );
    } finally {
      await failingHandle.close();
    }

    expect(result.status).toBe(500);
    expect((result.body as Record<string, unknown>).error).toContain('scripted failure');
  });
});

describe('POST /run — SSE streaming', () => {
  it('emits step events when Accept: text/event-stream', async () => {
    const ssePort = await pickFreePort();
    const sseHandle = createFlowServer(exported, {
      runStep: async ({ step }: HarnessStepRunnerInput): Promise<LLMStepResult> => ({
        text: `sse-output:${step.id}`,
        usage: null,
        toolCalls: [],
        toolResults: [],
      }),
    });
    await sseHandle.listen(ssePort);

    const receivedEventTypes: string[] = [];
    let doneData: unknown;

    try {
      const res = await fetch(`http://127.0.0.1:${ssePort}/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          Authorization: `Bearer ${sseHandle.token}`,
        },
        body: JSON.stringify({}),
      });

      expect(res.headers.get('content-type')).toContain('text/event-stream');

      // Read the SSE stream to completion.
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse complete SSE messages from the buffer.
        const messages = buffer.split('\n\n');
        // Keep the last (potentially incomplete) chunk in the buffer.
        buffer = messages.pop() ?? '';

        for (const message of messages) {
          const lines = message.trim().split('\n');
          let eventType = 'message';
          let data = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) eventType = line.slice(7).trim();
            else if (line.startsWith('data: ')) data = line.slice(6).trim();
          }
          if (eventType) receivedEventTypes.push(eventType);
          if (eventType === 'done') {
            doneData = JSON.parse(data) as unknown;
          }
        }
      }
    } finally {
      await sseHandle.close();
    }

    // Expect harness events and a terminal done event.
    expect(receivedEventTypes).toContain('harness');
    expect(receivedEventTypes).toContain('done');
    expect(doneData).toBeDefined();
    const done = doneData as Record<string, unknown>;
    expect([...(done.completedStepIds as string[])].sort()).toEqual(
      exported.steps.map((s) => s.id).sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// Auth: /run and /flow require a bearer token; /health does not.
//
// The rejection cases below intentionally reuse the shared `serverHandle`
// from beforeEach, which is created with NO scripted runStep (i.e. it would
// fall through to the real LLM runner if execution were ever reached). That
// is deliberate: it proves the auth gate runs strictly BEFORE dispatch —
// if it didn't, these tests would hang or fail trying to reach a real model
// instead of returning a fast 401.
// ---------------------------------------------------------------------------

describe('POST /run — auth', () => {
  it('rejects a request with no Authorization header', async () => {
    const { status, body } = await postRun(baseUrl);
    expect(status).toBe(401);
    expect((body as Record<string, unknown>).error).toMatch(/unauthorized/i);
  });

  it('rejects a malformed Authorization header (wrong scheme)', async () => {
    const { status } = await postRun(baseUrl, {}, { Authorization: `Basic ${serverHandle.token}` });
    expect(status).toBe(401);
  });

  it('rejects a Bearer header with no token value', async () => {
    const { status } = await postRun(baseUrl, {}, { Authorization: 'Bearer' });
    expect(status).toBe(401);
  });

  it('rejects a Bearer header whose token is empty/whitespace-only', async () => {
    const { status } = await postRun(baseUrl, {}, { Authorization: 'Bearer    ' });
    expect(status).toBe(401);
  });

  it('rejects an incorrect token', async () => {
    const { status } = await postRun(baseUrl, {}, { Authorization: 'Bearer wrong-token-entirely' });
    expect(status).toBe(401);
  });

  it('accepts the correct bearer token and executes the flow', async () => {
    // Uses its own scripted-runStep server so a genuinely authorized request
    // exercises real execution without touching the LLM runner.
    const authPort = await pickFreePort();
    const authHandle = createFlowServer(exported, { runStep: makeScriptedRunStep() });
    await authHandle.listen(authPort);
    try {
      const { status, body } = await postRun(
        `http://127.0.0.1:${authPort}`,
        {},
        authHeader(authHandle.token),
      );
      expect(status).toBe(200);
      expect((body as Record<string, unknown>).completedStepIds).toBeDefined();
    } finally {
      await authHandle.close();
    }
  });
});

describe('GET /flow — auth', () => {
  it('rejects an unauthenticated request', async () => {
    const { status } = await getEndpoint(baseUrl, '/flow');
    expect(status).toBe(401);
  });

  it('rejects an incorrect token', async () => {
    const { status } = await getEndpoint(baseUrl, '/flow', { Authorization: 'Bearer nope' });
    expect(status).toBe(401);
  });

  it('accepts the correct bearer token', async () => {
    const { status } = await getEndpoint(baseUrl, '/flow', authHeader(serverHandle.token));
    expect(status).toBe(200);
  });
});

describe('GET /health — auth-exempt', () => {
  it('returns 200 with no Authorization header at all', async () => {
    const { status, body } = await getEndpoint(baseUrl, '/health');
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
  });
});

describe('listen — host binding', () => {
  it('binds loopback (127.0.0.1) by default', async () => {
    const p = await pickFreePort();
    const handle = createFlowServer(exported);
    await handle.listen(p);
    try {
      const addr = handle.server.address();
      expect(addr && typeof addr === 'object' ? addr.address : null).toBe('127.0.0.1');
    } finally {
      await handle.close();
    }
  });

  it('binds an explicit host when the caller opts in (e.g. 0.0.0.0)', async () => {
    const p = await pickFreePort();
    const handle = createFlowServer(exported);
    await handle.listen(p, '0.0.0.0');
    try {
      const addr = handle.server.address();
      expect(addr && typeof addr === 'object' ? addr.address : null).toBe('0.0.0.0');
    } finally {
      await handle.close();
    }
  });
});

describe('createFlowServer — validation', () => {
  it('throws synchronously for a flow with an invalid rootStepId', () => {
    const bad: FluxorFlowExport = {
      ...exported,
      rootStepId: 'nonexistent',
    };
    expect(() => createFlowServer(bad)).toThrow(/rootStepId/);
  });
});

// ---------------------------------------------------------------------------
// contextMode — Rosetta context system (spec:
// docs/superpowers/specs/2026-07-10-rosetta-context-manifest.md)
//
// serve-flow inherits contextMode from the export (importFlow already
// restores AgenticFlow.contextMode — see fluxor-flow.test.ts) and accepts an
// optional per-request override in POST /run's body, validated to
// 'blind'|'feedback'.
// ---------------------------------------------------------------------------

describe('POST /run — contextMode', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'fluxor-serve-context-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('rejects an invalid contextMode value with 400, before execution starts', async () => {
    const p = await pickFreePort();
    const handle = createFlowServer(exported, { runStep: makeScriptedRunStep(), rootDir: tmpDir });
    await handle.listen(p);
    try {
      const { status, body } = await postRun(
        `http://127.0.0.1:${p}`,
        { contextMode: 'bogus' },
        authHeader(handle.token),
      );
      expect(status).toBe(400);
      expect((body as Record<string, unknown>).error).toMatch(/contextMode/i);
    } finally {
      await handle.close();
    }
  });

  it('overriding contextMode: "feedback" in the body materializes a run-context manifest under the given rootDir', async () => {
    const p = await pickFreePort();
    const handle = createFlowServer(exported, { runStep: makeScriptedRunStep(), rootDir: tmpDir });
    await handle.listen(p);
    try {
      const { status } = await postRun(
        `http://127.0.0.1:${p}`,
        { contextMode: 'feedback' },
        authHeader(handle.token),
      );
      expect(status).toBe(200);
    } finally {
      await handle.close();
    }

    const entries = await import('node:fs/promises').then((fs) => fs.readdir(join(tmpDir, '.fluxor', 'run-context')));
    expect(entries.length).toBeGreaterThan(0);
    const manifestPath = join(tmpDir, '.fluxor', 'run-context', entries[0], 'manifest.json');
    const manifest = JSON.parse(await nodeReadFile(manifestPath, 'utf-8'));
    expect(manifest.contextMode).toBe('feedback');
    expect(manifest.flowId).toBe(exported.id);
  });

  it('a body override does not mutate the shared flow across requests (no cross-request leakage)', async () => {
    const p = await pickFreePort();
    const handle = createFlowServer(exported, { runStep: makeScriptedRunStep(), rootDir: tmpDir });
    await handle.listen(p);
    try {
      // First request opts into feedback...
      await postRun(`http://127.0.0.1:${p}`, { contextMode: 'feedback' }, authHeader(handle.token));
      // ...a second, plain request must NOT inherit that as a side effect.
      const before = await import('node:fs/promises').then((fs) => fs.readdir(join(tmpDir, '.fluxor', 'run-context')));
      await postRun(`http://127.0.0.1:${p}`, {}, authHeader(handle.token));
      const after = await import('node:fs/promises').then((fs) => fs.readdir(join(tmpDir, '.fluxor', 'run-context')));
      // No NEW run-context directory was created for the plain (blind) request.
      expect(after.length).toBe(before.length);
    } finally {
      await handle.close();
    }
  });

  it('inherits contextMode: "feedback" from the export itself when the body carries no override', async () => {
    const feedbackExported: FluxorFlowExport = { ...exported, contextMode: 'feedback' };
    const p = await pickFreePort();
    const handle = createFlowServer(feedbackExported, { runStep: makeScriptedRunStep(), rootDir: tmpDir });
    await handle.listen(p);
    try {
      const { status } = await postRun(`http://127.0.0.1:${p}`, {}, authHeader(handle.token));
      expect(status).toBe(200);
    } finally {
      await handle.close();
    }

    const entries = await import('node:fs/promises').then((fs) => fs.readdir(join(tmpDir, '.fluxor', 'run-context')));
    expect(entries.length).toBeGreaterThan(0);
  });

  it('an explicit contextMode: "blind" override wins over a feedback export (no manifest created)', async () => {
    const feedbackExported: FluxorFlowExport = { ...exported, contextMode: 'feedback' };
    const p = await pickFreePort();
    const handle = createFlowServer(feedbackExported, { runStep: makeScriptedRunStep(), rootDir: tmpDir });
    await handle.listen(p);
    try {
      const { status } = await postRun(`http://127.0.0.1:${p}`, { contextMode: 'blind' }, authHeader(handle.token));
      expect(status).toBe(200);
    } finally {
      await handle.close();
    }

    await expect(
      import('node:fs/promises').then((fs) => fs.readdir(join(tmpDir, '.fluxor', 'run-context'))),
    ).rejects.toThrow();
  });
});
