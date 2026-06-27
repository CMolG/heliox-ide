/**
 * mcp-directory.ts — Curated, demand-ranked directory of recommended MCP servers
 *
 * Provides a vetted list of external MCP servers that users can attach to a
 * Heliox step in one click via the ARCH-066 `tool_provider` mod.
 *
 * Design principles:
 * - The directory is **curated metadata** only. The mod (mcp-client-mod.ts) is
 *   the runtime binding. Consistent with the /market source-of-truth law.
 * - Demand ranking is **read-only** aggregation of `missingCapabilitiesRequested`
 *   strings already flowing through `pipeline-generator.ts`. The outbound
 *   telemetry payload is never expanded here.
 * - No new dependencies; tokenize approach mirrors `pipeline-generator.ts`.
 */

import type { McpClientMod, McpClientModConfig } from '../harness-engine/mcp-client-mod';

// ---------------------------------------------------------------------------
// Directory entry shape
// ---------------------------------------------------------------------------

export type McpTransport = 'stdio' | 'http';

export type McpCategory =
  | 'filesystem'
  | 'web'
  | 'code-hosting'
  | 'messaging'
  | 'database'
  | 'vector-store';

/**
 * Curated descriptor for a recommended MCP server.
 * `install` carries the information needed to start/connect to the server;
 * `toMcpClientModConfig()` maps it to a runtime mod config.
 */
export interface McpDirectoryEntry {
  /** Stable kebab-case identifier. */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** One-sentence description shown in the connector picker UI. */
  description: string;
  /** High-level category for grouping / keyword bucketing. */
  category: McpCategory;
  /** How the server is connected at runtime. */
  transport: McpTransport;
  /**
   * Install/connection metadata.
   * For `stdio`: npm package name (used as npx command) + optional args.
   * For `http`:  base URL of the running server.
   */
  install:
    | { type: 'stdio'; command: string; args?: string[] }
    | { type: 'http'; url: string };
}

// ---------------------------------------------------------------------------
// Curated directory — default order = curated priority
// ---------------------------------------------------------------------------

const DIRECTORY: McpDirectoryEntry[] = [
  {
    id: 'mcp-filesystem',
    name: 'Filesystem',
    description: 'Read and write files on the local filesystem within a scoped directory.',
    category: 'filesystem',
    transport: 'stdio',
    install: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '.'] },
  },
  {
    id: 'mcp-fetch',
    name: 'Web Fetch / Search',
    description: 'Fetch web pages and perform web searches via the MCP fetch server.',
    category: 'web',
    transport: 'stdio',
    install: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-fetch'] },
  },
  {
    id: 'mcp-github',
    name: 'GitHub',
    description: 'Interact with GitHub repos, issues, pull requests, and code search.',
    category: 'code-hosting',
    transport: 'stdio',
    install: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
  },
  {
    id: 'mcp-slack',
    name: 'Slack',
    description: 'Send and read Slack messages, list channels, and post notifications.',
    category: 'messaging',
    transport: 'stdio',
    install: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-slack'] },
  },
  {
    id: 'mcp-postgres',
    name: 'PostgreSQL',
    description: 'Query and inspect a PostgreSQL database over a read-safe MCP interface.',
    category: 'database',
    transport: 'stdio',
    install: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres'] },
  },
  {
    id: 'mcp-vector-store',
    name: 'Vector Store',
    description: 'Semantic similarity search over embeddings via a generic vector-store MCP server.',
    category: 'vector-store',
    transport: 'http',
    install: { type: 'http', url: 'http://localhost:8080/mcp' },
  },
];

// ---------------------------------------------------------------------------
// Public API — directory access
// ---------------------------------------------------------------------------

/** Returns the full curated list in default (curated priority) order. */
export function getMcpDirectory(): McpDirectoryEntry[] {
  return DIRECTORY.slice();
}

// ---------------------------------------------------------------------------
// Demand-driven ranking
// ---------------------------------------------------------------------------

/**
 * Re-orders the directory by aggregated `missingCapabilitiesRequested` demand.
 *
 * @param demandCounts  A map of free-text capability name → observed count.
 *                      These are the strings that already flow through
 *                      `pipeline-generator.ts:reportMissingCapabilities` — we
 *                      only consume them here; the outbound payload is unchanged.
 * @returns             A new array sorted by descending demand score.
 *                      Entries with no demand signal preserve their curated order.
 */
export function rankByDemand(demandCounts: Record<string, number>): McpDirectoryEntry[] {
  const scored = DIRECTORY.map((entry) => ({
    entry,
    score: scoreEntryDemand(entry, demandCounts),
  }));

  // Stable sort: ties preserve original curated order (Array.sort is stable in V8).
  scored.sort((a, b) => b.score - a.score);
  return scored.map((item) => item.entry);
}

function scoreEntryDemand(entry: McpDirectoryEntry, demandCounts: Record<string, number>): number {
  let total = 0;

  for (const [capability, count] of Object.entries(demandCounts)) {
    if (count <= 0) continue;
    const capTokens = tokenize(capability);
    const entryText = `${entry.id} ${entry.name} ${entry.description} ${entry.category}`;
    const entryTokens = tokenize(entryText);

    for (const token of capTokens) {
      if (entryTokens.has(token)) {
        total += count * 2;
      } else {
        for (const entryToken of entryTokens) {
          if (entryToken.includes(token) || token.includes(entryToken)) {
            total += count;
            break;
          }
        }
      }
    }
  }

  return total;
}

// ---------------------------------------------------------------------------
// Keyword bucketing — free-text capability → directory category
// ---------------------------------------------------------------------------

/**
 * Maps a free-text capability name (from `missingCapabilitiesRequested`) to the
 * best-matching directory category, or `null` when no category matches.
 *
 * Reuses the same `tokenize` approach as `pipeline-generator.ts`.
 */
export function bucketCapabilityToCategory(capability: string): McpCategory | null {
  const tokens = tokenize(capability);
  let bestCategory: McpCategory | null = null;
  let bestScore = 0;

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS) as [McpCategory, string[]][]) {
    let score = 0;
    for (const keyword of keywords) {
      if (tokens.has(keyword)) score += 2;
      else {
        for (const token of tokens) {
          if (token.includes(keyword) || keyword.includes(token)) {
            score += 1;
            break;
          }
        }
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  return bestScore > 0 ? bestCategory : null;
}

/**
 * Category → representative keyword tokens (lower-cased, no accents, 3+ chars).
 * Mirrors the normalize approach in `tokenize()`.
 */
const CATEGORY_KEYWORDS: Record<McpCategory, string[]> = {
  'filesystem': ['file', 'folder', 'directory', 'read', 'write', 'disk', 'path', 'storage'],
  'web': ['web', 'fetch', 'http', 'search', 'scrape', 'browse', 'url', 'internet', 'google', 'bing'],
  'code-hosting': ['github', 'gitlab', 'git', 'repo', 'issue', 'pull', 'commit', 'code', 'source'],
  'messaging': ['slack', 'email', 'gmail', 'mail', 'message', 'chat', 'notification', 'send', 'teams', 'discord'],
  'database': ['postgres', 'sql', 'database', 'query', 'mysql', 'sqlite', 'db', 'table'],
  'vector-store': ['vector', 'embedding', 'semantic', 'similarity', 'pinecone', 'weaviate', 'chroma', 'search'],
};

// ---------------------------------------------------------------------------
// Entry → ARCH-066 mod config mapper
// ---------------------------------------------------------------------------

/**
 * Maps a directory entry to a valid ARCH-066 `McpClientMod` config so that
 * "Add connector" attaches it to the selected step in one click.
 *
 * The returned mod is ready to be pushed into `step.mods` — no further
 * transformation needed by the UI.
 */
export function entryToMcpClientMod(entry: McpDirectoryEntry): McpClientMod {
  const serverConfig: McpClientModConfig['servers'][number] =
    entry.install.type === 'stdio'
      ? { type: 'stdio', command: entry.install.command, args: entry.install.args }
      : { type: 'http', url: entry.install.url };

  const modConfig: McpClientModConfig = {
    servers: [serverConfig],
  };

  return {
    id: 'mcp-client',
    name: entry.name,
    type: 'tool_provider',
    config: modConfig,
  };
}

// ---------------------------------------------------------------------------
// tokenize — mirrors pipeline-generator.ts (local copy, no import to avoid
// coupling to meta-agent internals; the approach is documented in the card)
// ---------------------------------------------------------------------------

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3),
  );
}
