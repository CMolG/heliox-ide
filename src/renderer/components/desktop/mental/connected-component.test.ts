/**
 * connected-component.test.ts — unit tests for getConnectedComponent (Task B, Req11)
 *
 * Tests the pure BFS helper that computes which mental-graph nodes belong to
 * the same connected component as any currently-selected node, so the whole
 * component can be elevated above unrelated nodes.
 */
import { describe, expect, it } from 'vitest';
import { getConnectedComponent } from '../../../logic/mental-graph';

type SimpleEdge = { sourceId: string; targetId: string };

describe('getConnectedComponent', () => {
  it('returns an empty set when no seeds are given', () => {
    const edges: SimpleEdge[] = [{ sourceId: 'a', targetId: 'b' }];
    const result = getConnectedComponent([], edges);
    expect(result.size).toBe(0);
  });

  it('returns only the seed when it has no edges', () => {
    const result = getConnectedComponent(['x'], []);
    expect(result).toEqual(new Set(['x']));
  });

  it('includes directly connected neighbors (undirected)', () => {
    const edges: SimpleEdge[] = [
      { sourceId: 'a', targetId: 'b' },
      { sourceId: 'b', targetId: 'c' },
    ];
    // Selecting 'a' should reach 'b' and 'c' via transitivity
    const result = getConnectedComponent(['a'], edges);
    expect(result).toEqual(new Set(['a', 'b', 'c']));
  });

  it('treats edges as undirected — reachable from target back to source', () => {
    const edges: SimpleEdge[] = [{ sourceId: 'a', targetId: 'b' }];
    // Selecting the target 'b' should still reach 'a'
    const result = getConnectedComponent(['b'], edges);
    expect(result).toEqual(new Set(['a', 'b']));
  });

  it('does not cross into a disconnected component', () => {
    const edges: SimpleEdge[] = [
      { sourceId: 'a', targetId: 'b' },
      { sourceId: 'c', targetId: 'd' },
    ];
    const result = getConnectedComponent(['a'], edges);
    expect(result).toEqual(new Set(['a', 'b']));
    expect(result.has('c')).toBe(false);
    expect(result.has('d')).toBe(false);
  });

  it('merges multiple seeds — union of their components', () => {
    const edges: SimpleEdge[] = [
      { sourceId: 'a', targetId: 'b' },
      { sourceId: 'c', targetId: 'd' },
    ];
    // Selecting both disconnected roots should return both components
    const result = getConnectedComponent(['a', 'c'], edges);
    expect(result).toEqual(new Set(['a', 'b', 'c', 'd']));
  });

  it('handles cycles without infinite loops', () => {
    const edges: SimpleEdge[] = [
      { sourceId: 'a', targetId: 'b' },
      { sourceId: 'b', targetId: 'c' },
      { sourceId: 'c', targetId: 'a' }, // cycle back
    ];
    const result = getConnectedComponent(['a'], edges);
    expect(result).toEqual(new Set(['a', 'b', 'c']));
  });

  it('handles a star topology', () => {
    const edges: SimpleEdge[] = [
      { sourceId: 'hub', targetId: 'n1' },
      { sourceId: 'hub', targetId: 'n2' },
      { sourceId: 'hub', targetId: 'n3' },
    ];
    const result = getConnectedComponent(['n2'], edges);
    expect(result).toEqual(new Set(['hub', 'n1', 'n2', 'n3']));
  });

  it('node not referenced in any edge is isolated (just itself)', () => {
    const edges: SimpleEdge[] = [{ sourceId: 'a', targetId: 'b' }];
    const result = getConnectedComponent(['z'], edges);
    expect(result).toEqual(new Set(['z']));
  });
});
