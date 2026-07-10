/**
 * cli.ts — `fluxor serve` entrypoint
 *
 * Usage:
 *   npx tsx src/main/serve/cli.ts <flow.json> [--port <n>] [--host <host>] [--token <token>] [--model <id>] [--mcp] [--select <strategy>]
 *
 * Loads the supplied FluxorFlowExport, validates the DAG, and either:
 *   - (default) binds an HTTP server and prints the address to stdout.
 *   - (--mcp)   starts an MCP server over stdio for use by MCP clients.
 *
 * When --select <strategy> is given, the model is resolved from the latest
 * Arena leaderboard using the specified strategy (best-score|cheapest|fastest|
 * best-value).  An explicit --model always overrides --select.
 *
 * Networking & auth (HTTP transport only — --mcp is stdio and unaffected):
 *   - Binds 127.0.0.1 (loopback) by default. Pass --host 0.0.0.0 (or another
 *     address) to deliberately expose the server beyond localhost.
 *   - /run and /flow require `Authorization: Bearer <token>`; /health does not.
 *     The token comes from --token, else the FLUXOR_SERVE_TOKEN env var
 *     (legacy compat: HELIOX_SERVE_TOKEN, deprecated), else a random token
 *     generated at startup and printed to stdout.
 *
 * Responds to SIGINT / SIGTERM for graceful shutdown.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FluxorFlowExport } from '../flow-export/fluxor-flow';
import { createFlowServer } from './serve-flow';
import { createMcpFlowServer } from './mcp-server';
import { selectModel, type SelectionStrategy } from './model-selector';
import { readBrandEnv } from '../lib/env-compat';
import { migrateLegacyDirectories } from '../lib/legacy-migration';

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
  host: string | undefined;
  token: string | undefined;
}

function parseArgs(argv: string[]): CliArgs {
  // argv[0] = node, argv[1] = script path — positional args start at index 2.
  const args = argv.slice(2);

  let flowPath: string | undefined;
  let port = 7878;
  let modelId: string | undefined;
  let mcp = false;
  let selectStrategy: SelectionStrategy | undefined;
  let host: string | undefined;
  let token: string | undefined;

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
    } else if (arg === '--host') {
      const next = args[++i];
      if (!next || next.startsWith('--')) {
        throw new Error('Invalid --host: expected a hostname or IP address (e.g. 127.0.0.1 or 0.0.0.0).');
      }
      host = next;
    } else if (arg === '--token') {
      const next = args[++i];
      if (!next || next.startsWith('--')) {
        throw new Error('Invalid --token: expected a non-empty token value.');
      }
      token = next;
    } else if (!arg.startsWith('--')) {
      flowPath = arg;
    }
  }

  if (!flowPath) {
    throw new Error(
      'Usage: fluxor serve <flow.json> [--port 7878] [--host 127.0.0.1] [--token <token>] ' +
      '[--model <id>] [--mcp] [--select best-score|cheapest|fastest|best-value]',
    );
  }

  return { flowPath, port, modelId, mcp, selectStrategy, host, token };
}

/**
 * Resolve the effective bearer token: --token wins, else FLUXOR_SERVE_TOKEN
 * (legacy compat: HELIOX_SERVE_TOKEN, deprecated), else undefined
 * (createFlowServer then generates one). An empty string from either source
 * is treated as "not provided" rather than as a literal token.
 */
function resolveToken(cliToken: string | undefined): string | undefined {
  if (cliToken && cliToken.length > 0) return cliToken;
  const envToken = readBrandEnv('FLUXOR_SERVE_TOKEN');
  return envToken && envToken.length > 0 ? envToken : undefined;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Legacy compat: rename any pre-Fluxor `heliox/`/`.heliox/` dirs at the cwd
  // before doing anything else — best-effort, never blocks startup.
  migrateLegacyDirectories(process.cwd());

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

  let exported: FluxorFlowExport;
  try {
    exported = JSON.parse(raw) as FluxorFlowExport;
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
      `fluxor serve --mcp: "${exported.name}" (id: ${exported.id}) starting over stdio\n`,
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
  //
  // Binds loopback-only unless --host explicitly opts into a wider bind, and
  // always requires a bearer token on /run and /flow (see resolveToken()).
  // ---------------------------------------------------------------------------
  const effectiveHost = args.host && args.host.length > 0 ? args.host : '127.0.0.1';
  const resolvedToken = resolveToken(args.token);

  let flowServer: ReturnType<typeof createFlowServer>;
  try {
    flowServer = createFlowServer(exported, { modelId: resolvedModelId, token: resolvedToken });
  } catch (error) {
    process.stderr.write(
      `error: invalid flow — ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }

  let boundPort: number;
  try {
    boundPort = await flowServer.listen(args.port, effectiveHost);
  } catch (error) {
    process.stderr.write(
      `error: failed to bind ${effectiveHost}:${args.port} — ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }

  const isLoopbackHost =
    effectiveHost === '127.0.0.1' || effectiveHost === '::1' || effectiveHost === 'localhost';

  process.stdout.write(
    `fluxor serve: "${exported.name}" listening on http://${effectiveHost}:${boundPort}\n`,
  );
  process.stdout.write(`  auth token: ${flowServer.token}\n`);
  process.stdout.write(`  send requests with header: Authorization: Bearer ${flowServer.token}\n`);
  if (!isLoopbackHost) {
    process.stderr.write(
      `warning: "${effectiveHost}" is not loopback — this flow is reachable beyond localhost; keep the auth token secret.\n`,
    );
  }

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
