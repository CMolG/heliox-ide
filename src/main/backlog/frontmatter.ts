// src/main/backlog/frontmatter.ts
//
// Pure v2 frontmatter parser/serializer for .backlog/*.md cards. No Electron
// import — safe to unit test directly. Legacy mapping tables are verbatim
// from docs/superpowers/specs/2026-07-21-backlog-schema-v2-f0.md §2.1/§2.2.
import type {
  BacklogAttachment, BacklogCard, BacklogComment, BacklogPriority, BacklogRunState, BacklogStatus,
} from '../../types/market';

// §2.1 — status v1 -> {status v2, runState}
const LEGACY_STATUS_MAP: Record<string, { status: BacklogStatus; runState: BacklogRunState }> = {
  pending:     { status: 'todo',   runState: 'idle' },
  in_progress: { status: 'doing', runState: 'running' },
  completed:   { status: 'review', runState: 'completed' },
  failed:      { status: 'refine', runState: 'failed' },
};

// §2.2 — priority v1 -> v2
const LEGACY_PRIORITY_MAP: Record<string, BacklogPriority> = {
  critical: 'superHigh', high: 'high', medium: 'medium', low: 'low',
};

const V2_STATUSES = new Set<string>(['refine', 'todo', 'ready', 'doing', 'review', 'deploy']);
const V2_PRIORITIES = new Set<string>(['superHigh', 'high', 'medium', 'low', 'superLow']);
const V2_RUN_STATES = new Set<string>(['idle', 'running', 'completed', 'failed']);

export function resolveStatusAndRunState(
  rawStatus: unknown,
  rawRunState: unknown,
): { status: BacklogStatus; runState: BacklogRunState } {
  if (typeof rawStatus === 'string' && V2_STATUSES.has(rawStatus)) {
    const status = rawStatus as BacklogStatus;
    const runState = typeof rawRunState === 'string' && V2_RUN_STATES.has(rawRunState)
      ? (rawRunState as BacklogRunState)
      : 'idle';
    return { status, runState };
  }
  if (typeof rawStatus === 'string' && rawStatus in LEGACY_STATUS_MAP) {
    return LEGACY_STATUS_MAP[rawStatus];
  }
  // Absent/unrecognized mirrors v1's own `status || 'pending'` fallback (§2.1 last row).
  return LEGACY_STATUS_MAP.pending;
}

export function resolvePriority(rawPriority: unknown): BacklogPriority {
  if (typeof rawPriority === 'string' && V2_PRIORITIES.has(rawPriority)) {
    return rawPriority as BacklogPriority;
  }
  if (typeof rawPriority === 'string' && rawPriority in LEGACY_PRIORITY_MAP) {
    return LEGACY_PRIORITY_MAP[rawPriority];
  }
  return 'medium';
}

import { parse as parseYaml } from 'yaml';
import { stat } from 'fs/promises';
import { basename, join, isAbsolute } from 'path';

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;

function splitFrontmatter(content: string): { frontmatter: Record<string, unknown>; rawBody: string } | null {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return null;
  const parsed = parseYaml(match[1]);
  const frontmatter = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
  const rawBody = content.slice(match[0].length).trim();
  return { frontmatter, rawBody };
}

const SECTION_RE = /(?:^|\n)##\s+(Comments|Attachments)\s*\n([\s\S]*?)(?=\n##\s+|$)/gi;

const COMMENT_LINE_RE = /^-\s+\*\*(.+?)\*\*\s+\(([^)]+)\):\s?(.*)$/;
function parseCommentLine(line: string): BacklogComment | null {
  const m = line.trim().match(COMMENT_LINE_RE);
  if (!m) return null;
  return { author: m[1], date: m[2], text: m[3] };
}

const ATTACHMENT_LINE_RE = /^-\s+(.+?)(?:\s+—\s+(.+))?$/;
function parseAttachmentLine(line: string): { path: string; name: string } | null {
  const m = line.trim().match(ATTACHMENT_LINE_RE);
  if (!m) return null;
  const path = m[1].trim();
  const name = m[2]?.trim() || basename(path);
  return { path, name };
}

function splitBody(bodyAfterTitle: string): {
  description: string;
  comments: BacklogComment[];
  attachments: Array<{ path: string; name: string }>;
} {
  let commentsBlock = '';
  let attachmentsBlock = '';
  let firstSectionIndex = -1;

  const re = new RegExp(SECTION_RE.source, 'gi');
  let match: RegExpExecArray | null;
  while ((match = re.exec(bodyAfterTitle)) !== null) {
    if (firstSectionIndex === -1) firstSectionIndex = match.index;
    const heading = match[1].toLowerCase();
    const block = match[2].trim();
    if (heading === 'comments') commentsBlock = block;
    else if (heading === 'attachments') attachmentsBlock = block;
  }

  const description = firstSectionIndex === -1
    ? bodyAfterTitle.trim()
    : bodyAfterTitle.slice(0, firstSectionIndex).trim();

  const comments = commentsBlock
    ? commentsBlock.split('\n').map(parseCommentLine).filter((c): c is BacklogComment => c !== null)
    : [];
  const attachments = attachmentsBlock
    ? attachmentsBlock.split('\n').map(parseAttachmentLine).filter((a): a is { path: string; name: string } => a !== null)
    : [];

  return { description, comments, attachments };
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export interface ParseBacklogCardOptions {
  /** Project root, used to resolve attachment paths for the hot fs.stat size lookup (F0 spec §1.2). */
  projectRoot: string;
}

export async function parseBacklogCard(
  filePath: string,
  content: string,
  opts: ParseBacklogCardOptions,
): Promise<BacklogCard | null> {
  const parsed = splitFrontmatter(content);
  if (!parsed) return null;
  const { frontmatter: fm, rawBody } = parsed;

  const firstLine = rawBody.split('\n')[0] ?? '';
  const title = firstLine.replace(/^#+\s*/, '') || basename(filePath, '.md');
  const bodyAfterTitle = rawBody.replace(/^#+[^\n]*\n?/, '');
  const { description, comments, attachments: rawAttachments } = splitBody(bodyAfterTitle);

  const { status, runState } = resolveStatusAndRunState(fm.status, fm.runState);
  const priority = resolvePriority(fm.priority);

  let createdAt = typeof fm.createdAt === 'string' ? fm.createdAt : '';
  if (!createdAt) {
    try {
      createdAt = (await stat(filePath)).mtime.toISOString();
    } catch {
      createdAt = new Date().toISOString();
    }
  }
  const updatedAt = typeof fm.updatedAt === 'string' ? fm.updatedAt : createdAt;

  const attachments: BacklogAttachment[] = await Promise.all(rawAttachments.map(async (a) => {
    const absPath = isAbsolute(a.path) ? a.path : join(opts.projectRoot, a.path);
    try {
      const s = await stat(absPath);
      return { ...a, size: formatBytes(s.size) };
    } catch {
      return { ...a, size: undefined };
    }
  }));

  const orderRaw = fm.order;
  const order = typeof orderRaw === 'number' ? orderRaw : parseInt(String(orderRaw ?? '0'), 10) || 0;

  return {
    filename: basename(filePath),
    taskId: typeof fm.task_id === 'string' ? fm.task_id : '',
    targetAgent: typeof fm.target_agent === 'string' ? fm.target_agent : '',
    targetModule: typeof fm.target_module === 'string' ? fm.target_module : '',
    priority,
    status,
    runState,
    order,
    ...(typeof fm.epic === 'string' && fm.epic ? { epic: fm.epic } : {}),
    tags: toStringArray(fm.tags),
    estimate: typeof fm.estimate === 'number' ? fm.estimate : 0,
    assignees: toStringArray(fm.assignees),
    related: toStringArray(fm.related),
    createdAt,
    updatedAt,
    title,
    description,
    comments,
    attachments,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

import { stringify as stringifyYaml } from 'yaml';

/**
 * Serializes a BacklogCard back to a full .md file: v2 frontmatter (fixed
 * key order per F0 spec §1.5, scalars always emitted, empty optional
 * arrays/epic omitted) + the body verbatim. `body` is the FULL body
 * (title heading + description + any ## sections) exactly as it should
 * appear after the frontmatter — callers that only changed frontmatter
 * fields (e.g. a status/runState patch) pass the file's existing body
 * unchanged; callers that edited description/comments/attachments must
 * reassemble body themselves (title + description + rendered sections)
 * before calling this.
 */
export function serializeBacklogCard(card: BacklogCard, body: string): string {
  const fm: Record<string, unknown> = {
    task_id: card.taskId,
    ...(card.targetAgent ? { target_agent: card.targetAgent } : {}),
    ...(card.targetModule ? { target_module: card.targetModule } : {}),
    priority: card.priority,
    status: card.status,
    runState: card.runState,
    order: card.order,
    estimate: card.estimate,
    ...(card.epic ? { epic: card.epic } : {}),
    ...(card.tags.length > 0 ? { tags: card.tags } : {}),
    ...(card.assignees.length > 0 ? { assignees: card.assignees } : {}),
    ...(card.related.length > 0 ? { related: card.related } : {}),
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
  };
  const yamlText = stringifyYaml(fm).trimEnd();
  return `---\n${yamlText}\n---\n${body}`;
}

/** Renders comments/attachments back into `## Comments` / `## Attachments` markdown sections, appended after `description`. Used by callers that edit those fields (F2's modal). */
export function renderBody(title: string, description: string, comments: BacklogComment[], attachments: BacklogAttachment[]): string {
  const parts = [`# ${title}`, '', description];
  if (attachments.length > 0) {
    parts.push('', '## Attachments', ...attachments.map(a => a.name && a.name !== basename(a.path) ? `- ${a.path} — ${a.name}` : `- ${a.path}`));
  }
  if (comments.length > 0) {
    parts.push('', '## Comments', ...comments.map(c => `- **${c.author}** (${c.date}): ${c.text}`));
  }
  return parts.join('\n');
}
