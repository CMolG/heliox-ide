/**
 * webhook-trigger.test.ts — Acceptance tests for ARCH-070.
 *
 * Coverage:
 *   - POST without secret → 401
 *   - POST with wrong secret → 401
 *   - POST with correct secret (sync mode) → 200 { runId, output }; flow executed
 *   - POST with correct secret (async mode) → 202 { runId }; flow executed in bg
 *   - Triggered runs reuse executeAgenticFlow and emit on harnessEventBus
 *   - TriggerRegistry: register / list / start / stop / persist
 *
 * No real LLM is used — runStep is always scripted.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HarnessEventPayload } from '@/types/ipc-events';
import type { LLMStepResult } from '../harness-engine/llm-runner';
import type { HarnessStepRunnerInput } from '../harness-engine/executor';
import { harnessEventBus, HARNESS_EVENT_NAME } from '../harness-engine/event-bus';
import { registerWebhookTrigger, type RouteRegistrar } from './webhook-trigger';
import { TriggerRegistry } from './trigger-registry';
import type { TriggerDef } from './trigger-types';

// ---------------------------------------------------------------------------
// Fixture: write a minimal HelioxFlowExport JSON to a temp file
// ---------------------------------------------------------------------------

function makeFlowFixture(dir: string): string {
  const flowPath = join(dir, `test-flow-${randomUUID()}.json`);
  const exported = {
    version: '1',
    id: 'webhook-test-flow',
    name: 'Webhook Test Flow',
    rootStepId: 'step-1',
    steps: [
      {
        id: 'step-1',
        type: 'llm_call',
        prompt: 'Step 1: do the thing.',
        dependsOn: [],
        tools: [],
      },
      {
        id: 'step-2',
        type: 'llm_call',
        prompt: 'Step 2: finish.',
        dependsOn: ['step-1'],
        tools: [],
      },
    ],
  };
  writeFileSync(flowPath, JSON.stringify(exported), 'utf-8');
  return flowPath;
}

// ---------------------------------------------------------------------------
// Scripted runner
// ---------------------------------------------------------------------------

function makeScriptedRunStep() {
  return vi.fn(async ({ step }: HarnessStepRunnerInput): Promise<LLMStepResult> => ({
    text: `scripted:${step.id}`,
    usage: null,
    toolCalls: [],
    toolResults: [],
  }));
}

// ---------------------------------------------------------------------------
// Minimal in-process HTTP server that supports dynamic route registration
// ---------------------------------------------------------------------------

type RouteHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

interface TestServer {
  baseUrl: string;
  registrar: RouteRegistrar;
  close(): Promise<void>;
}

async function makeTestServer(): Promise<TestServer> {
  const routes = new Map<string, RouteHandler>();

  const registrar: RouteRegistrar = (method, path, handler) => {
    const key = `${method.toUpperCase()} ${path}`;
    routes.set(key, handler);
    return () => routes.delete(key);
  };

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const rawUrl = req.url ?? '/';
    const urlPath = rawUrl.split('?')[0] ?? '/';
    const method = (req.method ?? 'GET').toUpperCase();
    const key = `${method} ${urlPath}`;
    const handler = routes.get(key);
    if (handler) {
      await handler(req, res);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    }
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') resolve(addr.port);
      else reject(new Error('no address'));
    });
    server.on('error', reject);
  });

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    registrar,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

// ---------------------------------------------------------------------------
// Temp dir per test
// ---------------------------------------------------------------------------

let tmpDir: string;
let testServer: TestServer;
let flowPath: string;

beforeEach(async () => {
  harnessEventBus.removeAllListeners();
  tmpDir = join(tmpdir(), `heliox-trigger-test-${randomUUID()}`);
  mkdirSync(tmpDir, { recursive: true });
  testServer = await makeTestServer();
  flowPath = makeFlowFixture(tmpDir);
});

afterEach(async () => {
  harnessEventBus.removeAllListeners();
  await testServer.close();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDef(overrides: Partial<TriggerDef> = {}): TriggerDef {
  return {
    id: randomUUID(),
    flowPath,
    type: 'webhook',
    enabled: true,
    config: {
      path: '/triggers/test',
      secret: 'supersecret',
      mode: 'sync',
    },
    ...overrides,
  };
}

async function post(
  url: string,
  body: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

// ---------------------------------------------------------------------------
// Tests: secret validation
// ---------------------------------------------------------------------------

describe('webhook secret validation', () => {
  it('returns 401 when no secret is provided', async () => {
    const def = makeDef();
    registerWebhookTrigger(def, testServer.registrar, {
      runStep: makeScriptedRunStep(),
    });

    const { status, body } = await post(`${testServer.baseUrl}/triggers/test`);
    expect(status).toBe(401);
    expect((body as Record<string, unknown>).error).toMatch(/unauthorized/i);
  });

  it('returns 401 when the wrong secret is provided via header', async () => {
    const def = makeDef();
    registerWebhookTrigger(def, testServer.registrar, {
      runStep: makeScriptedRunStep(),
    });

    const { status } = await post(`${testServer.baseUrl}/triggers/test`, {}, {
      'x-heliox-secret': 'wrongsecret',
    });
    expect(status).toBe(401);
  });

  it('returns 401 when wrong secret is provided via query param', async () => {
    const def = makeDef();
    registerWebhookTrigger(def, testServer.registrar, {
      runStep: makeScriptedRunStep(),
    });

    const res = await fetch(`${testServer.baseUrl}/triggers/test?secret=badsecret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Tests: sync mode
// ---------------------------------------------------------------------------

describe('sync mode', () => {
  it('runs the bound flow and returns 200 { runId, output } on valid secret', async () => {
    const scriptedRunStep = makeScriptedRunStep();
    const def = makeDef({ config: { path: '/triggers/sync', secret: 'tok', mode: 'sync' } });
    registerWebhookTrigger(def, testServer.registrar, { runStep: scriptedRunStep });

    const { status, body } = await post(
      `${testServer.baseUrl}/triggers/sync`,
      {},
      { 'x-heliox-secret': 'tok' },
    );
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(typeof b.runId).toBe('string');
    // flow executed both steps
    expect(scriptedRunStep).toHaveBeenCalledTimes(2);
  });

  it('emits FlowStarted and FlowCompleted on harnessEventBus', async () => {
    const def = makeDef({ config: { path: '/triggers/events', secret: 'ev', mode: 'sync' } });
    const collected: HarnessEventPayload[] = [];
    harnessEventBus.on(HARNESS_EVENT_NAME, (e: HarnessEventPayload) => collected.push(e));
    registerWebhookTrigger(def, testServer.registrar, { runStep: makeScriptedRunStep() });

    await post(`${testServer.baseUrl}/triggers/events`, {}, { 'x-heliox-secret': 'ev' });

    expect(collected.some((e) => e.type === 'FlowStarted')).toBe(true);
    expect(collected.some((e) => e.type === 'FlowCompleted')).toBe(true);
  });

  it('accepts secret via query param', async () => {
    const def = makeDef({ config: { path: '/triggers/qp', secret: 'qsecret', mode: 'sync' } });
    const scriptedRunStep = makeScriptedRunStep();
    registerWebhookTrigger(def, testServer.registrar, { runStep: scriptedRunStep });

    const res = await fetch(`${testServer.baseUrl}/triggers/qp?secret=qsecret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect(scriptedRunStep).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: async mode
// ---------------------------------------------------------------------------

describe('async mode', () => {
  it('returns 202 { runId } immediately without waiting for flow', async () => {
    let resolveStep!: () => void;
    const slowStep = vi.fn(
      (): Promise<LLMStepResult> =>
        new Promise<LLMStepResult>((res) => {
          resolveStep = () =>
            res({ text: 'done', usage: null, toolCalls: [], toolResults: [] });
        }),
    );

    const def = makeDef({ config: { path: '/triggers/async', secret: 'as', mode: 'async' } });
    registerWebhookTrigger(def, testServer.registrar, { runStep: slowStep });

    // Should return 202 before the flow completes (step still hanging).
    const { status, body } = await post(
      `${testServer.baseUrl}/triggers/async`,
      {},
      { 'x-heliox-secret': 'as' },
    );
    expect(status).toBe(202);
    expect(typeof (body as Record<string, unknown>).runId).toBe('string');

    // Unblock the flow so the test doesn't leave hanging promises.
    resolveStep?.();
    // Give the background run a moment to settle.
    await new Promise<void>((r) => setTimeout(r, 50));
  });

  it('async mode does execute the flow in the background', async () => {
    const scriptedRunStep = makeScriptedRunStep();
    const def = makeDef({
      config: { path: '/triggers/async-exec', secret: 'bg', mode: 'async' },
    });
    registerWebhookTrigger(def, testServer.registrar, { runStep: scriptedRunStep });

    await post(`${testServer.baseUrl}/triggers/async-exec`, {}, { 'x-heliox-secret': 'bg' });

    // Wait for background execution to complete.
    await new Promise<void>((r) => setTimeout(r, 150));
    expect(scriptedRunStep).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Tests: TriggerRegistry
// ---------------------------------------------------------------------------

describe('TriggerRegistry', () => {
  it('register → list → persists to disk', () => {
    const registry = new TriggerRegistry({ dataDir: tmpDir });
    const def = registry.register({
      flowPath,
      type: 'webhook',
      enabled: true,
      config: { path: '/triggers/r1', secret: 's1', mode: 'sync' },
    });

    expect(def.id).toBeTruthy();
    expect(registry.list()).toHaveLength(1);

    // A fresh registry instance loaded from the same dataDir should have it.
    const registry2 = new TriggerRegistry({ dataDir: tmpDir });
    expect(registry2.list()).toHaveLength(1);
    expect(registry2.list()[0].id).toBe(def.id);
  });

  it('start → running; stop → stopped', async () => {
    const registry = new TriggerRegistry({
      dataDir: tmpDir,
      routeRegistrar: testServer.registrar,
      webhookRunStep: makeScriptedRunStep(),
    });
    const def = registry.register({
      flowPath,
      type: 'webhook',
      enabled: true,
      config: { path: '/triggers/lifecycle', secret: 'lc', mode: 'sync' },
    });

    registry.start(def.id);
    expect(registry.status(def.id)?.status).toBe('running');

    // The route should now respond.
    const { status } = await post(
      `${testServer.baseUrl}/triggers/lifecycle`,
      {},
      { 'x-heliox-secret': 'lc' },
    );
    expect(status).toBe(200);

    registry.stop(def.id);
    expect(registry.status(def.id)?.status).toBe('stopped');
  });

  it('unregister removes the trigger from disk', () => {
    const registry = new TriggerRegistry({ dataDir: tmpDir });
    const def = registry.register({
      flowPath,
      type: 'webhook',
      enabled: true,
      config: { path: '/triggers/del', secret: 'd', mode: 'sync' },
    });
    expect(registry.list()).toHaveLength(1);
    registry.unregister(def.id);
    expect(registry.list()).toHaveLength(0);

    // Reload to confirm persistence.
    const registry2 = new TriggerRegistry({ dataDir: tmpDir });
    expect(registry2.list()).toHaveLength(0);
  });

  it('startAll starts enabled triggers on boot', async () => {
    const registry = new TriggerRegistry({
      dataDir: tmpDir,
      routeRegistrar: testServer.registrar,
      webhookRunStep: makeScriptedRunStep(),
    });
    registry.register({
      flowPath,
      type: 'webhook',
      enabled: true,
      config: { path: '/triggers/boot', secret: 'boot', mode: 'sync' },
    });

    registry.startAll();

    const { status } = await post(
      `${testServer.baseUrl}/triggers/boot`,
      {},
      { 'x-heliox-secret': 'boot' },
    );
    expect(status).toBe(200);
  });

  it('startAll skips disabled triggers', async () => {
    const registry = new TriggerRegistry({
      dataDir: tmpDir,
      routeRegistrar: testServer.registrar,
      webhookRunStep: makeScriptedRunStep(),
    });
    registry.register({
      flowPath,
      type: 'webhook',
      enabled: false,
      config: { path: '/triggers/disabled', secret: 'dis', mode: 'sync' },
    });

    registry.startAll();

    // Route should not be mounted — expect 404.
    const res = await fetch(`${testServer.baseUrl}/triggers/disabled`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-heliox-secret': 'dis' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });
});
