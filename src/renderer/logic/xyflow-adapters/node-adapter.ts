/**
 * xyflow-adapters/node-adapter.ts — Maps desktop store entities to React Flow nodes
 *
 * Converts DesktopWindow, DesktopAttachable, MentalGraphNode, and DesktopGrid
 * objects into React Flow Node instances. This is the read-side of the adapter:
 * store → React Flow.
 *
 * The inverse (React Flow → store) is handled by the event adapter (onNodesChange).
 */
import type { Node } from '@xyflow/react';
import type {
  DesktopWindow,
  DesktopAttachable,
  MentalGraphNode,
  DesktopGrid,
} from '@/types/desktop';
import type {
  WindowNodeData,
  AttachableNodeData,
  MentalNodeData,
  GridNodeData,
} from './types';

// ─── Window → Node ──────────────────────────────────────────────

export function windowToNode(win: DesktopWindow): Node<WindowNodeData> {
  return {
    id: `win-${win.id}`,
    type: 'window',
    position: { x: win.position.x, y: win.position.y },
    data: {
      nodeType: 'window',
      windowId: win.id,
      windowType: win.type,
      title: win.title,
      iconName: win.iconName,
      state: win.state,
      sessionId: win.sessionId,
      pluginId: win.pluginId,
      flowId: win.flowId,
      roleId: win.roleId,
      modifierIds: win.modifierIds,
      filePath: win.filePath,
      gridId: win.gridId,
    },
    width: win.size.width,
    height: win.size.height,
    style: { width: win.size.width, height: win.size.height },
    zIndex: win.zIndex,
    draggable: win.state !== 'maximized',
    selectable: true,
  };
}

/** Batch-convert all windows to React Flow nodes. */
export function windowsToNodes(windows: DesktopWindow[]): Node<WindowNodeData>[] {
  return windows.map(windowToNode);
}

// ─── Attachable → Node ──────────────────────────────────────────

export function attachableToNode(att: DesktopAttachable): Node<AttachableNodeData> {
  return {
    id: `att-${att.id}`,
    type: 'attachable',
    position: { x: att.position.x, y: att.position.y },
    data: {
      nodeType: 'attachable',
      attachableId: att.id,
      attachableType: att.type,
      name: att.name,
    },
    zIndex: att.zIndex,
    draggable: true,
    selectable: true,
  };
}

/** Batch-convert all attachables to React Flow nodes. */
export function attachablesToNodes(attachables: DesktopAttachable[]): Node<AttachableNodeData>[] {
  return attachables.map(attachableToNode);
}

// ─── MentalGraphNode → Node ─────────────────────────────────────

export function mentalGraphNodeToNode(n: MentalGraphNode): Node<MentalNodeData> {
  return {
    id: n.id,
    type: 'mental',
    position: n.position,
    data: {
      nodeType: 'mental',
      text: n.text,
      color: n.color,
      width: n.width,
      height: n.height,
      shape: n.shape ?? 'square',
    },
    width: n.width,
    height: n.height,
    style: { width: n.width, height: n.height },
    dragHandle: '.mental-card',
  };
}

/** Batch-convert all mental nodes. */
export function mentalNodesToNodes(nodes: MentalGraphNode[]): Node<MentalNodeData>[] {
  return nodes.map(mentalGraphNodeToNode);
}

// ─── Grid → Node ────────────────────────────────────────────────

export function gridToNode(grid: DesktopGrid): Node<GridNodeData> {
  return {
    id: `grid-${grid.id}`,
    type: 'grid',
    position: { x: grid.position.x, y: grid.position.y },
    data: {
      nodeType: 'grid',
      gridId: grid.id,
      label: `Grid ${grid.columns}×${grid.rows}`,
      columns: grid.columns,
      rows: grid.rows,
    },
    width: grid.size.width,
    height: grid.size.height,
    style: { width: grid.size.width, height: grid.size.height },
    draggable: true,
    selectable: true,
  };
}

/** Batch-convert all grids. */
export function gridsToNodes(grids: DesktopGrid[]): Node<GridNodeData>[] {
  return grids.map(gridToNode);
}
