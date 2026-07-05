/**
 * MentalGraphCanvas.loopEdge.test.tsx — onConnect's forward-vs-loop edge decision
 *
 * Strategy:
 * - `MentalGraphCanvas`'s `<ReactFlow>` is mocked (see `MentalGraphCanvas.forkIndicator.test.tsx`)
 *   down to a plain children-passthrough div across this file's test suite, which
 *   drops the `onConnect` prop entirely — there is no way to trigger a real
 *   connection-drag and observe `onConnect`'s effect via `render()` here.
 * - `onConnect`'s forward-vs-loop decision is therefore extracted into the pure,
 *   exported `resolveConnectionEdgeType` helper and tested directly against
 *   realistic node/edge fixtures — no React Flow or store mocking needed at all,
 *   since it takes nodes/edges as plain arguments and delegates to the already
 *   -covered `wouldCreateStepCycle`.
 *
 * Scenarios:
 *   1. Connecting a later step back to an earlier upstream step (closes a cycle)
 *      resolves to 'loop'.
 *   2. Connecting to a fresh, unconnected step resolves to 'link'.
 *   3. A self-connection (source === target) resolves to 'loop' (mirrors
 *      `wouldCreateStepCycle`'s explicit self-loop case).
 *   4. A connection where either endpoint is NOT a Step node (e.g. a mental
 *      note) always resolves to 'link', even if the ids would otherwise cycle.
 */
import { describe, expect, it } from 'vitest';
import { resolveConnectionEdgeType } from './MentalGraphCanvas';
import type { CanvasGraphNode, MentalGraphEdge, StepGraphNode, MentalGraphNode } from '@/types/desktop';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeStep(id: string): StepGraphNode {
  return {
    id,
    type: 'step',
    position: { x: 0, y: 0 },
    width: 200,
    height: 100,
    text: id,
    color: '#ffffff',
    shape: 'square',
    data: { title: id, mods: [], roles: [] },
    createdAt: 0,
  };
}

function makeMentalNote(id: string): MentalGraphNode {
  return {
    id,
    type: 'mental',
    position: { x: 0, y: 0 },
    width: 100,
    height: 60,
    text: 'note',
    color: '#ffffff',
    shape: 'square',
    createdAt: 0,
  };
}

function makeEdge(id: string, sourceId: string, targetId: string): MentalGraphEdge {
  return { id, sourceId, targetId, type: 'link', color: '#4DA8FF', createdAt: 0 };
}

// A -> B -> C chain (all Step nodes), plus one disconnected Step D and one
// mental note N — the fixture reused across the scenarios below.
const stepA = makeStep('step-a');
const stepB = makeStep('step-b');
const stepC = makeStep('step-c');
const stepD = makeStep('step-d');
const note = makeMentalNote('note-1');
const nodes: CanvasGraphNode[] = [stepA, stepB, stepC, stepD, note];
const edges: MentalGraphEdge[] = [makeEdge('e-ab', 'step-a', 'step-b'), makeEdge('e-bc', 'step-b', 'step-c')];

describe('resolveConnectionEdgeType', () => {
  it('resolves to "loop" when connecting a later step back to an upstream step (would close a cycle)', () => {
    // C -> A would close the A -> B -> C -> A cycle.
    expect(resolveConnectionEdgeType('step-c', 'step-a', nodes, edges)).toBe('loop');
  });

  it('resolves to "link" when connecting to a fresh, unconnected step', () => {
    expect(resolveConnectionEdgeType('step-c', 'step-d', nodes, edges)).toBe('link');
  });

  it('resolves to "loop" for a self-connection', () => {
    expect(resolveConnectionEdgeType('step-b', 'step-b', nodes, edges)).toBe('loop');
  });

  it('resolves to "link" when either endpoint is not a Step node, even if the ids would otherwise cycle', () => {
    expect(resolveConnectionEdgeType('step-c', 'note-1', nodes, edges)).toBe('link');
    expect(resolveConnectionEdgeType('note-1', 'step-a', nodes, edges)).toBe('link');
  });

  it('resolves to "link" for an ordinary forward connection that extends the chain', () => {
    expect(resolveConnectionEdgeType('step-c', 'step-d', nodes, edges)).toBe('link');
    expect(resolveConnectionEdgeType('step-a', 'step-b', nodes, [])).toBe('link');
  });
});
