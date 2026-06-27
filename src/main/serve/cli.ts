/**
 * cli.ts — `heliox serve` entrypoint
 *
 * Usage:
 *   npx tsx src/main/serve/cli.ts <flow.json> [--port <n>] [--model <id>] [--mcp] [--select <strategy>]
 *
 * Loads the supplied HelioxFlowExport, validates the DAG, and either:
 *   - (default) binds an HTTP server and prints the address to stdout.
 *   - (--mcp)   starts an MCP server over stdio for use by MCP clients.
 *
 * When --select <strategy> is given, the model is resolved from the latest
 * Arena leaderboard using the specified strategy (best-score|cheapest|fastest|
 * best-value).  An explicit --model always overrides --select.
 *
 * Responds to SIGINT / SIGTERM for graceful shutdown.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { HelioxFlowExport } from '../flow-export/heliox-flow';
import { createFlowServer } from './serve-flow';
import { createMcpFlowServer } from './mcp-server';
import { selectModel, type SelectionStrategy } from './model-selector';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const VALID_STRATEGIES = new Set<SelectionStrategy>([
  'best-score',
  'cheapest',
  'fastest',
  'best-value',
]);

interface CliArgs {
  flowPath: string;
  port: number;
  modelId: string | undefined;
  mcp: boolean;
  selectStrategy: SelectionStrategy | undefined;
}

function parseArgs(argv: string[]): CliArgs {
  // argv[0] = node, argv[1] = script path — positional args start at index 2.
  const args = argv.slice(2);

  let flowPath: string | undefined;
  let port = 7878;
  let modelId: string | undefined;
  let mcp = false;
  let selectStrategy: SelectionStrategy | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--port' || arg === '-p') {
      const next = args[++i];
      const parsed = parseInt(next, 10);
      if (isNaN(parsed) || parsed < 1 || parsed > 65535) {
        throw new Error(`Invalid port: "${next}"`);
      }
      port = parsed;
    } else if (arg === '--model' || arg === '-m') {
      modelId = args[++i];
    } else if (arg === '--mcp') {
      mcp = true;
    } else if (arg === '--select' || arg === '-s') {
      const next = args[++i];
      if (!VALID_STRATEGIES.has(next as SelectionStrategy)) {
        throw new Error(
          `Invalid strategy "${next}". Valid values: ${[...VALID_STRATEGIES].join(' | ')}.`,
        );
      }
      selectStrategy = next as SelectionStrategy;
    } else if (!arg.startsWith('--')) {
      flowPath = arg;
    }
  }

  if (!flowPath) {
    throw new Error(
      'Usage: heliox serve <flow.json> [--port 7878] [--model <id>] [--mcp] [--select best-score|cheapest|fastest|best-value]',
    );
  }

  return { flowPath, port, modelId, mcp, selectStrategy };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv);
  } catch (error) {
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }

  const absolutePath = resolve(args.flowPath);

  let raw: string;
  try {
    raw = await readFile(absolutePath, 'utf-8');
  } catch {
    process.stderr.write(`error: cannot read flow file "${absolutePath}"\n`);
    process.exit(1);
  }

  let exported: HelioxFlowExport;
  try {
    exported = JSON.parse(raw) as HelioxFlowExport;
  } catch {
    process.stderr.write(`error: "${absolutePath}" is not valid JSON\n`);
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // Arena-informed model selection (--select).
  // An explicit --model always overrides the Arena result.
  // -------------------------------------------------------------------------
  let resolvedModelId = args.modelId;

  if (args.selectStrategy && !resolvedModelId) {
    const selection = await selectModel(exported.id, args.selectStrategy);
    if (selection) {
      resolvedModelId = selection.modelId;
      const { score, costPerRun, latencyMs } = selection.evidence;
      const latencyStr = latencyMs !== undefined ? `, latency ${latencyMs} ms` : '';
      process.stderr.write(
        `[model-selector] strategy="${args.selectStrategy}" → model="${selection.modelId}"` +
        ` (score ${score}/100, cost $${costPerRun.toFixed(6)}${latencyStr})\n`,
      );
    } else {
      process.stderr.write(
        `[model-selector] strategy="${args.selectStrategy}" — no Arena data available; falling back to default model\n`,
      );
    }
  } else if (args.selectStrategy && resolvedModelId) {
    process.stderr.write(
      `[model-selector] --model "${resolvedModelId}" overrides --select "${args.selectStrategy}"\n`,
    );
  }

  if (args.mcp) {
    // -------------------------------------------------------------------------
    // MCP transport: expose the flow as an MCP tool over stdio.
    // -------------------------------------------------------------------------
    let mcpServer: ReturnType<typeof createMcpFlowServer>;
    try {
      mcpServer = createMcpFlowServer(exported, { modelId: resolvedModelId });
    } catch (error) {
      process.stderr.write(
        `error: invalid flow — ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exit(1);
    }

    process.stderr.write(
      `heliox serve --mcp: "${exported.name}" (id: ${exported.id}) starting over stdio\n`,
    );

    const shutdown = async (): Promise<void> => {
      process.stderr.write('\nshutting down mcp server...\n');
      await mcpServer.close();
      process.exit(0);
    };

    process.on('SIGINT', () => { void shutdown(); });
    process.on('SIGTERM', () => { void shutdown(); });

    // serveStdio() resolves when the transport closes.
    await mcpServer.serveStdio();
    return;
  }

  // ---------------------------------------------------------------------------
  // Default: HTTP/REST transport.
  // ---------------------------------------------------------------------------
  let flowServer: ReturnType<typeof createFlowServer>;
  try {
    flowServer = createFlowServer(exported, { modelId: resolvedModelId });
  } catch (error) {
    process.stderr.write(
      `error: invalid flow — ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }

  let boundPort: number;
  try {
    boundPort = await flowServer.listen(args.port);
  } catch (error) {
    process.stderr.write(
      `error: failed to bind port ${args.port} — ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }

  process.stdout.write(
    `heliox serve: "${exported.name}" listening on http://0.0.0.0:${boundPort}\n`,
  );

  // Graceful shutdown.
  const shutdown = async (): Promise<void> => {
    process.stdout.write('\nshutting down...\n');
    await flowServer.close();
    process.exit(0);
  };

  process.on('SIGINT', () => { void shutdown(); });
  process.on('SIGTERM', () => { void shutdown(); });
}

void main();
