import { describe, it, expect } from 'vitest';
import { HUD_GRID, snapToHudGrid, clampToViewport } from './hud-grid';

describe('HUD_GRID constant', () => {
  it('is 24', () => {
    expect(HUD_GRID).toBe(24);
  });
});

describe('snapToHudGrid', () => {
  it('snaps (13, 37) to (24, 48)', () => {
    expect(snapToHudGrid({ x: 13, y: 37 })).toEqual({ x: 24, y: 48 });
  });

  it('snaps (0, 0) to (0, 0)', () => {
    expect(snapToHudGrid({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it('snaps exact multiples unchanged', () => {
    expect(snapToHudGrid({ x: 96, y: 120 })).toEqual({ x: 96, y: 120 });
  });

  it('snaps (11, 11) — midpoint rounds up to (24, 24)', () => {
    // Math.round(11/24)=0 → x=0; Math.round(11/24)=0 → both 0
    expect(snapToHudGrid({ x: 11, y: 11 })).toEqual({ x: 0, y: 0 });
  });

  it('snaps (12, 12) — >=0.5 rounds to 24', () => {
    expect(snapToHudGrid({ x: 12, y: 12 })).toEqual({ x: 24, y: 24 });
  });

  it('snaps negative values close to zero back to zero', () => {
    // Math.round(-3/24) = Math.round(-0.125) = 0; implementation adds +0 to normalise -0
    expect(snapToHudGrid({ x: -3, y: -3 })).toEqual({ x: 0, y: 0 });
  });

  it('snaps large values correctly', () => {
    // x=900: 900/24=37.5 → round=38 → 38*24=912
    expect(snapToHudGrid({ x: 900, y: 80 })).toEqual({ x: 912, y: 72 });
  });
});

describe('clampToViewport', () => {
  const vp = { width: 1200, height: 800 };
  const size = { width: 320, height: 220 };

  it('keeps a centered position unchanged', () => {
    const pos = { x: 400, y: 300 };
    expect(clampToViewport(pos, size, vp)).toEqual({ x: 400, y: 300 });
  });

  it('clamps left overshoot to 0', () => {
    expect(clampToViewport({ x: -50, y: 100 }, size, vp)).toMatchObject({ x: 0 });
  });

  it('clamps top overshoot to 0', () => {
    expect(clampToViewport({ x: 100, y: -10 }, size, vp)).toMatchObject({ y: 0 });
  });

  it('clamps right overshoot to viewport.width - size.width', () => {
    const result = clampToViewport({ x: 2000, y: 100 }, size, vp);
    expect(result.x).toBe(vp.width - size.width);
  });

  it('clamps bottom overshoot to viewport.height - size.height', () => {
    const result = clampToViewport({ x: 100, y: 9000 }, size, vp);
    expect(result.y).toBe(vp.height - size.height);
  });

  it('clamped result is within viewport bounds', () => {
    const result = clampToViewport({ x: -999, y: -999 }, size, vp);
    expect(result.x).toBeGreaterThanOrEqual(0);
    expect(result.y).toBeGreaterThanOrEqual(0);
    expect(result.x + size.width).toBeLessThanOrEqual(vp.width);
    expect(result.y + size.height).toBeLessThanOrEqual(vp.height);
  });
});
