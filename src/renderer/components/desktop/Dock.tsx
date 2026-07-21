/**
 * Dock.tsx — Renderer Desktop Surface Component
 *
 * Responsibility:
 * - Renders the Dock surface in the renderer layer as a composition over
 *   @javadaba/daba-engine's <Dock>: Fluxor supplies the item specs (icons,
 *   labels, click / drag-out behavior, the mental-mode popover content) via
 *   `DockItemSpec[]`, plus the attachables strip and Settings button as
 *   `children`. The engine owns the item button chrome, drag-out gesture
 *   detection + ghost, tooltip visibility rules, and popover open/close
 *   mechanics for the items it renders.
 * - Encapsulates Desktop canvas/window composition within the renderer workspace.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
import React, { useCallback, useRef, useState, useMemo } from 'react';
import { Dock as DabaDock, type DockItemSpec, type DockPopoverControls } from '@javadaba/daba-engine';
import { useDesktopStore } from '../../store/desktop-store';
import { useFluxorStore } from '../../store';
import { LucideIcon } from './LucideIcon';
import type { AttachableType, MentalMode, MentalShape, MentalTool } from '@/types/desktop';

const ATTACHABLE_TYPE_COLORS: Record<string, string> = {
  flows: '#A78BFA',
  roles: '#E87040',
  modifiers: '#4285F4',
};

const ATTACHABLE_VISIBLE_COUNT = 3;

/**
 * `.fluxor-dock`'s live bounding box. The engine's <Dock> owns its root DOM
 * node and doesn't forward a ref (no `forwardRef` in its contract), so the
 * attachables strip below — unchanged since before the engine adoption —
 * reads the dock's rect straight off the DOM via this stable class instead
 * of the React ref it used to close over.
 */
function getDockRect(): DOMRect | undefined {
  return document.querySelector('.fluxor-dock')?.getBoundingClientRect();
}

export function Dock() {
  const dockItems = useDesktopStore(s => s.dockItems);
  const addWindow = useDesktopStore(s => s.addWindow);
  const setShowMarketplace = useDesktopStore(s => s.setShowMarketplace);
  const installedPlugins = useDesktopStore(s => s.installedPlugins);
  const windows = useDesktopStore(s => s.windows);
  const projectPath = useFluxorStore(s => s.projectPath);
  const availablePlugins = useDesktopStore(s => s.availablePlugins);
  const deployPlugin = useDesktopStore(s => s.deployPlugin);
  const spawnAttachable = useDesktopStore(s => s.spawnAttachable);
  const canvasPan = useDesktopStore(s => s.canvasPan);
  const canvasZoom = useDesktopStore(s => s.canvasZoom);
  const navigateToWindow = useDesktopStore(s => s.navigateToWindow);
  const mentalMode = useDesktopStore(s => s.mentalMode);
  const setMentalMode = useDesktopStore(s => s.setMentalMode);
  const setMentalTool = useDesktopStore(s => s.setMentalTool);
  const setHudWidgetVisible = useDesktopStore(s => s.setHudWidgetVisible);

  // Local hover state — kept only for the attachables strip + Settings
  // button below (plain hand-rolled buttons in `children`). The dockItems-
  // derived items no longer need it: the engine tracks its own hover state
  // internally and drives `renderTooltip` from it.
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [attachableOffset, setAttachableOffset] = useState(0);
  const [attachDragItem, setAttachDragItem] = useState<{ id: string; category: string; name: string } | null>(null);
  const [attachDragPos, setAttachDragPos] = useState({ x: 0, y: 0 });
  const [attachDraggedOut, setAttachDraggedOut] = useState(false);
  const startPos = useRef({ x: 0, y: 0 });

  const projectName = projectPath?.split('/').pop() ?? 'project';

  // Attachable items (roles, mods, flows, steps)
  const attachableItems = useMemo(() =>
    availablePlugins.filter(p =>
      p.category === 'roles' || p.category === 'modifiers' || p.category === 'flows' || p.category === 'steps'
    ), [availablePlugins]);

  // Infinite wrap-around scroll
  const visibleAttachables = useMemo(() => {
    if (attachableItems.length === 0) return [];
    const count = Math.min(ATTACHABLE_VISIBLE_COUNT, attachableItems.length);
    const result: typeof attachableItems = [];
    for (let i = 0; i < count; i++) {
      const idx = (attachableOffset + i) % attachableItems.length;
      result.push(attachableItems[idx]);
    }
    return result;
  }, [attachableItems, attachableOffset]);

  const scrollAttachLeft = useCallback(() => {
    if (attachableItems.length === 0) return;
    setAttachableOffset(o => (o - ATTACHABLE_VISIBLE_COUNT + attachableItems.length) % attachableItems.length);
  }, [attachableItems.length]);

  const scrollAttachRight = useCallback(() => {
    if (attachableItems.length === 0) return;
    setAttachableOffset(o => (o + ATTACHABLE_VISIBLE_COUNT) % attachableItems.length);
  }, [attachableItems.length]);

  // Reveal + focus the single Auto-Chat HUD panel (chats→steps
  // re-architecture, F0 decision 2, 2026-07-10). Replaces the old
  // "pick a child project → spawn a scoped chat window" flow — the Auto-Chat
  // panel is a single, fixed HUD surface (not per-project, not a window), so
  // there is nothing left to pick. `requestAnimationFrame` lets the widget
  // mount (if it wasn't already visible) before the focus event fires; the
  // panel's own mount-time effect covers that same case too, so this is
  // belt-and-suspenders for the "already open, clicked again" case.
  const revealAutoChat = useCallback(() => {
    setHudWidgetVisible('auto-chat', true);
    requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('fluxor:focus-auto-chat')));
  }, [setHudWidgetVisible]);

  // ─── Item select (click) — unchanged 1:1 from the pre-engine handleClick,
  // just invoked via each item's `onSelect` instead of a DOM onClick. ─────
  const handleClick = (item: typeof dockItems[0]) => {
    if (item.type === 'action') {
      switch (item.action) {
        case 'new-chat': {
          revealAutoChat();
          break;
        }
        case 'file-explorer': {
          // Focus existing file-explorer or create new one
          const existing = useDesktopStore.getState().windows.find(w => w.type === 'file-explorer');
          if (existing) {
            navigateToWindow(existing.id);
          } else {
            const winId = addWindow('file-explorer', {
              title: projectName,
              iconName: 'FileText',
              size: { width: 400, height: 560 },
            });
            requestAnimationFrame(() => navigateToWindow(winId));
          }
          break;
        }
        case 'marketplace':
          setShowMarketplace(true);
          break;
        case 'backlog': {
          const existingBacklog = useDesktopStore.getState().windows.find(w => w.type === 'backlog');
          if (existingBacklog) {
            navigateToWindow(existingBacklog.id);
          } else {
            const winId = addWindow('backlog', {
              title: 'Backlog',
              iconName: 'KanbanSquare',
              size: { width: 960, height: 540 },
            });
            requestAnimationFrame(() => navigateToWindow(winId));
          }
          break;
        }
        case 'mental-draw-toggle': {
          const current = useDesktopStore.getState().mentalMode;
          setMentalMode(current === 'off' ? 'square' : 'off');
          break;
        }
        case 'prompt-dev-zone': {
          const existing = useDesktopStore.getState().windows.find(w => w.type === 'prompt-dev-zone');
          if (existing) {
            navigateToWindow(existing.id);
          } else {
            const winId = addWindow('prompt-dev-zone', {
              title: 'Prompt Dev Zone',
              iconName: 'FlaskConical',
              size: { width: 720, height: 520 },
            });
            requestAnimationFrame(() => navigateToWindow(winId));
          }
          break;
        }
        case 'new-step': {
          // Create a single step node at the current viewport center.
          const state = useDesktopStore.getState();
          const pan = state.canvasPan;
          const zoom = state.canvasZoom;
          const vpW = typeof window !== 'undefined' ? window.innerWidth : 1200;
          const vpH = typeof window !== 'undefined' ? window.innerHeight : 800;
          const cx = (vpW / 2 - pan.x) / zoom;
          const cy = (vpH / 2 - pan.y) / zoom;
          state.addStepNode({ position: { x: cx - 150, y: cy - 95 } });
          break;
        }
        case 'new-flow': {
          // Create a flow scaffold: an initiator step + one next step, wired
          // with a directed FlowEdge (source right handle → target left handle).
          // The initiator's isRoot badge (Play icon in StepNode) marks it as
          // the flow entry point.
          const state = useDesktopStore.getState();
          const pan = state.canvasPan;
          const zoom = state.canvasZoom;
          const vpW = typeof window !== 'undefined' ? window.innerWidth : 1200;
          const vpH = typeof window !== 'undefined' ? window.innerHeight : 800;
          const cx = (vpW / 2 - pan.x) / zoom;
          const cy = (vpH / 2 - pan.y) / zoom;
          const initiatorId = state.addStepNode({
            position: { x: cx - 180, y: cy },
            title: 'Flow Start',
            stepType: 'llm_call',
          });
          const nextId = state.addStepNode({
            position: { x: cx + 180, y: cy },
            title: 'Next Step',
            stepType: 'llm_call',
          });
          state.addMentalEdge(initiatorId, nextId, 'link', 'right', 'left');
          break;
        }
      }
    } else if (item.type === 'plugin' && item.pluginId) {
      const plugin = installedPlugins.find(p => p.id === item.pluginId);
      if (!plugin) return;
      if (plugin.category === 'tools') {
        const existing = windows.find(w => w.pluginId === item.pluginId);
        if (existing) {
          navigateToWindow(existing.id);
          return;
        }
      }
      const winId = addWindow('plugin', {
        title: plugin.name,
        iconName: plugin.iconName,
        pluginId: plugin.id,
      });
      requestAnimationFrame(() => navigateToWindow(winId));
    }
  };

  // ─── Drag-out (release above the dock) — unchanged 1:1 from the
  // pre-engine onUp switch, invoked via the engine's onDragOut. ──────────
  const handleDragOut = (spec: DockItemSpec, screenPos: { x: number; y: number }) => {
    const item = dockItems.find(d => d.id === spec.id);
    if (!item) return;
    const dropX = screenPos.x - 240;
    const dropY = screenPos.y - 30;
    if (item.type === 'action' && item.action === 'new-chat') {
      // Auto-Chat is a fixed HUD panel, not a spawnable window — the
      // drop position is intentionally not honored (see revealAutoChat).
      revealAutoChat();
    } else if (item.type === 'action' && item.action === 'file-explorer') {
      addWindow('file-explorer', {
        title: projectName,
        iconName: 'FileText',
        size: { width: 400, height: 560 },
        position: { x: dropX, y: dropY },
      });
    } else if (item.type === 'action' && item.action === 'backlog') {
      addWindow('backlog', {
        title: 'Backlog',
        iconName: 'KanbanSquare',
        size: { width: 720, height: 480 },
        position: { x: dropX, y: dropY },
      });
    } else if (item.type === 'plugin' && item.pluginId) {
      const plugin = installedPlugins.find(p => p.id === item.pluginId);
      if (plugin) {
        addWindow('plugin', {
          title: plugin.name,
          iconName: plugin.iconName,
          pluginId: plugin.id,
          position: { x: dropX, y: dropY },
        });
      }
    }
    // marketplace / prompt-dev-zone / new-step / new-flow: no-op on drag-out
    // (dragOutSpawn is still on for them, matching today — they just don't
    // spawn anything when released above the dock).
  };

  // ─── Main dock item specs, handed to the engine's <Dock> ─────────────
  const items: DockItemSpec[] = dockItems.map(item => {
    const isMentalToggle = item.type === 'action' && item.action === 'mental-draw-toggle';
    const isPluginOpen = item.type === 'plugin' && windows.some(w => w.pluginId === item.pluginId);
    const isToggleActive = isMentalToggle && mentalMode !== 'off';
    const showDot = isPluginOpen || isToggleActive;

    const spec: DockItemSpec = {
      id: item.id,
      label: item.label,
      testId: item.action ? `dock-${item.action}` : `dock-plugin-${item.pluginId}`,
      className: `dock-item${isToggleActive ? ' dock-item-active' : ''}`,
      icon: (
        <>
          <LucideIcon name={item.iconName} size={20} className="dock-icon" />
          {showDot && <div className="dock-active-dot" aria-hidden="true" />}
        </>
      ),
      onSelect: () => handleClick(item),
      ariaCurrent: isPluginOpen ? true : undefined,
      // Every item is drag-out-spawnable except the mental toggle (today it
      // isn't draggable at all — see handleDragOut for what each spawns).
      dragOutSpawn: !isMentalToggle,
    };

    if (isMentalToggle) {
      // Sole source of aria-pressed, exactly as before.
      spec.isActive = () => mentalMode !== 'off';
      spec.popoverOpenOn = 'hover';
      spec.popoverClassName = 'dock-mental-menu';
      spec.popoverAriaLabel = 'Mental tools';
      spec.popover = (controls: DockPopoverControls) => {
        const handleMentalModeSelect = (mode: MentalMode) => {
          setMentalMode(mode);
          controls.close();
        };
        // No tool picker in the popover UI (legacy from before Select/
        // Ramification were removed) — kept unused, same as before the
        // engine adoption, for parity with the store's setMentalTool surface.
        const handleMentalToolSelect = (tool: MentalTool) => {
          setMentalTool(tool);
          controls.close();
        };
        return (
          <div className="dock-mental-mode-options" role="none">
            {(['square'] as const).map((shape) => {
              const iconMap: Record<MentalShape, string> = {
                square: 'Square',
                circle: 'Circle',
                triangle: 'Triangle',
              };
              const labelMap: Record<MentalShape, string> = {
                square: 'Square',
                circle: 'Circle',
                triangle: 'Triangle',
              };
              return (
                <div
                  key={shape}
                  className={`dock-mental-icon-option${mentalMode === shape ? ' active' : ''}`}
                  role="menuitemradio"
                  aria-checked={mentalMode === shape}
                  aria-label={`${labelMap[shape]} shape`}
                  tabIndex={0}
                  onClick={() => handleMentalModeSelect(shape)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleMentalModeSelect(shape);
                    }
                  }}
                >
                  <LucideIcon name={iconMap[shape]} size={20} className="dock-icon" />
                  <div className="dock-tooltip dock-mental-option-tooltip" role="tooltip">{labelMap[shape]}</div>
                </div>
              );
            })}
          </div>
        );
      };
    }

    return spec;
  });

  // ─── Attachable drag-to-desktop (unchanged) ────────────────────────
  const onAttachDragStart = useCallback((e: React.MouseEvent, plugin: { id: string; category: string; name: string; iconName: string }) => {
    e.preventDefault();
    const attachStartPos = { x: e.clientX, y: e.clientY };
    // Ghost position below is `startPos.current + attachDragPos - 22` (an
    // absolute-position + delta split, mirroring attachDragPos's own
    // `ev.clientX - attachStartPos.x` delta math) — startPos.current must be
    // seeded with the drag's origin here, or it stays the useRef's {0,0}
    // initial value and the ghost renders pinned near the screen's top-left
    // corner (only the delta moves it) instead of tracking the cursor.
    startPos.current = attachStartPos;
    setAttachDragItem(plugin);
    setAttachDragPos({ x: 0, y: 0 });
    setAttachDraggedOut(false);

    const onMove = (ev: MouseEvent) => {
      setAttachDragPos({ x: ev.clientX - attachStartPos.x, y: ev.clientY - attachStartPos.y });
      const dockRect = getDockRect();
      if (dockRect) setAttachDraggedOut(ev.clientY < dockRect.top - 20);
    };

    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);

      const dockRect = getDockRect();
      const isOut = dockRect ? ev.clientY < dockRect.top - 20 : false;

      if (isOut) {
        // Map plugin category → attachable type
        const typeMap: Record<string, AttachableType> = { roles: 'role', modifiers: 'mod', flows: 'flow', steps: 'step' };
        const attType = typeMap[plugin.category];
        if (attType) {
          // Convert screen coords → canvas coords (accounting for pan/zoom)
          const zoom = canvasZoom;
          const pan = canvasPan;
          const canvasX = (ev.clientX - pan.x) / zoom;
          const canvasY = (ev.clientY - pan.y) / zoom;
          // Extract inventory name from plugin id
          let inventoryName = plugin.id;
          if (inventoryName.startsWith('inv-role-')) inventoryName = inventoryName.replace('inv-role-', '');
          else if (inventoryName.startsWith('inv-mod-')) inventoryName = inventoryName.replace('inv-mod-', '');
          else if (inventoryName.startsWith('flow-')) inventoryName = inventoryName.replace('flow-', '');
          spawnAttachable(attType, inventoryName, { x: canvasX - 110, y: canvasY - 30 });
        }
      }

      setAttachDragItem(null);
      setAttachDragPos({ x: 0, y: 0 });
      setAttachDraggedOut(false);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [spawnAttachable, canvasPan, canvasZoom]);

  return (
    <>
      <DabaDock
        items={items}
        onDragOut={handleDragOut}
        className="fluxor-dock"
        testId="dock"
        ariaLabel="Application dock"
        renderTooltip={(item) => <div className="dock-tooltip" role="tooltip">{item.label}</div>}
        dragOutTrigger={({ clientY, dockRect }) => clientY < dockRect.top - 20}
      >
        {/* Pipe separator + attachable items (macOS-style, infinite scroll) */}
        {attachableItems.length > 0 && (
          <div className="dock-attachables-section" data-testid="attachables-dock">
            <div className="dock-separator" aria-hidden="true" />

            <button
              className="dock-item dock-attach-nav"
              aria-label="Scroll attachables left"
              onClick={scrollAttachLeft}
              data-testid="attachable-scroll-left"
            >
              <LucideIcon name="ChevronLeft" size={14} />
            </button>

            {visibleAttachables.map(item => {
              const borderColor = ATTACHABLE_TYPE_COLORS[item.category] ?? '#888';
              const isAttachDragging = attachDragItem?.id === item.id;
              return (
                <button
                  key={`${item.id}-${attachableOffset}`}
                  className="dock-item dock-attachable-item"
                  style={{
                    borderColor, borderWidth: 2, borderStyle: 'solid',
                    opacity: isAttachDragging && attachDraggedOut ? 0.3 : 1,
                    transform: isAttachDragging && !attachDraggedOut ? `translate(${attachDragPos.x}px, ${attachDragPos.y}px)` : undefined,
                  }}
                  aria-label={item.name}
                  onClick={() => deployPlugin(item.id)}
                  onMouseDown={(e) => onAttachDragStart(e, item)}
                  onMouseEnter={() => setHoveredItem(`attach-${item.id}`)}
                  onMouseLeave={() => setHoveredItem(null)}
                  data-testid={`attachable-dock-${item.id}`}
                >
                  <LucideIcon name={item.iconName} size={18} />
                  {hoveredItem === `attach-${item.id}` && !isAttachDragging && (
                    <div className="dock-tooltip" role="tooltip">{item.name}</div>
                  )}
                </button>
              );
            })}

            <button
              className="dock-item dock-attach-nav"
              aria-label="Scroll attachables right"
              onClick={scrollAttachRight}
              data-testid="attachable-scroll-right"
            >
              <LucideIcon name="ChevronRight" size={14} />
            </button>
          </div>
        )}

        {/* Settings gear */}
        <div className="dock-separator" aria-hidden="true" />
        <button
          className="dock-item"
          aria-label="Settings"
          data-testid="dock-settings"
          onClick={() => useFluxorStore.getState().setShowSettings(true)}
          onMouseEnter={() => setHoveredItem('settings')}
          onMouseLeave={() => setHoveredItem(null)}
        >
          <LucideIcon name="Settings" size={18} />
          {hoveredItem === 'settings' && (
            <div className="dock-tooltip" role="tooltip">Settings</div>
          )}
        </button>
      </DabaDock>

      {/* Attachable drag ghost — own ghost, unchanged. The engine's ghost
          (.daba-dock__ghost) only covers `items`, not this `children` strip. */}
      {attachDragItem && attachDraggedOut && (
        <div
          className="dock-drag-ghost"
          style={{
            position: 'fixed',
            left: startPos.current.x + attachDragPos.x - 22,
            top: startPos.current.y + attachDragPos.y - 22,
            pointerEvents: 'none',
            zIndex: 9999,
            borderColor: ATTACHABLE_TYPE_COLORS[attachDragItem.category] ?? '#888',
            borderWidth: 2,
            borderStyle: 'solid',
            borderRadius: 12,
          }}
        >
          <LucideIcon name="Package" size={24} />
        </div>
      )}
    </>
  );
}
