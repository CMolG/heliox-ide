/**
 * MentalGraphCanvas.snapToGrid.test.tsx — Task 13 (adoption plan #20), Fase 1:
 * `resolveMentalNodeDragPosition`'s golden-value quantization + the
 * mid-drag-vs-drag-stop passthrough.
 *
 * Strategy: same idiom as `MentalGraphCanvas.loopEdge.test.tsx` — `<ReactFlow>`
 * is mocked down to a plain children-passthrough div across this file's test
 * suite (dropping `onNodesChange` entirely), so the decision this task adds
 * is extracted into the pure, exported `resolveMentalNodeDragPosition`
 * helper and tested directly. No React Flow / store rendering needed.
 */
import { describe, expect, it } from 'vitest';
import { resolveMentalNodeDragPosition } from './MentalGraphCanvas';
import { fluxorWindowGridSpec } from '../../../store/engine-bridge';

const GRID_24 = { enabled: true, spec: fluxorWindowGridSpec(24) };
const GRID_OFF = { enabled: false, spec: fluxorWindowGridSpec(24) };

describe('resolveMentalNodeDragPosition — Task 13 snap-to-grid drag commit', () => {
  it('mid-drag frames (dragging: true) always pass through unchanged, even with the toggle ON', () => {
    // Quantizing every intermediate frame would fight the live drag / feel
    // jittery — this is what stops that, independent of the toggle.
    expect(resolveMentalNodeDragPosition({ x: 41, y: 58 }, true, GRID_24)).toEqual({ x: 41, y: 58 });
  });

  it('a position change with no `dragging` field (not a user drag, e.g. programmatic) passes through unchanged', () => {
    expect(resolveMentalNodeDragPosition({ x: 41, y: 58 }, undefined, GRID_24)).toEqual({ x: 41, y: 58 });
  });

  it('drag-stop (dragging: false), toggle OFF: passes through unchanged (byte-identical to pre-Task-13 behavior)', () => {
    expect(resolveMentalNodeDragPosition({ x: 41, y: 58 }, false, GRID_OFF)).toEqual({ x: 41, y: 58 });
  });

  it('drag-stop (dragging: false), toggle ON: quantizes to the nearest grid cell (golden values, 24px cell)', () => {
    // round(150/24)=6 -> 144; round(113/24)=5 -> 120 (same math as
    // DesktopWindow.snapToGrid.test.tsx's window case — same grid).
    expect(resolveMentalNodeDragPosition({ x: 150, y: 113 }, false, GRID_24)).toEqual({ x: 144, y: 120 });
  });

  it('drag-stop, toggle ON: exact multiples of the cell size are left untouched (idempotent)', () => {
    expect(resolveMentalNodeDragPosition({ x: 96, y: 240 }, false, GRID_24)).toEqual({ x: 96, y: 240 });
  });

  it('mental nodes have no alignment-guide system to defer to — grid quantization is the only thing this ever does at drag-stop', () => {
    // Distinguishes this from DesktopWindow's guide-precedence rule: there is
    // no separate "guideMatched" input at all — dragging:false + toggle ON
    // always quantizes, unconditionally.
    expect(resolveMentalNodeDragPosition({ x: 10, y: 10 }, false, GRID_24)).toEqual({ x: 0, y: 0 });
  });
});
