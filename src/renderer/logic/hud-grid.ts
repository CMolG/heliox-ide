/**
 * hud-grid.ts — Renderer UI
 *
 * Architecture note:
 * This file follows the explanatory style used across the codebase:
 * explicit intent, clear boundaries, and behavior-preserving structure.
 */
// src/renderer/logic/hud-grid.ts — HUD widget snap-to-grid helpers

/** Fine cell size (px) for the invisible HUD snap grid */
export const HUD_GRID = 24;

/** Snap a position to the nearest HUD_GRID multiple on both axes */
export function snapToHudGrid(pos: { x: number; y: number }): { x: number; y: number } {
  // Add 0 to coerce -0 → 0 (JavaScript quirk with Math.round of small negatives)
  return {
    x: Math.round(pos.x / HUD_GRID) * HUD_GRID + 0,
    y: Math.round(pos.y / HUD_GRID) * HUD_GRID + 0,
  };
}

/**
 * Minimum HUD widget size (px). MUST be exact HUD_GRID multiples (24 * 9,
 * 24 * 6) — snapSizeToHudGrid rounds to the nearest grid multiple and THEN
 * clamps to these mins, so if a min weren't itself a grid multiple, the
 * rounding step and the clamp step would disagree. That's exactly the bug
 * this constant fixes: the old bare 220x140 min was not grid-aligned, so
 * rounding 220 down to the nearest multiple (216) produced a size the
 * clamp then re-raised back to 220 — an off-grid value that fought the
 * snap it was supposed to floor, visibly jumping the widget on mouse
 * release. Also the single source of truth for the min — desktop-store's
 * resizeHudWidget and HudWidgetLayer's live-drag floor both import these
 * instead of duplicating the literals.
 */
export const MIN_WIDGET_WIDTH = 216; // 24 * 9
export const MIN_WIDGET_HEIGHT = 144; // 24 * 6

/** Snap a widget size to the nearest HUD_GRID multiple on both axes, then clamp
 *  up to the grid-aligned minimum (delegates to snapToHudGrid). Clamping AFTER
 *  rounding — against mins that are themselves grid multiples — guarantees the
 *  result always lands exactly on-grid, never below the minimum. */
export function snapSizeToHudGrid(size: { width: number; height: number }): { width: number; height: number } {
  const snapped = snapToHudGrid({ x: size.width, y: size.height });
  return {
    width: Math.max(MIN_WIDGET_WIDTH, snapped.x),
    height: Math.max(MIN_WIDGET_HEIGHT, snapped.y),
  };
}

/** Clamp a widget so it stays entirely within the visible viewport */
export function clampToViewport(
  pos: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): { x: number; y: number } {
  const x = Math.max(0, Math.min(pos.x, viewport.width - size.width));
  const y = Math.max(0, Math.min(pos.y, viewport.height - size.height));
  return { x, y };
}

// ─── Phase 4: widget safe zone + collision-free placement ────────────────

/** Axis-aligned rectangle in the same absolute px coordinate space as a HUD
 *  widget's `position`/`size` — used both for the reserved safe zone and for
 *  other widgets' occupied areas when resolving a placement. */
export interface HudRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Footprint (px) of the reserved top-right safe zone. Sized to fully contain
 * the collapsed-inspector expand button, which CSS docks at `top: 65px;
 * right: 20px` with a 36×36 footprint (index.css `.expand-inspector-btn`):
 *  - WIDTH 72 (3 cells): the 36px button plus its 20px right margin fit in 72.
 *  - HEIGHT 120 (5 cells): the button's bottom edge is at 65+36=101px. A naive
 *    72px square would leave its lower ~29px unprotected, because the ~53px
 *    TopBar pushes the button below a 72px ceiling; 120 is the smallest
 *    grid-aligned height that clears 101px. (Reconciled across Phase 3's button
 *    placement and Phase 4's safe zone — see the matching note in index.css.)
 */
const SAFE_ZONE_WIDTH = HUD_GRID * 3; // 72
const SAFE_ZONE_HEIGHT = HUD_GRID * 5; // 120

/**
 * The reserved top-right safe zone for a given viewport — reserved for the
 * collapsed-inspector expand button (ExpandInspectorButton.tsx), which docks
 * top-right. Widgets may never occupy this rect. A function rather than a
 * plain constant because the zone is anchored to the viewport's right edge,
 * which changes with window size.
 */
export function SAFE_ZONE(viewport: { width: number; height: number }): HudRect {
  return { x: viewport.width - SAFE_ZONE_WIDTH, y: 0, width: SAFE_ZONE_WIDTH, height: SAFE_ZONE_HEIGHT };
}

/** Strict rectangle-overlap test. Edge-touching (e.g. `a.x + a.width === b.x`)
 *  is NOT an overlap — widgets may sit flush against each other or against
 *  the safe zone boundary. */
export function rectsOverlap(a: HudRect, b: HudRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/**
 * Grid-cell offsets at exactly Chebyshev distance `r` from the origin (i.e.
 * the r-th ring of a square spiral), in a fixed clockwise order: top edge
 * left→right, right edge top→bottom, bottom edge right→left, left edge
 * bottom→top. The fixed order is what makes the outward search in
 * `resolveHudWidgetPlacement` deterministic — identical inputs always visit
 * candidate cells in the same sequence and so always settle on the same
 * "first free" cell (no dependence on object/array iteration order elsewhere).
 */
function ringCellOffsets(r: number): Array<{ dx: number; dy: number }> {
  if (r <= 0) return [{ dx: 0, dy: 0 }];
  const cells: Array<{ dx: number; dy: number }> = [];
  for (let dx = -r; dx <= r; dx++) cells.push({ dx, dy: -r });        // top edge, L→R
  for (let dy = -r + 1; dy <= r; dy++) cells.push({ dx: r, dy });      // right edge, T→B
  for (let dx = r - 1; dx >= -r; dx--) cells.push({ dx, dy: r });      // bottom edge, R→L
  for (let dy = r - 1; dy >= -r + 1; dy--) cells.push({ dx: -r, dy }); // left edge, B→T
  return cells;
}

/** Hard cap on candidate cells `resolveHudWidgetPlacement`'s outward spiral
 *  will examine before giving up and falling back to the clamped desired
 *  position. Ring `r` holds `8r` cells, so ~400 cells covers roughly the
 *  first 9-10 rings (a ~216-240px search radius) — comfortably more than a
 *  HUD ever needs to route around one widget or the safe zone, while still
 *  guaranteeing the search always terminates (never throws, never loops
 *  forever) even in a pathological fully-occupied viewport. */
const MAX_PLACEMENT_SEARCH_CELLS = 400;
/** Generous upper bound on ring radius — pure defense-in-depth so the outer
 *  loop below is bounded even if the cell-count cap above were ever wrong;
 *  in practice `MAX_PLACEMENT_SEARCH_CELLS` always fires first. */
const MAX_PLACEMENT_SEARCH_RADIUS = 50;

/**
 * Resolve where a HUD widget should actually land. Snaps + clamps the
 * desired position exactly as `snapToHudGrid` + `clampToViewport` always
 * did — then, if that spot intersects the reserved top-right `SAFE_ZONE` or
 * overlaps another widget's rect (`others`), searches outward over the 24px
 * grid for the nearest free cell using a deterministic ring/spiral order
 * (see `ringCellOffsets`). Falls back to the plain clamped position if the
 * search cap is reached without finding one (pathological fully-occupied
 * viewport) — this function never throws and never loops forever.
 *
 * Used uniformly wherever a widget's position is (re)computed — drag-release,
 * resize-release, and spawn/reopen — so a widget can never end up under the
 * collapsed-inspector button or on top of another widget through any path.
 */
export function resolveHudWidgetPlacement(params: {
  desired: { x: number; y: number };
  size: { width: number; height: number };
  viewport: { width: number; height: number };
  others: HudRect[];
}): { x: number; y: number } {
  const { desired, size, viewport, others } = params;
  const clamped = clampToViewport(snapToHudGrid(desired), size, viewport);
  const safeZone = SAFE_ZONE(viewport);

  const isFree = (pos: { x: number; y: number }): boolean => {
    const rect: HudRect = { x: pos.x, y: pos.y, width: size.width, height: size.height };
    if (rectsOverlap(rect, safeZone)) return false;
    return others.every((o) => !rectsOverlap(rect, o));
  };

  if (isFree(clamped)) return clamped;

  let checked = 0;
  for (let r = 1; r <= MAX_PLACEMENT_SEARCH_RADIUS; r++) {
    for (const { dx, dy } of ringCellOffsets(r)) {
      if (checked >= MAX_PLACEMENT_SEARCH_CELLS) return clamped;
      checked++;
      const candidate = clampToViewport(
        { x: clamped.x + dx * HUD_GRID, y: clamped.y + dy * HUD_GRID },
        size,
        viewport,
      );
      if (isFree(candidate)) return candidate;
    }
  }
  return clamped;
}
