/**
 * mcp-client-mod.ts — Tool-provider mod for external MCP servers
 *
 * A `tool_provider` mod whose `config.servers` carries one or more external
 * MCP server descriptors (stdio or HTTP). The executor uses `getMcpClientModToolSet`
 * to detect the mod on a step, connect to each declared server, and merge the
 * resulting tools into the step's toolset.
 *
 * Connection is always EXPLICIT — nothing is auto-connected. Any server that
 * fails to connect degrades gracefully to an empty toolset (logged, never thrown).
 */

import type { AgenticMod, AgenticStep } from '../../types/harness';
import {
  createRemoteMcpToolSet,
  type RemoteMcpServerConfig,
  type RemoteMcpToolSet,
} from './mcp-adapter';
import type { ToolSet } from 'ai';

// ---------------------------------------------------------------------------
// Typed config for the MCP tool-provider mod
// ---------------------------------------------------------------------------

/**
 * The `config` shape expected on a mod whose `type === 'tool_provider'` and
 * whose `id` or `name` identifies it as an MCP client mod.
 */
export interface McpClientModConfig {
  /** One or more external MCP server descriptors to connect at step execution time. */
  servers: RemoteMcpServerConfig[];
  /**
   * Index signature so this typed config remains assignable to
   * `AgenticMod.config` (`Record<string, unknown>`) — i.e. an `McpClientMod`
   * is a proper subtype of `AgenticMod` and can be passed wherever one is expected.
   */
  [key: string]: unknown;
}

/**
 * A fully-typed `tool_provider` mod that carries MCP server descriptors.
 * Uses Omit+intersection to safely narrow `type` and `config` from AgenticMod.
 */
export type McpClientMod = Omit<AgenticMod, 'type' | 'config'> & {
  type: 'tool_provider';
  config: McpClientModConfig;
};

// ---------------------------------------------------------------------------
// Mod detection
// ---------------------------------------------------------------------------

const MCP_CLIENT_MOD_IDS = new Set(['mcp-client', 'McpClientMod', 'mcp-tool-provider']);

/**
 * Returns true when `mod` is an MCP client tool-provider mod with at least one
 * server descriptor.
 */
export function isMcpClientMod(mod: AgenticMod): boolean {
  if (mod.type !== 'tool_provider') return false;
  if (!MCP_CLIENT_MOD_IDS.has(mod.id) && !MCP_CLIENT_MOD_IDS.has(mod.name)) return false;

  const servers = (mod.config as McpClientModConfig | undefined)?.servers;
  return Array.isArray(servers) && servers.length > 0;
}

/**
 * Returns the first MCP client tool-provider mod attached to `step`, or `null`.
 */
export function findMcpClientMod(step: AgenticStep): McpClientMod | null {
  const found = step.mods.find(isMcpClientMod);
  return found ? (found as unknown as McpClientMod) : null;
}

// ---------------------------------------------------------------------------
// Toolset builder — called by the executor
// ---------------------------------------------------------------------------

/**
 * Connects to all MCP servers declared in `mod.config.servers`, merges their
 * tools into a single toolset, and returns the toolset alongside a `close()`
 * method that tears down all connections.
 *
 * Each individual server failure degrades gracefully (empty contribution).
 * This function itself never throws.
 */
export async function buildMcpClientModToolSet(mod: McpClientMod): Promise<RemoteMcpToolSet> {
  const results = await Promise.all(
    mod.config.servers.map((serverConfig) => createRemoteMcpToolSet(serverConfig)),
  );

  const mergedTools: ToolSet = Object.assign({}, ...results.map((r) => r.tools));

  return {
    tools: mergedTools,
    close: async () => {
      await Promise.all(results.map((r) => r.close()));
    },
  };
}

/**
 * Convenience: detect the MCP client mod on a step and build its toolset.
 * Returns `null` when no MCP client mod is present (caller skips the merge).
 */
export async function getMcpClientModToolSet(
  step: AgenticStep,
): Promise<RemoteMcpToolSet | null> {
  const mod = findMcpClientMod(step);
  if (!mod) return null;
  return buildMcpClientModToolSet(mod);
}
