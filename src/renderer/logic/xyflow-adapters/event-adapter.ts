/**
 * xyflow-adapters/event-adapter.ts — Maps React Flow events back to store actions
 *
 * Handles the write-side: React Flow node/edge changes → desktop store mutations.
 * This keeps the React Flow ↔ store sync bidirectional.
 */
import type { NodeChange, EdgeChange, Connection } from '@xyflow/react';

// ─── Types for store dispatch ────────────────────────────────────

export interface NodePositionUpdate {
  id: string;
  position: { x: number; y: number };
}

export interface NodeDimensionUpdate {
  id: string;
  width: number;
  height: number;
}

export interface NodeRemoval {
  id: string;
}

// ─── Node change processors ─────────────────────────────────────

/**
 * Extracts position updates from React Flow node changes.
 * Separates window nodes (win-*) from other node types.
 */
export function extractPositionUpdates(changes: NodeChange[]): {
  windowUpdates: NodePositionUpdate[];
  attachableUpdates: NodePositionUpdate[];
  mentalUpdates: NodePositionUpdate[];
  gridUpdates: NodePositionUpdate[];
} {
  const windowUpdates: NodePositionUpdate[] = [];
  const attachableUpdates: NodePositionUpdate[] = [];
  const mentalUpdates: NodePositionUpdate[] = [];
  const gridUpdates: NodePositionUpdate[] = [];

  for (const change of changes) {
    if (change.type !== 'position' || !('position' in change) || !change.position) continue;

    const update: NodePositionUpdate = {
      id: stripPrefix(change.id),
      position: change.position,
    };

    if (change.id.startsWith('win-')) {
      windowUpdates.push(update);
    } else if (change.id.startsWith('att-')) {
      attachableUpdates.push(update);
    } else if (change.id.startsWith('grid-')) {
      gridUpdates.push(update);
    } else {
      mentalUpdates.push(update);
    }
  }

  return { windowUpdates, attachableUpdates, mentalUpdates, gridUpdates };
}

/**
 * Extracts dimension updates from React Flow node changes.
 */
export function extractDimensionUpdates(changes: NodeChange[]): {
  windowUpdates: NodeDimensionUpdate[];
  mentalUpdates: NodeDimensionUpdate[];
} {
  const windowUpdates: NodeDimensionUpdate[] = [];
  const mentalUpdates: NodeDimensionUpdate[] = [];

  for (const change of changes) {
    if (change.type !== 'dimensions' || !('dimensions' in change) || !change.dimensions) continue;

    const update: NodeDimensionUpdate = {
      id: stripPrefix(change.id),
      width: change.dimensions.width,
      height: change.dimensions.height,
    };

    if (change.id.startsWith('win-')) {
      windowUpdates.push(update);
    } else {
      mentalUpdates.push(update);
    }
  }

  return { windowUpdates, mentalUpdates };
}

/**
 * Extracts removals from React Flow node changes.
 */
export function extractRemovals(changes: NodeChange[]): {
  windowRemovals: string[];
  attachableRemovals: string[];
  mentalRemovals: string[];
} {
  const windowRemovals: string[] = [];
  const attachableRemovals: string[] = [];
  const mentalRemovals: string[] = [];

  for (const change of changes) {
    if (change.type !== 'remove') continue;

    const rawId = stripPrefix(change.id);
    if (change.id.startsWith('win-')) {
      windowRemovals.push(rawId);
    } else if (change.id.startsWith('att-')) {
      attachableRemovals.push(rawId);
    } else {
      mentalRemovals.push(rawId);
    }
  }

  return { windowRemovals, attachableRemovals, mentalRemovals };
}

// ─── Edge change processors ─────────────────────────────────────

/**
 * Extracts edge removals from React Flow edge changes.
 */
export function extractEdgeRemovals(changes: EdgeChange[]): string[] {
  return changes
    .filter((c): c is EdgeChange & { type: 'remove' } => c.type === 'remove')
    .map((c) => c.id);
}

/**
 * Maps a React Flow connection to source/target IDs stripped of prefixes.
 */
export function connectionToIds(connection: Connection): {
  sourceId: string;
  targetId: string;
  sourceHandle: string | null;
  targetHandle: string | null;
} {
  return {
    sourceId: stripPrefix(connection.source),
    targetId: stripPrefix(connection.target),
    sourceHandle: connection.sourceHandle ?? null,
    targetHandle: connection.targetHandle ?? null,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────

/** Strips the node-type prefix (win-, att-, grid-) from an ID. */
function stripPrefix(id: string): string {
  const match = id.match(/^(?:win|att|grid)-(.+)$/);
  return match ? match[1] : id;
}
