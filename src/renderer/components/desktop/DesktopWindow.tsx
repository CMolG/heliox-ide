/**
 * DesktopWindow.tsx — Renderer Desktop Surface Component
 *
 * Responsibility:
 * - Renders the DesktopWindow surface in the renderer layer.
 * - Encapsulates Desktop canvas/window composition within the renderer workspace.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/desktop/DesktopWindow.tsx — Draggable/resizable window with external attachments
import React, { useRef, useCallback, useMemo, useState, useContext, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useDroppable } from '@dnd-kit/core';
import { useDesktopStore, GRID_PADDING, GRID_GAP } from '../../store/desktop-store';
import { CanvasSizeContext } from './SeamlessCanvas';
import { useFluxorStore } from '../../store';
import { LucideIcon } from './LucideIcon';
import { AttachmentInfoModal } from './AttachmentInfoModal';
import type { AttachmentModalInfo } from './AttachmentInfoModal';
// Window context menu adopted onto @cmolg/daba-engine's unified ContextMenu
// (adoption plan #20, javadaba-web Core, Task 10 — this used to be its own
// WindowContextMenu.tsx, deleted). `labelColor` (engine addition, same Task)
// preserves the per-action semantic colors (orange/blue/purple for role/mod/
// flow removal) the old component had, independent of `danger` (close).
import {
  ContextMenu, useContextMenuState, resolveSnap,
  type ContextMenuEntry, type ContextMenuProviders, type GridSpec,
} from '@cmolg/daba-engine';
import { engineStore } from '../../store/engine-bridge';
import type { WindowPosition, WindowSize, AttachableType } from '@/types/desktop';
import { TYPE_META } from './DesktopAttachable';
import { kebabToTitle } from './attachable-helpers';
import { TopRoleAttachment } from '../atoms/attachment/TopRoleAttachment';
import { BottomModAttachment } from '../atoms/attachment/BottomModAttachment';
import { theme } from '../../logic/theme';
import type { MarketRole, MarketMod, MarketFlow } from '@/types/market';

const RESIZE_DIRS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;
type ResizeDir = typeof RESIZE_DIRS[number];
const DRAG_ACTIVATION_PX = 4;

/**
 * Task 13 (adoption plan #20) — snap-to-grid quantization for the window
 * drag COMMIT only (the live drag itself stays pure-DOM-transform, untouched
 * — see `startInteraction`'s `onMouseMove` below). Precedence, exactly as
 * decided (task13-decisiones.md Q5, mirroring the motor's own `resolveSnap`
 * precedence rule): if Fluxor's OWN `calculateSnapGuides` (desktop-store.ts,
 * untouched) already magnetized on EITHER axis, its result wins outright —
 * grid quantization is skipped entirely, on BOTH axes, not just the matched
 * one. Only when no guide matched at all AND the toggle is on does the
 * raw/guide-less position get quantized, via the motor's `resolveSnap` with
 * `guides.enabled: false` (Fluxor's guide system already had its turn above
 * — this call only ever exercises the grid branch). `width`/`height` are
 * irrelevant to that branch (`core/grid.ts`'s `pixelsToColRow` only reads
 * `rect.x`/`rect.y`) so a dummy 0x0 rect is passed instead of `win.size`.
 *
 * Pure/exported so it's testable with golden values without simulating a
 * real pointer drag (same "extract the decision, test it directly" idiom as
 * `MentalGraphCanvas.tsx`'s `resolveConnectionEdgeType`).
 */
export function resolveWindowDropPosition(
  snappedPos: WindowPosition,
  guideMatched: boolean,
  snapGrid: { enabled: boolean; spec: GridSpec },
): WindowPosition {
  if (guideMatched || !snapGrid.enabled) return snappedPos;
  return resolveSnap(
    { x: snappedPos.x, y: snappedPos.y, width: 0, height: 0 },
    [],
    { grid: snapGrid, guides: { enabled: false, threshold: 0 } },
  ).pos;
}

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

interface DesktopWindowProps {
  windowId: string;
  children: React.ReactNode;
}

export function DesktopWindow({ windowId, children }: DesktopWindowProps) {
  const canvasSize = useContext(CanvasSizeContext);
  const win = useDesktopStore(s => s.windows.find(w => w.id === windowId));
  const activeWindowId = useDesktopStore(s => s.activeWindowId);
  const hoveredWindowId = useDesktopStore(s => s.hoveredWindowId);
  const selectedWindowIds = useDesktopStore(s => s.selectedWindowIds);
  const focusWindow = useDesktopStore(s => s.focusWindow);
  const moveWindow = useDesktopStore(s => s.moveWindow);
  const moveSelectedWindows = useDesktopStore(s => s.moveSelectedWindows);
  const resizeWindow = useDesktopStore(s => s.resizeWindow);
  const removeWindow = useDesktopStore(s => s.removeWindow);
  const setWindowState = useDesktopStore(s => s.setWindowState);
  const detachFromWindow = useDesktopStore(s => s.detachFromWindow);
  const marketInventory = useDesktopStore(s => s.marketInventory);
  const calculateSnapGuides = useDesktopStore(s => s.calculateSnapGuides);
  const setActiveSnapGuides = useDesktopStore(s => s.setActiveSnapGuides);
  const canvasPan = useDesktopStore(s => s.canvasPan);
  const canvasZoom = useDesktopStore(s => s.canvasZoom);
  const activeDragId = useDesktopStore(s => s.activeDragId);
  const removeWindowFromCell = useDesktopStore(s => s.removeWindowFromCell);
  const resizeWindowInGrid = useDesktopStore(s => s.resizeWindowInGrid);

  // Grid-snapped state: when set, window is positioned by the grid — disable drag but allow resize
  const isGridSnapped = !!win?.gridId;

  // Project name for titlebar
  const projectPath = useFluxorStore(s => s.projectPath);
  const projectName = projectPath?.split('/').pop() ?? null;

  // Check if this window's session has a running agent
  const session = useFluxorStore(s =>
    win?.sessionId ? s.sessions.find(ss => ss.id === win.sessionId) : undefined
  );
  const isAgentRunning = session?.status === 'running';

  const interactionRef = useRef<InteractionState>({
    type: null, startX: 0, startY: 0,
    initialLeft: 0, initialTop: 0, initialWidth: 0, initialHeight: 0, rafId: 0,
  });
  const elRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const [shaking, setShaking] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const dragArmRef = useRef<{ startX: number; startY: number } | null>(null);
  const [attachmentModal, setAttachmentModal] = useState<AttachmentModalInfo | null>(null);
  const { state: contextMenuState, open: openContextMenu, close: closeContextMenu } = useContextMenuState();

  const isActive = activeWindowId === windowId;
  const isHighlighted = hoveredWindowId === windowId;
  const isSelected = selectedWindowIds.includes(windowId);
  // 'chat' window type retired (chats→steps re-architecture, F0 decision 2,
  // 2026-07-10) — mirrors connectFlow/attachToWindow's own retirement in
  // desktop-store.ts (both always return false now for the identical
  // reason): drag-drop-attach-to-window and its ribbon UI below were only
  // ever valid for chat windows, the sole surface that supported them, so
  // this is always false now — zero observable change for every window type
  // that still exists (they never satisfied `win?.type === 'chat'` either).
  const isChatWindow = false;

  // ─── dnd-kit droppable ─────────────────────────────────
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `window-drop-${windowId}`,
    data: { windowId, type: 'chat-window' },
    disabled: !isChatWindow,
  });

  // Determine if a compatible attachable is being actively dragged
  const dropActive = isOver && !!activeDragId;

  // Resolve attached items from inventory
  const inventoryRole = win?.roleId && marketInventory
    ? marketInventory.roles.find(r => r.name === win.roleId) : null;
  const inventoryMods = win && marketInventory
    ? win.modifierIds.map(id => marketInventory.mods.find(m => m.name === id)).filter(Boolean) : [];
  const flow = win?.flowId;
  const inventoryFlow = flow && marketInventory
    ? marketInventory.flows.find(f => f.name === flow) : null;

  // Determine overlay label based on active drag type
  const getDropOverlayLabel = (): string => {
    if (!activeDragId) return '';
    const att = useDesktopStore.getState().attachables.find(a => a.id === activeDragId);
    if (!att) return '';
    const meta = TYPE_META[att.type];
    return `Drop here to add ${meta.label.toLowerCase()}`;
  };

  // Open attachment info modal
  const openAttachmentModal = useCallback((type: AttachableType, item: MarketRole | MarketMod | MarketFlow) => {
    const info: AttachmentModalInfo = {
      type,
      name: item.name,
      description: item.description,
      tags: item.tags,
      color: (item as MarketRole).color,
    };
    if (type === 'flow') {
      const f = item as MarketFlow;
      info.extra = { complexity: f.recommendedComplexity, cost: f.cost };
    }
    setAttachmentModal(info);
  }, []);

  // Context menu on right-click — entries ported verbatim from the deleted
  // WindowContextMenu.tsx call site (adoption plan #20, Task 10). testId
  // mirrors the old component's own slug (`ctx-menu-${label.toLowerCase()
  // .replace(/\s+/g,'-')}`) so existing e2e selectors keep working.
  const windowContextMenuProviders: ContextMenuProviders = useMemo(() => {
    const testIdFor = (label: string) => `ctx-menu-${label.toLowerCase().replace(/\s+/g, '-')}`;
    const entries: ContextMenuEntry[] = [];
    if (inventoryRole) {
      const label = `Remove role: ${kebabToTitle(inventoryRole.name)}`;
      entries.push({
        id: 'remove-role', label, testId: testIdFor(label),
        icon: <LucideIcon name="UserMinus" size={13} style={{ opacity: 0.7, flexShrink: 0 }} />,
        labelColor: '#E87040',
        onSelect: () => detachFromWindow(windowId, 'role', inventoryRole.name),
      });
    }
    for (const mod of inventoryMods) {
      if (!mod) continue;
      const label = `Remove mod: ${kebabToTitle(mod.name)}`;
      entries.push({
        id: `remove-mod-${mod.name}`, label, testId: testIdFor(label),
        icon: <LucideIcon name="WrenchIcon" size={13} style={{ opacity: 0.7, flexShrink: 0 }} />,
        labelColor: '#4285F4',
        onSelect: () => detachFromWindow(windowId, 'mod', mod.name),
      });
    }
    if (inventoryFlow) {
      const label = `Remove flow: ${kebabToTitle(inventoryFlow.name)}`;
      entries.push({
        id: 'remove-flow', label, testId: testIdFor(label),
        icon: <LucideIcon name="GitBranch" size={13} style={{ opacity: 0.7, flexShrink: 0 }} />,
        labelColor: '#A78BFA',
        onSelect: () => detachFromWindow(windowId, 'flow', inventoryFlow.name),
      });
    }
    // Always show window actions
    const maximizeLabel = win?.state === 'maximized' ? 'Restore' : 'Maximize';
    entries.push({
      id: 'maximize', label: maximizeLabel, testId: testIdFor(maximizeLabel),
      icon: <LucideIcon name="Square" size={13} style={{ opacity: 0.7, flexShrink: 0 }} />,
      onSelect: () => setWindowState(windowId, win?.state === 'maximized' ? 'normal' : 'maximized'),
    });
    entries.push({
      id: 'minimize', label: 'Minimize', testId: testIdFor('Minimize'),
      icon: <LucideIcon name="Minus" size={13} style={{ opacity: 0.7, flexShrink: 0 }} />,
      onSelect: () => setWindowState(windowId, 'minimized'),
    });
    entries.push({
      id: 'close-window', label: 'Close window', testId: testIdFor('Close window'),
      icon: <LucideIcon name="X" size={13} style={{ opacity: 0.7, flexShrink: 0 }} />,
      labelColor: theme.danger,
      onSelect: () => removeWindow(windowId),
    });
    return { window: () => entries };
  }, [inventoryRole, inventoryMods, inventoryFlow, windowId, detachFromWindow, setWindowState, removeWindow, win?.state]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openContextMenu({ targetKind: 'window', targetId: windowId, worldPos: { x: 0, y: 0 } }, { x: e.clientX, y: e.clientY });
  }, [openContextMenu, windowId]);

  // ─── Grid-aware resize (merge/unmerge adjacent empty cells) ───

  const onGridResizeStart = useCallback((e: React.MouseEvent, dir: string) => {
    if (!win?.gridId || win.gridCellIndex == null) return;
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;
    const gridId = win.gridId;
    const grid = useDesktopStore.getState().grids.find(g => g.id === gridId);
    if (!grid) return;

    const originIdx = win.gridCellIndex;
    const startColSpan = win.gridColSpan ?? 1;
    const startRowSpan = win.gridRowSpan ?? 1;
    const originRow = Math.floor(originIdx / grid.columns);
    const originCol = originIdx % grid.columns;

    const cellW = (grid.size.width - GRID_PADDING * 2 - (grid.columns - 1) * GRID_GAP) / grid.columns;
    const cellH = (grid.size.height - GRID_PADDING * 2 - (grid.rows - 1) * GRID_GAP) / grid.rows;
    const cellStepX = cellW + GRID_GAP;
    const cellStepY = cellH + GRID_GAP;

    let rafId = 0;

    const onMove = (ev: MouseEvent) => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const zoom = useDesktopStore.getState().canvasZoom;
        const dx = (ev.clientX - startX) / zoom;
        const dy = (ev.clientY - startY) / zoom;

        let newOriginCol = originCol;
        let newOriginRow = originRow;
        let newColSpan = startColSpan;
        let newRowSpan = startRowSpan;

        if (dir.includes('e')) newColSpan = Math.max(1, startColSpan + Math.round(dx / cellStepX));
        if (dir.includes('w')) {
          const d = Math.round(dx / cellStepX);
          newOriginCol = originCol + d;
          newColSpan = startColSpan - d;
        }
        if (dir.includes('s')) newRowSpan = Math.max(1, startRowSpan + Math.round(dy / cellStepY));
        if (dir.includes('n')) {
          const d = Math.round(dy / cellStepY);
          newOriginRow = originRow + d;
          newRowSpan = startRowSpan - d;
        }

        // Clamp to grid bounds
        newOriginCol = Math.max(0, Math.min(newOriginCol, grid.columns - 1));
        newOriginRow = Math.max(0, Math.min(newOriginRow, grid.rows - 1));
        newColSpan = Math.max(1, Math.min(newColSpan, grid.columns - newOriginCol));
        newRowSpan = Math.max(1, Math.min(newRowSpan, grid.rows - newOriginRow));

        const newOrigin = newOriginRow * grid.columns + newOriginCol;
        resizeWindowInGrid(win.id, newOrigin, newColSpan, newRowSpan);
      });
    };

    const onUp = () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [win, resizeWindowInGrid]);

  // ─── Drag/Resize handlers ──────────────────────────────────

  const startInteraction = useCallback((type: InteractionState['type'], startX: number, startY: number, shouldFocus = true) => {
    if (!win || !type) return;
    // Block drag/resize when maximized
    if (win.state === 'maximized' && (type === 'drag' || type?.startsWith('resize-'))) return;
    if (shouldFocus) focusWindow(windowId);

    const inter = interactionRef.current;
    inter.type = type;
    inter.startX = startX;
    inter.startY = startY;
    inter.initialLeft = win.position.x;
    inter.initialTop = win.position.y;
    inter.initialWidth = win.size.width;
    inter.initialHeight = win.size.height;
    setInteracting(true);

    const isMultiDrag = type === 'drag' && selectedWindowIds.includes(windowId) && selectedWindowIds.length > 1;

    // Track the latest drag position for final commit (avoids store updates during drag)
    let lastDragPos: WindowPosition | null = null;
    // Cache zoom to avoid getState() on every mousemove
    let cachedZoom = useDesktopStore.getState().canvasZoom;
    let zoomCacheTime = performance.now();

    const onMouseMove = (ev: MouseEvent) => {
      if (!inter.type) return;

      // Refresh zoom cache every 500ms (zoom rarely changes mid-drag)
      const now = performance.now();
      if (now - zoomCacheTime > 500) {
        cachedZoom = useDesktopStore.getState().canvasZoom;
        zoomCacheTime = now;
      }

      const dx = (ev.clientX - inter.startX) / cachedZoom;
      const dy = (ev.clientY - inter.startY) / cachedZoom;

      if (inter.type === 'drag') {
        if (isMultiDrag) {
          // Multi-drag still needs store updates for other windows
          cancelAnimationFrame(inter.rafId);
          inter.rafId = requestAnimationFrame(() => {
            moveSelectedWindows(dx, dy, inter.startX, inter.startY, ev.clientX, ev.clientY);
            inter.startX = ev.clientX;
            inter.startY = ev.clientY;
          });
        } else {
          // Single drag: pure DOM transform — zero React, zero Zustand, zero RAF
          const rawPos: WindowPosition = {
            x: inter.initialLeft + dx,
            y: inter.initialTop + dy,
          };
          lastDragPos = rawPos;

          const shell = shellRef.current;
          if (shell) {
            const offsetX = rawPos.x - inter.initialLeft;
            const offsetY = rawPos.y - inter.initialTop;
            shell.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
          }
        }
      } else if (inter.type?.startsWith('resize-')) {
        cancelAnimationFrame(inter.rafId);
        inter.rafId = requestAnimationFrame(() => {
          const dir = inter.type!.replace('resize-', '') as ResizeDir;
          let newW = inter.initialWidth;
          let newH = inter.initialHeight;
          let newX = inter.initialLeft;
          let newY = inter.initialTop;

          if (dir.includes('e')) newW = inter.initialWidth + dx;
          if (dir.includes('w')) { newW = inter.initialWidth - dx; newX = inter.initialLeft + dx; }
          if (dir.includes('s')) newH = inter.initialHeight + dy;
          if (dir.includes('n')) { newH = inter.initialHeight - dy; newY = inter.initialTop + dy; }

          resizeWindow(windowId, { width: newW, height: newH }, { x: newX, y: newY });
        });
      }
    };

    const onMouseUp = () => {
      cancelAnimationFrame(inter.rafId);

      const wasDrag = inter.type === 'drag';
      const shell = shellRef.current;

      // ── 1. Commit final drag position instantly (zero transitions) ──
      if (wasDrag && lastDragPos && !isMultiDrag) {
        const { snappedPos, guides } = calculateSnapGuides(windowId, lastDragPos, win.size);
        const finalPos = resolveWindowDropPosition(snappedPos, guides.length > 0, engineStore.getState().snap.grid);
        if (shell) {
          // Force-kill transitions so the position commit is instant.
          // The CSS rule [data-interacting="true"]{transition:none} would
          // normally handle this, but React batches setInteracting(false)
          // with the position change — re-enabling the 300ms ease-out
          // transition in the SAME render that changes left/top → bounce.
          shell.style.transition = 'none';
          shell.style.transform = '';
          shell.style.left = `${finalPos.x}px`;
          shell.style.top = `${finalPos.y}px`;
          // Force synchronous reflow — browser paints the final position
          // before anything else runs. No frame can show the old position.
          void shell.offsetHeight;
        }
        moveWindow(windowId, finalPos);
      }

      if (inter.type?.startsWith('resize-')) {
        const state = useDesktopStore.getState();
        const currentWin = state.windows.find(w => w.id === windowId);
        if (currentWin) {
          const { snappedPos } = calculateSnapGuides(windowId, currentWin.position, currentWin.size);
          if (snappedPos.x !== currentWin.position.x || snappedPos.y !== currentWin.position.y) {
            moveWindow(windowId, snappedPos);
          }
        }
      }

      // Trigger canvas wave from window center on drop (not resize)
      if (wasDrag) {
        const state = useDesktopStore.getState();
        const droppedWin = state.windows.find(w => w.id === windowId);
        if (droppedWin) {
          let absorbed = false;

          // ── File-viewer → file-explorer absorption ────────────
          if (droppedWin.type === 'file-viewer' && droppedWin.filePath) {
            const explorer = state.windows.find(w =>
              w.type === 'file-explorer' && w.id !== windowId && w.state !== 'minimized' &&
              droppedWin.position.x + droppedWin.size.width > w.position.x &&
              droppedWin.position.x < w.position.x + w.size.width &&
              droppedWin.position.y + droppedWin.size.height > w.position.y &&
              droppedWin.position.y < w.position.y + w.size.height
            );
            if (explorer) {
              window.dispatchEvent(new CustomEvent('fluxor:absorb-file-viewer', {
                detail: { explorerId: explorer.id, filePath: droppedWin.filePath },
              }));
              removeWindow(windowId);
              absorbed = true;
            }
          }

          if (!absorbed) {
            const centerX = droppedWin.position.x + droppedWin.size.width / 2;
            const centerY = droppedWin.position.y + droppedWin.size.height / 2;
            const pan = state.canvasPan;
            window.dispatchEvent(new CustomEvent('fluxor:canvas-wave', {
              detail: { x: centerX + pan.x, y: centerY + pan.y },
            }));
          }
        }
      }

      // ── 2. Synchronous cleanup ──
      inter.type = null;
      lastDragPos = null;
      window.removeEventListener('pointermove', onMouseMove);
      window.removeEventListener('pointerup', onMouseUp);

      // ── 3. Deferred state reset ──
      // Wait one frame so the browser has PAINTED the committed position
      // before we flip data-interacting→false (which re-enables the
      // 300ms CSS transition). By then left/top are settled — nothing
      // to animate.
      requestAnimationFrame(() => {
        setInteracting(false);
        setActiveSnapGuides([]);
        if (shellRef.current) shellRef.current.style.transition = '';
      });
    };

    window.addEventListener('pointermove', onMouseMove);
    window.addEventListener('pointerup', onMouseUp);
  }, [win, windowId, focusWindow, moveWindow, moveSelectedWindows, resizeWindow, calculateSnapGuides, setActiveSnapGuides, selectedWindowIds, removeWindow]);

  const onInteractionStart = useCallback((e: React.MouseEvent, type: InteractionState['type']) => {
    e.preventDefault();
    e.stopPropagation();
    startInteraction(type, e.clientX, e.clientY);
  }, [startInteraction]);

  const handleSurfaceMouseDown = useCallback((e: React.MouseEvent) => {
    if (!win || e.button !== 0) return;
    focusWindow(windowId);
    if (!isGridSnapped && win.state !== 'maximized') {
      dragArmRef.current = { startX: e.clientX, startY: e.clientY };
    }
  }, [win, windowId, focusWindow, isGridSnapped]);

  const handleSurfaceDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!win || isGridSnapped) return;
    setWindowState(windowId, win.state === 'maximized' ? 'normal' : 'maximized');
  }, [win, windowId, isGridSnapped, setWindowState]);

  useEffect(() => {
    const onMove = (ev: MouseEvent) => {
      const arm = dragArmRef.current;
      if (!arm) return;
      const dx = ev.clientX - arm.startX;
      const dy = ev.clientY - arm.startY;
      if (Math.hypot(dx, dy) < DRAG_ACTIVATION_PX) return;
      dragArmRef.current = null;
      startInteraction('drag', arm.startX, arm.startY, false);
    };
    const onUp = () => { dragArmRef.current = null; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [startInteraction]);

  // Do NOT early-return for minimized — keep full DOM tree so React preserves children state
  if (!win) return null;

  // Resolve role color for integrated theming
  const roleColor = inventoryRole
    ? ((inventoryRole as any).color
        ? ((inventoryRole as any).color as string).startsWith('#')
          ? (inventoryRole as any).color as string
          : `#${(inventoryRole as any).color}`
        : null)
    : null;

  const isMinimized = win.state === 'minimized';
  const isMaximized = win.state === 'maximized';

  // Maximized: fill the canvas container (not the full viewport — excludes sidebar/topbar).
  // Pan layer applies translate + scale, so we invert both to fit the visible canvas exactly.
  const DOCK_RESERVED_PX = 76; // dock height + bottom breathing room
  const vpW = canvasSize.width;
  const vpH = Math.max(120, canvasSize.height - DOCK_RESERVED_PX);

  // Style: world-space coordinates. Zoom is handled by the pan layer transform.
  const style: React.CSSProperties = isMinimized
    ? { display: 'none' }
    : isMaximized
    ? {
        position: 'absolute',
        left: -canvasPan.x / canvasZoom,
        top: -canvasPan.y / canvasZoom,
        width: vpW / canvasZoom,
        height: vpH / canvasZoom,
        zIndex: 99999,
        pointerEvents: 'none',
        ...(roleColor ? { '--role-color': roleColor } as React.CSSProperties : {}),
      }
    : {
        left: win.position.x,
        top: win.position.y,
        width: win.size.width,
        height: win.size.height,
        zIndex: win.zIndex,
        pointerEvents: 'none',
        ...(roleColor ? { '--role-color': roleColor } as React.CSSProperties : {}),
      };

  const hasExternalAttachments = !isMaximized && isChatWindow && (inventoryRole || inventoryMods.length > 0 || inventoryFlow);

  const windowNode = (
    <div
      ref={shellRef}
      className="desktop-window-shell nopan nodrag nowheel"
      data-state={win.state}
      data-interacting={interacting}
      data-has-role={!!roleColor}
      // Mirrored from the inner .desktop-window below (data-active/
      // data-highlighted/data-selected there too): the selection ring now
      // lives on THIS element (index.css's `.desktop-window-shell[data-...]`
      // rules) so role/mod/flow attachments — rendered as shell children,
      // siblings of the inner window — can't overlap/cut it. --role-color
      // already reaches this element via `style` below.
      data-active={isActive}
      data-highlighted={isHighlighted}
      data-selected={isSelected}
      style={style}
    >
      {/* ── External Attachments (outside window bounds) ──────────── */}
      {hasExternalAttachments && (
        <>
          {inventoryRole && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                zIndex: -1,
                cursor: 'pointer',
              }}
              data-testid={`top-role-attach-${win.roleId}`}
              onClick={() => openAttachmentModal('role', inventoryRole)}
              role="button"
              aria-label={`Role: ${kebabToTitle(inventoryRole.name)}. Click for details.`}
            >
              <TopRoleAttachment
                roles={[inventoryRole]}
                activeRoleName={win.roleId!}
                onSelectRole={() => {}}
              />
            </div>
          )}

          {inventoryMods.length > 0 && (
            <BottomModAttachment
              mods={inventoryMods.filter(Boolean) as MarketMod[]}
              onDetach={() => {}}
              onClickMod={(mod) => openAttachmentModal('mod', mod)}
              parentActive={isActive || isSelected || isHighlighted}
              roleColor={roleColor}
            />
          )}

          {/* RightFlowAttachment.tsx retired (chats→steps re-architecture, F0
              decision 4, 2026-07-10): flows no longer attach to a window —
              `inventoryFlow` is still computed above (it also feeds the
              window's "Remove flow" context-menu action and
              `hasExternalAttachments`) but this dedicated ribbon render is
              gone. This whole block is already unreachable in practice:
              `hasExternalAttachments` requires `isChatWindow`, hardcoded
              `false` since 'chat' windows were retired. */}
        </>
      )}

      {/* ── Window body (overflow: hidden for rounded corners) ────── */}
      <div
        ref={(node) => { (elRef as React.MutableRefObject<HTMLDivElement | null>).current = node; setDropRef(node); }}
        role="dialog"
        aria-label={win.title}
        className={`desktop-window ${shaking ? 'animate-shake' : ''}`}
        data-testid={`desktop-window-${windowId}`}
        data-window-id={windowId}
        data-active={isActive}
        data-highlighted={isHighlighted}
        data-selected={isSelected}
        data-state={win.state}
        data-interacting={interacting}
        data-agent-running={isAgentRunning}
        data-drop-active={dropActive}
        data-has-role={!!roleColor}
        style={roleColor ? { '--role-color': roleColor } as React.CSSProperties : undefined}
        onMouseDownCapture={() => win && focusWindow(windowId)}
        onContextMenu={handleContextMenu}
      >
        {/* Slim titlebar drag/maximize zone — only this element arms drag and double-click maximize */}
        <div
          className="window-titlebar"
          data-testid="window-titlebar"
          onPointerDownCapture={(e) => { try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* not all envs */ } }}
          onMouseDown={handleSurfaceMouseDown}
          onDoubleClick={handleSurfaceDoubleClick}
        >
          {projectName && (
            <span
              data-testid="window-project-name"
              style={{
                fontSize: 10, fontWeight: 500, color: theme.textGhost,
                fontFamily: theme.fontMono, letterSpacing: '0.03em',
                maxWidth: '40%', overflow: 'hidden', textOverflow: 'ellipsis',
                whiteSpace: 'nowrap', pointerEvents: 'none',
              }}
            >
              {projectName}
            </span>
          )}
        </div>

        {/* Pulse glow overlay for running agents */}
        {isAgentRunning && <span className="agent-glow" />}

        {/* Drop overlay — 0.2 opacity when compatible attachable is dragged over */}
        {dropActive && isChatWindow && (
          <div
            data-testid={`drop-overlay-${windowId}`}
            style={{
              position: 'absolute', inset: 0, zIndex: 999,
              background: 'rgba(167,139,250,0.20)', borderRadius: 'inherit',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <span style={{
              fontFamily: "'Space Grotesk', sans-serif", fontSize: 13,
              fontWeight: 600, color: '#A78BFA',
              background: 'rgba(0,0,0,0.6)', padding: '8px 16px', borderRadius: 8,
            }}>
              {getDropOverlayLabel()}
            </span>
          </div>
        )}

        {/* Resize handles — hidden when maximized; grid-snapped windows use grid-aware resize */}
        {win.state !== 'maximized' && RESIZE_DIRS.map(dir => (
          <div
            key={dir}
            className="resize-handle"
            data-dir={dir}
            onMouseDown={(e) => isGridSnapped ? onGridResizeStart(e, dir) : onInteractionStart(e, `resize-${dir}`)}
          />
        ))}

        <div className="window-surface-corner-controls">
          {isGridSnapped ? (
            <button
              type="button"
              className="window-grid-grip window-grid-eject"
              title="Eject from grid"
              aria-label="Eject from grid"
              onClick={(e) => {
                e.stopPropagation();
                removeWindowFromCell(win.gridId!, win.id);
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <LucideIcon name="Minimize2" size={12} />
            </button>
          ) : (
            <button
              type="button"
              className="window-grid-grip window-grid-drag"
              title="Drag into a grid cell"
              aria-label="Drag to grid"
              onMouseDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                const store = useDesktopStore.getState();
                store.setDraggingWindowId(windowId);

                const onUp = () => {
                  const s = useDesktopStore.getState();
                  if (s.draggingWindowId === windowId) {
                    s.setDraggingWindowId(null);
                  }
                  window.removeEventListener('pointerup', onUp);
                };
                window.addEventListener('pointerup', onUp);
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <LucideIcon name="GripVertical" size={12} />
            </button>
          )}
        </div>

        {/* Content area */}
        <div className="window-content">
          {children}
        </div>
      </div>

      {/* Attachment info modal — portalled to body to escape transform stacking context */}
      {attachmentModal && createPortal(
        <AttachmentInfoModal info={attachmentModal} onClose={() => setAttachmentModal(null)} />,
        document.body,
      )}

      {/* Context menu — portalled to body to escape transform stacking context */}
      {createPortal(
        <ContextMenu
          state={contextMenuState}
          providers={windowContextMenuProviders}
          onClose={closeContextMenu}
          backdropTestId="window-context-menu"
        />,
        document.body,
      )}
    </div>
  );

  return windowNode;
}
