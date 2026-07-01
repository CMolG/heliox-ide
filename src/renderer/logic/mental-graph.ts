/**
 * mental-graph.ts — Pure utility helpers for the mental graph
 *
 * Responsibility:
 * - Exports stateless, side-effect-free helpers used by both the desktop store
 *   and MentalGraphCanvas.
 *
 * Boundaries:
 * - No React, no Zustand — pure TypeScript logic only.
 */

// ─── Connected-component BFS ──────────────────────────────────────
// Given a set of seed node ids and the full edge list (undirected),
// returns the set of all node ids reachable from any seed node.
// Exported so it can be unit-tested in isolation.

export function getConnectedComponent(
  seedIds: string[],
  edges: Array<{ sourceId: string; targetId: string }>,
): Set<string> {
  // Build adjacency map (undirected)
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.sourceId)) adj.set(e.sourceId, []);
    if (!adj.has(e.targetId)) adj.set(e.targetId, []);
    adj.get(e.sourceId)!.push(e.targetId);
    adj.get(e.targetId)!.push(e.sourceId);
  }

  const visited = new Set<string>();
  const queue = [...seedIds];
  for (const seed of seedIds) visited.add(seed);

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const neighbor of (adj.get(current) ?? [])) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  return visited;
}
