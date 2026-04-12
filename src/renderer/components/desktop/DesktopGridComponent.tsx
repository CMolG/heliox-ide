/**
 * DesktopGridComponent.tsx — Renderer Desktop Surface Component
 *
 * Responsibility:
 * - Renders the DesktopGridComponent surface in the renderer layer.
 * - Encapsulates Desktop canvas/window composition within the renderer workspace.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
import React, { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import { useDesktopStore } from '../../store/desktop-store';
import { LucideIcon } from './LucideIcon';
import type { DesktopGrid } from '@/types/desktop';

// ─── Resize directions ───────────────────────────────────────────

const RESIZE_DIRS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;
type ResizeDir = typeof RESIZE_DIRS[number];

interface InteractionState {
  type: 'drag' | `resize-${ResizeDir}` | null;
  startX: number;
  startY: number;
  initialLeft: number;
  initialTop: number;
  initialWidth: number;
  initialHeight: number;
  rafId: number;
}

// ─── Props ───────────────────────────────────────────────────────

interface DesktopGridComponentProps {
  grid: DesktopGrid;
}

type ConfirmAction = { type: 'row' | 'column' } | null;

export function DesktopGridComponent({ grid }: DesktopGridComponentProps) {
  const moveGrid = useDesktopStore(s => s.moveGrid);
  const resizeGrid = useDesktopStore(s => s.resizeGrid);
  const focusGrid = useDesktopStore(s => s.focusGrid);
  const removeGrid = useDesktopStore(s => s.removeGrid);
  const assignWindowToCell = useDesktopStore(s => s.assignWindowToCell);
  const addGridRow = useDesktopStore(s => s.addGridRow);
  const addGridColumn = useDesktopStore(s => s.addGridColumn);
  const draggingWindowId = useDesktopStore(s => s.draggingWindowId);
  const setDraggingWindowId = useDesktopStore(s => s.setDraggingWindowId);

  // Derive span info from grid.cells (stable — updates only when cells change)
  const windowSpans = useMemo(() => {
    const spans = new Map<string, { originIdx: number; colSpan: number; rowSpan: number }>();
    const windows = useDesktopStore.getState().windows;
    const seen = new Set<string>();
    for (const wid of grid.cells) {
      if (wid && !seen.has(wid)) {
        seen.add(wid);
        const w = windows.find(win => win.id === wid);
        if (w && w.gridCellIndex != null) {
          spans.set(wid, { originIdx: w.gridCellIndex, colSpan: w.gridColSpan ?? 1, rowSpan: w.gridRowSpan ?? 1 });
        }
      }
    }
    return spans;
  }, [grid.cells]);

  const [hoveredCorner, setHoveredCorner] = useState<string | null>(null);
  const [interacting, setInteracting] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);

  const interactionRef = useRef<InteractionState>({
    type: null, startX: 0, startY: 0,
    initialLeft: 0, initialTop: 0, initialWidth: 0, initialHeight: 0, rafId: 0,
  });

  // ─── Drag/Resize interaction (mirrors DesktopWindow pattern) ───

  const onInteractionStart = useCallback((e: React.MouseEvent, type: InteractionState['type']) => {
    if (!type) return;
    e.preventDefault();
    e.stopPropagation();
    focusGrid(grid.id);

    const inter = interactionRef.current;
    inter.type = type;
    inter.startX = e.clientX;
    inter.startY = e.clientY;
    inter.initialLeft = grid.position.x;
    inter.initialTop = grid.position.y;
    inter.initialWidth = grid.size.width;
    inter.initialHeight = grid.size.height;
    setInteracting(true);

    const onMove = (ev: MouseEvent) => {
      cancelAnimationFrame(inter.rafId);
      inter.rafId = requestAnimationFrame(() => {
        const zoom = useDesktopStore.getState().canvasZoom;
        const dx = (ev.clientX - inter.startX) / zoom;
        const dy = (ev.clientY - inter.startY) / zoom;

        if (inter.type === 'drag') {
          moveGrid(grid.id, {
            x: inter.initialLeft + dx,
            y: inter.initialTop + dy,
          });
        } else if (inter.type?.startsWith('resize-')) {
          const dir = inter.type.replace('resize-', '') as ResizeDir;
          let newW = inter.initialWidth;
          let newH = inter.initialHeight;
          let newX = inter.initialLeft;
          let newY = inter.initialTop;

          if (dir.includes('e')) newW = inter.initialWidth + dx;
          if (dir.includes('w')) { newW = inter.initialWidth - dx; newX = inter.initialLeft + dx; }
          if (dir.includes('s')) newH = inter.initialHeight + dy;
          if (dir.includes('n')) { newH = inter.initialHeight - dy; newY = inter.initialTop + dy; }

          resizeGrid(grid.id, { width: newW, height: newH }, { x: newX, y: newY });
        }
      });
    };

    const onUp = () => {
      cancelAnimationFrame(inter.rafId);
      inter.type = null;
      setInteracting(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [grid, focusGrid, moveGrid, resizeGrid]);

  // ─── Custom drop handler (replaces flaky HTML5 native drag in Electron) ───

  const handleCellMouseUp = useCallback((cellIndex: number) => {
    if (!draggingWindowId) return;
    if (cellIndex < 0 || cellIndex >= grid.cells.length) return;
    if (grid.cells[cellIndex] !== null) return;
    assignWindowToCell(grid.id, cellIndex, draggingWindowId);
    setDraggingWindowId(null);
  }, [draggingWindowId, grid.id, grid.cells, assignWindowToCell, setDraggingWindowId]);

  // Also support HTML5 native drag as fallback
  const handleCellDragOver = useCallback((e: React.DragEvent, cellIndex: number) => {
    if (grid.cells[cellIndex] !== null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, [grid.cells]);

  const handleCellDrop = useCallback((e: React.DragEvent, cellIndex: number) => {
    e.preventDefault();
    const windowId = e.dataTransfer.getData('heliox/window-id');
    if (windowId) {
      assignWindowToCell(grid.id, cellIndex, windowId);
    }
  }, [grid.id, assignWindowToCell]);

  // ─── Corner button handlers with confirmation ─────────────────

  const handleCornerClick = useCallback((e: React.MouseEvent, type: 'row' | 'column') => {
    e.stopPropagation();
    setConfirmAction({ type });
  }, []);

  const handleConfirm = useCallback(() => {
    if (!confirmAction) return;
    if (confirmAction.type === 'column') addGridColumn(grid.id);
    else addGridRow(grid.id);
    setConfirmAction(null);
  }, [confirmAction, grid.id, addGridColumn, addGridRow]);

  const handleCancelConfirm = useCallback(() => {
    setConfirmAction(null);
  }, []);

  // ESC to dismiss confirmation
  useEffect(() => {
    if (!confirmAction) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setConfirmAction(null); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [confirmAction]);

  const handleClose = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    removeGrid(grid.id);
  }, [grid.id, removeGrid]);

  // ─── Render ────────────────────────────────────────────────────

  const style: React.CSSProperties = {
    position: 'absolute',
    left: grid.position.x,
    top: grid.position.y,
    width: grid.size.width,
    height: grid.size.height,
    zIndex: grid.zIndex,
    pointerEvents: 'auto',
  };

  const isDraggingWindow = !!draggingWindowId;

  return (
    <div
      className="desktop-grid-shell"
      data-testid={`grid-${grid.id}`}
      data-interacting={interacting || undefined}
      data-drop-active={isDraggingWindow || undefined}
      style={style}
      onMouseDown={(e) => {
        focusGrid(grid.id);
        const target = e.target as HTMLElement;
        if (target.classList.contains('desktop-grid-shell') || target.classList.contains('grid-cells')) {
          onInteractionStart(e, 'drag');
        }
      }}
    >
      {/* Resize handles */}
      {RESIZE_DIRS.map(dir => (
        <div
          key={dir}
          className={`grid-resize grid-resize-${dir}`}
          onMouseDown={(e) => onInteractionStart(e, `resize-${dir}`)}
        />
      ))}

      {/* Corner hover zones — each shows only its own "+" button */}
      {[
        { pos: 'tl', type: 'column' as const, label: 'Add column' },
        { pos: 'tr', type: 'column' as const, label: 'Add column' },
        { pos: 'bl', type: 'row' as const, label: 'Add row' },
        { pos: 'br', type: 'row' as const, label: 'Add row' },
      ].map(({ pos, type, label }) => (
        <div
          key={pos}
          className={`grid-corner-zone grid-corner-zone-${pos}`}
          onMouseEnter={() => setHoveredCorner(pos)}
          onMouseLeave={() => setHoveredCorner(null)}
        >
          <button
            className={`grid-corner-btn grid-corner-${pos}`}
            data-testid={`grid-add-${type}-${pos}`}
            data-visible={hoveredCorner === pos || undefined}
            title={label}
            aria-label={label}
            onClick={(e) => handleCornerClick(e, type)}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <LucideIcon name="Plus" size={12} />
          </button>
        </div>
      ))}

      {/* Close button — appears on top-right corner hover */}
      <button
        className="grid-close-floating"
        data-testid="grid-close"
        data-visible={hoveredCorner === 'tr' || undefined}
        aria-label="Close grid"
        title="Remove grid"
        onClick={handleClose}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <LucideIcon name="X" size={10} />
      </button>

      {/* Confirmation modal for add row/column */}
      {confirmAction && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 backdrop-blur-sm rounded-[inherit]"
          data-testid="grid-confirm-modal"
          onClick={handleCancelConfirm}
        >
          <div
            className="bg-white rounded-xl shadow-[0_4px_24px_rgba(0,0,0,0.12)] border border-black/10 px-5 py-4 min-w-[200px] text-center"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-medium text-[#1a1a2e] m-0 mb-2">
              Add new {confirmAction.type}?
            </p>
            <span className="text-[11px] text-[#888] block mb-3">
              The grid will expand to keep cell sizes
            </span>
            <div className="flex gap-2 justify-center">
              <button
                className="px-3 py-1.5 text-xs font-medium rounded-md border border-black/10 bg-white text-[#444] cursor-pointer transition-colors hover:bg-[#eee]"
                data-testid="grid-confirm-cancel"
                onClick={handleCancelConfirm}
              >
                Cancel
              </button>
              <button
                className="px-3 py-1.5 text-xs font-medium rounded-md border border-blue-500/20 bg-blue-500/10 text-blue-600 cursor-pointer transition-colors hover:bg-blue-500/20"
                data-testid="grid-confirm-ok"
                onClick={handleConfirm}
              >
                Add {confirmAction.type}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Grid cells */}
      <div
        className="grid-cells"
        style={{
          gridTemplateColumns: `repeat(${grid.columns}, 1fr)`,
          gridTemplateRows: `repeat(${grid.rows}, 1fr)`,
        }}
        data-testid="grid-cells"
      >
        {grid.cells.map((cellWindowId, idx) => {
          const row = Math.floor(idx / grid.columns);
          const col = idx % grid.columns;

          // Skip sub-cells of merged windows (non-origin cells)
          if (cellWindowId !== null) {
            const span = windowSpans.get(cellWindowId);
            if (span && span.originIdx !== idx) return null;
          }

          const isEmpty = cellWindowId === null;
          const isDropTarget = isDraggingWindow && isEmpty;

          // Determine CSS grid span for origin cells of merged windows
          const span = cellWindowId ? windowSpans.get(cellWindowId) : null;
          const colSpan = span?.colSpan ?? 1;
          const rowSpan = span?.rowSpan ?? 1;

          return (
            <div
              key={`${grid.id}-${idx}`}
              className={`grid-cell ${isEmpty ? 'grid-cell-empty' : 'grid-cell-occupied'}`}
              data-testid={`grid-cell-${idx}`}
              data-drop-target={isDropTarget || undefined}
              style={{
                gridColumn: `${col + 1} / span ${colSpan}`,
                gridRow: `${row + 1} / span ${rowSpan}`,
              }}
              onDragOver={(e) => isEmpty && handleCellDragOver(e, idx)}
              onDrop={(e) => isEmpty && handleCellDrop(e, idx)}
              onMouseUp={() => handleCellMouseUp(idx)}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {isEmpty && (
                <div className={`grid-cell-placeholder ${isDropTarget ? 'grid-cell-placeholder-active' : ''}`}>
                  <LucideIcon name={isDropTarget ? 'ArrowDown' : 'Plus'} size={14} style={{ opacity: isDropTarget ? 0.6 : 0.2 }} />
                  <span>{isDropTarget ? 'Drop here' : 'Drop window'}</span>
                </div>
              )}
              {/* Occupied cells are transparent — the actual DesktopWindow renders on top at cell coordinates */}
            </div>
          );
        })}
      </div>
    </div>
  );
}
