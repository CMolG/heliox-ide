/**
 * serve-flow.test.ts — Parity test for the REST serving layer
 *
 * Verifies that:
 *   1. POST /run produces stepOutputs and completion order identical to a
 *      direct executeAgenticFlow call (with the same scripted runStep).
 *   2. GET /health returns { ok: true }.
 *   3. GET /flow returns the expected flow metadata.
 *   4. SSE streaming emits step events when Accept: text/event-stream.
 *
 * The conformance fixture is sdk/conformance/conformance-chain.flow.json — a
 * four-step linear chain: step-a → step-b → step-c → step-d.
 *
 * No real LLM is involved; runStep is fully scripted.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgenticStep } from '@/types/harness';
import type { HarnessEventPayload } from '@/types/ipc-events';
import type { LLMStepResult } from '../harness-engine/llm-runner';
import type { HarnessStepRunnerInput } from '../harness-engine/executor';
import { harnessEventBus, HARNESS_EVENT_NAME } from '../harness-engine/event-bus';
import { executeAgenticFlow } from '../harness-engine/executor';
import { importFlow, type HelioxFlowExport } from '../flow-export/heliox-flow';
import { createFlowServer } from './serve-flow';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const FIXTURE_PATH = resolve(
  __dirname,
  '../../../sdk/conformance/conformance-chain.flow.json',
);

const exported: HelioxFlowExport = JSON.parse(
  readFileSync(FIXTURE_PATH, 'utf-8'),
) as HelioxFlowExport;

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

async function getEndpoint(baseUrl: string, path: string): Promise<RunViaHttp> {
  const res = await fetch(`${baseUrl}${path}`);
  const body: unknown = await res.json();
  return { status: res.status, body };
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
  it('returns the loaded flow metadata', async () => {
    const { status, body } = await getEndpoint(baseUrl, '/flow');
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
      const { status, body } = await postRun(`http://127.0.0.1:${servedPort}`);
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
      result = await postRun(`http://127.0.0.1:${failingPort}`);
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

describe('createFlowServer — validation', () => {
  it('throws synchronously for a flow with an invalid rootStepId', () => {
    const bad: HelioxFlowExport = {
      ...exported,
      rootStepId: 'nonexistent',
    };
    expect(() => createFlowServer(bad)).toThrow(/rootStepId/);
  });
});
