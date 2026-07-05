import { describe, it, expect } from 'vitest';
import {
  HUD_GRID, snapToHudGrid, clampToViewport, snapSizeToHudGrid, MIN_WIDGET_WIDTH, MIN_WIDGET_HEIGHT,
  SAFE_ZONE, rectsOverlap, resolveHudWidgetPlacement,
} from './hud-grid';

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

describe('snapSizeToHudGrid', () => {
  it('leaves exact grid multiples unchanged', () => {
    expect(snapSizeToHudGrid({ width: 360, height: 288 })).toEqual({ width: 360, height: 288 });
  });

  it('rounds (350, 300) to the nearest grid multiple', () => {
    // 350/24=14.583 -> round 15 -> 360; 300/24=12.5 -> round 13 -> 312
    expect(snapSizeToHudGrid({ width: 350, height: 300 })).toEqual({ width: 360, height: 312 });
  });

  it('rounds a size just above the old (non-grid) 220x140 minimum down onto the new grid-aligned minimum', () => {
    // 221/24=9.208 -> round 9 -> 216 (== MIN_WIDGET_WIDTH); 141/24=5.875 -> round 6 -> 144 (== MIN_WIDGET_HEIGHT).
    // The post-round clamp is a no-op here because the rounded value already IS the min — this is the
    // case that used to disagree with resizeHudWidget's separate (off-grid) 220 clamp and jump on release.
    expect(snapSizeToHudGrid({ width: 221, height: 141 })).toEqual({ width: 216, height: 144 });
  });

  it('clamps a size below the minimum up to MIN_WIDGET_WIDTH/MIN_WIDGET_HEIGHT', () => {
    // 50/24=2.083 -> round 2 -> 48, well below the min; 30/24=1.25 -> round 1 -> 24, also below the min.
    expect(snapSizeToHudGrid({ width: 50, height: 30 })).toEqual({ width: MIN_WIDGET_WIDTH, height: MIN_WIDGET_HEIGHT });
  });

  it('never returns a size below the minimum, even for zero or negative input', () => {
    expect(snapSizeToHudGrid({ width: 0, height: 0 })).toEqual({ width: MIN_WIDGET_WIDTH, height: MIN_WIDGET_HEIGHT });
    expect(snapSizeToHudGrid({ width: -100, height: -100 })).toEqual({ width: MIN_WIDGET_WIDTH, height: MIN_WIDGET_HEIGHT });
  });

  it('delegates to the same HUD_GRID constant as snapToHudGrid once above the minimum', () => {
    const size = { width: 500, height: 500 };
    const viaSize = snapSizeToHudGrid(size);
    const viaPos = snapToHudGrid({ x: size.width, y: size.height });
    expect(viaSize).toEqual({ width: viaPos.x, height: viaPos.y });
  });
});

describe('MIN_WIDGET_WIDTH / MIN_WIDGET_HEIGHT', () => {
  it('are exact HUD_GRID multiples so rounding and clamping can never disagree', () => {
    expect(MIN_WIDGET_WIDTH % HUD_GRID).toBe(0);
    expect(MIN_WIDGET_HEIGHT % HUD_GRID).toBe(0);
  });
});

// ─── Phase 4: widget safe zone + collision-free placement ────────────────

describe('SAFE_ZONE', () => {
  it('is a 72x120 rect (3 wide x 5 tall HUD_GRID cells) anchored to the top-right corner', () => {
    // 72 wide fits the 36px expand button + its 20px right margin; 120 tall
    // clears the button's bottom edge (65+36=101px) that a naive 72px square
    // would leave exposed under the ~53px TopBar.
    expect(SAFE_ZONE({ width: 1200, height: 800 })).toEqual({ x: 1128, y: 0, width: 72, height: 120 });
  });

  it('tracks viewport width so it always hugs the right edge', () => {
    expect(SAFE_ZONE({ width: 1600, height: 900 })).toEqual({ x: 1528, y: 0, width: 72, height: 120 });
  });
});

describe('rectsOverlap', () => {
  it('returns true when two rects genuinely intersect', () => {
    expect(rectsOverlap(
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 50, y: 50, width: 100, height: 100 },
    )).toBe(true);
  });

  it('returns true when one rect fully contains another', () => {
    expect(rectsOverlap(
      { x: 0, y: 0, width: 200, height: 200 },
      { x: 50, y: 50, width: 10, height: 10 },
    )).toBe(true);
  });

  it('returns false for disjoint rects', () => {
    expect(rectsOverlap(
      { x: 0, y: 0, width: 50, height: 50 },
      { x: 500, y: 500, width: 50, height: 50 },
    )).toBe(false);
  });

  it('treats edge-touching rects as NOT overlapping (flush is OK)', () => {
    // a's right edge (x=100) exactly meets b's left edge (x=100)
    expect(rectsOverlap(
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 100, y: 0, width: 100, height: 100 },
    )).toBe(false);
    // Same, but touching along the y axis
    expect(rectsOverlap(
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 0, y: 100, width: 100, height: 100 },
    )).toBe(false);
  });
});

describe('resolveHudWidgetPlacement', () => {
  const viewport = { width: 1200, height: 800 };

  it('returns the snapped+clamped desired position when free', () => {
    const result = resolveHudWidgetPlacement({
      desired: { x: 96, y: 120 },
      size: { width: 320, height: 220 },
      viewport,
      others: [],
    });
    expect(result).toEqual({ x: 96, y: 120 });
  });

  it('nudges a position that intersects the SAFE_ZONE to the nearest free cell outside it', () => {
    // (1140, 24) sits inside SAFE_ZONE({1200,800}) = {x:1128, y:0, w:72, h:120}
    const result = resolveHudWidgetPlacement({
      desired: { x: 1140, y: 24 },
      size: { width: 48, height: 48 },
      viewport,
      others: [],
    });
    // Deterministic outward spiral settles flush against the safe zone's left
    // edge at the top (widget right edge 1080+48=1128 === zone left 1128, which
    // is edge-touching, not overlap) — the nearest free cell once the taller
    // 120px zone rules out dropping straight down. Hand-verified ring-by-ring.
    expect(result).toEqual({ x: 1080, y: 0 });
    expect(rectsOverlap({ ...result, width: 48, height: 48 }, SAFE_ZONE(viewport))).toBe(false);
  });

  it('nudges a position overlapping another widget to the nearest free grid cell', () => {
    const others = [{ x: 96, y: 96, width: 48, height: 48 }];
    const result = resolveHudWidgetPlacement({
      desired: { x: 96, y: 96 },
      size: { width: 48, height: 48 },
      viewport,
      others,
    });
    // First free ring-2 cell above-left of the identical-rect obstacle
    // (hand-verified ring-by-ring — ring 1 is fully blocked by an
    // identically-sized/positioned neighbour).
    expect(result).toEqual({ x: 48, y: 48 });
    expect(rectsOverlap({ ...result, width: 48, height: 48 }, others[0])).toBe(false);
  });

  it('relocates a widget whose stored/default position now falls in the SAFE_ZONE (first-open path)', () => {
    // Simulates a persisted or default widget position that predates the
    // safe zone (or that a viewport shrink pushed under it) landing inside
    // it on the next resolve — the same function serves the "first render
    // after this feature ships" case, no special-casing needed.
    const storedPosition = { x: 1152, y: 12 };
    const result = resolveHudWidgetPlacement({
      desired: storedPosition,
      size: { width: 300, height: 280 },
      viewport,
      others: [],
    });
    expect(rectsOverlap({ ...result, width: 300, height: 280 }, SAFE_ZONE(viewport))).toBe(false);
    expect(result).not.toEqual(storedPosition);
  });

  it('falls back to the clamped desired position when the viewport is pathologically fully occupied (never throws, never loops forever)', () => {
    const others = [{ x: 0, y: 0, width: 1200, height: 800 }]; // covers the entire viewport
    const run = () => resolveHudWidgetPlacement({
      desired: { x: 504, y: 408 },
      size: { width: 48, height: 48 },
      viewport,
      others,
    });
    expect(run).not.toThrow();
    expect(run()).toEqual({ x: 504, y: 408 });
  });

  it('never returns a position outside the viewport, even under collision search', () => {
    const others = [{ x: 900, y: 0, width: 300, height: 800 }];
    const size = { width: 320, height: 220 };
    const result = resolveHudWidgetPlacement({
      desired: { x: 950, y: 24 },
      size,
      viewport,
      others,
    });
    expect(result.x).toBeGreaterThanOrEqual(0);
    expect(result.y).toBeGreaterThanOrEqual(0);
    expect(result.x + size.width).toBeLessThanOrEqual(viewport.width);
    expect(result.y + size.height).toBeLessThanOrEqual(viewport.height);
  });

  it('is deterministic: identical inputs always resolve to the identical position', () => {
    const args = {
      desired: { x: 1140, y: 24 },
      size: { width: 48, height: 48 },
      viewport,
      others: [{ x: 1080, y: 60, width: 48, height: 48 }],
    };
    const first = resolveHudWidgetPlacement(args);
    const second = resolveHudWidgetPlacement(args);
    expect(second).toEqual(first);
  });
});
