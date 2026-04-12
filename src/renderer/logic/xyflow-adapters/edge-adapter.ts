/**
 * xyflow-adapters/edge-adapter.ts — Maps desktop store connections to React Flow edges
 *
 * Converts WindowConnection, attachable links, and MentalGraphEdge
 * objects into React Flow Edge instances.
 */
import type { Edge } from '@xyflow/react';
import type {
  WindowConnection,
  ConnectionPort,
  MentalGraphEdge,
  DesktopAttachable,
  DesktopWindow,
} from '@/types/desktop';
import type {
  ConnectionEdgeData,
  AttachmentEdgeData,
  MentalEdgeData,
} from './types';

// ─── Port → Handle mapping ─────────────────────────────────────

const PORT_HANDLE_MAP: Record<ConnectionPort, string> = {
  top: 'top',
  right: 'right',
  bottom: 'bottom',
  left: 'left',
};

// ─── WindowConnection → Edge ────────────────────────────────────

export function connectionToEdge(conn: WindowConnection): Edge<ConnectionEdgeData> {
  return {
    id: conn.id,
    source: `win-${conn.sourceWindowId}`,
    target: `win-${conn.targetWindowId}`,
    sourceHandle: PORT_HANDLE_MAP[conn.sourcePort],
    targetHandle: PORT_HANDLE_MAP[conn.targetPort],
    type: 'connection',
    data: {
      edgeType: 'connection',
      sourcePort: conn.sourcePort,
      targetPort: conn.targetPort,
    },
  };
}

/** Batch-convert all window connections to edges. */
export function connectionsToEdges(connections: WindowConnection[]): Edge<ConnectionEdgeData>[] {
  return connections.map(connectionToEdge);
}

// ─── Attachable → Window Link Edges ─────────────────────────────

/**
 * Derives attachment edges by checking which attachables are linked
 * to windows via flowId, roleId, modifierIds, or designSystemId.
 */
export function deriveAttachmentEdges(
  windows: DesktopWindow[],
  attachables: DesktopAttachable[],
): Edge<AttachmentEdgeData>[] {
  const edges: Edge<AttachmentEdgeData>[] = [];
  const attachableByName = new Map(attachables.map((a) => [a.name, a]));

  for (const win of windows) {
    if (win.flowId) {
      const att = attachableByName.get(win.flowId);
      if (att) {
        edges.push({
          id: `att-link-${win.id}-flow-${att.id}`,
          source: `att-${att.id}`,
          target: `win-${win.id}`,
          type: 'attachment',
          data: { edgeType: 'attachment', attachableType: att.type },
        });
      }
    }
    if (win.roleId) {
      const att = attachableByName.get(win.roleId);
      if (att) {
        edges.push({
          id: `att-link-${win.id}-role-${att.id}`,
          source: `att-${att.id}`,
          target: `win-${win.id}`,
          type: 'attachment',
          data: { edgeType: 'attachment', attachableType: att.type },
        });
      }
    }
    for (const modId of win.modifierIds) {
      const att = attachableByName.get(modId);
      if (att) {
        edges.push({
          id: `att-link-${win.id}-mod-${att.id}`,
          source: `att-${att.id}`,
          target: `win-${win.id}`,
          type: 'attachment',
          data: { edgeType: 'attachment', attachableType: att.type },
        });
      }
    }
    if (win.designSystemId) {
      const att = attachableByName.get(win.designSystemId);
      if (att) {
        edges.push({
          id: `att-link-${win.id}-ds-${att.id}`,
          source: `att-${att.id}`,
          target: `win-${win.id}`,
          type: 'attachment',
          data: { edgeType: 'attachment', attachableType: att.type },
        });
      }
    }
  }

  return edges;
}

// ─── MentalGraphEdge → Edge ─────────────────────────────────────

export function mentalEdgeToFlowEdge(edge: MentalGraphEdge): Edge<MentalEdgeData> {
  return {
    id: edge.id,
    source: edge.sourceId,
    target: edge.targetId,
    type: 'mental',
    data: {
      edgeType: 'mental-edge',
      mentalType: edge.type,
      color: edge.color,
    },
  };
}

/** Batch-convert all mental edges. */
export function mentalEdgesToFlowEdges(edges: MentalGraphEdge[]): Edge<MentalEdgeData>[] {
  return edges.map(mentalEdgeToFlowEdge);
}
