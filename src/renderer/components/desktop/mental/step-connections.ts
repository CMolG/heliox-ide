/**
 * step-connections.ts — Shared incoming/outgoing/loop derivation for a Step node
 *
 * Responsibility:
 * - Computes the `connections` shape StepInfoModal/StepRunEvidence expect
 *   (incoming step ids, outgoing step ids, loopOut/loopIn) from the raw
 *   mental-graph edges + nodes, given a single step id.
 * - Split into two layers (perf fix — see StepInspector.tsx's two-tier
 *   subscription): `computeStepConnectionIds` derives the id-level shape from
 *   EDGES ONLY (no node lookups, so it's cheap enough to recompute on every
 *   render off a narrow edges slice), and `computeStepConnections` layers a
 *   title-resolution pass over NODES on top of it for callers that already
 *   have both slices at hand and don't need the split.
 *
 * Boundaries:
 * - Pure functions — no store reads, no React. Callers (StepInspector today;
 *   StepNode historically) pass in their own `mentalEdges`/`mentalNodes`
 *   slices and own the resulting `connections` prop hand-off.
 *
 * Extracted from StepNode.tsx (Phase 8 refactor — the right-side Inspector's
 * "Run evidence" popup needed the exact same derivation StepNode used to
 * compute for its own StepInfoModal portal) so there is exactly one place
 * this math lives, instead of two copies that could silently diverge. Phase
 * 8 ended up removing StepNode's own copy entirely (it no longer opens the
 * modal itself — see StepNode.tsx's context-menu "Inspect step" action).
 *
 * `computeStepConnections` (the combined helper) has no callers left in `src`
 * as of the drag-tick perf fix below — StepInspector.tsx now calls
 * `computeStepConnectionIds` + `stepTitleById` directly so it can subscribe
 * to edges and node-titles separately (see that file's Subscriptions A/B).
 * It stays exported anyway (with the rest of this module) so a future
 * caller that already has both slices on hand — and doesn't need the
 * split-subscription optimization — doesn't have to resurrect this from git
 * history.
 */
import type { CanvasGraphNode, MentalGraphEdge } from '@/types/desktop';
import { clampLoopIterations } from '@/types/harness';

export interface StepConnections {
  incoming: string[];
  outgoing: string[];
  /** Present when this step is a loop edge's source (the later step) — it loops back to `toTitle` after completing. */
  loopOut?: { toTitle: string; maxIterations: number };
  /** Present when this step is a loop edge's target (the earlier step / loop entry point) — `fromTitle` loops back here. */
  loopIn?: { fromTitle: string; maxIterations: number };
}

/**
 * The id-level half of `StepConnections` — everything `computeStepConnections`
 * derives EXCEPT the title lookups (`incoming`/`outgoing` were always raw ids,
 * never titles — see `StepRunEvidence.tsx`, which only ever reads their
 * `.length`; only the loop fields carry a resolved title). Depends on edges
 * only, so a caller can derive this from a narrow, this-step-only edges slice
 * without needing the full node list at all.
 */
export interface StepConnectionIds {
  incoming: string[];
  outgoing: string[];
  /** This step is a loop edge's source — `targetId` is the earlier step it loops back to. */
  loopOut?: { targetId: string; maxIterations: number };
  /** This step is a loop edge's target — `sourceId` is the later step that loops back here. */
  loopIn?: { sourceId: string; maxIterations: number };
}

/** Resolves a mental-graph node id to its Step title, falling back to the raw id for non-step/missing nodes. */
export function stepTitleById(nodeId: string, mentalNodes: CanvasGraphNode[]): string {
  const node = mentalNodes.find((n) => n.id === nodeId);
  return node && node.type === 'step' ? node.data.title : nodeId;
}

/**
 * Edges-only derivation: incoming/outgoing step ids plus the loop edge's
 * counterpart id + clamped `maxIterations`, for a single step. No node
 * lookups — safe to recompute on every render.
 */
export function computeStepConnectionIds(stepId: string, mentalEdges: MentalGraphEdge[]): StepConnectionIds {
  const incoming = mentalEdges.filter((e) => e.targetId === stepId).map((e) => e.sourceId);
  const outgoing = mentalEdges.filter((e) => e.sourceId === stepId).map((e) => e.targetId);

  // `loopOut`: this step IS the loop edge's source (the later step) — it
  // loops back to an earlier step (`targetId`) after completing.
  // `loopIn`: this step IS the loop edge's target (the earlier step / loop
  // entry point) — a later step (`sourceId`) loops back here.
  const loopOutEdge = mentalEdges.find((e) => e.type === 'loop' && e.sourceId === stepId);
  const loopInEdge = mentalEdges.find((e) => e.type === 'loop' && e.targetId === stepId);
  const loopOut = loopOutEdge
    ? { targetId: loopOutEdge.targetId, maxIterations: clampLoopIterations(loopOutEdge.maxIterations) }
    : undefined;
  const loopIn = loopInEdge
    ? { sourceId: loopInEdge.sourceId, maxIterations: clampLoopIterations(loopInEdge.maxIterations) }
    : undefined;

  return { incoming, outgoing, loopOut, loopIn };
}

/**
 * Full derivation (ids + titles) — a thin wrapper: `computeStepConnectionIds`
 * plus a title-resolution pass over `mentalNodes` for the loop fields only.
 */
export function computeStepConnections(
  stepId: string,
  mentalEdges: MentalGraphEdge[],
  mentalNodes: CanvasGraphNode[],
): StepConnections {
  const ids = computeStepConnectionIds(stepId, mentalEdges);
  return {
    incoming: ids.incoming,
    outgoing: ids.outgoing,
    loopOut: ids.loopOut
      ? { toTitle: stepTitleById(ids.loopOut.targetId, mentalNodes), maxIterations: ids.loopOut.maxIterations }
      : undefined,
    loopIn: ids.loopIn
      ? { fromTitle: stepTitleById(ids.loopIn.sourceId, mentalNodes), maxIterations: ids.loopIn.maxIterations }
      : undefined,
  };
}
