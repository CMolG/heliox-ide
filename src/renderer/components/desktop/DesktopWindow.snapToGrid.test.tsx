/**
 * DesktopWindow.snapToGrid.test.tsx — Task 13 (adoption plan #20), Fase 1:
 * `resolveWindowDropPosition`'s golden-value quantization + precedence.
 *
 * Strategy: `DesktopWindow.tsx`'s real drag is pointer+rAF with window-level
 * event listeners and direct DOM mutation (see its own doc-comment) —
 * simulating a real pointer drag in jsdom to exercise the onMouseUp commit
 * would be brittle and indirect. The decision itself (guide-vs-grid
 * precedence, quantization math) is already extracted into the pure,
 * exported `resolveWindowDropPosition` helper — same "extract the decision,
 * test it directly" idiom as `MentalGraphCanvas.tsx`'s
 * `resolveConnectionEdgeType` (see its own loopEdge test file). No React
 * Flow / store / DOM needed at all.
 */
import { describe, expect, it } from 'vitest';
import { resolveWindowDropPosition } from './DesktopWindow';
import { fluxorWindowGridSpec } from '../../store/engine-bridge';

const GRID_24 = { enabled: true, spec: fluxorWindowGridSpec(24) };
const GRID_OFF = { enabled: false, spec: fluxorWindowGridSpec(24) };

describe('resolveWindowDropPosition — Task 13 snap-to-grid drag commit', () => {
  it('toggle OFF: returns the guide-resolved position byte-identical, regardless of grid math', () => {
    // Same raw position as the "toggle ON, no guide" case below — proves the
    // ONLY variable that changes the outcome is the toggle, not some hidden
    // rounding creeping in when disabled.
    expect(resolveWindowDropPosition({ x: 150, y: 113 }, false, GRID_OFF)).toEqual({ x: 150, y: 113 });
  });

  it('toggle ON, no guide matched: quantizes to the nearest grid cell (golden values, 24px cell)', () => {
    // round(150/24)=6 -> 144; round(113/24)=5 -> 120.
    expect(resolveWindowDropPosition({ x: 150, y: 113 }, false, GRID_24)).toEqual({ x: 144, y: 120 });
  });

  it('toggle ON, no guide matched: a second golden case at a different cell size (16px)', () => {
    // round(41/16)=3 (48-41=7 < 41-32=9, so 3 wins) -> 48; round(58/16)=4 (64-58=6 < 58-48=10) -> 64.
    expect(resolveWindowDropPosition({ x: 41, y: 58 }, false, { enabled: true, spec: fluxorWindowGridSpec(16) }))
      .toEqual({ x: 48, y: 64 });
  });

  it('exact multiples of the cell size are left untouched (idempotent)', () => {
    expect(resolveWindowDropPosition({ x: 96, y: 240 }, false, GRID_24)).toEqual({ x: 96, y: 240 });
  });

  it('precedence: a matched guide wins outright, even with the toggle ON — grid quantization is skipped on BOTH axes', () => {
    // 152/24 would round to 144 (a different value than 152) if grid math
    // ran — asserting the guide's raw 152 survives proves grid quantization
    // never got a chance to touch it.
    expect(resolveWindowDropPosition({ x: 152, y: 113 }, true, GRID_24)).toEqual({ x: 152, y: 113 });
  });

  it('precedence: toggle OFF + no guide matched is a pure passthrough (byte-identical to pre-Task-13 behavior)', () => {
    expect(resolveWindowDropPosition({ x: 41, y: 58 }, false, GRID_OFF)).toEqual({ x: 41, y: 58 });
  });

  it('negative coordinates clamp to the grid origin (core/grid.ts:pixelsToColRow clamps col/row at 0, they can never go negative)', () => {
    expect(resolveWindowDropPosition({ x: -10, y: -20 }, false, GRID_24)).toEqual({ x: 0, y: 0 });
  });
});
