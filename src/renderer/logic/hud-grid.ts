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
