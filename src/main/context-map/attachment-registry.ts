import type { ContextMapNode, ContextMapPriority } from '../../types/context-map';
import { isAttachableNode } from '../../types/context-map';
import { ensureContextMap, writeContextMap } from './store';

const PRIORITY_RANK: Record<ContextMapPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
};

/**
 * In-memory singleton for live session attachments.
 * Source of truth is persisted context-map; registry is optimized for prompt-time lookup.
 */
export class AttachmentRegistry {
  private bySession = new Map<string, ContextMapNode[]>();

  async refresh(projectPath: string): Promise<void> {
    const map = await ensureContextMap(projectPath);
    const next = new Map<string, ContextMapNode[]>();
    for (const node of map.nodes) {
      if (!isAttachableNode(node)) continue;
      const attachments = node.attachments ?? [];
      for (const attachment of attachments) {
        if (!attachment.active) continue;
        const list = next.get(attachment.sessionId) ?? [];
        list.push(node);
        next.set(attachment.sessionId, list);
      }
    }
    for (const [sessionId, nodes] of next.entries()) {
      nodes.sort((a, b) => {
        const pa = PRIORITY_RANK[a.priority ?? 'normal'];
        const pb = PRIORITY_RANK[b.priority ?? 'normal'];
        if (pa !== pb) return pa - pb;
        return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
      });
      next.set(sessionId, nodes);
    }
    this.bySession = next;
  }

  listForSession(sessionId: string): ContextMapNode[] {
    return this.bySession.get(sessionId) ?? [];
  }

  listAll(): Record<string, ContextMapNode[]> {
    const out: Record<string, ContextMapNode[]> = {};
    for (const [k, v] of this.bySession.entries()) out[k] = v;
    return out;
  }

  async attach(projectPath: string, attachableId: string, sessionId: string, by: 'user' | 'agent' = 'user'): Promise<void> {
    const map = await ensureContextMap(projectPath);
    const node = map.nodes.find(n => n.id === attachableId);
    if (!node || !isAttachableNode(node)) {
      throw new Error('[attachable] Attachable node not found');
    }
    const now = new Date().toISOString();
    const attachments = node.attachments ?? [];
    const existing = attachments.find(a => a.sessionId === sessionId);
    if (existing) {
      existing.active = true;
      existing.attachedAt = now;
      existing.attachedBy = by;
    } else {
      attachments.push({
        sessionId,
        attachedAt: now,
        attachedBy: by,
        active: true,
      });
    }
    node.attachments = attachments;
    node.updatedAt = now;
    await writeContextMap(projectPath, map);
    await this.refresh(projectPath);
  }

  async detach(projectPath: string, attachableId: string, sessionId: string): Promise<void> {
    const map = await ensureContextMap(projectPath);
    const node = map.nodes.find(n => n.id === attachableId);
    if (!node || !isAttachableNode(node)) {
      throw new Error('[attachable] Attachable node not found');
    }
    const attachments = node.attachments ?? [];
    const existing = attachments.find(a => a.sessionId === sessionId);
    if (existing) {
      existing.active = false;
      node.updatedAt = new Date().toISOString();
      await writeContextMap(projectPath, map);
    }
    await this.refresh(projectPath);
  }
}

export const attachmentRegistry = new AttachmentRegistry();
