/**
 * mcp-server.ts — Expose a loaded FluxorFlowExport as an MCP server tool.
 *
 * Wraps the ARCH-063 execution core (`executeAgenticFlow`) behind the
 * Model Context Protocol so any MCP-compatible client (Claude Desktop, IDEs,
 * other agents) can discover and invoke a Fluxor flow as a single tool.
 *
 * Transport:
 *   - stdio  — default; suitable for local subprocess / pipe invocations.
 *
 * Tool registration:
 *   - name        = flow.id
 *   - description = "<flow.name> — steps: <step-ids joined by ' → '>"
 *   - input schema: { input: { type: "string" } }  (v1 string-only)
 *
 * Execution is entirely delegated to executeAgenticFlow — no forked logic.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { z } from 'zod';
import { importFlow, type FluxorFlowExport } from '../flow-export/fluxor-flow';
import { executeAgenticFlow, type ExecuteAgenticFlowOptions } from '../harness-engine/executor';
import { harnessEventBus, HARNESS_EVENT_NAME } from '../harness-engine/event-bus';
import type { HarnessEventPayload } from '../../types/ipc-events';
import type { LLMStepResult } from '../harness-engine/llm-runner';
import type { HarnessStepRunnerInput } from '../harness-engine/executor';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface McpFlowServerOptions {
  /** Injectable runStep; defaults to the real LLM runner when omitted. */
  runStep?: (input: HarnessStepRunnerInput) => Promise<LLMStepResult>;
  modelId?: string;
}

export interface McpFlowServer {
  /** Start the MCP server over stdio. Resolves when the transport closes. */
  serveStdio(): Promise<void>;
  /**
   * Connect the server to an in-process InMemoryTransport pair.
   * Returns the server-side transport — pair it with an in-process Client for tests.
   */
  connectInMemory(): Promise<{ serverTransport: InMemoryTransport; clientTransport: InMemoryTransport }>;
  /** Close the underlying McpServer. */
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildDescription(exported: FluxorFlowExport): string {
  const stepSummary = exported.steps.map((s) => s.id).join(' → ');
  return `${exported.name} — steps: ${stepSummary}`;
}

/**
 * Run the flow and collect the FlowCompleted event, returning its finalOutput
 * as a JSON string suitable for an MCP text content block.
 */
async function runFlow(
  exported: FluxorFlowExport,
  options: McpFlowServerOptions,
): Promise<string> {
  const flow = importFlow(exported);
  const collectedEvents: HarnessEventPayload[] = [];

  const onEvent = (event: HarnessEventPayload): void => {
    collectedEvents.push(event);
  };

  harnessEventBus.on(HARNESS_EVENT_NAME, onEvent);

  try {
    const execOptions: ExecuteAgenticFlowOptions = {
      modelId: options.modelId,
      runStep: options.runStep,
    };

    await executeAgenticFlow(flow, execOptions);

    const completed = collectedEvents.find(
      (e): e is Extract<HarnessEventPayload, { type: 'FlowCompleted' }> =>
        e.type === 'FlowCompleted',
    );

    if (!completed) {
      throw new Error('FlowCompleted event was not emitted — execution may have failed.');
    }

    return JSON.stringify(completed.finalOutput, null, 2);
  } finally {
    harnessEventBus.removeListener(HARNESS_EVENT_NAME, onEvent);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create an MCP server that exposes a single tool for the given flow.
 *
 * The flow is validated immediately (via importFlow) so callers know upfront
 * if the export is malformed before a transport is connected.
 */
export function createMcpFlowServer(
  exported: FluxorFlowExport,
  options: McpFlowServerOptions = {},
): McpFlowServer {
  // Validate upfront — importFlow reconstructs the DAG but does not throw on
  // missing rootStepId; mirror the serve-flow.ts validation guard.
  const flow = importFlow(exported);
  if (!flow.rootStepId || !flow.stepsRecord[flow.rootStepId]) {
    throw new Error(
      `Invalid flow "${flow.id}": rootStepId "${flow.rootStepId}" not found in stepsRecord.`,
    );
  }

  const server = new McpServer(
    { name: `fluxor-flow-${exported.id}`, version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  // Register the flow as a single MCP tool.
  server.registerTool(
    exported.id,
    {
      title: exported.name,
      description: buildDescription(exported),
      inputSchema: z.object({
        input: z.string().optional().describe('Optional string input forwarded to the flow.'),
      }),
    },
    async (_args) => {
      try {
        const output = await runFlow(exported, options);
        return {
          content: [{ type: 'text' as const, text: output }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  );

  return {
    async serveStdio(): Promise<void> {
      const transport = new StdioServerTransport();
      await server.connect(transport);
      // Resolve when the transport closes (process exits or pipe breaks).
      await new Promise<void>((resolve) => {
        transport.onclose = resolve;
      });
    },

    async connectInMemory(): Promise<{ serverTransport: InMemoryTransport; clientTransport: InMemoryTransport }> {
      const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      return { serverTransport, clientTransport };
    },

    async close(): Promise<void> {
      await server.close();
    },
  };
}

/**
 * Convenience: create an in-process MCP Client already connected to the server.
 * Useful for tests and programmatic invocations inside the same Node process.
 */
export async function createInProcessMcpClient(
  exported: FluxorFlowExport,
  options: McpFlowServerOptions = {},
): Promise<{ client: Client; mcpServer: McpFlowServer }> {
  const mcpServer = createMcpFlowServer(exported, options);
  const { clientTransport } = await mcpServer.connectInMemory();

  const client = new Client(
    { name: 'fluxor-test-client', version: '1.0.0' },
    { capabilities: {} },
  );

  await client.connect(clientTransport);

  return { client, mcpServer };
}
