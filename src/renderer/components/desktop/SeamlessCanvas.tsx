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
import React, { useCallback, useMemo, useRef, useState, useEffect, createContext } from 'react';
import { DndContext, DragOverlay, PointerSensor, pointerWithin, useSensor, useSensors } from '@dnd-kit/core';
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core';
import { useDesktopStore } from '../../store/desktop-store';
import { engineStore } from '../../store/engine-bridge';
import { DesktopWindow } from './DesktopWindow';
import { DesktopAttachable, AttachableOverlayCard } from './DesktopAttachable';
import { SnapGuides } from './SnapGuides';
import { WindowConnections } from './WindowConnections';
import { MentalGraphCanvas } from './mental/MentalGraphCanvas';
import { Dock } from './Dock';
import { TutorialEngine } from './tutorial/TutorialEngine';
import { MarketplaceApp } from '@/renderer/components/atoms/apps/MarketplaceApp';
import { WindowContextPlugin } from '@/renderer/components/atoms/plugins/WindowContextPlugin';
import { FileExplorerAppp } from '@/renderer/components/atoms/apps/FileExplorerAppp';
import { FileViewerApp } from '@/renderer/components/atoms/apps/FileViewerApp';
import { DiffViewerApp } from '@/renderer/components/atoms/apps/DiffViewerApp';
import { BacklogBentoWidget } from '@/renderer/components/atoms/widgets/backlog/BacklogBentoWidget';
import { PromptDevZoneApp } from '@/renderer/components/atoms/apps/PromptDevZoneApp';
import { WebPreviewApp } from '@/renderer/components/atoms/apps/WebPreviewApp';
import { ArenaDashboardApp } from '@/renderer/components/atoms/apps/ArenaDashboardApp';
import { AgentSessionApp } from '@/renderer/components/atoms/apps/AgentSessionApp';
import { SessionListApp } from '@/renderer/components/atoms/apps/SessionListApp';
import { WidgetLauncher } from './hud/WidgetLauncher';
import { HudWidgetLayer } from './hud/HudWidgetLayer';
import { DesktopCanvasBg } from './DesktopCanvasBg';
import { BacklogCardModal } from '../atoms/widgets/backlog/BacklogCardModal';
import { LucideIcon } from './LucideIcon';
// Canvas context menu adopted onto @cmolg/daba-engine's unified ContextMenu
// (adoption plan #20, javadaba-web Core, Task 10 — this used to be its own
// CanvasContextMenu.tsx, deleted; the entries below are that file's
// CANVAS_ACTIONS ported verbatim as a declarative provider).
//
// Task 12 (adoption plan #20, Core, satellite): the camera (pan/zoom) and
// the pan-layer are ALSO adopted onto this package now — DabaCanvas +
// EngineProvider, wired to the singleton EngineStore in
// ../../store/engine-bridge.ts. Only middle-click pan and the pan-layer
// transform move to the motor (shouldHandleCanvasGesture below opts in
// button===1 only — Fluxor never had an Alt-drag pan gesture of its own);
// marquee selection, ctrl/cmd+wheel zoom, DottedBackground, and
// DesktopWindow's own drag/resize stay Fluxor's own domain code this wave
// (see engine-bridge.ts's doc-comment and the task's scout/decisions docs
// for the reasoning behind each cut). Per daba-engine commit 31416c4,
// middle-click pan is NOT restricted to gestures starting on empty canvas —
// it bubbles from anywhere (item/chrome included) up to DabaCanvas's root,
// matching Fluxor's own historic handleMouseDown (its `e.button === 1`
// branch never checked `target` either). Only marquee-start and the
// background context menu stay strictly background-gated.
import {
  BACKGROUND_TARGET_KIND,
  ContextMenu,
  DabaCanvas,
  EngineProvider,
  useContextMenuState,
  useDabaCanvasContext,
  type ContextMenuContext,
  type ContextMenuEntry,
  type ContextMenuProviders,
  type Point,
} from '@cmolg/daba-engine';
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

/**
 * Bridges the raw DOM node <DabaCanvas> mounts back out to SeamlessCanvas.
 * SeamlessCanvas still owns a couple of effects that need direct DOM access
 * (a ResizeObserver for CanvasSizeContext, and a NATIVE non-passive `wheel`
 * listener — React's synthetic onWheel is passive, so e.preventDefault()
 * inside it can't actually block the browser's own ctrl+wheel page-zoom;
 * see the effect below), but `rootProps` (used to carry the exact testid/
 * aria/data-* attributes of today's canvas container onto DabaCanvas's own
 * root — see the JSX below) cannot carry a `ref`: it is not part of
 * `HTMLAttributes`, and DabaCanvas does not forward one to its consumer.
 * This tiny always-null component instead reads the container through the
 * engine's own publicly-exported `useDabaCanvasContext()` hook (only
 * callable from inside `<DabaCanvas>`'s own subtree) and hands the node back
 * up via a plain callback + state, the same shape a callback ref produces.
 */
function CanvasContainerBridge({ onContainer }: { onContainer: (el: HTMLDivElement | null) => void }) {
  const { containerRef } = useDabaCanvasContext();
  useEffect(() => {
    onContainer(containerRef.current);
  }, [containerRef, onContainer]);
  return null;
}

export function SeamlessCanvas() {
  const windows = useDesktopStore(s => s.windows);
  const attachables = useDesktopStore(s => s.attachables);
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
  const addStepNode = useDesktopStore(s => s.addStepNode);
  const setSelectedMentalNodeIds = useDesktopStore(s => s.setSelectedMentalNodeIds);
  const updateSettings = useDesktopStore(s => s.updateSettings);
  const setPendingStepFocusId = useDesktopStore(s => s.setPendingStepFocusId);

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

  // Pan visual flag (middle-click). The pan MATH itself is now owned by the
  // engine's own pointerdown/pointermove/pointerup inside <DabaCanvas>
  // (gated to button===1 via shouldHandleBackgroundGesture below) — this
  // state only tracks whether a middle-click-drag is CURRENTLY active, for
  // the `data-panning`/cursor CSS contract the root still carries via
  // rootProps. Plain mouse events (onMouseDown/onMouseUp, attached below via
  // rootProps) fire ALONGSIDE the engine's own pointer events for the same
  // physical gesture without interfering with it — they're different native
  // event types.
  const [isPanning, setIsPanning] = useState(false);

  // Real DOM node <DabaCanvas> mounts, handed up by CanvasContainerBridge —
  // see that component's doc-comment for why a plain ref won't do.
  const [canvasEl, setCanvasEl] = useState<HTMLDivElement | null>(null);

  // Rubber-band multi-select state — stays Fluxor's own domain code this
  // wave (the engine's own marquee is suppressed via
  // shouldHandleBackgroundGesture below: selection remains domain territory
  // until a future task teaches the motor about it).
  const [selectRect, setSelectRect] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const selectRafRef = useRef(0);

  // Context menu state for right-click on empty canvas — owned by the motor
  // (@cmolg/daba-engine's useContextMenuState), a single provider keyed by
  // BACKGROUND_TARGET_KIND replaces the old CanvasContextMenu.tsx component.
  const { state: canvasContextMenuState, open: openCanvasContextMenu, close: closeCanvasContextMenu } = useContextMenuState();

  // Smooth zoom transition toggle
  const [isZooming, setIsZooming] = useState(false);
  const zoomTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mentalDrawRect, setMentalDrawRect] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const mentalDrawStartRef = useRef<{ x: number; y: number } | null>(null);

  // Track canvas container size for maximized window viewport calculations.
  // ResizeObserver keeps this in sync when sidebar collapses/expands or window resizes.
  const [canvasSize, setCanvasSize] = useState({ width: 1200, height: 800 });
  useEffect(() => {
    if (!canvasEl) return;
    const ro = new ResizeObserver(entries => {
      const r = entries[0]?.contentRect;
      if (r) setCanvasSize({ width: r.width, height: r.height });
    });
    ro.observe(canvasEl);
    return () => ro.disconnect();
  }, [canvasEl]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
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

    // Middle mouse button (button 1) — the engine's own pointerdown (see
    // shouldHandleBackgroundGesture below) does the actual panning; this
    // only flips the local isPanning flag (cursor/data-panning contract).
    if (e.button === 1) {
      e.preventDefault();
      setIsPanning(true);
      return;
    }

    // Left click on empty canvas — start rubber-band selection (domain-
    // owned; the engine's own marquee is suppressed for button 0, see
    // shouldHandleBackgroundGesture below).
    if (e.button === 0 && (target.classList.contains('desktop-canvas') || target.classList.contains('desktop-pan-layer'))) {
      useDesktopStore.setState({ activeWindowId: null });
      setSelectedWindowIds([]);

      const canvasRect = e.currentTarget.getBoundingClientRect();
      if (canvasRect) {
        const x = e.clientX;
        const y = e.clientY;
        setSelectRect({ startX: x, startY: y, endX: x, endY: y });
      }
    }
  }, [setSelectedWindowIds, hasMaximizedWindow, mentalMode]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (mentalDrawRect) {
      setMentalDrawRect(prev => prev ? { ...prev, endX: e.clientX, endY: e.clientY } : null);
      return;
    }

    // Rubber-band selection
    if (selectRect) {
      cancelAnimationFrame(selectRafRef.current);
      selectRafRef.current = requestAnimationFrame(() => {
        setSelectRect(prev => prev ? { ...prev, endX: e.clientX, endY: e.clientY } : null);
      });
    }
  }, [selectRect, mentalDrawRect]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (mentalDrawRect && mentalDrawStartRef.current) {
      const store = useDesktopStore.getState();
      const rect = e.currentTarget.getBoundingClientRect();
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
          color: '#BFDBFE',
          shape: activeShape,
        });
        store.setMentalEditingNodeId(nodeId);
      }

      setMentalDrawRect(null);
      mentalDrawStartRef.current = null;
      return;
    }

    // End panning (visual flag only — the engine already applied the pan)
    if (e.button === 1) {
      setIsPanning(false);
    }

    // End rubber-band selection — compute selected windows
    if (selectRect) {
      cancelAnimationFrame(selectRafRef.current);
      const { canvasPan: pan, canvasZoom: zoom, windows: allWins } = useDesktopStore.getState();
      const canvasRect = e.currentTarget.getBoundingClientRect();
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

  // Double-click on empty canvas.
  // Handled here (not in MentalGraphCanvas) because the React Flow root div has
  // pointer-events:auto by default and intercepts the event, so we rely on bubbling
  // up to this root container where we own the full canvas interaction.
  //
  // Two behaviors, gated on `mentalMode` (chats→steps re-architecture, F0
  // decision 1, 2026-07-10):
  // - `mentalMode !== 'off'` (actively authoring shapes): UNCHANGED — creates
  //   a mental (shape) node, exactly as before this task.
  // - `mentalMode === 'off'` (the default/read-only mode — previously a
  //   no-op here): NEW — the canonical "mono-step" gesture. Creates a step
  //   node centered on the click point, selects it, and force-opens the
  //   Inspector (mirrors StepNode.tsx's own "Inspect step" context-menu
  //   action) so it's immediately visible and ready to configure/launch via
  //   the existing per-step run. `setPendingStepFocusId` carries the "and
  //   please focus my input" signal forward for whichever component ends up
  //   owning the step's prompt textarea (Task H2, ola B1 — no such input
  //   exists on the canvas yet as of this task; see that field's doc
  //   comment in desktop-store.ts for the full consumer contract).
  const handleDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (
      target.closest('.desktop-window') ||
      target.closest('.react-flow__node') ||
      target.closest('.react-flow__handle')
    ) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect) return;
    // Convert screen coords to React Flow's flow-space coordinates
    // by accounting for the current viewport (pan + zoom).
    const { canvasPan: pan, canvasZoom: zoom } = useDesktopStore.getState();
    const flowX = (e.clientX - rect.left - pan.x) / zoom;
    const flowY = (e.clientY - rect.top  - pan.y) / zoom;

    if (mentalMode === 'off') {
      // Center the new step (300×190, matches DEFAULT_STEP_WIDTH/HEIGHT in
      // desktop-store.ts — same 150/95 half-offset Dock.tsx's 'new-step'
      // dock action already uses) on the double-click point.
      const stepId = addStepNode({ position: { x: flowX - 150, y: flowY - 95 } });
      setSelectedMentalNodeIds([stepId]);
      updateSettings({ showInspector: true });
      setPendingStepFocusId(stepId);
      return;
    }

    const nodeId = addMentalNode({
      position: { x: flowX, y: flowY },
      width: 220,
      height: 120,
      text: '',
      color: '#BFDBFE',
      shape: 'square',
    });
    setMentalEditingNodeId(nodeId);
  }, [mentalMode, addMentalNode, setMentalEditingNodeId, addStepNode, setSelectedMentalNodeIds, updateSettings, setPendingStepFocusId]);

  // Prevent default middle-click scroll
  const handleAuxClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button === 1) e.preventDefault();
  }, []);

  // Right-click on empty canvas — show context menu. worldPos is resolved
  // once at open time (same "same feel" tradeoff the motor's contract makes
  // for every context menu — see ContextMenuContext.worldPos) rather than
  // re-derived from live pan/zoom when an entry is later selected; the two
  // can only disagree if the canvas pans/zooms while the menu is open, which
  // never happens in practice (any interaction that would do that closes it).
  //
  // Routed through DabaCanvas's onBackgroundContextMenu (below) rather than
  // a plain onContextMenu in rootProps: the motor's own onContextMenu wins
  // over anything with that same prop name passed through rootProps (see
  // DabaCanvasProps' doc-comment), since it needs to own that native event
  // to compute worldPos itself and consult shouldHandleBackgroundGesture.
  // The math here is unchanged — engine.toWorld() uses the exact same
  // (client - rect - pan) / zoom formula this used to compute inline.
  const handleCanvasBackgroundContextMenu = useCallback((worldPos: Point, screenPos: Point) => {
    openCanvasContextMenu({ targetKind: BACKGROUND_TARGET_KIND, targetId: null, worldPos }, screenPos);
  }, [openCanvasContextMenu]);

  // Consulted by DabaCanvas before it would otherwise handle pan-start,
  // marquee-start, wheel-zoom, or the background context menu. Fluxor only
  // wants the engine for middle-click pan (NOT background-gated as of
  // daba-engine 31416c4 — see this file's header comment) — everything else
  // (marquee, wheel-zoom) stays domain code, and the background context menu
  // is routed through onBackgroundContextMenu above instead of being gated
  // here (matches the original handleContextMenu, which never checked
  // hasMaximizedWindow/mentalMode either).
  const shouldHandleCanvasGesture = useCallback((e: PointerEvent | WheelEvent | MouseEvent) => {
    if (e.type === 'wheel') return false; // Fluxor keeps its own ctrl/cmd+wheel zoom entirely (decision 1)
    if (e.type === 'contextmenu') return true; // routed to onBackgroundContextMenu above, no extra gating
    // pointerdown: only middle-click pan is delegated to the engine (mirrors
    // handleMouseDown's own `if (e.button === 1)` gate — mentalMode does NOT
    // block middle-click pan today, only hasMaximizedWindow does). Marquee
    // (button 0) always returns false here — see this callback's own
    // doc-comment above.
    return e.button === 1 && !hasMaximizedWindow;
  }, [hasMaximizedWindow]);

  // Ctrl+wheel zoom with smooth transition. Deliberately NOT DabaCanvas's own
  // wheel-zoom (suppressed for all WheelEvents via shouldHandleCanvasGesture
  // above, decision 1 of task12-decisiones.md): Fluxor's zoom is a fixed
  // ±0.1 step per tick, unanchored to the cursor, with a 200ms data-zooming
  // window that suppresses window-shell CSS transitions during the burst —
  // none of which is what the motor's own cursor-anchored, continuous-
  // sensitivity zoomAt() does. Still a NATIVE addEventListener (not React's
  // onWheel): React's synthetic wheel listener is passive, so
  // e.preventDefault() inside it cannot block the browser's own page-zoom.
  useEffect(() => {
    if (!canvasEl) return;
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
    canvasEl.addEventListener('wheel', handler, { passive: false });
    return () => canvasEl.removeEventListener('wheel', handler);
  }, [setCanvasZoom, hasMaximizedWindow, canvasEl]);

  // Canvas doesn't need drag-over for marketplace items anymore — attachables handle their own DnD

  // Helper: render the correct app component inside a window
  const renderWindowContent = (win: typeof windows[number]) => {
    // 'chat' branch retired alongside DesktopWindow['type'] (chats→steps
    // re-architecture, F0 decision 2, 2026-07-10) — no window can have this
    // type anymore (desktop-store's v19 migration tombstones any legacy
    // persisted 'chat' window before it ever reaches this switch), so this
    // render path is unreachable. This orphans AgenticChatApp (no remaining
    // call site imports it anywhere in the tree) — left for C2's dead-code
    // sweep to delete the component itself, per this task's territory.
    if (win.type === 'plugin' && win.pluginId) return <WindowContextPlugin pluginId={win.pluginId} />;
    if (win.type === 'file-explorer') return <FileExplorerAppp windowId={win.id} />;
    if (win.type === 'file-viewer' && win.filePath) return <FileViewerApp windowId={win.id} filePath={win.filePath} />;
    if (win.type === 'diff-viewer') return <DiffViewerApp windowId={win.id} sessionId={win.sessionId} />;
    if (win.type === 'backlog') return <BacklogBentoWidget windowId={win.id} />;
    if (win.type === 'prompt-dev-zone') {
      if (!import.meta.env.DEV) return null;
      return <PromptDevZoneApp windowId={win.id} />;
    }
    // M1 — embedded preview webview; url is guaranteed present when type === 'web-preview'
    if (win.type === 'web-preview' && win.url) return <WebPreviewApp windowId={win.id} url={win.url} />;
    // Arena leaderboard dashboard
    if (win.type === 'arena') return <ArenaDashboardApp windowId={win.id} />;
    // Cockpit F1 — a vendor CLI in a real terminal. The window carries its own
    // `agentSession` metadata; the app renders its "no session attached" state
    // if it somehow does not.
    if (win.type === 'agent-session') return <AgentSessionApp windowId={win.id} />;
    // Cockpit F4 — every open session on one line each. It reads the store,
    // so it needs nothing from the window but its own id.
    if (win.type === 'session-list') return <SessionListApp windowId={win.id} />;
    return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#525252', fontSize: 13 }}>Empty window</div>;
  };

  // Canvas context menu entries — ported verbatim from the deleted
  // CanvasContextMenu.tsx's CANVAS_ACTIONS + this file's own
  // handleContextMenuAction switch (adoption plan #20, Task 10). `cx`/`cy`
  // come from the ContextMenuContext.worldPos resolved at open time above.
  // NOTE: the pre-adoption switch also had unreachable `mental-select-tool`/
  // `mental-ramification-tool` cases with no menu entry ever dispatching them
  // (dead code even before this adoption) — intentionally not carried over.
  const canvasContextMenuProviders: ContextMenuProviders = useMemo(() => {
    const runAction = (action: string, cx: number, cy: number) => {
      const store = useDesktopStore.getState();
      switch (action) {
        case 'new-chat': {
          // chats→steps re-architecture (F0 decision 2, 2026-07-10): "New
          // Step" no longer opens a chat window — chat is not a window
          // surface anymore, and the one surviving chat (Auto-Chat) is a
          // position-independent fixed HUD panel, not something this
          // *spatially*-anchored menu can meaningfully spawn at (cx, cy) the
          // way its sibling actions here do. Replaced with the canonical
          // mono-step gesture — the same primitive handleDoubleClick below
          // uses for double-click-on-empty-canvas — anchored at the
          // right-click point instead.
          const stepId = store.addStepNode({ position: { x: cx - 150, y: cy - 95 } });
          store.setSelectedMentalNodeIds([stepId]);
          store.updateSettings({ showInspector: true });
          store.setPendingStepFocusId(stepId);
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
        case 'marketplace': {
          store.setShowMarketplace(true);
          break;
        }
        case 'prompt-dev-zone': {
          if (import.meta.env.DEV) {
            store.addWindow('prompt-dev-zone', { title: 'Prompt Dev Zone', position: { x: cx, y: cy }, size: { width: 720, height: 520 } });
          }
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
        case 'cockpit': {
          // Deliberately NOT anchored at (cx, cy) like its siblings above: a
          // preset is about the whole desktop, and starting it wherever the
          // right-click happened would put half the arrangement off-screen.
          store.arrangeCockpit();
          break;
        }
        case 'session-list': {
          const existing = store.windows.find((w) => w.type === 'session-list');
          if (existing) store.navigateToWindow(existing.id);
          else store.addWindow('session-list', { title: 'Sessions', position: { x: cx, y: cy }, size: { width: 520, height: 220 } });
          break;
        }
        case 'reset-view': {
          store.setCanvasPan({ x: 0, y: 0 });
          store.setCanvasZoom(1);
          break;
        }
      }
    };

    const makeEntry = (id: string, label: string, icon: string, dividerAfter?: boolean): ContextMenuEntry => ({
      id,
      label,
      testId: `canvas-ctx-${id}`,
      icon: <LucideIcon name={icon} size={14} style={{ opacity: 0.6, flexShrink: 0 }} />,
      dividerAfter,
      onSelect: (ctx: ContextMenuContext) => runAction(id, ctx.worldPos.x, ctx.worldPos.y),
    });

    return {
      [BACKGROUND_TARGET_KIND]: () => [
        makeEntry('new-chat', 'New Step', 'SquarePlus'),
        makeEntry('file-explorer', 'New File Explorer', 'FileText'),
        makeEntry('backlog', 'New Backlog Board', 'KanbanSquare'),
        makeEntry('mental-draw-toggle', 'Enable Mental Authoring', 'PenTool', true),
        makeEntry('marketplace', 'Open Marketplace', 'Store', true),
        ...(import.meta.env.DEV ? [makeEntry('prompt-dev-zone', 'Prompt Dev Zone', 'FlaskConical', true)] : []),
        makeEntry('arrange', 'Arrange Components', 'Grid2x2'),
        makeEntry('stack', 'Stack Components', 'Layers'),
        makeEntry('cockpit', 'Arrange as Cockpit', 'LayoutGrid'),
        makeEntry('session-list', 'Open Session List', 'ListChecks'),
        makeEntry('reset-view', 'Reset Canvas View', 'Maximize2'),
      ],
    };
  }, []);

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
    {/* collisionDetection=pointerWithin (not the dnd-kit default rectIntersection):
        rectIntersection ranks droppables by raw overlap AREA between the dragged
        card's bounding box and each candidate's rect. Pipeline steps commonly sit
        adjacent to each other, and a user rarely grabs a Role/Mod card from its
        exact center — with an off-center grab, the card's translated rect can
        overlap a NEIGHBORING step more than the one the cursor is actually over,
        so rectIntersection silently attaches to (or fails to attach to) the wrong
        step. pointerWithin instead requires the pointer's own coordinate to fall
        inside the target's rect, matching what the user visually did. See
        StepNode.dnd.test.tsx's "precision regression" cases for a reproduction. */}
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <EngineProvider store={engineStore}>
        <DabaCanvas
          className="fluxor-desktop desktop-canvas"
          style={{ cursor: mentalMode !== 'off' ? 'crosshair' : (isPanning ? 'grabbing' : undefined) }}
          rootProps={{
            role: 'application',
            'aria-label': 'Desktop canvas',
            'data-testid': 'seamless-desktop',
            'data-panning': isPanning,
            'data-mental-mode': mentalMode,
            // panLayerClassName can only add a CLASS to the motor's own
            // pan-layer div, not attributes (see DabaCanvasProps — rootProps
            // is root-only) — data-zooming moves up to the root instead of
            // the pan-layer, and index.css's `.desktop-pan-layer[data-
            // zooming]` compound selector became `.desktop-canvas[data-
            // zooming] .desktop-pan-layer` (descendant) to match. This also
            // makes `[data-zooming] .desktop-window-shell{transition:none}`
            // (index.css) reachable — window shells are descendants of this
            // root too — restoring its original intent (suppress the
            // 300ms position/size CSS transition during a zoom burst).
            'data-zooming': isZooming || undefined,
            onMouseDown: handleMouseDown,
            onMouseMove: handleMouseMove,
            onMouseUp: handleMouseUp,
            onDoubleClick: handleDoubleClick,
            onAuxClick: handleAuxClick,
          }}
          shouldHandleBackgroundGesture={shouldHandleCanvasGesture}
          onBackgroundContextMenu={handleCanvasBackgroundContextMenu}
          panLayerClassName="desktop-pan-layer"
          overlay={
            <>
              {/* Bridges the real container DOM node back to SeamlessCanvas
                  (ResizeObserver + native wheel listener above). Renders
                  nothing. */}
              <CanvasContainerBridge onContainer={setCanvasEl} />

              {/* Interactive shape-grid background. z-index -1: this used to
                  be a sibling BEFORE the pan-layer in the DOM (paint order
                  alone kept it behind), but DabaCanvas's overlay slot always
                  renders AFTER the pan-layer — daba-pan-layer carries no
                  z-index of its own, so without an explicit negative value
                  here this would now paint IN FRONT of window-connections/
                  attachables instead of behind them. See this task's final
                  report for the full stacking-order analysis. */}
              <DesktopCanvasBg />

              {/* Mental Graph canvas (React Flow surface — manages its own pan/zoom).
                  Windows and SnapGuides are passed as viewportChildren so they render
                  inside React Flow's transformed viewport (.react-flow__viewport) at
                  the same coordinate space as mental nodes. The React Flow viewport
                  applies its OWN translate+scale (a SEPARATE, synced transform — NOT
                  the engine's pan-layer; see this task's final report's dentro/fuera
                  map), driven by the canvasPan/canvasZoom mirror, so window positions
                  align. Deliberately NOT children of <DabaCanvas> — nesting an
                  already-doubly-transformed surface inside the engine's OWN pan-layer
                  would transform it twice. */}
              <MentalGraphCanvas
                viewportChildren={
                  <>
                    {windows.map(win => (
                      <DesktopWindow key={win.id} windowId={win.id}>
                        {renderWindowContent(win)}
                      </DesktopWindow>
                    ))}
                    <SnapGuides />
                  </>
                }
              />

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
                    borderColor: 'rgba(77, 168, 255, 0.85)',
                    background: 'rgba(77, 168, 255, 0.12)',
                  }}
                />
              )}

              {/* Maximized windows handled via inverse-transform CSS in DesktopWindow (no portals) */}

              {/* Right-click context menu */}
              <ContextMenu
                state={canvasContextMenuState}
                providers={canvasContextMenuProviders}
                onClose={closeCanvasContextMenu}
                backdropTestId="canvas-context-menu-backdrop"
                menuTestId="canvas-context-menu"
              />

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
              <Dock />

              {/* Marketplace overlay */}
              <MarketplaceApp />

              {/* HUD widget layer — screen-fixed, sits above canvas, below modals */}
              <HudWidgetLayer />

              {/* Widget launcher (replaces standalone notification bell) */}
              <WidgetLauncher />

              {/* Canvas-level backlog card modal */}
              <BacklogCardModal />
            </>
          }
        >
          {/* Connection arrows layer */}
          <WindowConnections />

          {/* Desktop Attachables (role / mod / flow) */}
          {attachables.map(att => (
            <DesktopAttachable key={att.id} attachable={att} />
          ))}
        </DabaCanvas>
      </EngineProvider>

      {/* DragOverlay — renders OUTSIDE canvas at portal level, fixes z-index */}
      <DragOverlay dropAnimation={null}>
        {draggedAttachable ? <AttachableOverlayCard attachable={draggedAttachable} /> : null}
      </DragOverlay>

      <TutorialEngine />
    </DndContext>
    </CanvasSizeContext.Provider>
  );
}
