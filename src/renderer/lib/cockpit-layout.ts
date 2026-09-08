/**
 * cockpit-layout.ts — Where the Cockpit's windows go (F4)
 *
 * Responsibility:
 * - One pure function from a viewport and a session count to the rectangle of
 *   every window the preset places: the backlog, the session list, and the
 *   session grid.
 *
 * Boundaries:
 * - Owns: the geometry, the minimum sizes, and what happens when the grid does
 *   not fit.
 * - Does NOT own: which windows exist (desktop-store's `arrangeCockpit`), how
 *   they are drawn, or the camera.
 *
 * Architectural role:
 * - Pure renderer module. The reason it is not four lines inline in the store
 *   —which is where the canvas's own `arrange` action lives— is that "no two
 *   windows overlap" and "the grid grows downward rather than off-screen" are
 *   claims about arithmetic, and arithmetic is cheap to test and expensive to
 *   eyeball.
 *
 * The shape, in one sentence: the board on the left, the sessions tiled on the
 * right, and the session list above the board when there is one — the pile is
 * what you read, the sessions are what you watch, and they do not compete for
 * the same half of the screen.
 */

export interface Rect { x: number; y: number; width: number; height: number }

export interface CockpitLayout {
  backlog: Rect;
  /** Non-null only when the caller said a session-list window exists. */
  sessionList: Rect | null;
  /** One per agent session, in the order they were handed in. */
  sessions: Rect[];
}

export interface Viewport { width: number; height: number }

/** Breathing room between every pair of windows, on both axes. */
export const GUTTER = 12;

/** The left column: 38 % of the viewport, but never narrower than this. */
export const BACKLOG_MIN_WIDTH = 420;
export const BACKLOG_WIDTH_RATIO = 0.38;
/** Below this a card pile is a list of truncated titles, not a board. */
export const BACKLOG_MIN_HEIGHT = 320;

/** The session list is a strip, not a panel: rows, and nothing else. */
export const SESSION_LIST_HEIGHT = 160;

/** A terminal below this is unreadable — a TUI wraps into ribbons. */
export const SESSION_MIN_WIDTH = 360;
export const SESSION_MIN_HEIGHT = 240;

/**
 * The rectangle of every Cockpit window, in canvas coordinates with the
 * arrangement's own origin at (0, 0).
 *
 * The caller pans to it afterwards; placing it at the origin keeps this
 * function independent of where the camera happens to be, which is what makes
 * the overlap test meaningful.
 */
export function cockpitLayout(
  viewport: Viewport,
  sessionCount: number,
  opts: { hasSessionList?: boolean } = {},
): CockpitLayout {
  const viewW = Math.max(1, Math.floor(viewport.width));
  const viewH = Math.max(1, Math.floor(viewport.height));
  const hasList = opts.hasSessionList === true;

  const leftW = Math.max(BACKLOG_MIN_WIDTH, Math.floor(viewW * BACKLOG_WIDTH_RATIO));

  const sessionList = hasList
    ? { x: 0, y: 0, width: leftW, height: SESSION_LIST_HEIGHT }
    : null;
  const backlogY = hasList ? SESSION_LIST_HEIGHT + GUTTER : 0;
  const backlog: Rect = {
    x: 0,
    y: backlogY,
    width: leftW,
    // The list never eats into the board below its minimum: on a short window
    // the column simply extends past the viewport, and the camera zooms out.
    height: Math.max(BACKLOG_MIN_HEIGHT, viewH - backlogY),
  };

  if (sessionCount <= 0) return { backlog, sessionList, sessions: [] };

  const regionX = leftW + GUTTER;
  const regionW = Math.max(SESSION_MIN_WIDTH, viewW - regionX);
  const regionH = viewH;

  // How many minimum-width cells fit across. Capping the column count HERE is
  // what makes an over-full grid grow DOWNWARD instead of off the right edge:
  // fewer columns means more rows, and a taller arrangement is one the camera
  // can zoom out to, while a wider one fights the board for the same space.
  const maxCols = Math.max(1, Math.floor((regionW + GUTTER) / (SESSION_MIN_WIDTH + GUTTER)));
  const cols = Math.max(1, Math.min(Math.ceil(Math.sqrt(sessionCount)), maxCols));
  const rows = Math.ceil(sessionCount / cols);

  const cellW = Math.max(SESSION_MIN_WIDTH, Math.floor((regionW - (cols - 1) * GUTTER) / cols));
  const cellH = Math.max(SESSION_MIN_HEIGHT, Math.floor((regionH - (rows - 1) * GUTTER) / rows));

  const sessions: Rect[] = [];
  for (let i = 0; i < sessionCount; i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    sessions.push({
      x: regionX + col * (cellW + GUTTER),
      y: row * (cellH + GUTTER),
      width: cellW,
      height: cellH,
    });
  }

  return { backlog, sessionList, sessions };
}

/**
 * The bounding box of everything the layout placed — what the camera has to
 * fit for "the whole arrangement is visible" to be true.
 */
export function cockpitBounds(layout: CockpitLayout): Rect {
  const rects = [layout.backlog, ...(layout.sessionList ? [layout.sessionList] : []), ...layout.sessions];
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.width));
  const maxY = Math.max(...rects.map((r) => r.y + r.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
