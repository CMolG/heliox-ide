import { describe, it, expect } from 'vitest';
import {
  mentalSubgraphToDigest,
  mentalAttachmentsToDigest,
  pickMentalSubgraph,
  UNTITLED_NODE_LABEL,
} from './mental-digest';
import type { MentalGraphNode, MentalGraphEdge } from '@/types/desktop';

function n(id: string, text: string): MentalGraphNode {
  return {
    id,
    position: { x: 0, y: 0 },
    width: 200,
    height: 100,
    text,
    color: '#EDE9FE',
    shape: 'square',
    createdAt: 0,
  };
}

function e(id: string, sourceId: string, targetId: string, type: 'link' | 'ramification' = 'link'): MentalGraphEdge {
  return { id, sourceId, targetId, type, color: '#7C3AED', createdAt: 0 };
}

describe('mentalSubgraphToDigest', () => {
  it('returns empty string for empty subgraph', () => {
    expect(mentalSubgraphToDigest({ nodes: [], edges: [] })).toBe('');
  });

  it('emits a [MENTAL MAP] header followed by triples', () => {
    const digest = mentalSubgraphToDigest({
      nodes: [n('a', 'Auth flow'), n('b', 'Session cookie')],
      edges: [e('e1', 'a', 'b', 'link')],
    });
    expect(digest).toBe('[MENTAL MAP]\n"Auth flow" --link--> "Session cookie"');
  });

  it('distinguishes ramification from link predicates', () => {
    const digest = mentalSubgraphToDigest({
      nodes: [n('a', 'Parent'), n('b', 'Child')],
      edges: [e('e1', 'a', 'b', 'ramification')],
    });
    expect(digest).toContain('--ramification-->');
  });

  it('replaces blank node text with <untitled>', () => {
    const digest = mentalSubgraphToDigest({
      nodes: [n('a', '   '), n('b', 'Has text')],
      edges: [e('e1', 'a', 'b')],
    });
    expect(digest).toContain(`"${UNTITLED_NODE_LABEL}" --link--> "Has text"`);
  });

  it('collapses whitespace in node text', () => {
    const digest = mentalSubgraphToDigest({
      nodes: [n('a', 'Multi\n  line   text'), n('b', 'Other')],
      edges: [e('e1', 'a', 'b')],
    });
    expect(digest).toContain('"Multi line text"');
  });

  it('escapes embedded double quotes', () => {
    const digest = mentalSubgraphToDigest({
      nodes: [n('a', 'He said "hi"'), n('b', 'Other')],
      edges: [e('e1', 'a', 'b')],
    });
    expect(digest).toContain('"He said \\"hi\\""');
  });

  it('drops edges that reference nodes outside the subgraph', () => {
    const digest = mentalSubgraphToDigest({
      nodes: [n('a', 'Inside')],
      edges: [e('e1', 'a', 'b-outside'), e('e2', 'b-outside', 'a')],
    });
    // 'a' is orphan because its only edges reference a node not in the subgraph.
    expect(digest).toContain('(orphan) "Inside"');
    expect(digest).not.toContain('-->');
  });

  it('emits orphan lines for nodes with no in/out edges', () => {
    const digest = mentalSubgraphToDigest({
      nodes: [n('a', 'Linked-1'), n('b', 'Linked-2'), n('c', 'Standalone')],
      edges: [e('e1', 'a', 'b')],
    });
    const lines = digest.split('\n');
    expect(lines[0]).toBe('[MENTAL MAP]');
    expect(lines).toContain('"Linked-1" --link--> "Linked-2"');
    expect(lines).toContain('(orphan) "Standalone"');
  });

  it('emits one [MENTAL MAP] header per subgraph when chained', () => {
    const combined = mentalAttachmentsToDigest([
      { nodes: [n('a', 'A')], edges: [] },
      { nodes: [n('b', 'B'), n('c', 'C')], edges: [e('e1', 'b', 'c')] },
    ]);
    const headers = (combined.match(/\[MENTAL MAP\]/g) ?? []).length;
    expect(headers).toBe(2);
    expect(combined).toContain('(orphan) "A"');
    expect(combined).toContain('"B" --link--> "C"');
  });

  it('skips empty subgraphs when combining', () => {
    const combined = mentalAttachmentsToDigest([
      { nodes: [], edges: [] },
      { nodes: [n('a', 'A')], edges: [] },
    ]);
    const headers = (combined.match(/\[MENTAL MAP\]/g) ?? []).length;
    expect(headers).toBe(1);
  });
});

describe('pickMentalSubgraph', () => {
  const allNodes = [n('a', 'A'), n('b', 'B'), n('c', 'C')];
  const allEdges = [e('e1', 'a', 'b'), e('e2', 'b', 'c'), e('e3', 'a', 'c')];

  it('returns the entire graph when nodeIds is empty (live whole-map attachment)', () => {
    const sub = pickMentalSubgraph(allNodes, allEdges, []);
    expect(sub.nodes).toHaveLength(3);
    expect(sub.edges).toHaveLength(3);
  });

  it('returns only the requested nodes plus their inner edges', () => {
    const sub = pickMentalSubgraph(allNodes, allEdges, ['a', 'b']);
    expect(sub.nodes.map(x => x.id)).toEqual(['a', 'b']);
    expect(sub.edges.map(x => x.id)).toEqual(['e1']);
  });

  it('silently drops ids no longer present in the live graph', () => {
    const sub = pickMentalSubgraph(allNodes, allEdges, ['a', 'ghost-id']);
    expect(sub.nodes.map(x => x.id)).toEqual(['a']);
    expect(sub.edges).toEqual([]);
  });
});
