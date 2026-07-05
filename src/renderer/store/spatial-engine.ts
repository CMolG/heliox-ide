import type { CanvasGraphNode } from '@/types/desktop';

export interface InsertionPoint {
  x: number;
  y: number;
}

const INSERTION_MARGIN_X = 400;
const DEFAULT_INSERTION_Y = 120;

function resolveAbsolutePosition(
  node: CanvasGraphNode,
  nodeById: Map<string, CanvasGraphNode>,
  seen = new Set<string>(),
): InsertionPoint {
  if (!('parentId' in node) || !node.parentId || seen.has(node.id)) {
    return node.position;
  }

  const parent = nodeById.get(node.parentId);
  if (!parent) return node.position;

  seen.add(node.id);
  const parentPosition = resolveAbsolutePosition(parent, nodeById, seen);
  return {
    x: parentPosition.x + node.position.x,
    y: parentPosition.y + node.position.y,
  };
}

export function calculateSafeInsertionPoint(
  existingNodes: CanvasGraphNode[],
  newFrameWidth: number,
  newFrameHeight: number,
): InsertionPoint {
  if (existingNodes.length === 0) {
    return { x: INSERTION_MARGIN_X, y: DEFAULT_INSERTION_Y };
  }

  const nodeById = new Map(existingNodes.map((node) => [node.id, node]));
  let maxRight = 0;
  let minTop = Number.POSITIVE_INFINITY;
  let maxBottom = 0;

  for (const node of existingNodes) {
    const absolutePosition = resolveAbsolutePosition(node, nodeById);
    maxRight = Math.max(maxRight, absolutePosition.x + node.width);
    minTop = Math.min(minTop, absolutePosition.y);
    maxBottom = Math.max(maxBottom, absolutePosition.y + node.height);
  }

  const nextY = Number.isFinite(minTop)
    ? Math.max(DEFAULT_INSERTION_Y, Math.min(minTop, maxBottom - newFrameHeight))
    : DEFAULT_INSERTION_Y;

  return {
    x: maxRight + INSERTION_MARGIN_X,
    y: nextY,
  };
}
