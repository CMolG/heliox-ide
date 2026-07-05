/**
 * mcp-directory.test.ts — ARCH-067 acceptance tests
 *
 * Verifies:
 * 1. `getMcpDirectory()` returns a curated, non-empty list with required fields.
 * 2. `rankByDemand` reorders the directory by aggregated demand counts.
 * 3. `bucketCapabilityToCategory` maps free-text capability names to categories.
 * 4. `entryToMcpClientMod` produces a valid ARCH-066 `McpClientMod` config.
 */

import { describe, expect, it } from 'vitest';
import {
  getMcpDirectory,
  rankByDemand,
  bucketCapabilityToCategory,
  entryToMcpClientMod,
  type McpDirectoryEntry,
  type McpCategory,
} from './mcp-directory';
import { isMcpClientMod } from '../harness-engine/mcp-client-mod';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findById(entries: McpDirectoryEntry[], id: string): McpDirectoryEntry {
  const found = entries.find((e) => e.id === id);
  if (!found) throw new Error(`Entry "${id}" not found in directory`);
  return found;
}

// ---------------------------------------------------------------------------
// 1. getMcpDirectory — shape and completeness
// ---------------------------------------------------------------------------

describe('getMcpDirectory()', () => {
  it('returns a non-empty array', () => {
    const directory = getMcpDirectory();
    expect(directory.length).toBeGreaterThanOrEqual(6);
  });

  it('contains the six mandated entries', () => {
    const ids = getMcpDirectory().map((e) => e.id);
    expect(ids).toContain('mcp-filesystem');
    expect(ids).toContain('mcp-fetch');
    expect(ids).toContain('mcp-github');
    expect(ids).toContain('mcp-slack');
    expect(ids).toContain('mcp-postgres');
    expect(ids).toContain('mcp-vector-store');
  });

  it('every entry has required fields with correct shapes', () => {
    for (const entry of getMcpDirectory()) {
      expect(typeof entry.id).toBe('string');
      expect(entry.id.length).toBeGreaterThan(0);
      expect(typeof entry.name).toBe('string');
      expect(entry.name.length).toBeGreaterThan(0);
      expect(typeof entry.description).toBe('string');
      expect(entry.description.length).toBeGreaterThan(0);
      expect(typeof entry.category).toBe('string');
      expect(['filesystem', 'web', 'code-hosting', 'messaging', 'database', 'vector-store']).toContain(entry.category);
      expect(['stdio', 'http']).toContain(entry.transport);
      expect(['stdio', 'http']).toContain(entry.install.type);
    }
  });

  it('all ids are unique', () => {
    const ids = getMcpDirectory().map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('returns a defensive copy (mutations do not affect the internal list)', () => {
    const a = getMcpDirectory();
    a.push({ id: 'mutant', name: 'X', description: 'X', category: 'web', transport: 'http', install: { type: 'http', url: 'http://x' } });
    const b = getMcpDirectory();
    expect(b.some((e) => e.id === 'mutant')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. rankByDemand — reorders by aggregated missingCapabilitiesRequested counts
// ---------------------------------------------------------------------------

describe('rankByDemand()', () => {
  it('promotes a high-demand entry to the top', () => {
    // Drive heavy demand for "PostgreSQL database" → mcp-postgres should rank first
    const demand = { 'PostgreSQL database': 100 };
    const ranked = rankByDemand(demand);
    expect(ranked[0].id).toBe('mcp-postgres');
  });

  it('returns all entries regardless of demand', () => {
    const ranked = rankByDemand({ 'github pull requests': 5 });
    expect(ranked.length).toBe(getMcpDirectory().length);
  });

  it('with zero demand returns same count as curated directory', () => {
    const ranked = rankByDemand({});
    expect(ranked.length).toBe(getMcpDirectory().length);
  });

  it('does not mutate the original directory order', () => {
    const before = getMcpDirectory().map((e) => e.id);
    rankByDemand({ 'vector embedding similarity': 999 });
    const after = getMcpDirectory().map((e) => e.id);
    expect(after).toEqual(before);
  });

  it('promotes vector-store entry when embedding demand is highest', () => {
    const demand = { 'vector embedding search': 50, 'github': 10 };
    const ranked = rankByDemand(demand);
    const vectorIdx = ranked.findIndex((e) => e.id === 'mcp-vector-store');
    const githubIdx = ranked.findIndex((e) => e.id === 'mcp-github');
    expect(vectorIdx).toBeLessThan(githubIdx);
  });

  it('promotes messaging (Slack) entry when email/messaging demand is highest', () => {
    const demand = { 'send slack notification': 80 };
    const ranked = rankByDemand(demand);
    expect(ranked[0].id).toBe('mcp-slack');
  });

  it('entries with count ≤ 0 do not change relative order', () => {
    const demandZero = { github: 0 };
    const defaultOrder = getMcpDirectory().map((e) => e.id);
    const ranked = rankByDemand(demandZero).map((e) => e.id);
    // All scores are 0, so stable sort preserves original order
    expect(ranked).toEqual(defaultOrder);
  });
});

// ---------------------------------------------------------------------------
// 3. bucketCapabilityToCategory — free-text → category
// ---------------------------------------------------------------------------

describe('bucketCapabilityToCategory()', () => {
  const cases: [string, McpCategory][] = [
    ['send email', 'messaging'],
    ['gmail integration', 'messaging'],
    ['send slack message', 'messaging'],
    ['read file from disk', 'filesystem'],
    ['write files to directory', 'filesystem'],
    ['search the web', 'web'],
    ['fetch a webpage', 'web'],
    ['github pull request', 'code-hosting'],
    ['git repository access', 'code-hosting'],
    ['postgres sql query', 'database'],
    ['run sql query on database', 'database'],
    ['vector embedding similarity search', 'vector-store'],
    ['semantic search over embeddings', 'vector-store'],
  ];

  for (const [capability, expected] of cases) {
    it(`maps "${capability}" → "${expected}"`, () => {
      const result = bucketCapabilityToCategory(capability);
      expect(result).toBe(expected);
    });
  }

  it('returns null for an unrecognisable capability', () => {
    // Tokens shorter than 3 chars or completely unrelated are not matched
    expect(bucketCapabilityToCategory('xyz')).toBeNull();
  });

  it('is case-insensitive and accent-insensitive', () => {
    expect(bucketCapabilityToCategory('GITHUB REPO')).toBe('code-hosting');
    expect(bucketCapabilityToCategory('Búsqueda web')).toBe('web');
  });
});

// ---------------------------------------------------------------------------
// 4. entryToMcpClientMod — produces a valid ARCH-066 McpClientMod
// ---------------------------------------------------------------------------

describe('entryToMcpClientMod()', () => {
  it('returns a mod accepted by isMcpClientMod()', () => {
    for (const entry of getMcpDirectory()) {
      const mod = entryToMcpClientMod(entry);
      // isMcpClientMod requires type === 'tool_provider', id in allowed set, servers array non-empty
      expect(isMcpClientMod(mod)).toBe(true);
    }
  });

  it('maps a stdio entry to a stdio server config', () => {
    const entry = findById(getMcpDirectory(), 'mcp-github');
    const mod = entryToMcpClientMod(entry);
    expect(mod.config.servers).toHaveLength(1);
    expect(mod.config.servers[0].type).toBe('stdio');
    if (mod.config.servers[0].type === 'stdio') {
      expect(typeof mod.config.servers[0].command).toBe('string');
      expect(mod.config.servers[0].command.length).toBeGreaterThan(0);
    }
  });

  it('maps an http entry to an http server config', () => {
    const entry = findById(getMcpDirectory(), 'mcp-vector-store');
    const mod = entryToMcpClientMod(entry);
    expect(mod.config.servers).toHaveLength(1);
    expect(mod.config.servers[0].type).toBe('http');
    if (mod.config.servers[0].type === 'http') {
      expect(typeof mod.config.servers[0].url).toBe('string');
      expect(mod.config.servers[0].url.startsWith('http')).toBe(true);
    }
  });

  it('mod type is always tool_provider', () => {
    for (const entry of getMcpDirectory()) {
      expect(entryToMcpClientMod(entry).type).toBe('tool_provider');
    }
  });

  it('mod id is always the canonical mcp-client id', () => {
    for (const entry of getMcpDirectory()) {
      expect(entryToMcpClientMod(entry).id).toBe('mcp-client');
    }
  });

  it('mod name matches the entry name', () => {
    const entry = findById(getMcpDirectory(), 'mcp-slack');
    const mod = entryToMcpClientMod(entry);
    expect(mod.name).toBe(entry.name);
  });

  it('filesystem entry stdio command includes the mcp server package', () => {
    const entry = findById(getMcpDirectory(), 'mcp-filesystem');
    const mod = entryToMcpClientMod(entry);
    const server = mod.config.servers[0];
    expect(server.type).toBe('stdio');
    if (server.type === 'stdio') {
      const fullCmd = [server.command, ...(server.args ?? [])].join(' ');
      expect(fullCmd).toContain('@modelcontextprotocol/server-filesystem');
    }
  });
});
