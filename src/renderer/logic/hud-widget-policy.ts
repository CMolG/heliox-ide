/**
 * hud-widget-policy.ts — Fluxor's own HUD widget sizing/placement policy,
 * layered on top of @javadaba/daba-engine's generic HUD grid math.
 *
 * Architecture note:
 * This used to be `logic/hud-grid.ts` (188 LOC): a self-contained, generic
 * HUD_GRID/snap/clamp/placement module. The daba-engine adoption (plan #20,
 * javadaba-web Core, Task 10) ported that generic geometry into the motor's
 * `core/hud-grid` (HUD_GRID, snapToHudGrid, resolveHudWidgetPlacement) — this
 * file deletes the old `logic/hud-grid.ts` and keeps ONLY what is genuinely
 * Fluxor-specific policy, expressed on top of the motor's primitives:
 *   - MIN_WIDGET_WIDTH/HEIGHT: which sizes make sense for these 3 widgets.
 *   - SAFE_ZONE: which corner InspectorPanel's collapsed button reserves.
 *   - The placement adapter: the motor's `safeZone` option CONFINES
 *     placement to within a rect (a positive placement area) — the OPPOSITE
 *     of what Fluxor needs (avoid one reserved corner, otherwise free
 *     anywhere in the viewport). Folding SAFE_ZONE into the `others` list
 *     (rects to avoid) gets Fluxor's actual semantics from the motor's
 *     generic collision-avoidance spiral search, with no engine change
 *     required — see the daba-engine CHANGELOG's Task 10 entry for the two
 *     gaps that DID need an engine change (TutorialEngine, ContextMenu).
 *
 * Standalone (not colocated in HudWidgetLayer.tsx) so desktop-store.ts can
 * import MIN_WIDGET_WIDTH/HEIGHT without a store → component → store cycle.
 */
import {
  HUD_GRID,
  resolveHudWidgetPlacement as engineResolveHudWidgetPlacement,
  snapToHudGrid as engineSnapToHudGrid,
  type Rect,
} from '@javadaba/daba-engine';

export type HudRect = Rect;

/** Minimum HUD widget size (px). MUST be exact HUD_GRID multiples (24 * 9, 24
 *  * 6) — `snapSizeToHudGrid` rounds to the nearest grid multiple and THEN
 *  clamps to these mins, so if a min weren't itself a grid multiple, the
 *  rounding step and the clamp step would disagree and visibly jump the
 *  widget on release. Single source of truth for the min — HudWidgetLayer's
 *  live-drag floor and desktop-store's resizeHudWidget both import these
 *  instead of duplicating the literals. */
export const MIN_WIDGET_WIDTH = 216; // 24 * 9
export const MIN_WIDGET_HEIGHT = 144; // 24 * 6

/** Snap a widget size to the nearest HUD_GRID multiple on both axes (via the
 *  motor's per-axis `snapToHudGrid`), then clamp up to the grid-aligned
 *  minimum. Clamping AFTER rounding — against mins that are themselves grid
 *  multiples — guarantees the result always lands exactly on-grid, never
 *  below the minimum. */
export function snapSizeToHudGrid(size: { width: number; height: number }): { width: number; height: number } {
  return {
    width: Math.max(MIN_WIDGET_WIDTH, engineSnapToHudGrid(size.width, HUD_GRID)),
    height: Math.max(MIN_WIDGET_HEIGHT, engineSnapToHudGrid(size.height, HUD_GRID)),
  };
}

/**
 * Reserved top-right safe zone for a given viewport — reserved for
 * InspectorPanel's collapsed button (formerly its own component,
 * ExpandInspectorButton.tsx, deleted in Task 13 — adoption plan #20 —
 * once its role moved to the motor's `<SideToolbar>` collapsed state, see
 * index.css's `.inspector-side-toolbar.daba-side-toolbar__expand`), which
 * docks top-right. Widgets may never occupy this rect.
 *  - WIDTH 72 (3 cells): the 36px button plus its 20px right margin fit in 72.
 *  - HEIGHT 120 (5 cells): the button's bottom edge is at 65+36=101px; 120 is
 *    the smallest grid-aligned height that clears it under the ~53px TopBar
 *    (see the matching note in index.css).
 */
export function SAFE_ZONE(viewport: { width: number; height: number }): HudRect {
  return { x: viewport.width - HUD_GRID * 3, y: 0, width: HUD_GRID * 3, height: HUD_GRID * 5 };
}

/** Strict rectangle-overlap test. Edge-touching (e.g. `a.x + a.width === b.x`)
 *  is NOT an overlap — widgets may sit flush against each other or against
 *  the safe zone boundary. */
export function rectsOverlap(a: HudRect, b: HudRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * Resolve where a HUD widget should actually land, dodging both the reserved
 * SAFE_ZONE and every OTHER currently-visible widget. See the module
 * docblock for why SAFE_ZONE is folded into `others` rather than passed as
 * the motor's `safeZone` option.
 */
export function resolveHudWidgetPlacement(params: {
  desired: { x: number; y: number };
  size: { width: number; height: number };
  viewport: { width: number; height: number };
  others: HudRect[];
}): { x: number; y: number } {
  const { desired, size, viewport, others } = params;
  const resolved = engineResolveHudWidgetPlacement({
    preferred: desired,
    size,
    viewport,
    others: [...others, SAFE_ZONE(viewport)],
  });
  return { x: resolved.x, y: resolved.y };
}
