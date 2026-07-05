/**
 * normalize-edge-types.test.ts — heals persisted boards carrying edges
 * misclassified by the pre-fix "edge direction follows handle type, not drag
 * order" bug (see orient-connection.ts): forward edges that were saved typed
 * `loop` (phantom iteration badges), or back-edges saved typed `link`.
 */
import { describe, expect, it } from 'vitest';
import type { CanvasGraphNode, MentalGraphEdge, StepGraphNode } from '@/types/desktop';
import { LOOP_DEFAULT_MAX_ITERATIONS } from '@/types/harness';
import { normalizeEdgeTypes } from './normalize-edge-types';

function stepNode(id: string): StepGraphNode {
  return {
    id,
    type: 'step',
    position: { x: 0, y: 0 },
    width: 300,
    height: 190,
    text: id,
    color: '#111111',
    shape: 'square',
    data: { title: id, mods: [], roles: [] },
    createdAt: 1,
  };
}

function linkEdge(id: string, sourceId: string, targetId: string): MentalGraphEdge {
  return { id, sourceId, targetId, type: 'link', color: '#7C3AED', createdAt: 1 };
}

function loopEdge(id: string, sourceId: string, targetId: string, maxIterations?: number): MentalGraphEdge {
  return {
    id, sourceId, targetId, type: 'loop',
    ...(maxIterations !== undefined ? { maxIterations } : {}),
    color: '#7C3AED', createdAt: 1,
  };
}

describe('normalizeEdgeTypes', () => {
  it('re-types a loop edge to link (and drops maxIterations) when its target does not forward-reach its source', () => {
    const nodes: CanvasGraphNode[] = [stepNode('a'), stepNode('b')];
    // A lone A→B edge mistakenly saved as 'loop' — nothing forward-reaches
    // back from B to A, so this can never be a genuine loop-back.
    const edges = [loopEdge('e1', 'a', 'b', 5)];

    const result = normalizeEdgeTypes(nodes, edges);

    expect(result).not.toBe(edges);
    expect(result[0].type).toBe('link');
    expect(result[0].maxIterations).toBeUndefined();
  });

  it('leaves a genuine loop-back edge untouched (same object reference)', () => {
    const nodes: CanvasGraphNode[] = [stepNode('a'), stepNode('b'), stepNode('c')];
    // Forward chain a→b→c, plus a genuine loop-back c→a.
    const forwardAB = linkEdge('e-ab', 'a', 'b');
    const forwardBC = linkEdge('e-bc', 'b', 'c');
    const backCA = loopEdge('e-ca', 'c', 'a', 4);
    const edges = [forwardAB, forwardBC, backCA];

    const result = normalizeEdgeTypes(nodes, edges);

    expect(result).toBe(edges); // whole-array reference stability (no-op)
    expect(result[2]).toBe(backCA); // untouched edge keeps its own identity too
  });

  it('re-types a link edge to loop with default maxIterations when it actually closes a cycle', () => {
    // Two disconnected components: p→q is a plain, uninvolved forward edge
    // (control — proves the normalizer leaves healthy edges alone); x→y→z→x
    // is a genuine 3-cycle that was (mis)saved with EVERY edge typed 'link' —
    // the exact "iteration badge missing / arrow backwards" bug Task 1 fixes.
    // NB: once x→y→z→x is a closed cycle, `wouldCreateStepCycle` (correctly)
    // reports ALL THREE of its edges as cycle-closing when each is checked
    // against the other two — removing any one edge from a pure cycle still
    // leaves a path connecting its endpoints, so there is no single
    // "the" back-edge to distinguish algorithmically. All three become 'loop'.
    const nodes: CanvasGraphNode[] = [
      stepNode('p'), stepNode('q'), stepNode('x'), stepNode('y'), stepNode('z'),
    ];
    const control = linkEdge('e-pq', 'p', 'q');
    const xy = linkEdge('e-xy', 'x', 'y');
    const yz = linkEdge('e-yz', 'y', 'z');
    const zx = linkEdge('e-zx', 'z', 'x');
    const edges = [control, xy, yz, zx];

    const result = normalizeEdgeTypes(nodes, edges);

    expect(result).not.toBe(edges);
    // Uninvolved control edge: untouched, same object reference.
    expect(result.find((e) => e.id === 'e-pq')).toBe(control);
    // Every edge on the healed cycle becomes a loop with the default cap.
    for (const id of ['e-xy', 'e-yz', 'e-zx']) {
      const fixed = result.find((e) => e.id === id)!;
      expect(fixed.type).toBe('loop');
      expect(fixed.maxIterations).toBe(LOOP_DEFAULT_MAX_ITERATIONS);
    }
  });

  it('returns the SAME array reference when nothing changed', () => {
    const nodes: CanvasGraphNode[] = [stepNode('a'), stepNode('b'), stepNode('c')];
    const edges = [
      linkEdge('e-ab', 'a', 'b'),
      linkEdge('e-bc', 'b', 'c'),
      loopEdge('e-ca', 'c', 'a', 4),
    ];

    const result = normalizeEdgeTypes(nodes, edges);

    expect(result).toBe(edges);
  });
});
