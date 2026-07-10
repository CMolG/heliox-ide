/**
 * store.ts — Main process context-map persistence
 *
 * Responsibility:
 * - Read/write `.fluxor/context-map.json` per project.
 * - Keep gitignore default behavior (`.fluxor/`) on first creation.
 * - Legacy compat: migrate a pre-Fluxor `.heliox/` dir (context-map.json +
 *   performance-frontier/) to `.fluxor/` the first time a project is touched.
 */
import { createHash, randomUUID } from 'crypto';
import { dirname, join } from 'path';
import { access, mkdir, readFile, stat, writeFile } from 'fs/promises';
import type {
  ContextDigestOptions,
  ContextMap,
  ContextMapAttachableType,
  ContextMapEdge,
  ContextMapNode,
  ContextMapNodeType,
  ContextMapSessionStatus,
} from '../../types/context-map';
import { isAttachableNode } from '../../types/context-map';
import { migrateLegacyDirectories } from '../lib/legacy-migration';

const MAP_VERSION = 1 as const;

function nowIso(): string {
  return new Date().toISOString();
}

function hashProjectId(projectPath: string): string {
  return createHash('sha1').update(projectPath).digest('hex').slice(0, 16);
}

function mapPathFor(projectPath: string): string {
  return join(projectPath, '.fluxor', 'context-map.json');
}

function isContextMap(value: unknown): value is ContextMap {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<ContextMap>;
  return v.version === MAP_VERSION && Array.isArray(v.nodes) && Array.isArray(v.edges);
}

function normalizeNode(node: ContextMapNode): ContextMapNode {
  return {
    ...node,
    createdAt: node.createdAt || nowIso(),
    updatedAt: node.updatedAt || nowIso(),
    tags: node.tags ?? [],
    attachments: node.attachments ?? (isAttachableNode(node) ? [] : undefined),
  };
}

export function makeEmptyContextMap(projectPath: string): ContextMap {
  return {
    version: MAP_VERSION,
    projectId: hashProjectId(projectPath),
    nodes: [],
    edges: [],
  };
}

export async function ensureContextMap(projectPath: string): Promise<ContextMap> {
  if (!projectPath || projectPath.trim().length === 0) {
    throw new Error('[context-map] projectPath is required');
  }
  // Legacy compat: rename this project's pre-Fluxor heliox/.heliox dirs (if
  // present) before touching anything else — best-effort, never blocks.
  migrateLegacyDirectories(projectPath);
  const filePath = mapPathFor(projectPath);
  await mkdir(dirname(filePath), { recursive: true });
  await ensureGitignoreDefault(projectPath);
  try {
    await access(filePath);
  } catch {
    const empty = makeEmptyContextMap(projectPath);
    await writeFile(filePath, JSON.stringify(empty, null, 2), 'utf-8');
    return empty;
  }
  return readContextMap(projectPath);
}

export async function readContextMap(projectPath: string): Promise<ContextMap> {
  if (!projectPath || projectPath.trim().length === 0) {
    throw new Error('[context-map] projectPath is required');
  }
  const filePath = mapPathFor(projectPath);
  const raw = await readFile(filePath, 'utf-8');
  const parsed = JSON.parse(raw) as unknown;
  if (!isContextMap(parsed)) {
    throw new Error('[context-map] Invalid context-map.json format');
  }
  return {
    ...parsed,
    nodes: parsed.nodes.map(normalizeNode),
  };
}

export async function writeContextMap(projectPath: string, map: ContextMap): Promise<void> {
  if (!projectPath || projectPath.trim().length === 0) {
    throw new Error('[context-map] projectPath is required');
  }
  const filePath = mapPathFor(projectPath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(map, null, 2), 'utf-8');
}

export async function upsertNode(projectPath: string, node: Partial<ContextMapNode> & Pick<ContextMapNode, 'label' | 'type'>): Promise<ContextMapNode> {
  const map = await ensureContextMap(projectPath);
  const now = nowIso();
  const existingIndex = node.id ? map.nodes.findIndex(n => n.id === node.id) : -1;
  const nextNode: ContextMapNode = existingIndex >= 0
    ? normalizeNode({
      ...map.nodes[existingIndex],
      ...node,
      updatedAt: now,
    } as ContextMapNode)
    : normalizeNode({
      id: node.id ?? randomUUID(),
      label: node.label,
      type: node.type,
      body: node.body,
      tags: node.tags ?? [],
      createdAt: now,
      updatedAt: now,
      source: node.source ?? 'user',
      sessionId: node.sessionId,
      attachments: node.attachments,
      injectMode: node.injectMode,
      priority: node.priority ?? (isAttachableType(node.type) ? 'normal' : undefined),
      status: node.status,
      roleId: node.roleId,
      x: node.x,
      y: node.y,
    });

  if (existingIndex >= 0) {
    map.nodes[existingIndex] = nextNode;
  } else {
    map.nodes.push(nextNode);
  }
  await writeContextMap(projectPath, map);
  return nextNode;
}

export async function deleteNode(projectPath: string, nodeId: string): Promise<void> {
  const map = await ensureContextMap(projectPath);
  map.nodes = map.nodes.filter(n => n.id !== nodeId);
  map.edges = map.edges.filter(e => e.from !== nodeId && e.to !== nodeId);
  await writeContextMap(projectPath, map);
}

export async function upsertEdge(projectPath: string, edge: Partial<ContextMapEdge> & Pick<ContextMapEdge, 'from' | 'to'>): Promise<ContextMapEdge> {
  const map = await ensureContextMap(projectPath);
  const existingIndex = edge.id ? map.edges.findIndex(e => e.id === edge.id) : -1;
  const nextEdge: ContextMapEdge = existingIndex >= 0
    ? { ...map.edges[existingIndex], ...edge, id: map.edges[existingIndex].id }
    : {
      id: edge.id ?? randomUUID(),
      from: edge.from,
      to: edge.to,
      label: edge.label,
      weight: edge.weight,
      dashed: edge.dashed ?? false,
    };
  if (existingIndex >= 0) {
    map.edges[existingIndex] = nextEdge;
  } else {
    map.edges.push(nextEdge);
  }
  await writeContextMap(projectPath, map);
  return nextEdge;
}

export async function deleteEdge(projectPath: string, edgeId: string): Promise<void> {
  const map = await ensureContextMap(projectPath);
  map.edges = map.edges.filter(e => e.id !== edgeId);
  await writeContextMap(projectPath, map);
}

export async function searchNodes(projectPath: string, query: string): Promise<ContextMapNode[]> {
  const map = await ensureContextMap(projectPath);
  const q = query.trim().toLowerCase();
  if (!q) return map.nodes;
  return map.nodes.filter(n => {
    const tags = n.tags ?? [];
    const hay = `${n.label}\n${n.body ?? ''}\n${tags.join(' ')}`.toLowerCase();
    return hay.includes(q);
  });
}

function degreeMap(map: ContextMap): Map<string, number> {
  const degrees = new Map<string, number>();
  for (const node of map.nodes) degrees.set(node.id, 0);
  for (const edge of map.edges) {
    degrees.set(edge.from, (degrees.get(edge.from) ?? 0) + 1);
    degrees.set(edge.to, (degrees.get(edge.to) ?? 0) + 1);
  }
  return degrees;
}

function scoreNode(node: ContextMapNode, deg: number, roleId?: string, sessionId?: string): number {
  let score = deg * 2;
  if (roleId && node.tags?.includes(roleId)) score += 12;
  if (sessionId && node.sessionId === sessionId) score += 8;
  if (node.type === 'constraint' || node.type === 'goal' || node.type === 'decision') score += 5;
  if (node.priority === 'critical') score += 10;
  if (node.priority === 'high') score += 5;
  return score;
}

export async function exportContextDigest(projectPath: string, opts?: ContextDigestOptions): Promise<string> {
  if (!projectPath || projectPath.trim().length === 0) return '';
  const map = await ensureContextMap(projectPath);
  const degrees = degreeMap(map);
  const limit = Math.max(3, Math.min(opts?.limit ?? 10, 20));
  const sorted = [...map.nodes]
    .filter(n => n.type !== 'session')
    .sort((a, b) => {
      const sa = scoreNode(a, degrees.get(a.id) ?? 0, opts?.roleId, opts?.sessionId);
      const sb = scoreNode(b, degrees.get(b.id) ?? 0, opts?.roleId, opts?.sessionId);
      if (sa !== sb) return sb - sa;
      return (b.updatedAt || '').localeCompare(a.updatedAt || '');
    })
    .slice(0, limit);

  if (sorted.length === 0) return '';

  const lines = ['[CONTEXT MAP DIGEST]'];
  for (const node of sorted) {
    const body = node.body?.trim() ?? '';
    const firstLine = body.split('\n')[0]?.trim();
    const snippet = firstLine && firstLine.length > 0 ? firstLine : node.label;
    lines.push(`- ${node.type}: ${snippet}`);
  }
  return lines.join('\n');
}

async function ensureGitignoreDefault(projectPath: string): Promise<void> {
  const gitignorePath = join(projectPath, '.gitignore');
  let current = '';
  try {
    current = await readFile(gitignorePath, 'utf-8');
  } catch {
    // No gitignore yet; create one.
  }
  const entries = current.split('\n').map(l => l.trim());
  // Legacy compat: a project migrated from Heliox may still list the old
  // `.heliox/` entry — harmless to leave, but `.fluxor/` (the current dir)
  // must be present too, so this checks for `.fluxor/` specifically rather
  // than treating an old-only entry as "already handled".
  if (entries.includes('.fluxor/') || entries.includes('.fluxor/context-map.json')) return;
  const next = current.trimEnd().length > 0
    ? `${current.trimEnd()}\n\n.fluxor/\n`
    : '.fluxor/\n';
  await writeFile(gitignorePath, next, 'utf-8');
}

export function isAttachableType(type: ContextMapNodeType): type is ContextMapAttachableType {
  return (
    type === 'constraint' ||
    type === 'instruction' ||
    type === 'persona-mod' ||
    type === 'context-snippet' ||
    type === 'goal' ||
    type === 'checklist'
  );
}

export async function syncSessionNode(projectPath: string, session: {
  sessionId: string;
  label: string;
  status: ContextMapSessionStatus;
  roleId?: string;
}): Promise<ContextMapNode> {
  const map = await ensureContextMap(projectPath);
  const now = nowIso();
  const existing = map.nodes.find(n => n.type === 'session' && n.sessionId === session.sessionId);
  if (existing) {
    existing.label = session.label;
    existing.status = session.status;
    existing.roleId = session.roleId;
    existing.updatedAt = now;
    await writeContextMap(projectPath, map);
    return existing;
  }
  const node: ContextMapNode = {
    id: randomUUID(),
    type: 'session',
    sessionId: session.sessionId,
    label: session.label,
    status: session.status,
    roleId: session.roleId,
    source: 'user',
    createdAt: now,
    updatedAt: now,
    tags: [],
  };
  map.nodes.push(node);
  await writeContextMap(projectPath, map);
  return node;
}

export async function contextMapExists(projectPath: string): Promise<boolean> {
  try {
    const s = await stat(mapPathFor(projectPath));
    return s.isFile();
  } catch {
    return false;
  }
}
