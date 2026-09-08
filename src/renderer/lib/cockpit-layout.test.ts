/**
 * cockpit-layout.test.ts — The preset's arithmetic
 *
 * Three claims, and none of them is safe to eyeball:
 *   1. **No two windows overlap.** A grid that looks right at 1440×900 and
 *      puts a terminal under the board at 1280×720 is a preset nobody uses
 *      twice, and the failure is invisible until it happens on that machine.
 *   2. **A crowded grid grows DOWNWARD.** Cells never shrink below a readable
 *      terminal; when they cannot fit across, the column count drops and the
 *      arrangement gets taller — which the camera can zoom out to — rather
 *      than wider, which would put sessions behind the board.
 *   3. **The left column is the board's**, at 38 % but never under 420px.
 */
import { describe, expect, it } from 'vitest';
import {
  BACKLOG_MIN_HEIGHT,
  BACKLOG_MIN_WIDTH,
  GUTTER,
  SESSION_LIST_HEIGHT,
  SESSION_MIN_HEIGHT,
  SESSION_MIN_WIDTH,
  cockpitBounds,
  cockpitLayout,
  type Rect,
} from './cockpit-layout';

const WIDE = { width: 1600, height: 900 };

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width
    && a.y < b.y + b.height && b.y < a.y + a.height;
}

function allRects(layout: ReturnType<typeof cockpitLayout>): Rect[] {
  return [layout.backlog, ...(layout.sessionList ? [layout.sessionList] : []), ...layout.sessions];
}

function anyOverlap(rects: Rect[]): boolean {
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      if (overlaps(rects[i], rects[j])) return true;
    }
  }
  return false;
}

describe('cockpitLayout — the board column', () => {
  it('takes 38 % of a wide viewport', () => {
    expect(cockpitLayout(WIDE, 3).backlog.width).toBe(Math.floor(1600 * 0.38));
  });

  it('never goes below its minimum, however narrow the window', () => {
    expect(cockpitLayout({ width: 800, height: 600 }, 2).backlog.width).toBe(BACKLOG_MIN_WIDTH);
    expect(cockpitLayout({ width: 320, height: 400 }, 1).backlog.width).toBe(BACKLOG_MIN_WIDTH);
  });

  it('is the leftmost thing on the desktop', () => {
    const layout = cockpitLayout(WIDE, 5);
    expect(layout.backlog.x).toBe(0);
    for (const session of layout.sessions) expect(session.x).toBeGreaterThan(layout.backlog.x);
  });

  it('starts at the top when there is no session list', () => {
    const layout = cockpitLayout(WIDE, 2);
    expect(layout.sessionList).toBeNull();
    expect(layout.backlog.y).toBe(0);
    expect(layout.backlog.height).toBe(900);
  });

  it('makes room for the session list above it when there is one', () => {
    const layout = cockpitLayout(WIDE, 2, { hasSessionList: true });
    expect(layout.sessionList).toEqual({ x: 0, y: 0, width: layout.backlog.width, height: SESSION_LIST_HEIGHT });
    expect(layout.backlog.y).toBe(SESSION_LIST_HEIGHT + GUTTER);
    expect(layout.backlog.height).toBe(900 - SESSION_LIST_HEIGHT - GUTTER);
  });

  it('keeps a readable board rather than squeezing it into a short window', () => {
    const layout = cockpitLayout({ width: 1600, height: 360 }, 2, { hasSessionList: true });
    expect(layout.backlog.height).toBe(BACKLOG_MIN_HEIGHT);
  });
});

describe('cockpitLayout — the session grid', () => {
  it('places nothing when there are no sessions', () => {
    expect(cockpitLayout(WIDE, 0).sessions).toEqual([]);
  });

  it('uses a square-ish grid: ceil(sqrt(n)) columns', () => {
    // 4 sessions on a wide viewport → 2 columns, 2 rows.
    const four = cockpitLayout(WIDE, 4).sessions;
    expect(new Set(four.map((r) => r.x)).size).toBe(2);
    expect(new Set(four.map((r) => r.y)).size).toBe(2);

    // 3 sessions → 2 columns, 2 rows, the last row half full.
    const three = cockpitLayout(WIDE, 3).sessions;
    expect(new Set(three.map((r) => r.x)).size).toBe(2);
    expect(new Set(three.map((r) => r.y)).size).toBe(2);

    // 1 session fills the whole region.
    expect(cockpitLayout(WIDE, 1).sessions).toHaveLength(1);
  });

  it('separates every cell by exactly one gutter', () => {
    const [a, b] = cockpitLayout(WIDE, 4).sessions;
    expect(b.x - (a.x + a.width)).toBe(GUTTER);
    const [, , c] = cockpitLayout(WIDE, 4).sessions;
    expect(c.y - (a.y + a.height)).toBe(GUTTER);
  });

  it('never renders a terminal below the readable minimum', () => {
    for (const n of [1, 2, 3, 4, 6, 9, 12, 16, 25]) {
      for (const viewport of [WIDE, { width: 1280, height: 720 }, { width: 900, height: 600 }]) {
        for (const rect of cockpitLayout(viewport, n).sessions) {
          expect(rect.width).toBeGreaterThanOrEqual(SESSION_MIN_WIDTH);
          expect(rect.height).toBeGreaterThanOrEqual(SESSION_MIN_HEIGHT);
        }
      }
    }
  });

  it('GROWS DOWNWARD when the grid cannot fit across', () => {
    // 900px wide: the board takes 420, leaving ~468 — one minimum cell across.
    // ceil(sqrt(4)) would be 2 columns; the cap forces 1, so 4 rows.
    const tight = cockpitLayout({ width: 900, height: 600 }, 4);
    expect(new Set(tight.sessions.map((r) => r.x)).size).toBe(1);
    expect(new Set(tight.sessions.map((r) => r.y)).size).toBe(4);
    expect(cockpitBounds(tight).height).toBeGreaterThan(600);
  });

  it('never grows RIGHTWARD past what the region can hold', () => {
    const tight = cockpitLayout({ width: 900, height: 600 }, 9);
    const region = { x: tight.backlog.width + GUTTER, width: 900 - tight.backlog.width - GUTTER };
    for (const rect of tight.sessions) {
      expect(rect.x).toBe(region.x);
      expect(rect.width).toBeLessThanOrEqual(Math.max(SESSION_MIN_WIDTH, region.width));
    }
  });
});

describe('cockpitLayout — nothing overlaps', () => {
  it('holds across viewports, session counts, and with or without the list', () => {
    const viewports = [
      { width: 1920, height: 1080 }, { width: 1600, height: 900 },
      { width: 1280, height: 720 }, { width: 1024, height: 768 },
      { width: 900, height: 600 }, { width: 640, height: 480 },
    ];
    for (const viewport of viewports) {
      for (let n = 0; n <= 12; n += 1) {
        for (const hasSessionList of [false, true]) {
          const layout = cockpitLayout(viewport, n, { hasSessionList });
          expect({ viewport, n, hasSessionList, overlap: anyOverlap(allRects(layout)) })
            .toEqual({ viewport, n, hasSessionList, overlap: false });
        }
      }
    }
  });
});

describe('cockpitBounds', () => {
  it('covers everything the layout placed', () => {
    const layout = cockpitLayout(WIDE, 5, { hasSessionList: true });
    const bounds = cockpitBounds(layout);
    for (const rect of allRects(layout)) {
      expect(rect.x).toBeGreaterThanOrEqual(bounds.x);
      expect(rect.y).toBeGreaterThanOrEqual(bounds.y);
      expect(rect.x + rect.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      expect(rect.y + rect.height).toBeLessThanOrEqual(bounds.y + bounds.height);
    }
  });

  it('is the board alone when there are no sessions', () => {
    const layout = cockpitLayout(WIDE, 0);
    expect(cockpitBounds(layout)).toEqual(layout.backlog);
  });
});
