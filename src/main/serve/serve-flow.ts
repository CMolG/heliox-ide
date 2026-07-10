/**
 * serve-flow.ts — HTTP serving layer for a portable FluxorFlowExport
 *
 * Loads a FluxorFlowExport via importFlow, validates the DAG, and exposes
 * three endpoints over Node http / Express:
 *
 *   POST /run    — executes the flow; returns { completedStepIds, stepOutputs, finalOutput }.
 *                  When the request carries Accept: text/event-stream the response is
 *                  streamed as Server-Sent Events. Body may carry an optional
 *                  `contextMode: 'blind' | 'feedback'` override (spec:
 *                  docs/superpowers/specs/2026-07-10-rosetta-context-manifest.md)
 *                  — absent ⇒ the served flow's own mode (inherited from the
 *                  export by importFlow) applies unchanged; an invalid value
 *                  is rejected with 400 before execution starts. The override
 *                  is applied to a per-request shallow clone, never mutating
 *                  the shared flow across requests.
 *   GET  /flow   — returns the loaded flow's { id, name, rootStepId, steps }.
 *   GET  /health — returns 200 { ok: true }.
 *
 * Execution is entirely delegated to executeAgenticFlow.  This module never
 * forks execution logic.
 *
 * Security:
 *   - /run and /flow require `Authorization: Bearer <token>`; /health is open.
 *     The token is caller-supplied (ServeFlowOptions.token) or, when omitted,
 *     randomly generated at server-creation time and exposed on the returned
 *     ServeFlowServer.token — /run can never be stood up unauthenticated.
 *   - listen() binds 127.0.0.1 (loopback) by default. Binding wider (e.g.
 *     0.0.0.0 to expose the flow on the network) requires explicitly passing
 *     a `host` argument — it is never the default.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Server } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { importFlow, type FluxorFlowExport } from '../flow-export/fluxor-flow';
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
  /**
   * Bearer token required on /run and /flow. If omitted or empty, a random
   * token is generated at server-creation time (see ServeFlowServer.token) —
   * there is no way to end up with /run left unauthenticated.
   */
  token?: string;
  /**
   * Project root passed straight through to executeAgenticFlow. Matters most
   * for a `contextMode: 'feedback'` flow (inherited from the export, or from
   * a per-request body override — see handleRun): feedback-mode genesis
   * writes the Rosetta run-context directory under this root (defaulting, as
   * executeAgenticFlow always does, to `process.cwd()` when omitted). Unset
   * by every existing caller, so behavior for a blind flow is unaffected.
   */
  rootDir?: string;
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
  /** The effective bearer token (caller-supplied or generated) guarding /run and /flow. */
  token: string;
  /**
   * Start listening on the given port (defaults to 7878) and host (defaults
   * to '127.0.0.1' — loopback only). Pass an explicit host (e.g. '0.0.0.0')
   * to deliberately expose the server beyond localhost.
   */
  listen(port?: number, host?: string): Promise<number>;
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

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/** Generate a cryptographically random bearer token (256 bits, hex-encoded). */
function generateToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Constant-time string comparison for secret tokens. `crypto.timingSafeEqual`
 * throws when buffer lengths differ, so a length mismatch is treated as a
 * definite non-match up front rather than allowed to throw — an attacker
 * must not be able to distinguish "wrong length" from "wrong content" via a
 * crash, and callers must never see this throw.
 */
function safeTokenEquals(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided, 'utf-8');
  const expectedBuf = Buffer.from(expected, 'utf-8');
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}

/**
 * Extract the bearer token from an `Authorization: Bearer <token>` header.
 * Returns null for: a missing header, a non-Bearer scheme, "Bearer" with no
 * value, or a value that is empty/whitespace-only once trimmed.
 */
function extractBearerToken(req: IncomingMessage): string | null {
  const header = req.headers['authorization'];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  if (!match) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

/** Whether the request carries a valid bearer token for this server instance. */
function isAuthorized(req: IncomingMessage, token: string): boolean {
  const provided = extractBearerToken(req);
  if (!provided) return false;
  return safeTokenEquals(provided, token);
}

function handleUnauthorized(res: ServerResponse): void {
  jsonResponse(res, 401, {
    error: 'Unauthorized: missing or invalid Authorization: Bearer <token> header',
  });
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
// contextMode override (Rosetta context system, spec:
// docs/superpowers/specs/2026-07-10-rosetta-context-manifest.md)
// ---------------------------------------------------------------------------

/**
 * Reads an optional `contextMode` override from the /run request body.
 * Absent ⇒ undefined (the served flow's own mode — inherited from the export
 * by importFlow — applies unchanged). Present ⇒ must be exactly 'blind' or
 * 'feedback'; anything else throws so the caller gets a 400, never a silent
 * fallback to the export's mode.
 */
function resolveContextModeOverride(body: Record<string, unknown>): 'blind' | 'feedback' | undefined {
  const raw = body.contextMode;
  if (raw === undefined) return undefined;
  if (raw === 'blind' || raw === 'feedback') return raw;
  throw new Error(`Invalid contextMode "${String(raw)}" in request body — must be "blind" or "feedback".`);
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

  // Validated BEFORE any SSE headers are written, so an invalid value always
  // gets a clean 400 — never a silently-degraded stream.
  let contextModeOverride: 'blind' | 'feedback' | undefined;
  try {
    contextModeOverride = resolveContextModeOverride(body);
  } catch (error) {
    jsonResponse(res, 400, { error: error instanceof Error ? error.message : String(error) });
    return;
  }
  // A shallow clone (never mutating the shared `flow` closure the server
  // reuses across every request) so one request's override can never leak
  // into an unrelated later request against the same server instance.
  const effectiveFlow: AgenticFlow = contextModeOverride !== undefined
    ? { ...flow, contextMode: contextModeOverride }
    : flow;

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
    await executeAgenticFlow(effectiveFlow, {
      modelId,
      runStep: options.runStep,
      rootDir: options.rootDir,
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
 * Create a serving instance from a FluxorFlowExport.
 *
 * The flow is validated immediately so callers know upfront if the export is
 * malformed before a port is bound.
 */
export function createFlowServer(
  exported: FluxorFlowExport,
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

  // Resolve the bearer token guarding /run and /flow. A caller-supplied token
  // (e.g. from the CLI's --token/env) is honored verbatim; otherwise generate
  // one so this server can never be reached on /run without authentication,
  // even if a caller forgets to supply one.
  const authToken = options.token && options.token.length > 0 ? options.token : generateToken();

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
        if (!isAuthorized(req, authToken)) {
          handleUnauthorized(res);
          return;
        }
        handleFlow(req, res, flow);
        return;
      }

      if (urlPath === '/run' && method === 'POST') {
        if (!isAuthorized(req, authToken)) {
          handleUnauthorized(res);
          return;
        }
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
    token: authToken,

    listen(port = 7878, host = '127.0.0.1'): Promise<number> {
      return new Promise<number>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
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
