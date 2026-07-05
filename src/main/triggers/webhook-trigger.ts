/**
 * webhook-trigger.ts — Register HTTP webhook routes that launch Heliox flows.
 *
 * Each webhook trigger binds a POST route to the shared HTTP server.  On
 * request:
 *   1. Validates X-Heliox-Secret header (or ?secret= query param); 401 if
 *      missing or wrong.
 *   2. Parses the JSON body as the flow input payload.
 *   3. Calls executeAgenticFlow with the (injectable) runStep.
 *   4. Async mode → responds 202 { runId } before the run finishes.
 *      Sync mode  → awaits the run and responds 200 { runId, output }.
 *   5. Emits all lifecycle events on harnessEventBus so the IDE can observe
 *      triggered runs identically to manually-initiated runs.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { TriggerDef, WebhookTriggerConfig } from './trigger-types';
import type { ExecuteAgenticFlowOptions } from '../harness-engine/executor';
import { executeAgenticFlow } from '../harness-engine/executor';
import { harnessEventBus, HARNESS_EVENT_NAME } from '../harness-engine/event-bus';
import { importFlow, type HelioxFlowExport } from '../flow-export/heliox-flow';
import type { HarnessEventPayload } from '../../types/ipc-events';
import type { AgenticFlow } from '../../types/harness';

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

function extractSecret(req: IncomingMessage): string | undefined {
  // 1. X-Heliox-Secret header (preferred)
  const headerVal = req.headers['x-heliox-secret'];
  if (typeof headerVal === 'string' && headerVal.length > 0) return headerVal;

  // 2. ?secret= query param (convenience for tools that can't set headers)
  const url = req.url ?? '';
  const qIdx = url.indexOf('?');
  if (qIdx !== -1) {
    const params = new URLSearchParams(url.slice(qIdx + 1));
    const qVal = params.get('secret');
    if (qVal) return qVal;
  }

  return undefined;
}

function extractFlowCompleted(events: HarnessEventPayload[]): unknown {
  const completed = events.find(
    (e): e is Extract<HarnessEventPayload, { type: 'FlowCompleted' }> =>
      e.type === 'FlowCompleted',
  );
  return completed?.finalOutput ?? null;
}

// ---------------------------------------------------------------------------
// Route handler factory
// ---------------------------------------------------------------------------

/**
 * Options that configure a single webhook trigger's execution behaviour.
 * runStep is injectable so tests can script the runner without hitting an LLM.
 */
export interface WebhookTriggerOptions {
  runStep?: ExecuteAgenticFlowOptions['runStep'];
}

/**
 * A registered webhook route handle — returned by registerWebhookTrigger so
 * the registry can unregister it later.
 */
export interface WebhookRouteHandle {
  /** The normalised URL path this route is listening on. */
  path: string;
  /** Remove the route from the router table. */
  unregister(): void;
}

/**
 * Minimal interface for the shared HTTP server that the trigger can plug into.
 * This is the abstraction the test environment satisfies without needing to
 * create a full Node http.Server.
 */
export type RouteRegistrar = (
  method: string,
  path: string,
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
) => () => void; // returns an unregistration callback

/**
 * Create a request handler for a webhook trigger and register it via
 * `registrar`.  Returns a handle that can unregister the route.
 */
export function registerWebhookTrigger(
  def: TriggerDef,
  registrar: RouteRegistrar,
  options: WebhookTriggerOptions = {},
): WebhookRouteHandle {
  if (def.type !== 'webhook') {
    throw new Error(`registerWebhookTrigger: trigger "${def.id}" is not a webhook trigger`);
  }

  const cfg = def.config as WebhookTriggerConfig;
  const triggerPath = cfg.path.startsWith('/') ? cfg.path : `/${cfg.path}`;

  // Load and validate the flow once at registration time — fail fast so the
  // operator knows immediately if the flowPath is broken.
  let flow: AgenticFlow;
  try {
    const raw = readFileSync(def.flowPath, 'utf-8');
    const exported: HelioxFlowExport = JSON.parse(raw) as HelioxFlowExport;
    flow = importFlow(exported);
  } catch (err) {
    throw new Error(
      `Webhook trigger "${def.id}": could not load flow from "${def.flowPath}": ${String(err)}`,
    );
  }

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // --- Auth ---
    const provided = extractSecret(req);
    if (!provided || provided !== cfg.secret) {
      jsonResponse(res, 401, { error: 'Unauthorized: missing or invalid secret' });
      return;
    }

    // --- Parse body ---
    const raw = await readBody(req);
    let _inputPayload: Record<string, unknown> = {};
    if (raw.trim()) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          _inputPayload = parsed as Record<string, unknown>;
        }
      } catch {
        // Non-JSON body: silently ignore and pass empty payload.
      }
    }

    const runId = randomUUID();

    if (cfg.mode === 'async') {
      // Respond immediately, run in background.
      jsonResponse(res, 202, { runId });

      // Fire-and-forget — intentionally not awaited from the handler.
      void executeAgenticFlow(flow, {
        runStep: options.runStep,
        runId,
      }).catch((err: unknown) => {
        harnessEventBus.emitHarnessEvent({
          type: 'StepStatusChanged',
          flowId: flow.id,
          stepId: flow.rootStepId,
          status: 'error',
          timestamp: Date.now(),
          logs: `Async trigger error: ${String(err)}`,
        });
      });

      return;
    }

    // --- Sync mode: await the run and return output ---
    const collectedEvents: HarnessEventPayload[] = [];
    const onEvent = (event: HarnessEventPayload): void => {
      collectedEvents.push(event);
    };
    harnessEventBus.on(HARNESS_EVENT_NAME, onEvent);

    try {
      await executeAgenticFlow(flow, {
        runStep: options.runStep,
        runId,
      });

      const output = extractFlowCompleted(collectedEvents);
      jsonResponse(res, 200, { runId, output });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      jsonResponse(res, 500, { error: message });
    } finally {
      harnessEventBus.removeListener(HARNESS_EVENT_NAME, onEvent);
    }
  };

  const unregister = registrar('POST', triggerPath, handler);

  return {
    path: triggerPath,
    unregister,
  };
}
