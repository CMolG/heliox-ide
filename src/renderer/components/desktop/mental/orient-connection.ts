/**
 * orient-connection.ts — Re-orients an xyflow connection to follow drag order
 *
 * Responsibility:
 * - With `ConnectionMode.Loose`, xyflow assigns `connection.source`/`target` by
 *   handle TYPE (right/bottom=source, top/left=target), not by which node the
 *   user actually dragged FROM. Dragging out of a left/top handle therefore
 *   produces a connection that reads backwards relative to the user's gesture.
 * - `orientConnection` corrects this: given the node id the drag started on
 *   (tracked separately via `onConnectStart`), it swaps source/target (and
 *   their handles) whenever xyflow's reported source is NOT the drag origin.
 *
 * Boundaries:
 * - Pure function, no React Flow/store access — MentalGraphCanvas's `onConnect`
 *   calls this before computing the edge type via `resolveConnectionEdgeType`,
 *   so downstream loop/link classification always sees a correctly-oriented
 *   connection.
 */
export interface OrientableConnection {
  source: string;
  target: string;
  sourceHandle: string | null;
  targetHandle: string | null;
}

export function orientConnection(
  dragOriginNodeId: string | null,
  connection: OrientableConnection,
): OrientableConnection {
  if (!dragOriginNodeId || connection.source === dragOriginNodeId) return connection;
  if (connection.target !== dragOriginNodeId) return connection;
  return {
    source: connection.target,
    target: connection.source,
    sourceHandle: connection.targetHandle,
    targetHandle: connection.sourceHandle,
  };
}
