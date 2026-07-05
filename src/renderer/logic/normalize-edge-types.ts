/**
 * normalize-edge-types.ts — heals persisted `link`/`loop` misclassification
 *
 * Responsibility:
 * - Before Task 1's `orient-connection` fix, edges dragged from a
 *   target-typed handle (top/left) recorded source/target backwards, which
 *   made `resolveConnectionEdgeType` (desktop-store's `onConnect` path,
 *   itself a thin wrapper over `wouldCreateStepCycle`) misclassify ordinary
 *   forward connectors as `loop` (phantom iteration badges) or, symmetrically,
 *   let a genuine back-edge slip through saved as `link`. Boards saved before
 *   the fix can carry either mistake forward indefinitely since nothing
 *   re-evaluates a persisted edge's type once written.
 * - `normalizeEdgeTypes` re-derives each `link`/`loop` edge's correct type
 *   from the CURRENT graph shape (excluding the edge itself, so it never
 *   "counts" its own presence when asked whether it closes a cycle — same
 *   rule `invertMentalEdge` follows) and applies it on every board hydration.
 *
 * Boundaries:
 * - Pure function, no store access — desktop-store calls this at every site
 *   that hydrates `mentalNodes`/`mentalEdges` from persisted data (the
 *   `merge` rehydration hook, and `switchBoard`/`deleteBoard`'s snapshot
 *   reads), not on every render.
 * - Only touches `link`/`loop` edges — `ramification` edges (and any edge
 *   with a non-Step endpoint) are never reclassified by `wouldCreateStepCycle`
 *   in the first place, so leaving their type untouched here is a no-op in
 *   practice; skipping them explicitly just avoids a wasted recompute.
 * - Reference-stable: returns the SAME edge object when that edge's type was
 *   already correct, and the SAME array when no edge in it changed at all —
 *   so a no-op normalization pass never dirties zustand/persist equality
 *   checks or triggers extra re-renders/writes.
 */
import type { CanvasGraphNode, MentalGraphEdge } from '@/types/desktop';
import { wouldCreateStepCycle } from '../lib/harness-compiler';
import { LOOP_DEFAULT_MAX_ITERATIONS, clampLoopIterations } from '@/types/harness';

export function normalizeEdgeTypes(
  nodes: CanvasGraphNode[],
  edges: MentalGraphEdge[],
): MentalGraphEdge[] {
  let changed = false;

  const next = edges.map((edge) => {
    if (edge.type !== 'link' && edge.type !== 'loop') return edge;

    // Re-classify against the graph MINUS this edge — an edge must not count
    // itself when deciding whether its own direction closes a cycle.
    const others = edges.filter((e) => e.id !== edge.id);
    const shouldBeLoop = wouldCreateStepCycle(edge.sourceId, edge.targetId, nodes, others);
    const isCurrentlyLoop = edge.type === 'loop';
    if (shouldBeLoop === isCurrentlyLoop) return edge; // already correctly classified

    changed = true;
    if (shouldBeLoop) {
      return {
        ...edge,
        type: 'loop' as const,
        maxIterations: clampLoopIterations(edge.maxIterations ?? LOOP_DEFAULT_MAX_ITERATIONS),
      };
    }
    const { maxIterations: _drop, ...rest } = edge;
    return { ...rest, type: 'link' as const };
  });

  return changed ? next : edges;
}
