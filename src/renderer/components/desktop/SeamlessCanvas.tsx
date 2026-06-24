/**
 * SeamlessCanvas.tsx — Renderer Desktop Surface Component
 *
 * Responsibility:
 * - Renders the SeamlessCanvas surface in the renderer layer.
 * - Encapsulates Desktop canvas/window composition within the renderer workspace.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/desktop/SeamlessCanvas.tsx — Main canvas with pan, zoom, multi-select, and drag-drop
import React, { useCallback, useRef, useState, useEffect, createContext } from 'react';
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core';
import { useDesktopStore } from '../../store/desktop-store';
import { DesktopWindow } from './DesktopWindow';
import { DesktopAttachable, AttachableOverlayCard } from './DesktopAttachable';
import { SnapGuides } from './SnapGuides';
import { WindowConnections } from './WindowConnections';
import { MentalGraphCanvas } from './mental/MentalGraphCanvas';
import { StepHarnessDock } from './mental/StepHarnessDock';
import { Dock } from './Dock';
import { TutorialEngine } from './tutorial/TutorialEngine';
import { MarketplaceApp } from '@/renderer/components/atoms/apps/MarketplaceApp';
import { AgenticChatApp } from '@/renderer/components/atoms/apps/AgenticChatApp';
import { WindowContextPlugin } from '@/renderer/components/atoms/plugins/WindowContextPlugin';
import { FileExplorerAppp } from '@/renderer/components/atoms/apps/FileExplorerAppp';
import { FileViewerApp } from '@/renderer/components/atoms/apps/FileViewerApp';
import { DiffViewerApp } from '@/renderer/components/atoms/apps/DiffViewerApp';
import { BacklogKanbanWidget } from '@/renderer/components/atoms/widgets/BacklogKanbanWidget';
import { PromptDevZoneApp } from '@/renderer/components/atoms/apps/PromptDevZoneApp';
import { WebPreviewApp } from '@/renderer/components/atoms/apps/WebPreviewApp';
import { NotificationCenterApp } from '@/renderer/components/atoms/apps/NotificationCenterApp';
import { SessionStatusDock } from '@/renderer/components/atoms/plugins/SessionStatusDock';
import { DesktopCanvasBg } from './DesktopCanvasBg';
import { BacklogCardModal } from './BacklogCardModal';
import { CanvasContextMenu } from './CanvasContextMenu';
import { DesktopGridComponent } from './DesktopGridComponent';
import type { MarketMod, MarketRole } from '@/types/market';

/** Canvas container dimensions — consumed by DesktopWindow for maximized viewport calc */
export const CanvasSizeContext = createContext<{ width: number; height: number }>({ width: 1200, height: 800 });

interface DraggedAtomData {
  type?: string;
  name?: string;
  mod?: MarketMod;
  role?: MarketRole;
}

function isStepNodeDropTarget(overId: string): boolean {
  return useDesktopStore.getState().mentalNodes.some((node) => node.id === overId && node.type === 'step');
}

function resolveDraggedMod(data: DraggedAtomData): MarketMod | null {
  if (data.type !== 'mod') return null;
  if (data.mod) return data.mod;
  if (!data.name) return null;
  return useDesktopStore.getState().marketInventory?.mods.find((mod) => mod.name === data.name) ?? null;
}

function resolveDraggedRole(data: DraggedAtomData): MarketRole | null {
  if (data.type !== 'role') return null;
  if (data.role) return data.role;
  if (!data.name) return null;
  return useDesktopStore.getState().marketInventory?.roles.find((role) => role.name === data.name) ?? null;
}

export function SeamlessCanvas() {
  const windows = useDesktopStore(s => s.windows);
  const attachables = useDesktopStore(s => s.attachables);
  const grids = useDesktopStore(s => s.grids);
  const canvasPan = useDesktopStore(s => s.canvasPan);
  const setCanvasPan = useDesktopStore(s => s.setCanvasPan);
  const canvasZoom = useDesktopStore(s => s.canvasZoom);
  const setCanvasZoom = useDesktopStore(s => s.setCanvasZoom);
  const setSelectedWindowIds = useDesktopStore(s => s.setSelectedWindowIds);
  const setActiveDragId = useDesktopStore(s => s.setActiveDragId);
  const activeDragId = useDesktopStore(s => s.activeDragId);
  const attachToWindow = useDesktopStore(s => s.attachToWindow);
  const moveAttachable = useDesktopStore(s => s.moveAttachable);
  const mentalMode = useDesktopStore(s => s.mentalMode);
  const addMentalNode = useDesktopStore(s => s.addMentalNode);
  const setMentalEditingNodeId = useDesktopStore(s => s.setMentalEditingNodeId);

  // Detect if any window is maximized — blocks pan/zoom/selection
  const hasMaximizedWindow = windows.some(w => w.state === 'maximized');

  // dnd-kit sensor: pointer with 5px activation distance to avoid accidental drags
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(event.active.id as string);
  }, [setActiveDragId]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over, delta } = event;
    setActiveDragId(null);

    const attachableId = active.id as string;

    if (over && isStepNodeDropTarget(String(over.id))) {
      const stepId = String(over.id);
      const data = (active.data.current ?? {}) as DraggedAtomData;
      const mod = resolveDraggedMod(data);
      if (mod) {
        useDesktopStore.getState().addModToStep(stepId, mod);
        return;
      }

      const role = resolveDraggedRole(data);
      if (role) {
        useDesktopStore.getState().addRoleToStep(stepId, role);
        return;
      }

      return;
    }

    // Dropped on a window drop zone?
    if (over && (over.id as string).startsWith('window-drop-')) {
      const windowId = over.data.current?.windowId as string;
      if (windowId) {
        attachToWindow(attachableId, windowId);
        return;
      }
    }

    // Otherwise, update position based on drag delta (account for canvas zoom)
    const att = useDesktopStore.getState().attachables.find(a => a.id === attachableId);
    if (att) {
      const zoom = useDesktopStore.getState().canvasZoom;
      moveAttachable(attachableId, {
        x: att.position.x + delta.x / zoom,
        y: att.position.y + delta.y / zoom,
      });
    }
  }, [setActiveDragId, attachToWindow, moveAttachable]);

  // Find the currently dragged attachable for the overlay
  const draggedAttachable = activeDragId
    ? attachables.find(a => a.id === activeDragId)
    : null;

  // Pan state (middle-click or left-click on empty canvas)
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0 });
  const panOrigin = useRef({ x: 0, y: 0 });
  const rafRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Rubber-band multi-select state
  const [selectRect, setSelectRect] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const selectRafRef = useRef(0);

  // Context menu state for right-click on empty canvas
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  // Smooth zoom transition toggle
  const [isZooming, setIsZooming] = useState(false);
  const zoomTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mentalDrawRect, setMentalDrawRect] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const mentalDrawStartRef = useRef<{ x: number; y: number } | null>(null);

  // Track canvas container size for maximized window viewport calculations.
  // ResizeObserver keeps this in sync when sidebar collapses/expands or window resizes.
  const [canvasSize, setCanvasSize] = useState({ width: 1200, height: 800 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const r = entries[0]?.contentRect;
      if (r) setCanvasSize({ width: r.width, height: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (hasMaximizedWindow) return; // Block pan/selection when maximized
    const target = e.target as HTMLElement;

    // CSS pointer-events is NOT inherited, so .react-flow (pointer-events:auto by default)
    // intercepts all empty-canvas clicks — the target won't be .desktop-canvas.
    // Guard against windows and React Flow nodes/handles instead of checking for specific classes.
    if (mentalMode !== 'off' && e.button === 0 &&
      !target.closest('.desktop-window') &&
      !target.closest('.react-flow__node') &&
      !target.closest('.react-flow__handle')) {
      useDesktopStore.setState({ activeWindowId: null });
      setSelectedWindowIds([]);
      const x = e.clientX;
      const y = e.clientY;
      mentalDrawStartRef.current = { x, y };
      setMentalDrawRect({ startX: x, startY: y, endX: x, endY: y });
      return;
    }

    // Middle mouse button (button 1) — always pan
    if (e.button === 1) {
      e.preventDefault();
      setIsPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY };
      panOrigin.current = { ...useDesktopStore.getState().canvasPan };
      return;
    }

    // Left click on empty canvas — start rubber-band selection or pan
    if (e.button === 0 && (target.classList.contains('desktop-canvas') || target.classList.contains('desktop-pan-layer'))) {
      useDesktopStore.setState({ activeWindowId: null });
      setSelectedWindowIds([]);

      const canvasRect = containerRef.current?.getBoundingClientRect();
      if (canvasRect) {
        const x = e.clientX;
        const y = e.clientY;
        setSelectRect({ startX: x, startY: y, endX: x, endY: y });
      }
    }
  }, [setSelectedWindowIds, hasMaximizedWindow, mentalMode]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (mentalDrawRect) {
      setMentalDrawRect(prev => prev ? { ...prev, endX: e.clientX, endY: e.clientY } : null);
      return;
    }

    // Pan handling
    if (isPanning) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const dx = e.clientX - panStart.current.x;
        const dy = e.clientY - panStart.current.y;
        setCanvasPan({
          x: panOrigin.current.x + dx,
          y: panOrigin.current.y + dy,
        });
      });
      return;
    }

    // Rubber-band selection
    if (selectRect) {
      cancelAnimationFrame(selectRafRef.current);
      selectRafRef.current = requestAnimationFrame(() => {
        setSelectRect(prev => prev ? { ...prev, endX: e.clientX, endY: e.clientY } : null);
      });
    }
  }, [isPanning, setCanvasPan, selectRect, mentalDrawRect]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (mentalDrawRect && mentalDrawStartRef.current) {
      const store = useDesktopStore.getState();
      const rect = containerRef.current?.getBoundingClientRect();
      const left = Math.min(mentalDrawRect.startX, mentalDrawRect.endX);
      const top = Math.min(mentalDrawRect.startY, mentalDrawRect.endY);
      const right = Math.max(mentalDrawRect.startX, mentalDrawRect.endX);
      const bottom = Math.max(mentalDrawRect.startY, mentalDrawRect.endY);
      const widthPx = right - left;
      const heightPx = bottom - top;

      if (widthPx > 6 && heightPx > 6 && rect) {
        // Convert screen rect to React Flow flow-space coordinates
        // by accounting for the current viewport (pan + zoom).
        const { canvasPan: pan, canvasZoom: zoom } = store;
        const flowX = (left - rect.left - pan.x) / zoom;
        const flowY = (top  - rect.top  - pan.y) / zoom;
        const shapeWidth  = Math.max(120, widthPx  / zoom);
        const shapeHeight = Math.max(70,  heightPx / zoom);
        const activeShape = store.mentalMode === 'off' ? 'square' : store.mentalMode;
        const nodeId = store.addMentalNode({
          position: { x: flowX, y: flowY },
          width: shapeWidth,
          height: shapeHeight,
          text: '',
          color: '#EDE9FE',
          shape: activeShape,
        });
        store.setMentalEditingNodeId(nodeId);
      }

      setMentalDrawRect(null);
      mentalDrawStartRef.current = null;
      return;
    }

    // End panning
    if (e.button === 1) {
      setIsPanning(false);
      cancelAnimationFrame(rafRef.current);
    }

    // End rubber-band selection — compute selected windows
    if (selectRect) {
      cancelAnimationFrame(selectRafRef.current);
      const { canvasPan: pan, canvasZoom: zoom, windows: allWins } = useDesktopStore.getState();
      const canvasRect = containerRef.current?.getBoundingClientRect();
      if (canvasRect) {
        // Convert screen-space rectangle to canvas-space
        const left = Math.min(selectRect.startX, selectRect.endX);
        const top = Math.min(selectRect.startY, selectRect.endY);
        const right = Math.max(selectRect.startX, selectRect.endX);
        const bottom = Math.max(selectRect.startY, selectRect.endY);

        // Only count as selection if drag was meaningful (>5px)
        if (right - left > 5 || bottom - top > 5) {
          const selected = allWins.filter(w => {
            if (w.state === 'minimized') return false;
            // Window position in screen-space
            const wx = canvasRect.left + pan.x + w.position.x * zoom;
            const wy = canvasRect.top + pan.y + w.position.y * zoom;
            const wr = wx + w.size.width * zoom;
            const wb = wy + w.size.height * zoom;
            // Check intersection
            return wx < right && wr > left && wy < bottom && wb > top;
          });
          setSelectedWindowIds(selected.map(w => w.id));
        }
      }
      setSelectRect(null);
    }
  }, [selectRect, setSelectedWindowIds, mentalDrawRect]);

  // Double-click on empty canvas in shapes mode creates a mental node at the click position.
  // Handled here (not in MentalGraphCanvas) because the React Flow root div has
  // pointer-events:auto by default and intercepts the event, so we rely on bubbling
  // up to this root container where we own the full canvas interaction.
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (mentalMode === 'off') return;
    const target = e.target as HTMLElement;
    if (
      target.closest('.desktop-window') ||
      target.closest('.react-flow__node') ||
      target.closest('.react-flow__handle')
    ) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Convert screen coords to React Flow's flow-space coordinates
    // by accounting for the current viewport (pan + zoom).
    const { canvasPan: pan, canvasZoom: zoom } = useDesktopStore.getState();
    const flowX = (e.clientX - rect.left - pan.x) / zoom;
    const flowY = (e.clientY - rect.top  - pan.y) / zoom;
    const nodeId = addMentalNode({
      position: { x: flowX, y: flowY },
      width: 220,
      height: 120,
      text: '',
      color: '#EDE9FE',
      shape: 'square',
    });
    setMentalEditingNodeId(nodeId);
  }, [mentalMode, addMentalNode, setMentalEditingNodeId]);

  // Prevent default middle-click scroll
  const handleAuxClick = useCallback((e: React.MouseEvent) => {
    if (e.button === 1) e.preventDefault();
  }, []);

  // Right-click on empty canvas — show context menu
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('desktop-canvas') || target.classList.contains('desktop-pan-layer')) {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY });
    }
  }, []);

  // Dispatch context menu actions to the desktop store
  const handleContextMenuAction = useCallback((action: string) => {
    const store = useDesktopStore.getState();
    const pan = store.canvasPan;
    const zoom = store.canvasZoom;
    const rect = containerRef.current?.getBoundingClientRect();
    const cx = rect && contextMenu ? (contextMenu.x - rect.left - pan.x) / zoom : 200;
    const cy = rect && contextMenu ? (contextMenu.y - rect.top - pan.y) / zoom : 200;

    switch (action) {
      case 'new-chat': {
        store.setShowProjectPicker(true, { x: cx, y: cy });
        break;
      }
      case 'file-explorer': {
        store.addWindow('file-explorer', { title: 'Files', position: { x: cx, y: cy } });
        break;
      }
      case 'backlog': {
        store.addWindow('backlog', { title: 'Backlog', position: { x: cx, y: cy } });
        break;
      }
      case 'mental-draw-toggle': {
        const current = store.mentalMode;
        store.setMentalMode(current === 'off' ? 'square' : 'off');
        break;
      }
      case 'mental-select-tool': {
        store.setMentalTool('select');
        break;
      }
      case 'mental-ramification-tool': {
        store.setMentalTool('ramification');
        break;
      }
      case 'marketplace': {
        store.setShowMarketplace(true);
        break;
      }
      case 'prompt-dev-zone': {
        store.addWindow('prompt-dev-zone', { title: 'Prompt Dev Zone', position: { x: cx, y: cy }, size: { width: 720, height: 520 } });
        break;
      }
      case 'arrange': {
        const wins = store.windows.filter(w => w.state !== 'minimized');
        const cols = Math.ceil(Math.sqrt(wins.length));
        wins.forEach((w, i) => {
          const col = i % cols;
          const row = Math.floor(i / cols);
          store._updateWindow(w.id, { position: { x: col * 520, y: row * 540 } });
        });
        break;
      }
      case 'stack': {
        const wins = store.windows.filter(w => w.state !== 'minimized');
        wins.forEach((w, i) => {
          store._updateWindow(w.id, { position: { x: 40 + i * 30, y: 40 + i * 30 } });
        });
        break;
      }
      case 'reset-view': {
        store.setCanvasPan({ x: 0, y: 0 });
        store.setCanvasZoom(1);
        break;
      }
      case 'grid': {
        store.addGrid({ position: { x: cx, y: cy } });
        break;
      }
    }
    setContextMenu(null);
  }, [contextMenu]);

  // Ctrl+wheel zoom with smooth transition
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (hasMaximizedWindow) return; // Block zoom when maximized
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const store = useDesktopStore.getState();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        const newZoom = Math.max(0.25, Math.min(3, store.canvasZoom + delta));

        // Enable smooth zoom transition
        setIsZooming(true);
        clearTimeout(zoomTimeoutRef.current ?? undefined);
        zoomTimeoutRef.current = setTimeout(() => setIsZooming(false), 200);

        setCanvasZoom(newZoom);
      }
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [setCanvasZoom, hasMaximizedWindow]);

  // Canvas doesn't need drag-over for marketplace items anymore — attachables handle their own DnD

  // Helper: render the correct app component inside a window
  const renderWindowContent = (win: typeof windows[number]) => {
    if (win.type === 'chat' && win.sessionId) return <AgenticChatApp windowId={win.id} sessionId={win.sessionId} />;
    if (win.type === 'plugin' && win.pluginId) return <WindowContextPlugin pluginId={win.pluginId} />;
    if (win.type === 'file-explorer') return <FileExplorerAppp windowId={win.id} />;
    if (win.type === 'file-viewer' && win.filePath) return <FileViewerApp windowId={win.id} filePath={win.filePath} />;
    if (win.type === 'diff-viewer') return <DiffViewerApp windowId={win.id} sessionId={win.sessionId} />;
    if (win.type === 'backlog') return <BacklogKanbanWidget windowId={win.id} />;
    if (win.type === 'prompt-dev-zone') return <PromptDevZoneApp windowId={win.id} />;
    // M1 — embedded preview webview; url is guaranteed present when type === 'web-preview'
    if (win.type === 'web-preview' && win.url) return <WebPreviewApp windowId={win.id} url={win.url} />;
    return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#525252', fontSize: 13 }}>Empty window</div>;
  };

  // Split windows: normal ones live inside the pan layer, maximized ones render at viewport level
  // hasMaximizedWindow still used for UI decisions (block selection, etc.)
  const selectionBox = selectRect ? {
    left: Math.min(selectRect.startX, selectRect.endX),
    top: Math.min(selectRect.startY, selectRect.endY),
    width: Math.abs(selectRect.endX - selectRect.startX),
    height: Math.abs(selectRect.endY - selectRect.startY),
  } : null;

  return (
    <CanvasSizeContext.Provider value={canvasSize}>
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div
        ref={containerRef}
        className="heliox-desktop desktop-canvas"
        role="application"
        aria-label="Desktop canvas"
        data-testid="seamless-desktop"
        data-panning={isPanning}
        data-mental-mode={mentalMode}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onDoubleClick={handleDoubleClick}
        onAuxClick={handleAuxClick}
        onContextMenu={handleContextMenu}
        style={{ cursor: mentalMode !== 'off' ? 'crosshair' : (isPanning ? 'grabbing' : undefined) }}
      >
        {/* Interactive shape-grid background */}
        <DesktopCanvasBg />

        {/* Pannable canvas layer — camera transform (translate + scale). */}
        <div
          className="desktop-pan-layer"
          data-zooming={isZooming || undefined}
          style={{
            transform: `translate(${canvasPan.x}px, ${canvasPan.y}px) scale(${canvasZoom})`,
            transformOrigin: '0 0',
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
          }}
        >
          {/* Connection arrows layer */}
          <WindowConnections />

          {/* Snap guide overlay */}
          <SnapGuides />

          {/* Desktop Attachables (role / mod / flow) */}
          {attachables.map(att => (
            <DesktopAttachable key={att.id} attachable={att} />
          ))}

          {/* Desktop Grids (top-level layout containers) */}
          {grids.map(grid => (
            <DesktopGridComponent key={grid.id} grid={grid} />
          ))}

          {/* All windows rendered in one map for stable keys (state preserved across minimize/maximize) */}
          {windows.map(win => (
            <DesktopWindow key={win.id} windowId={win.id}>
              {renderWindowContent(win)}
            </DesktopWindow>
          ))}
        </div>

        {/* Mental Graph canvas (React Flow surface — manages its own pan/zoom) */}
        <MentalGraphCanvas />

        {/* Rubber-band selection rectangle */}
        {!hasMaximizedWindow && selectionBox && selectionBox.width > 5 && (
          <div
            className="selection-rect"
            style={{
              position: 'fixed',
              left: selectionBox.left,
              top: selectionBox.top,
              width: selectionBox.width,
              height: selectionBox.height,
            }}
          />
        )}
        {mentalDrawRect && (
          <div
            className="selection-rect"
            data-testid="mental-draw-preview"
            style={{
              position: 'fixed',
              left: Math.min(mentalDrawRect.startX, mentalDrawRect.endX),
              top: Math.min(mentalDrawRect.startY, mentalDrawRect.endY),
              width: Math.abs(mentalDrawRect.endX - mentalDrawRect.startX),
              height: Math.abs(mentalDrawRect.endY - mentalDrawRect.startY),
              borderColor: 'rgba(167, 139, 250, 0.85)',
              background: 'rgba(167, 139, 250, 0.12)',
            }}
          />
        )}

        {/* Maximized windows handled via inverse-transform CSS in DesktopWindow (no portals) */}

        {/* Right-click context menu */}
        {contextMenu && (
          <CanvasContextMenu
            position={contextMenu}
            onAction={handleContextMenuAction}
            onClose={() => setContextMenu(null)}
          />
        )}

        {/* Zoom indicator (top-right of canvas) */}
        {Math.abs(canvasZoom - 1) > 0.001 && (
          <div
            className="canvas-zoom-indicator"
            data-testid="zoom-indicator"
            aria-live="polite"
            aria-label={`Canvas zoom ${Math.round(canvasZoom * 100)} percent`}
          >
            {Math.round(canvasZoom * 100)}%
          </div>
        )}

        {/* Dock (fixed, not affected by pan/zoom) — includes attachables */}
        <StepHarnessDock />
        <Dock />

        {/* Session status dock — vertical left side */}
        <SessionStatusDock />

        {/* Marketplace overlay */}
        <MarketplaceApp />

        {/* Notification center */}
        <NotificationCenterApp />

        {/* Canvas-level backlog card modal */}
        <BacklogCardModal />
      </div>

      {/* DragOverlay — renders OUTSIDE canvas at portal level, fixes z-index */}
      <DragOverlay dropAnimation={null}>
        {draggedAttachable ? <AttachableOverlayCard attachable={draggedAttachable} /> : null}
      </DragOverlay>

      <TutorialEngine />
    </DndContext>
    </CanvasSizeContext.Provider>
  );
}
