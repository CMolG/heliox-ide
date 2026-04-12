/**
 * context-map.ts — Shared types
 *
 * Responsibility:
 * - Canonical data model for the project-scoped Context Mental Map.
 * - Shared by main (store/injection) and renderer (map UI) layers.
 */

export type ContextMapNodeSource = 'user' | 'agent' | 'import';

export type ContextMapNodeType =
  | 'concept'
  | 'file'
  | 'pattern'
  | 'constraint'
  | 'goal'
  | 'decision'
  | 'reference'
  | 'person'
  | 'question'
  | 'instruction'
  | 'persona-mod'
  | 'context-snippet'
  | 'checklist'
  | 'session';

export type ContextMapAttachableType =
  | 'constraint'
  | 'instruction'
  | 'persona-mod'
  | 'context-snippet'
  | 'goal'
  | 'checklist';

export type ContextMapInjectMode = 'system' | 'prefix' | 'suffix';
export type ContextMapPriority = 'critical' | 'high' | 'normal';

export type ContextMapSessionStatus = 'running' | 'completed' | 'stopped';

export interface ContextMapAttachment {
  sessionId: string;
  attachedAt: string;
  attachedBy: 'user' | 'agent';
  active: boolean;
}

export interface ContextMapNode {
  id: string;
  type: ContextMapNodeType;
  label: string;
  body?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  source: ContextMapNodeSource;
  sessionId?: string;

  // Attachable extensions
  attachments?: ContextMapAttachment[];
  injectMode?: ContextMapInjectMode;
  priority?: ContextMapPriority;

  // Session node extensions
  status?: ContextMapSessionStatus;
  roleId?: string;

  // Lightweight persisted coordinates for the map canvas
  x?: number;
  y?: number;
}

export interface ContextMapEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  weight?: number;
  dashed?: boolean;
}

export interface ContextMap {
  version: 1;
  projectId: string;
  nodes: ContextMapNode[];
  edges: ContextMapEdge[];
}

export interface ContextDigestOptions {
  roleId?: string;
  sessionId?: string;
  limit?: number;
}

export interface AttachableAttachOptions {
  injectMode?: ContextMapInjectMode;
  priority?: ContextMapPriority;
  attachedBy?: 'user' | 'agent';
}

export interface AttachablePreset {
  name: string;
  type: ContextMapAttachableType;
  body: string;
  injectMode: ContextMapInjectMode;
  priority: ContextMapPriority;
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

export function isAttachableNode(node: ContextMapNode): boolean {
  return isAttachableType(node.type);
}
