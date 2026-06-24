/**
 * xyflow-adapters/types.ts — Core type definitions for the @xyflow/react adapter layer
 *
 * Defines the node/edge types that map the window system concepts to
 * React Flow's data model, preparing for a future Figma-style canvas.
 */
import type { Node, Edge } from '@xyflow/react';
import type {
  DesktopWindow,
  WindowConnection,
  DesktopAttachable,
  DesktopGrid,
  MentalShape,
} from '@/types/desktop';

// ─── Node Types ──────────────────────────────────────────────────

/** Discriminator for custom node types rendered on the canvas. */
export type CanvasNodeType =
  | 'window'
  | 'attachable'
  | 'mental'
  | 'grid';

/** Data payload for a window node (chat, plugin, file-explorer, etc.). */
export interface WindowNodeData {
  nodeType: 'window';
  windowId: string;
  windowType: DesktopWindow['type'];
  title: string;
  iconName: string;
  state: DesktopWindow['state'];
  sessionId?: string;
  pluginId?: string;
  flowId?: string;
  roleId?: string;
  modifierIds: string[];
  filePath?: string;
  gridId?: string;
  [key: string]: unknown;
}

/** Data payload for an attachable node (role, mod, flow). */
export interface AttachableNodeData {
  nodeType: 'attachable';
  attachableId: string;
  attachableType: DesktopAttachable['type'];
  name: string;
  [key: string]: unknown;
}

/** Data payload for a mental shape node. */
export interface MentalNodeData {
  nodeType: 'mental';
  text: string;
  color: string;
  width: number;
  height: number;
  shape: MentalShape;
  [key: string]: unknown;
}

/** Data payload for a grid container node. */
export interface GridNodeData {
  nodeType: 'grid';
  gridId: string;
  label: string;
  columns: number;
  rows: number;
  [key: string]: unknown;
}

/** Union of all canvas node data types. */
export type CanvasNodeData =
  | WindowNodeData
  | AttachableNodeData
  | MentalNodeData
  | GridNodeData;

/** A fully-typed React Flow node for the canvas. */
export type CanvasNode = Node<CanvasNodeData>;

// ─── Edge Types ──────────────────────────────────────────────────

/** Discriminator for custom edge types. */
export type CanvasEdgeType =
  | 'connection'     // window-to-window automation arrow
  | 'attachment'     // attachable linked to a window
  | 'mental-edge';   // mental graph edge (ramification / link)

/** Data payload for a connection edge. */
export interface ConnectionEdgeData {
  edgeType: 'connection';
  sourcePort: WindowConnection['sourcePort'];
  targetPort: WindowConnection['targetPort'];
  [key: string]: unknown;
}

/** Data payload for an attachment edge (market item → window). */
export interface AttachmentEdgeData {
  edgeType: 'attachment';
  attachableType: DesktopAttachable['type'];
  [key: string]: unknown;
}

/** Data payload for a mental graph edge. */
export interface MentalEdgeData {
  edgeType: 'mental-edge';
  mentalType: 'ramification' | 'link';
  color: string;
  [key: string]: unknown;
}

/** Union of all canvas edge data types. */
export type CanvasEdgeData =
  | ConnectionEdgeData
  | AttachmentEdgeData
  | MentalEdgeData;

/** A fully-typed React Flow edge for the canvas. */
export type CanvasEdge = Edge<CanvasEdgeData>;

// ─── Viewport State ──────────────────────────────────────────────

/** Mirrors the canvas pan/zoom for viewport syncing. */
export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}
