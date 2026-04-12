import type { ContextMapInjectMode, ContextMapNode, ContextMapPriority } from '../../types/context-map';
import { attachmentRegistry } from './attachment-registry';

const PRIORITY_RANK: Record<ContextMapPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
};

function toPriorityLabel(priority?: ContextMapPriority): string {
  const p = priority ?? 'normal';
  return p.toUpperCase();
}

function directiveLine(node: ContextMapNode): string {
  const content = node.body?.trim() || node.label;
  return `[${toPriorityLabel(node.priority)}] ${content}`;
}

function buildBlock(nodes: ContextMapNode[]): string {
  if (nodes.length === 0) return '';
  const sorted = [...nodes].sort((a, b) => {
    const pa = PRIORITY_RANK[a.priority ?? 'normal'];
    const pb = PRIORITY_RANK[b.priority ?? 'normal'];
    if (pa !== pb) return pa - pb;
    return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
  });
  return ['[ACTIVE DIRECTIVES]', ...sorted.map(directiveLine)].join('\n');
}

function partitionByInjectMode(nodes: ContextMapNode[]): Record<ContextMapInjectMode, ContextMapNode[]> {
  const groups: Record<ContextMapInjectMode, ContextMapNode[]> = {
    system: [],
    prefix: [],
    suffix: [],
  };
  for (const node of nodes) {
    const mode = node.injectMode ?? 'prefix';
    groups[mode].push(node);
  }
  return groups;
}

export function getAttachmentInjectionBlocks(sessionId: string): {
  system: string;
  prefix: string;
  suffix: string;
} {
  const nodes = attachmentRegistry.listForSession(sessionId);
  const groups = partitionByInjectMode(nodes);
  return {
    system: buildBlock(groups.system),
    prefix: buildBlock(groups.prefix),
    suffix: buildBlock(groups.suffix),
  };
}
