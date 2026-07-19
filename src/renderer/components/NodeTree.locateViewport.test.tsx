/**
 * NodeTree.locateViewport.test.tsx — Task 13 (adoption plan #20), Fase 2,
 * Q1 golden-value requirement.
 *
 * `NodeTree.tsx`'s `centerViewportOn` used to compute
 * `-(pos.x*zoom) + viewportW/2 - (size.width*zoom)/2` inline; it now
 * delegates to the motor's `centerOn(rect, viewport, zoom, insets)` with
 * `viewport = {width: innerWidth-280, height: innerHeight-60}` and zero
 * insets (task13-decisiones.md Q1: verified algebraically identical to the
 * OLD formula). This file pins that down directly with 3+ golden-value
 * cases computed from the OLD formula independently (not by calling any
 * shared helper), so a future change to either side would have to break
 * this test to silently drift.
 */
import { describe, expect, it } from 'vitest';
import { centerViewportOn } from './NodeTree';

/** The OLD inline formula, reimplemented independently for comparison. */
function oldFormula(
  position: { x: number; y: number },
  size: { width: number; height: number },
  zoom: number,
): { x: number; y: number } {
  const viewportW = window.innerWidth - 280;
  const viewportH = window.innerHeight - 60;
  return {
    x: -(position.x * zoom) + viewportW / 2 - (size.width * zoom) / 2,
    y: -(position.y * zoom) + viewportH / 2 - (size.height * zoom) / 2,
  };
}

describe('centerViewportOn — golden values against the pre-Task-13 inline formula', () => {
  it('case 1: a window-sized rect at zoom 1', () => {
    const position = { x: 100, y: 100 };
    const size = { width: 480, height: 500 };
    expect(centerViewportOn(position, size, 1)).toEqual(oldFormula(position, size, 1));
  });

  it('case 2: a mental-node-sized rect at a fractional zoom', () => {
    const position = { x: -320, y: 540 };
    const size = { width: 220, height: 120 };
    expect(centerViewportOn(position, size, 0.6)).toEqual(oldFormula(position, size, 0.6));
  });

  it('case 3: a grid-sized rect at zoom above 1', () => {
    const position = { x: 0, y: 0 };
    const size = { width: 900, height: 700 };
    expect(centerViewportOn(position, size, 2.5)).toEqual(oldFormula(position, size, 2.5));
  });

  it('case 4: negative position and zero-size edge case', () => {
    const position = { x: -50, y: -75 };
    const size = { width: 0, height: 0 };
    expect(centerViewportOn(position, size, 1.75)).toEqual(oldFormula(position, size, 1.75));
  });
});
