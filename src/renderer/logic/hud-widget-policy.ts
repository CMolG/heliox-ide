/**
 * hud-widget-policy.ts — Fluxor's own HUD widget sizing/placement policy,
 * layered on top of @cmolg/daba-engine's generic HUD grid math.
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
} from '@cmolg/daba-engine';

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
export const CANVAS_PADDING_X = 12;
export const CANVAS_PADDING_Y = 12;
export const TOP_BAR_HEIGHT = 48;
export const BOTTOM_DOCK_RESERVE = 64;

export function getDynamicAvoidanceRects(params: {
  viewport: { width: number; height: number };
  showSidebar?: boolean;
  showInspector?: boolean;
}): HudRect[] {
  const { viewport, showSidebar, showInspector } = params;
  const avoidance: HudRect[] = [];

  // Left sidebar avoidance when expanded
  if (showSidebar) {
    avoidance.push({ x: 0, y: 0, width: 280 + CANVAS_PADDING_X, height: viewport.height });
  }

  // Right inspector panel avoidance when expanded vs collapsed safe-zone
  if (showInspector) {
    avoidance.push({
      x: viewport.width - (300 + CANVAS_PADDING_X),
      y: 0,
      width: 300 + CANVAS_PADDING_X,
      height: viewport.height,
    });
  } else {
    avoidance.push(SAFE_ZONE(viewport));
  }

  // Bottom dock avoidance
  avoidance.push({
    x: 0,
    y: viewport.height - BOTTOM_DOCK_RESERVE,
    width: viewport.width,
    height: BOTTOM_DOCK_RESERVE,
  });

  return avoidance;
}

/**
 * Resolve where a HUD widget should actually land, dodging reserved panel areas,
 * SAFE_ZONE, top/bottom margins, and every OTHER currently-visible widget.
 */
export function resolveHudWidgetPlacement(params: {
  desired: { x: number; y: number };
  size: { width: number; height: number };
  viewport: { width: number; height: number };
  others: HudRect[];
  showSidebar?: boolean;
  showInspector?: boolean;
}): { x: number; y: number } {
  const { desired, size, viewport, others, showSidebar, showInspector } = params;
  const panelAvoidance = getDynamicAvoidanceRects({ viewport, showSidebar, showInspector });

  const allOthers = [...others, ...panelAvoidance];

  // 1. Run motor's spiral search placement dodging safe zone + panels + other widgets
  const resolved = engineResolveHudWidgetPlacement({
    preferred: desired,
    size,
    viewport,
    others: allOthers,
  });

  // 2. Enforce tight in-canvas boundary guardrails considering panels & top/bottom margins
  const minX = showSidebar ? 280 + CANVAS_PADDING_X : CANVAS_PADDING_X;
  const maxX = Math.max(
    minX,
    viewport.width - size.width - (showInspector ? 300 + CANVAS_PADDING_X : CANVAS_PADDING_X),
  );
  const minY = TOP_BAR_HEIGHT;
  const maxY = Math.max(minY, viewport.height - size.height - BOTTOM_DOCK_RESERVE);

  const finalX = Math.max(minX, Math.min(resolved.x, maxX));
  const finalY = Math.max(minY, Math.min(resolved.y, maxY));

  // 3. Fallback anti-overlap guardrail: if resolved position still overlaps any active neighbour,
  // nudge it by HUD_GRID (24px) offsets until it clears or reaches viewport limit.
  const candidateRect = { x: finalX, y: finalY, width: size.width, height: size.height };
  const hasOverlap = allOthers.some((other) => rectsOverlap(candidateRect, other));

  if (hasOverlap) {
    let offset = HUD_GRID; // 24px step
    while (offset <= HUD_GRID * 12) {
      const altCandidates = [
        { x: Math.max(minX, Math.min(finalX + offset, maxX)), y: Math.max(minY, Math.min(finalY + offset, maxY)) },
        { x: Math.max(minX, Math.min(finalX - offset, maxX)), y: Math.max(minY, Math.min(finalY + offset, maxY)) },
        { x: Math.max(minX, Math.min(finalX, maxX)), y: Math.max(minY, Math.min(finalY + offset, maxY)) },
        { x: Math.max(minX, Math.min(finalX, maxX)), y: Math.max(minY, Math.min(finalY - offset, maxY)) },
      ];
      for (const alt of altCandidates) {
        const testRect = { x: alt.x, y: alt.y, width: size.width, height: size.height };
        if (!allOthers.some((other) => rectsOverlap(testRect, other))) {
          return alt;
        }
      }
      offset += HUD_GRID;
    }
  }

  return { x: finalX, y: finalY };
}
