/**
 * Dock.tsx — Renderer Desktop Surface Component
 *
 * Responsibility:
 * - Renders the Dock surface in the renderer layer.
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
import { useDesktopStore } from '../../store/desktop-store';
import { useFluxorStore } from '../../store';
import { LucideIcon } from './LucideIcon';
import { DockPopover } from './DockPopover';
import type { AttachableType, MentalMode, MentalShape, MentalTool } from '@/types/desktop';

const ATTACHABLE_TYPE_COLORS: Record<string, string> = {
  flows: '#A78BFA',
  roles: '#E87040',
  modifiers: '#4285F4',
};

const ATTACHABLE_VISIBLE_COUNT = 3;

export function Dock() {
  const dockItems = useDesktopStore(s => s.dockItems);
  const addWindow = useDesktopStore(s => s.addWindow);
  const setShowMarketplace = useDesktopStore(s => s.setShowMarketplace);
  const installedPlugins = useDesktopStore(s => s.installedPlugins);
  const windows = useDesktopStore(s => s.windows);
  const focusWindow = useDesktopStore(s => s.focusWindow);
  const projectPath = useFluxorStore(s => s.projectPath);
  const availablePlugins = useDesktopStore(s => s.availablePlugins);
  const deployPlugin = useDesktopStore(s => s.deployPlugin);
  const spawnAttachable = useDesktopStore(s => s.spawnAttachable);
  const canvasPan = useDesktopStore(s => s.canvasPan);
  const canvasZoom = useDesktopStore(s => s.canvasZoom);
  const navigateToWindow = useDesktopStore(s => s.navigateToWindow);
  const settings = useDesktopStore(s => s.settings);
  const updateSettings = useDesktopStore(s => s.updateSettings);
  const focusAttachable = useDesktopStore(s => s.focusAttachable);
  const selectedAttachableId = useDesktopStore(s => s.selectedAttachableId);
  const setSelectedAttachableId = useDesktopStore(s => s.setSelectedAttachableId);
  const mentalMode = useDesktopStore(s => s.mentalMode);
  const setMentalMode = useDesktopStore(s => s.setMentalMode);
  const mentalTool = useDesktopStore(s => s.mentalTool);
  const setMentalTool = useDesktopStore(s => s.setMentalTool);
  const setHudWidgetVisible = useDesktopStore(s => s.setHudWidgetVisible);

  // Drag-out state for spawning windows at drop position
  const [dragItem, setDragItem] = useState<string | null>(null);
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 });
  const [draggedOut, setDraggedOut] = useState(false);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [attachableOffset, setAttachableOffset] = useState(0);
  const [attachDragItem, setAttachDragItem] = useState<{ id: string; category: string; name: string } | null>(null);
  const [attachDragPos, setAttachDragPos] = useState({ x: 0, y: 0 });
  const [attachDraggedOut, setAttachDraggedOut] = useState(false);
  const [mentalMenuOpen, setMentalMenuOpen] = useState(false);
  const dockRef = useRef<HTMLDivElement>(null);
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

  const handleClick = useCallback((item: typeof dockItems[0]) => {
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
  }, [dockItems, addWindow, setShowMarketplace, revealAutoChat, installedPlugins, windows, focusWindow, projectName, navigateToWindow, setMentalMode]);

  // ─── Drag-out handling (like LegallyOS) ────────────────────

  const onDragStart = useCallback((e: React.MouseEvent, itemId: string) => {
    e.preventDefault();
    setDragItem(itemId);
    startPos.current = { x: e.clientX, y: e.clientY };
    setDragPos({ x: 0, y: 0 });
    setDraggedOut(false);

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startPos.current.x;
      const dy = ev.clientY - startPos.current.y;
      setDragPos({ x: dx, y: dy });
      // Check if dragged outside dock zone
      const dockRect = dockRef.current?.getBoundingClientRect();
      if (dockRect) {
        const out = ev.clientY < dockRect.top - 20;
        setDraggedOut(out);
      }
    };

    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);

      const dockRect = dockRef.current?.getBoundingClientRect();
      const isOut = dockRect ? ev.clientY < dockRect.top - 20 : false;

      if (isOut) {
        // Spawn window at drop position
        const item = dockItems.find(d => d.id === itemId);
        if (item) {
          const dropX = ev.clientX - 240;
          const dropY = ev.clientY - 30;
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
        }
      }

      setDragItem(null);
      setDragPos({ x: 0, y: 0 });
      setDraggedOut(false);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [dockItems, addWindow, installedPlugins, projectName, revealAutoChat]);

  // ─── Attachable drag-to-desktop ────────────────────────────
  const onAttachDragStart = useCallback((e: React.MouseEvent, plugin: { id: string; category: string; name: string; iconName: string }) => {
    e.preventDefault();
    const attachStartPos = { x: e.clientX, y: e.clientY };
    setAttachDragItem(plugin);
    setAttachDragPos({ x: 0, y: 0 });
    setAttachDraggedOut(false);

    const onMove = (ev: MouseEvent) => {
      setAttachDragPos({ x: ev.clientX - attachStartPos.x, y: ev.clientY - attachStartPos.y });
      const dockRect = dockRef.current?.getBoundingClientRect();
      if (dockRect) setAttachDraggedOut(ev.clientY < dockRect.top - 20);
    };

    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);

      const dockRect = dockRef.current?.getBoundingClientRect();
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
      {/* Drag ghost element */}
      {dragItem && draggedOut && (
        <div
          className="dock-drag-ghost"
          style={{
            position: 'fixed',
            left: startPos.current.x + dragPos.x - 22,
            top: startPos.current.y + dragPos.y - 22,
            pointerEvents: 'none',
            zIndex: 9999,
          }}
        >
          <LucideIcon
            name={dockItems.find(d => d.id === dragItem)?.iconName ?? 'Blocks'}
            size={28}
            className="text-white"
          />
        </div>
      )}

      <div ref={dockRef} className="fluxor-dock" data-testid="dock" role="toolbar" aria-label="Application dock">
        {/* Action items + tool plugins */}
        {dockItems.map(item => {
          const isDragging = dragItem === item.id;
          const isMentalToggle = item.type === 'action' && item.action === 'mental-draw-toggle';
          const isToggleActive = isMentalToggle && mentalMode !== 'off';
          const showMentalMenu = isMentalToggle && mentalMenuOpen && !isDragging;

          const handleMentalModeSelect = (mode: MentalMode) => {
            setMentalMode(mode);
            setMentalMenuOpen(false);
          };

          const handleMentalToolSelect = (tool: MentalTool) => {
            setMentalTool(tool);
            setMentalMenuOpen(false);
          };

          return (
            <button
              key={item.id}
              className={`dock-item${isToggleActive ? ' dock-item-active' : ''}`}
              aria-label={item.label}
              aria-pressed={isMentalToggle ? mentalMode !== 'off' : undefined}
              aria-current={item.type === 'plugin' && windows.some(w => w.pluginId === item.pluginId) ? 'true' : undefined}
              onClick={() => !isDragging && handleClick(item)}
              onMouseDown={isMentalToggle ? undefined : (e) => onDragStart(e, item.id)}
              onMouseEnter={() => setHoveredItem(item.id)}
              onMouseLeave={() => {
                if (!isMentalToggle) setHoveredItem(null);
              }}
              onPointerEnter={isMentalToggle ? () => {
                setHoveredItem(item.id);
                setMentalMenuOpen(true);
              } : undefined}
              onPointerLeave={isMentalToggle ? () => {
                setHoveredItem(null);
                setMentalMenuOpen(false);
              } : undefined}
              data-testid={item.action ? `dock-${item.action}` : `dock-plugin-${item.pluginId}`}
              style={{
                opacity: isDragging && draggedOut ? 0.3 : 1,
                transform: isDragging && !draggedOut ? `translate(${dragPos.x}px, ${dragPos.y}px)` : undefined,
              }}
            >
              <LucideIcon name={item.iconName} size={20} className="dock-icon" />
              {hoveredItem === item.id && !isDragging && (!isMentalToggle || !showMentalMenu) && (
                <div className="dock-tooltip" role="tooltip">{item.label}</div>
              )}
              {showMentalMenu && (
                <DockPopover
                  className="dock-mental-menu"
                  ariaLabel="Mental tools"
                  onPointerDownOutside={() => setMentalMenuOpen(false)}
                  onEscape={() => setMentalMenuOpen(false)}
                >
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
                </DockPopover>
              )}
              {/* Active indicator for plugin windows */}
              {item.type === 'plugin' && windows.some(w => w.pluginId === item.pluginId) && (
                <div className="dock-active-dot" aria-hidden="true" />
              )}
              {isToggleActive && <div className="dock-active-dot" aria-hidden="true" />}
            </button>
          );
        })}

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
      </div>

      {/* Attachable drag ghost */}
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
