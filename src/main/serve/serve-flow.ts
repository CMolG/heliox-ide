/**
 * serve-flow.ts — HTTP serving layer for a portable HelioxFlowExport
 *
 * Loads a HelioxFlowExport via importFlow, validates the DAG, and exposes
 * three endpoints over Node http / Express:
 *
 *   POST /run    — executes the flow; returns { completedStepIds, stepOutputs, finalOutput }.
 *                  When the request carries Accept: text/event-stream the response is
 *                  streamed as Server-Sent Events.
 *   GET  /flow   — returns the loaded flow's { id, name, rootStepId, steps }.
 *   GET  /health — returns 200 { ok: true }.
 *
 * Execution is entirely delegated to executeAgenticFlow.  This module never
 * forks execution logic.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Server } from 'node:http';
import { importFlow, type HelioxFlowExport } from '../flow-export/heliox-flow';
import { executeAgenticFlow, type ExecuteAgenticFlowOptions } from '../harness-engine/executor';
import { harnessEventBus, HARNESS_EVENT_NAME } from '../harness-engine/event-bus';
import type { HarnessEventPayload } from '../../types/ipc-events';
import type { AgenticFlow } from '../../types/harness';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FlowRunResult {
  completedStepIds: string[];
  stepOutputs: Record<string, string>;
  finalOutput: unknown;
}

export interface ServeFlowOptions {
  /** Injectable runStep; defaults to the real LLM runner when omitted. */
  runStep?: ExecuteAgenticFlowOptions['runStep'];
  modelId?: string;
}

/**
 * Route registration callback exposed by ServeFlowServer.
 *
 * Trigger handlers call this to mount additional routes on the shared HTTP
 * server without needing direct access to the server internals.
 *
 *   method  — HTTP verb in uppercase (e.g. 'POST').
 *   path    — URL path the route listens on (e.g. '/triggers/my-flow').
 *   handler — async handler invoked when a matching request arrives.
 *
 * Returns an unregistration callback that removes the route.
 */
export type RouteRegistrar = (
  method: string,
  path: string,
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
) => () => void;

export interface ServeFlowServer {
  /** The underlying Node http.Server instance. */
  server: Server;
  /**
   * Register an additional route on the shared HTTP server.
   * Trigger modules use this to mount webhook routes without owning the server.
   */
  registerRoute: RouteRegistrar;
  /** Start listening on the given port (defaults to 7878). */
  listen(port?: number): Promise<number>;
  /** Gracefully close the HTTP server. */
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function parseJsonBody(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function extractFlowCompleted(events: HarnessEventPayload[]): FlowRunResult {
  const completed = events.find(
    (e): e is Extract<HarnessEventPayload, { type: 'FlowCompleted' }> =>
      e.type === 'FlowCompleted',
  );
  if (!completed) {
    throw new Error('FlowCompleted event was not emitted — execution may have failed.');
  }
  const output = completed.finalOutput as {
    completedStepIds: string[];
    stepOutputs: Record<string, string>;
  };
  return {
    completedStepIds: output.completedStepIds,
    stepOutputs: output.stepOutputs,
    finalOutput: completed.finalOutput,
  };
}

// ---------------------------------------------------------------------------
// SSE helpers
// ---------------------------------------------------------------------------

function writeSseEvent(res: ServerResponse, event: HarnessEventPayload): void {
  const data = JSON.stringify(event);
  res.write(`event: harness\ndata: ${data}\n\n`);
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleRun(
  req: IncomingMessage,
  res: ServerResponse,
  flow: AgenticFlow,
  options: ServeFlowOptions,
): Promise<void> {
  const raw = await readBody(req);
  const body = parseJsonBody(raw);
  const modelId =
    typeof body.modelId === 'string' ? body.modelId : options.modelId;

  const acceptSse = (req.headers['accept'] ?? '').includes('text/event-stream');

  // Collect events for the buffered (JSON) path; relay them for SSE immediately.
  const collectedEvents: HarnessEventPayload[] = [];

  if (acceptSse) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
  }

  const onEvent = (event: HarnessEventPayload): void => {
    collectedEvents.push(event);
    if (acceptSse) {
      writeSseEvent(res, event);
    }
  };

  harnessEventBus.on(HARNESS_EVENT_NAME, onEvent);

  try {
    await executeAgenticFlow(flow, {
      modelId,
      runStep: options.runStep,
    });

    const result = extractFlowCompleted(collectedEvents);

    if (acceptSse) {
      // Emit a synthetic done event so the client knows the stream ended cleanly.
      res.write(`event: done\ndata: ${JSON.stringify(result)}\n\n`);
      res.end();
    } else {
      jsonResponse(res, 200, result);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (acceptSse) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
      res.end();
    } else {
      jsonResponse(res, 500, { error: message });
    }
  } finally {
    harnessEventBus.removeListener(HARNESS_EVENT_NAME, onEvent);
  }
}

function handleFlow(
  _req: IncomingMessage,
  res: ServerResponse,
  flow: AgenticFlow,
): void {
  jsonResponse(res, 200, {
    id: flow.id,
    name: flow.name,
    rootStepId: flow.rootStepId,
    steps: Object.values(flow.stepsRecord).map((s) => ({
      id: s.id,
      type: s.type,
      prevStepIds: s.prevStepIds,
      nextStepIds: s.nextStepIds,
    })),
  });
}

function handleHealth(_req: IncomingMessage, res: ServerResponse): void {
  jsonResponse(res, 200, { ok: true });
}

function handleNotFound(_req: IncomingMessage, res: ServerResponse): void {
  jsonResponse(res, 404, { error: 'Not found' });
}

function handleMethodNotAllowed(_req: IncomingMessage, res: ServerResponse): void {
  jsonResponse(res, 405, { error: 'Method not allowed' });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a serving instance from a HelioxFlowExport.
 *
 * The flow is validated immediately so callers know upfront if the export is
 * malformed before a port is bound.
 */
export function createFlowServer(
  exported: HelioxFlowExport,
  options: ServeFlowOptions = {},
): ServeFlowServer {
  const flow = importFlow(exported);

  // Validate the DAG — mirrors executor.ts validateFlow semantics.
  if (!flow.rootStepId || !flow.stepsRecord[flow.rootStepId]) {
    throw new Error(
      `Invalid flow "${flow.id}": rootStepId "${flow.rootStepId}" not found in stepsRecord.`,
    );
  }
  for (const step of Object.values(flow.stepsRecord)) {
    for (const prevId of step.prevStepIds) {
      if (!flow.stepsRecord[prevId]) {
        throw new Error(
          `Invalid flow "${flow.id}": step "${step.id}" references missing prevStepId "${prevId}".`,
        );
      }
    }
    for (const nextId of step.nextStepIds) {
      if (!flow.stepsRecord[nextId]) {
        throw new Error(
          `Invalid flow "${flow.id}": step "${step.id}" references missing nextStepId "${nextId}".`,
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Dynamic route table — allows trigger modules to mount additional routes.
  // Key: `${METHOD} ${path}`, e.g. 'POST /triggers/my-flow'
  // ---------------------------------------------------------------------------
  const dynamicRoutes = new Map<
    string,
    (req: IncomingMessage, res: ServerResponse) => Promise<void>
  >();

  function registerRoute(
    method: string,
    path: string,
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  ): () => void {
    const key = `${method.toUpperCase()} ${path}`;
    dynamicRoutes.set(key, handler);
    return () => {
      dynamicRoutes.delete(key);
    };
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // Strip query string for routing (preserve it in req.url for handlers).
    const rawUrl = req.url ?? '/';
    const urlPath = rawUrl.split('?')[0] ?? '/';
    const method = (req.method ?? 'GET').toUpperCase();

    try {
      if (urlPath === '/health' && method === 'GET') {
        handleHealth(req, res);
        return;
      }

      if (urlPath === '/flow' && method === 'GET') {
        handleFlow(req, res, flow);
        return;
      }

      if (urlPath === '/run' && method === 'POST') {
        await handleRun(req, res, flow, options);
        return;
      }

      if (urlPath === '/run' && method !== 'POST') {
        handleMethodNotAllowed(req, res);
        return;
      }

      // Check dynamic routes registered by trigger modules.
      const dynamicKey = `${method} ${urlPath}`;
      const dynamicHandler = dynamicRoutes.get(dynamicKey);
      if (dynamicHandler) {
        await dynamicHandler(req, res);
        return;
      }

      handleNotFound(req, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!res.headersSent) {
        jsonResponse(res, 500, { error: message });
      }
    }
  });

  return {
    server,
    registerRoute,

    listen(port = 7878): Promise<number> {
      return new Promise<number>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '0.0.0.0', () => {
          const addr = server.address();
          const bound =
            addr && typeof addr === 'object' ? addr.port : port;
          resolve(bound);
        });
      });
    },

    close(): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
