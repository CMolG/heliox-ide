/**
 * mental-digest.ts — Renderer / AI Composition
 *
 * Responsibility:
 * - Serialize a subgraph of the mental map (nodes + edges) into a compact
 *   triple-style block that the LLM can ingest as context.
 *
 * Boundaries:
 * - Owns: the canonical text shape of an attached mental subgraph.
 * - Does NOT own: subgraph selection (caller picks which nodes/edges) or
 *   prompt assembly (handled by agent-manager via `contextDigest`).
 */
import type { CanvasGraphNode, MentalGraphNode, MentalGraphEdge } from '@/types/desktop';

/** Strict label for an untitled / blank node. */
export const UNTITLED_NODE_LABEL = '<untitled>';

/** Sanitize node text for inclusion inside `"…"` triples. */
function quote(text: string): string {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (!clean) return `"${UNTITLED_NODE_LABEL}"`;
  // Escape embedded double-quotes so we don't break parsing on the model side.
  return `"${clean.replace(/"/g, '\\"')}"`;
}

/** Map our edge type to a stable, readable arrow predicate. */
function predicate(edge: MentalGraphEdge): string {
  return edge.type === 'ramification' ? 'ramification' : 'link';
}

export interface MentalSubgraph {
  nodes: MentalGraphNode[];
  edges: MentalGraphEdge[];
}

function isMentalGraphNode(node: CanvasGraphNode): node is MentalGraphNode {
  return node.type !== 'step';
}

/**
 * Returns the triples-format digest for a subgraph. Empty subgraphs return ''.
 *
 * Shape (decision: triples, token-efficient):
 *
 *   [MENTAL MAP]
 *   "Auth flow" --link--> "Session cookie"
 *   "Session cookie" --ramification--> "JWT refresh"
 *   "Auth flow" --link--> "JWT refresh"
 *   (orphan) "Open question: TTL?"
 *
 * Orphan nodes (in `nodes` but referenced by no edge) appear as `(orphan)`
 * lines so the model still sees them as concepts even with no relations.
 */
export function mentalSubgraphToDigest(subgraph: MentalSubgraph): string {
  const { nodes, edges } = subgraph;
  if (nodes.length === 0) return '';

  const byId = new Map(nodes.map(n => [n.id, n]));

  // Filter edges down to those whose endpoints are BOTH inside the subgraph.
  const innerEdges = edges.filter(e => byId.has(e.sourceId) && byId.has(e.targetId));

  // Track which nodes participate in at least one edge.
  const connectedIds = new Set<string>();
  for (const e of innerEdges) {
    connectedIds.add(e.sourceId);
    connectedIds.add(e.targetId);
  }

  const lines: string[] = ['[MENTAL MAP]'];

  for (const e of innerEdges) {
    const from = byId.get(e.sourceId)!;
    const to = byId.get(e.targetId)!;
    lines.push(`${quote(from.text)} --${predicate(e)}--> ${quote(to.text)}`);
  }

  const orphans = nodes.filter(n => !connectedIds.has(n.id));
  for (const o of orphans) {
    lines.push(`(orphan) ${quote(o.text)}`);
  }

  return lines.join('\n');
}

/**
 * Join one or more mental subgraphs into a single context block separated by
 * blank lines. Empty subgraphs are skipped.
 */
export function mentalAttachmentsToDigest(subgraphs: MentalSubgraph[]): string {
  return subgraphs
    .map(mentalSubgraphToDigest)
    .filter(s => s.length > 0)
    .join('\n\n');
}

/**
 * Resolve a saved attachment (list of node ids) against the live graph.
 * Empty `nodeIds` means "the whole graph at this moment".
 * Missing ids are silently dropped (nodes the user may have deleted since
 * attaching).
 */
export function pickMentalSubgraph(
  allNodes: CanvasGraphNode[],
  allEdges: MentalGraphEdge[],
  nodeIds: string[],
): MentalSubgraph {
  const mentalNodes = allNodes.filter(isMentalGraphNode);
  if (nodeIds.length === 0) {
    return { nodes: mentalNodes, edges: allEdges };
  }
  const idSet = new Set(nodeIds);
  const nodes = mentalNodes.filter(n => idSet.has(n.id));
  const edges = allEdges.filter(e => idSet.has(e.sourceId) && idSet.has(e.targetId));
  return { nodes, edges };
}
