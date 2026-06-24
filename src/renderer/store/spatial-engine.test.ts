import { describe, expect, it } from 'vitest';
import type { CanvasGraphNode, FrameGraphNode, StepGraphNode } from '@/types/desktop';
import { calculateSafeInsertionPoint } from './spatial-engine';

function step(id: string, x: number, y: number, width = 300, height = 190, parentId?: string): StepGraphNode {
  return {
    id,
    type: 'step',
    ...(parentId ? { parentId } : {}),
    position: { x, y },
    width,
    height,
    text: id,
    color: '#111',
    shape: 'square',
    data: { title: id, mods: [], roles: [] },
    createdAt: 1,
  };
}

function frame(id: string, x: number, y: number, width = 900, height = 420): FrameGraphNode {
  return {
    id,
    type: 'frame',
    position: { x, y },
    width,
    height,
    text: id,
    color: 'rgba(255,255,255,0.04)',
    shape: 'square',
    data: { title: id, childIds: [] },
    createdAt: 1,
  };
}

describe('calculateSafeInsertionPoint', () => {
  it('places the first frame with generous canvas breathing room', () => {
    expect(calculateSafeInsertionPoint([], 900, 420)).toEqual({ x: 400, y: 120 });
  });

  it('places new frames to the right of the widest occupied bounds', () => {
    const nodes: CanvasGraphNode[] = [
      step('a', 100, 50, 300, 190),
      step('b', 620, 220, 340, 190),
    ];

    expect(calculateSafeInsertionPoint(nodes, 900, 420)).toEqual({ x: 1360, y: 120 });
  });

  it('accounts for parent-relative children when computing occupied bounds', () => {
    const nodes: CanvasGraphNode[] = [
      frame('frame-a', 100, 80, 900, 420),
      step('child-a', 760, 150, 320, 190, 'frame-a'),
    ];

    expect(calculateSafeInsertionPoint(nodes, 900, 420).x).toBe(1580);
  });
});
