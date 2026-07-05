/**
 * EdgeChrome.tsx — Shared interactive "chrome" for custom React Flow edges
 *
 * Responsibility:
 * - Renders the scaffolding every custom edge in this app needs around its
 *   own primary stroke: a halo underlay (readability across card fills), a
 *   wide invisible hit-area (forgiving hover/click/right-click detection), a
 *   body-portaled right-click context menu, and a color-editor popover
 *   anchored near the edge's label position.
 * - Extracted from MentalEdge.tsx and LoopEdge.tsx, which had grown
 *   near-identical copies of this scaffolding (same halo color, same
 *   hit-area width, same context-menu z-index/portal target, same
 *   color-modal markup) and had already started to diverge — LoopEdge
 *   grew a "Set iterations…" menu entry MentalEdge doesn't know about.
 *
 * Boundaries:
 * - Owns: hover/context-menu/color-editor UI state, the halo + hit-area SVG
 *   primitives, and the portaled menu/modal markup (reuses the existing
 *   `.mental-line-menu` / `.mental-line-color-modal` classes as-is).
 * - Does NOT own: the primary colored stroke — dash pattern, marker,
 *   animation class all differ per consumer, so each renders its own
 *   `<BaseEdge>` and passes it in as `children`, painted between the halo
 *   and the hit-area (matching the pre-extraction DOM order, which matters:
 *   the hit-area must stay topmost so hovering the thin visible stroke
 *   still resolves to the wide hit target, not a dead zone). Also does not
 *   own store persistence (consumers wire `onColorChange` / `onDelete` /
 *   menu-item callbacks into their own store calls) or anything specific to
 *   one edge kind (LoopEdge's iteration badge/stepper stay in LoopEdge,
 *   wired in via `extraMenuItems` and the `openContextMenu` ref handle).
 */
import React, { useCallback, useImperativeHandle, useState } from 'react';
import { createPortal } from 'react-dom';
import { BaseEdge, EdgeLabelRenderer } from '@xyflow/react';

/** Halo underlay color — shared across every custom edge for readability over card fills. */
export const EDGE_HALO_COLOR = 'rgba(0, 0, 0, 0.25)';
/** Invisible hit-area stroke width — wide enough for a forgiving hover/click/right-click target. */
export const EDGE_HIT_AREA_WIDTH = 20;
/** Context-menu portal overlay z-index (above the canvas and modals). */
export const EDGE_CONTEXT_MENU_ZINDEX = 10002;

export interface EdgeChromeMenuItem {
  label: string;
  onSelect: () => void;
  testId?: string;
}

export interface EdgeChromeHandle {
  /**
   * Opens the context menu at the given viewport coordinates. Exposed so a
   * consumer's own affordance rendered outside this component (e.g.
   * LoopEdge's iteration badge, which also opens the context menu on
   * right-click) can trigger the exact same portaled menu without lifting
   * `contextMenu` state back out of EdgeChrome.
   */
  openContextMenu: (x: number, y: number) => void;
}

export interface EdgeChromeProps {
  /** React Flow edge id — the halo id and default element ids key on this. */
  id: string;
  edgePath: string;
  /** Primary stroke width as computed by the consumer (hover/selection/flowing all factor in); the halo renders 4px wider, matching the pre-extraction convention. */
  strokeWidth: number;
  /**
   * The primary colored `<BaseEdge>` (and, for LoopEdge, its own
   * `EdgeLabelRenderer`-portaled badge/stepper) — differs per edge kind, so
   * it stays owned by the consumer and is rendered between the halo and the
   * hit-area, exactly where the primary stroke sat before extraction.
   */
  children: React.ReactNode;
  edgeColor: string;
  onColorChange: (color: string) => void;
  labelX: number;
  /** Fully-computed top offset for the color modal — consumers fold in their own `labelY` plus any local state (e.g. LoopEdge nudges it down while its stepper is also open). */
  colorModalTop: number;
  /** LoopEdge centers its color modal under the label; MentalEdge left-anchors it. */
  centerColorModal?: boolean;
  onHoverChange?: (hovered: boolean) => void;
  /** MentalEdge's hit-area has no testid; LoopEdge's does (`loop-edge-hit-${id}`). */
  hitAreaTestId?: string;
  menuTestId: string;
  colorMenuItemTestId: string;
  deleteMenuItemTestId: string;
  onDelete: () => void;
  /** Extra items rendered above the built-in "Change color" / "Delete edge" pair (e.g. LoopEdge's "Set iterations…"). */
  extraMenuItems?: EdgeChromeMenuItem[];
  /** React 19 supports `ref` as a plain prop on function components — no `forwardRef` wrapper needed. */
  ref?: React.Ref<EdgeChromeHandle>;
}

export function EdgeChrome({
  id,
  edgePath,
  strokeWidth,
  children,
  edgeColor,
  onColorChange,
  labelX,
  colorModalTop,
  centerColorModal,
  onHoverChange,
  hitAreaTestId,
  menuTestId,
  colorMenuItemTestId,
  deleteMenuItemTestId,
  onDelete,
  extraMenuItems,
  ref,
}: EdgeChromeProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [colorEditor, setColorEditor] = useState(false);

  useImperativeHandle(ref, () => ({
    openContextMenu: (x: number, y: number) => setContextMenu({ x, y }),
  }), []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  return (
    <>
      {/* Halo underlay for readability across card fills */}
      <BaseEdge
        id={`${id}-halo`}
        path={edgePath}
        style={{
          stroke: EDGE_HALO_COLOR,
          strokeWidth: strokeWidth + 4,
          strokeLinecap: 'round',
          fill: 'none',
        }}
      />

      {/* Consumer's primary stroke (+ any of its own label-portaled affordances) */}
      {children}

      {/* Wider invisible hit-area for hover/click/context-menu detection */}
      <path
        data-testid={hitAreaTestId}
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={EDGE_HIT_AREA_WIDTH}
        style={{ cursor: 'pointer' }}
        onMouseEnter={() => onHoverChange?.(true)}
        onMouseLeave={() => onHoverChange?.(false)}
        onContextMenu={handleContextMenu}
      />

      {/* Color editor — anchored near the label via EdgeLabelRenderer's portal */}
      <EdgeLabelRenderer>
        {colorEditor && (
          <div
            className="mental-line-color-modal"
            style={{
              position: 'absolute',
              left: labelX,
              top: colorModalTop,
              ...(centerColorModal ? { transform: 'translate(-50%, 0)' } : null),
              pointerEvents: 'all',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              className="mental-line-color-input"
              type="color"
              value={edgeColor}
              onChange={(e) => onColorChange(e.target.value)}
            />
            <button className="mental-line-menu-item" onClick={() => setColorEditor(false)}>
              Done
            </button>
          </div>
        )}
      </EdgeLabelRenderer>

      {/* Context menu — portaled to body to escape React Flow's transform */}
      {contextMenu && createPortal(
        <div
          style={{ position: 'fixed', inset: 0, zIndex: EDGE_CONTEXT_MENU_ZINDEX, pointerEvents: 'all' }}
          onClick={() => setContextMenu(null)}
          onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }}
        >
          <div
            className="mental-line-menu"
            data-testid={menuTestId}
            style={{
              position: 'absolute',
              left: contextMenu.x,
              top: contextMenu.y,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {extraMenuItems?.map((item) => (
              <button
                key={item.testId ?? item.label}
                className="mental-line-menu-item"
                data-testid={item.testId}
                onClick={() => {
                  item.onSelect();
                  setContextMenu(null);
                }}
              >
                {item.label}
              </button>
            ))}
            <button
              className="mental-line-menu-item"
              data-testid={colorMenuItemTestId}
              onClick={() => {
                setColorEditor(true);
                setContextMenu(null);
              }}
            >
              Change color
            </button>
            <button
              className="mental-line-menu-item"
              data-testid={deleteMenuItemTestId}
              onClick={() => {
                onDelete();
                setContextMenu(null);
              }}
            >
              Delete edge
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
