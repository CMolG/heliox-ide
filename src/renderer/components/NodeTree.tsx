/**
 * NodeTree.tsx — Renderer Composite Component
 *
 * Responsibility:
 * - Renders the NodeTree surface in the renderer layer.
 * - Encapsulates Feature-level composition used by the renderer shell and panels.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
import React, { useCallback, useState, useRef, useEffect } from 'react';
import { useDesktopStore } from '@/renderer/store/desktop-store';
import { LucideIcon } from './desktop/LucideIcon';
import { theme } from '@/renderer/logic/theme';
import type { AttachableType } from '@/types/desktop';

const ELECTRIC_BLUE = '#4285F4';

const TYPE_META: Record<AttachableType, { color: string; icon: string; label: string }> = {
  role: { color: '#E87040', icon: 'User', label: 'Role' },
  mod:  { color: '#4285F4', icon: 'Wrench', label: 'Mod' },
  flow: { color: '#A78BFA', icon: 'Route', label: 'Flow' },
  'design-system': { color: '#10B981', icon: 'Palette', label: 'Design System' },
};

function kebabToTitle(str: string): string {
  return str.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function NodeTree() {
  const windows = useDesktopStore(s => s.windows);
  const attachables = useDesktopStore(s => s.attachables);
  const grids = useDesktopStore(s => s.grids);
  const activeWindowId = useDesktopStore(s => s.activeWindowId);
  const focusWindow = useDesktopStore(s => s.focusWindow);
  const setCanvasPan = useDesktopStore(s => s.setCanvasPan);
  const canvasZoom = useDesktopStore(s => s.canvasZoom);
  const removeWindow = useDesktopStore(s => s.removeWindow);
  const setWindowState = useDesktopStore(s => s.setWindowState);
  const connections = useDesktopStore(s => s.connections);
  const setHoveredWindowId = useDesktopStore(s => s.setHoveredWindowId);
  const detachFromWindow = useDesktopStore(s => s.detachFromWindow);
  const removeAttachedItem = useDesktopStore(s => s.removeAttachedItem);
  const removeAttachable = useDesktopStore(s => s.removeAttachable);
  const mentalNodes = useDesktopStore(s => s.mentalNodes);
  const mentalEdges = useDesktopStore(s => s.mentalEdges);
  const removeMentalNode = useDesktopStore(s => s.removeMentalNode);
  const mentalMode = useDesktopStore(s => s.mentalMode);
  const setMentalMode = useDesktopStore(s => s.setMentalMode);
  const marketInventory = useDesktopStore(s => s.marketInventory);
  const removeGrid = useDesktopStore(s => s.removeGrid);
  const removeWindowFromCell = useDesktopStore(s => s.removeWindowFromCell);
  const updateWindowTitle = useDesktopStore(s => s.updateWindowTitle);
  const updateMentalNode = useDesktopStore(s => s.updateMentalNode);
  const updateGridTitle = useDesktopStore(s => s.updateGridTitle);

  type CtxTarget =
    | { kind: 'window'; id: string }
    | { kind: 'mental'; id: string }
    | { kind: 'grid'; id: string };

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; target: CtxTarget } | null>(null);
  const [renamingItem, setRenamingItem] = useState<CtxTarget | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingItem && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingItem]);

  const navigateToWindow = useCallback((windowId: string) => {
    const win = useDesktopStore.getState().windows.find(w => w.id === windowId);
    if (!win) return;
    focusWindow(windowId);
    const viewportW = window.innerWidth - 280;
    const viewportH = window.innerHeight - 60;
    const centerX = -(win.position.x * canvasZoom) + (viewportW / 2) - (win.size.width * canvasZoom / 2);
    const centerY = -(win.position.y * canvasZoom) + (viewportH / 2) - (win.size.height * canvasZoom / 2);
    setCanvasPan({ x: centerX, y: centerY });
  }, [focusWindow, setCanvasPan, canvasZoom]);

  const navigateToGrid = useCallback((gridId: string) => {
    const grid = useDesktopStore.getState().grids.find(g => g.id === gridId);
    if (!grid) return;
    const focusGrid = useDesktopStore.getState().focusGrid;
    focusGrid(gridId);
    const viewportW = window.innerWidth - 280;
    const viewportH = window.innerHeight - 60;
    const centerX = -(grid.position.x * canvasZoom) + (viewportW / 2) - (grid.size.width * canvasZoom / 2);
    const centerY = -(grid.position.y * canvasZoom) + (viewportH / 2) - (grid.size.height * canvasZoom / 2);
    setCanvasPan({ x: centerX, y: centerY });
  }, [setCanvasPan, canvasZoom]);

  const openContextMenu = useCallback((e: React.MouseEvent, target: CtxTarget) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, target });
  }, []);

  const handleContextMenuAction = useCallback((action: string) => {
    if (!contextMenu) return;
    const { target } = contextMenu;
    switch (action) {
      case 'rename': {
        if (target.kind === 'window') {
          const win = useDesktopStore.getState().windows.find(w => w.id === target.id);
          if (win) setRenameValue(win.title);
        } else if (target.kind === 'mental') {
          const node = useDesktopStore.getState().mentalNodes.find(n => n.id === target.id);
          if (node) setRenameValue(node.text);
        } else if (target.kind === 'grid') {
          const grid = useDesktopStore.getState().grids.find(g => g.id === target.id);
          if (grid) setRenameValue(grid.title ?? `Grid ${grid.columns}×${grid.rows}`);
        }
        setRenamingItem(target);
        break;
      }
      case 'locate':
        if (target.kind === 'window') navigateToWindow(target.id);
        else if (target.kind === 'mental') {
          const node = useDesktopStore.getState().mentalNodes.find(n => n.id === target.id);
          if (node) {
            const vpW = window.innerWidth - 280;
            const vpH = window.innerHeight - 60;
            setCanvasPan({
              x: -(node.position.x * canvasZoom) + vpW / 2 - (node.width / 2) * canvasZoom,
              y: -(node.position.y * canvasZoom) + vpH / 2 - (node.height / 2) * canvasZoom,
            });
          }
        } else if (target.kind === 'grid') navigateToGrid(target.id);
        break;
      case 'minimize':
        if (target.kind === 'window') {
          const win = useDesktopStore.getState().windows.find(w => w.id === target.id);
          if (win) setWindowState(target.id, win.state === 'minimized' ? 'normal' : 'minimized');
        }
        break;
      case 'delete':
        if (target.kind === 'window') removeWindow(target.id);
        else if (target.kind === 'mental') removeMentalNode(target.id);
        else if (target.kind === 'grid') removeGrid(target.id);
        break;
    }
    setContextMenu(null);
  }, [contextMenu, navigateToWindow, navigateToGrid, setCanvasPan, canvasZoom, setWindowState, removeWindow, removeMentalNode, removeGrid]);

  const commitRename = useCallback(() => {
    if (renamingItem && renameValue.trim()) {
      if (renamingItem.kind === 'window') updateWindowTitle(renamingItem.id, renameValue.trim());
      else if (renamingItem.kind === 'mental') updateMentalNode(renamingItem.id, { text: renameValue.trim() });
      else if (renamingItem.kind === 'grid') updateGridTitle(renamingItem.id, renameValue.trim());
    }
    setRenamingItem(null);
  }, [renamingItem, renameValue, updateWindowTitle, updateMentalNode, updateGridTitle]);

  const toggleMinimize = useCallback((windowId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const win = useDesktopStore.getState().windows.find(w => w.id === windowId);
    if (win) {
      setWindowState(windowId, win.state === 'minimized' ? 'normal' : 'minimized');
    }
  }, [setWindowState]);

  const handleRemove = useCallback((windowId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    removeWindow(windowId);
  }, [removeWindow]);

  const handleDetach = useCallback((windowId: string, type: AttachableType, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    detachFromWindow(windowId, type, name);
  }, [detachFromWindow]);

  const handleRemoveAttached = useCallback((windowId: string, type: AttachableType, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    removeAttachedItem(windowId, type, name);
  }, [removeAttachedItem]);

  // Sort: active first, then by zIndex desc
  const sortedWindows = [...windows].sort((a, b) => {
    if (a.id === activeWindowId) return -1;
    if (b.id === activeWindowId) return 1;
    return b.zIndex - a.zIndex;
  });

  const chatWindows = sortedWindows.filter(w => w.type === 'chat');
  const fileWindows = sortedWindows.filter(w => w.type === 'file-explorer');
  const fileViewerWindows = sortedWindows.filter(w => w.type === 'file-viewer');
  const pluginWindows = sortedWindows.filter(w => w.type === 'plugin');
  const backlogWindows = sortedWindows.filter(w => w.type === 'backlog');
  const designEditorWindows = sortedWindows.filter(w => w.type === 'design-system-editor');
  const promptDevWindows = sortedWindows.filter(w => w.type === 'prompt-dev-zone');

  const getAttachedItems = (win: typeof windows[0]) => {
    const items: Array<{ type: AttachableType; name: string }> = [];
    if (win.roleId) items.push({ type: 'role', name: win.roleId });
    if (win.flowId) items.push({ type: 'flow', name: win.flowId });
    for (const modId of win.modifierIds) {
      items.push({ type: 'mod', name: modId });
    }
    return items;
  };

  const renderGroup = (label: string, items: typeof windows) => {
    if (items.length === 0) return null;
    return (
      <div>
        <div style={{
          padding: '8px 12px 4px', fontSize: 10, fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: '0.05em',
          color: theme.textGhost,
        }}>
          {label} ({items.length})
        </div>
        {items.map(win => {
          const isActive = win.id === activeWindowId;
          const isMinimized = win.state === 'minimized';
          const connCount = connections.filter(
            c => c.sourceWindowId === win.id || c.targetWindowId === win.id
          ).length;
          const attachedItems = getAttachedItems(win);

          return (
            <div key={win.id}>
              <button
                onClick={() => navigateToWindow(win.id)}
                onMouseEnter={() => setHoveredWindowId(win.id)}
                onMouseLeave={() => setHoveredWindowId(null)}
                onContextMenu={(e) => openContextMenu(e, { kind: 'window', id: win.id })}
                aria-label={`Window: ${win.title}${isActive ? ', active' : ''}`}
                data-testid={`nav-window-${win.id}`}
                className="nav-window-item"
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 12px', border: 'none', textAlign: 'left', cursor: 'pointer',
                  background: isActive ? `${ELECTRIC_BLUE}12` : 'transparent',
                  borderLeft: isActive ? `2px solid ${ELECTRIC_BLUE}` : '2px solid transparent',
                  color: isMinimized ? theme.textGhost : theme.textSecondary,
                  fontSize: 12, transition: 'background 0.1s ease, border-color 0.1s ease',
                  opacity: isMinimized ? 0.5 : 1,
                }}
              >
                <LucideIcon
                  name={win.iconName}
                  size={14}
                  style={{ flexShrink: 0, opacity: 0.7 }}
                />
                {renamingItem?.kind === 'window' && renamingItem.id === win.id ? (
                  <input
                    ref={renameInputRef}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') setRenamingItem(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    data-testid={`nav-window-rename-input-${win.id}`}
                    style={{
                      flex: 1, minWidth: 0, fontSize: 12,
                      background: 'rgba(255,255,255,0.08)',
                      border: `1px solid ${ELECTRIC_BLUE}`,
                      borderRadius: 4, padding: '1px 4px',
                      color: theme.textSecondary, outline: 'none',
                      fontWeight: isActive ? 500 : 400,
                    }}
                  />
                ) : (
                <span style={{
                  flex: 1, overflow: 'hidden', textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap', fontWeight: isActive ? 500 : 400,
                }}>
                  {win.title}
                </span>
                )}

                {connCount > 0 && (
                  <span style={{
                    fontSize: 9, padding: '1px 5px', borderRadius: 8,
                    background: `${ELECTRIC_BLUE}1f`,
                    color: ELECTRIC_BLUE, flexShrink: 0,
                  }}>
                    {connCount}
                  </span>
                )}

                <button
                  onClick={(e) => toggleMinimize(win.id, e)}
                  title={isMinimized ? 'Show' : 'Hide'}
                  aria-label={`${isMinimized ? 'Show' : 'Minimize'} ${win.title}`}
                  style={{
                    background: 'none', border: 'none', color: theme.textGhost,
                    cursor: 'pointer', padding: 2, borderRadius: 4, flexShrink: 0,
                    display: 'flex', alignItems: 'center',
                  }}
                >
                  <LucideIcon name={isMinimized ? 'Plus' : 'Minus'} size={10} />
                </button>

                <button
                  onClick={(e) => handleRemove(win.id, e)}
                  title="Close"
                  aria-label={`Close ${win.title}`}
                  style={{
                    background: 'none', border: 'none', color: theme.textGhost,
                    cursor: 'pointer', padding: 2, borderRadius: 4, flexShrink: 0,
                    display: 'flex', alignItems: 'center',
                  }}
                >
                  <LucideIcon name="X" size={10} />
                </button>
              </button>

              {/* Attached children (roles, flows, mods) */}
              {attachedItems.map(item => {
                const meta = TYPE_META[item.type];
                const winRoleColor = win.roleId && marketInventory
                  ? (() => {
                      const r = marketInventory.roles.find((rl: any) => rl.name === win.roleId);
                      if (!r?.color) return null;
                      return r.color.startsWith('#') ? r.color : `#${r.color}`;
                    })()
                  : null;
                const childBorderColor = isActive ? (winRoleColor ?? ELECTRIC_BLUE) : 'transparent';

                return (
                  <div
                    key={`${win.id}-${item.type}-${item.name}`}
                    className="nav-child-item"
                    data-testid={`nav-child-${item.type}-${item.name}`}
                    data-parent-active={isActive}
                    onMouseEnter={() => setHoveredWindowId(win.id)}
                    onMouseLeave={() => setHoveredWindowId(null)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 6,
                      padding: '4px 12px 4px 32px',
                      cursor: 'default',
                      color: isActive ? theme.textSecondary : theme.textDim,
                      fontSize: 11,
                      transition: 'background 0.1s ease, border-color 0.1s ease',
                      borderLeft: `2px solid ${childBorderColor}`,
                      background: isActive ? `${winRoleColor ?? ELECTRIC_BLUE}08` : 'transparent',
                    }}
                  >
                    <LucideIcon
                      name={meta.icon}
                      size={12}
                      style={{ flexShrink: 0, color: meta.color, opacity: 0.8 }}
                    />
                    <span style={{
                      flex: 1, overflow: 'hidden', textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap', fontSize: 11,
                    }}>
                      {kebabToTitle(item.name)}
                    </span>
                    <span style={{
                      fontSize: 8, padding: '0px 4px', borderRadius: 3,
                      background: `${meta.color}15`,
                      color: meta.color,
                      border: `1px solid ${meta.color}30`,
                      flexShrink: 0, textTransform: 'uppercase', fontWeight: 600,
                      letterSpacing: '0.03em',
                    }}>
                      {meta.label}
                    </span>

                    <button
                      onClick={(e) => handleDetach(win.id, item.type, item.name, e)}
                      title="Unlink"
                      aria-label={`Unlink ${kebabToTitle(item.name)} from ${win.title}`}
                      data-testid={`nav-child-unlink-${item.type}-${item.name}`}
                      style={{
                        background: 'none', border: 'none', color: theme.textGhost,
                        cursor: 'pointer', padding: 2, borderRadius: 4, flexShrink: 0,
                        display: 'flex', alignItems: 'center',
                      }}
                    >
                      <LucideIcon name="Unlink" size={10} />
                    </button>

                    <button
                      onClick={(e) => handleRemoveAttached(win.id, item.type, item.name, e)}
                      title="Remove"
                      aria-label={`Remove ${kebabToTitle(item.name)}`}
                      data-testid={`nav-child-close-${item.type}-${item.name}`}
                      style={{
                        background: 'none', border: 'none', color: theme.textGhost,
                        cursor: 'pointer', padding: 2, borderRadius: 4, flexShrink: 0,
                        display: 'flex', alignItems: 'center',
                      }}
                    >
                      <LucideIcon name="X" size={10} />
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div data-testid="node-tree" style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
      {windows.length === 0 && attachables.length === 0 && grids.length === 0 ? (
        <div style={{
          padding: '24px 16px', textAlign: 'center', color: theme.textGhost, fontSize: 12,
        }}>
          No windows open
        </div>
      ) : (
        <>
          {renderGroup('Chats', chatWindows)}
          {/* Files group: file-explorers + file-viewer child items */}
          {(fileWindows.length > 0 || fileViewerWindows.length > 0) && (
            <div>
              <div style={{
                padding: '8px 12px 4px', fontSize: 10, fontWeight: 600,
                textTransform: 'uppercase', letterSpacing: '0.05em',
                color: theme.textGhost,
              }}>
                Files ({fileWindows.length + fileViewerWindows.length})
              </div>
              {fileWindows.map(win => {
                const isActive = win.id === activeWindowId;
                const isMinimized = win.state === 'minimized';
                const connCount = connections.filter(
                  c => c.sourceWindowId === win.id || c.targetWindowId === win.id
                ).length;
                const attachedItems = getAttachedItems(win);
                return (
                  <div key={win.id}>
                    <button
                      onClick={() => navigateToWindow(win.id)}
                      onMouseEnter={() => setHoveredWindowId(win.id)}
                      onMouseLeave={() => setHoveredWindowId(null)}
                      aria-label={`Window: ${win.title}${isActive ? ', active' : ''}`}
                      data-testid={`nav-window-${win.id}`}
                      className="nav-window-item"
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                        padding: '6px 12px', border: 'none', textAlign: 'left', cursor: 'pointer',
                        background: isActive ? `${ELECTRIC_BLUE}12` : 'transparent',
                        borderLeft: isActive ? `2px solid ${ELECTRIC_BLUE}` : '2px solid transparent',
                        color: isMinimized ? theme.textGhost : theme.textSecondary,
                        fontSize: 12, transition: 'background 0.1s ease, border-color 0.1s ease',
                        opacity: isMinimized ? 0.5 : 1,
                      }}
                    >
                      <LucideIcon name={win.iconName} size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: isActive ? 500 : 400 }}>{win.title}</span>
                      {connCount > 0 && (
                        <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 8, background: `${ELECTRIC_BLUE}1f`, color: ELECTRIC_BLUE, flexShrink: 0 }}>{connCount}</span>
                      )}
                      <button onClick={(e) => toggleMinimize(win.id, e)} title={isMinimized ? 'Show' : 'Hide'} aria-label={`${isMinimized ? 'Show' : 'Minimize'} ${win.title}`} style={{ background: 'none', border: 'none', color: theme.textGhost, cursor: 'pointer', padding: 2, borderRadius: 4, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                        <LucideIcon name={isMinimized ? 'Plus' : 'Minus'} size={10} />
                      </button>
                      <button onClick={(e) => handleRemove(win.id, e)} title="Close" aria-label={`Close ${win.title}`} style={{ background: 'none', border: 'none', color: theme.textGhost, cursor: 'pointer', padding: 2, borderRadius: 4, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                        <LucideIcon name="X" size={10} />
                      </button>
                    </button>
                    {attachedItems.map(item => {
                      const meta = TYPE_META[item.type];
                      return (
                        <div key={`${win.id}-${item.type}-${item.name}`} className="nav-child-item" style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px 4px 32px', color: theme.textDim, fontSize: 11 }}>
                          <LucideIcon name={meta.icon} size={12} style={{ flexShrink: 0, color: meta.color, opacity: 0.8 }} />
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{kebabToTitle(item.name)}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              {/* File-viewer windows (individual open files) */}
              {fileViewerWindows.map(win => {
                const isActive = win.id === activeWindowId;
                const isMinimized = win.state === 'minimized';
                return (
                  <button
                    key={win.id}
                    onClick={() => navigateToWindow(win.id)}
                    onMouseEnter={() => setHoveredWindowId(win.id)}
                    onMouseLeave={() => setHoveredWindowId(null)}
                    aria-label={`File: ${win.title}${isActive ? ', active' : ''}`}
                    data-testid={`nav-window-${win.id}`}
                    className="nav-window-item"
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 6,
                      padding: '4px 12px 4px 28px', border: 'none', textAlign: 'left', cursor: 'pointer',
                      background: isActive ? `${ELECTRIC_BLUE}12` : 'transparent',
                      borderLeft: isActive ? `2px solid ${ELECTRIC_BLUE}` : '2px solid transparent',
                      color: isMinimized ? theme.textGhost : theme.textDim,
                      fontSize: 11, transition: 'background 0.1s ease, border-color 0.1s ease',
                      opacity: isMinimized ? 0.5 : 1,
                    }}
                  >
                    <LucideIcon name="FileCode2" size={12} style={{ flexShrink: 0, opacity: 0.7 }} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: isActive ? 500 : 400 }}>{win.title}</span>
                    <button onClick={(e) => toggleMinimize(win.id, e)} title={isMinimized ? 'Show' : 'Hide'} style={{ background: 'none', border: 'none', color: theme.textGhost, cursor: 'pointer', padding: 2, borderRadius: 4, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                      <LucideIcon name={isMinimized ? 'Plus' : 'Minus'} size={10} />
                    </button>
                    <button onClick={(e) => handleRemove(win.id, e)} title="Close" aria-label={`Close ${win.title}`} style={{ background: 'none', border: 'none', color: theme.textGhost, cursor: 'pointer', padding: 2, borderRadius: 4, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                      <LucideIcon name="X" size={10} />
                    </button>
                  </button>
                );
              })}
            </div>
          )}
          {renderGroup('Backlog', backlogWindows)}
          {renderGroup('Plugins', pluginWindows)}
          {renderGroup('Design System', designEditorWindows)}
          {renderGroup('Prompt Dev Zone', promptDevWindows)}

          {/* Grid layouts */}
          {grids.length > 0 && (
            <div>
              <div style={{
                padding: '8px 12px 4px', fontSize: 10, fontWeight: 600,
                textTransform: 'uppercase', letterSpacing: '0.05em',
                color: theme.textGhost,
              }}>
                Grids ({grids.length})
              </div>
              {grids.map(grid => {
                const childWindowIds = Array.from(new Set(
                  grid.cells.filter((id): id is string => Boolean(id))
                ));
                const childWindows = childWindowIds
                  .map(id => windows.find(w => w.id === id))
                  .filter((w): w is typeof windows[number] => Boolean(w));
                return (
                  <div key={grid.id}>
                    <button
                      onClick={() => navigateToGrid(grid.id)}
                      onContextMenu={(e) => openContextMenu(e, { kind: 'grid', id: grid.id })}
                      aria-label={`Grid: ${grid.title ?? `${grid.columns}×${grid.rows}`}`}
                      data-testid={`nav-grid-${grid.id}`}
                      className="nav-window-item"
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                        padding: '6px 12px', border: 'none', textAlign: 'left', cursor: 'pointer',
                        background: 'transparent',
                        borderLeft: '2px solid transparent',
                        color: theme.textSecondary,
                        fontSize: 12, transition: 'background 0.1s ease, border-color 0.1s ease',
                      }}
                    >
                      <LucideIcon name="LayoutGrid" size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
                      {renamingItem?.kind === 'grid' && renamingItem.id === grid.id ? (
                        <input
                          ref={renameInputRef}
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={commitRename}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename();
                            if (e.key === 'Escape') setRenamingItem(null);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          data-testid={`nav-grid-rename-input-${grid.id}`}
                          style={{
                            flex: 1, minWidth: 0, fontSize: 12,
                            background: 'rgba(255,255,255,0.08)',
                            border: `1px solid ${ELECTRIC_BLUE}`,
                            borderRadius: 4, padding: '1px 4px',
                            color: theme.textSecondary, outline: 'none',
                          }}
                        />
                      ) : (
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {grid.title ?? `Grid ${grid.columns}×${grid.rows}`}
                      </span>
                      )}
                      <span style={{
                        fontSize: 9, padding: '1px 5px', borderRadius: 8,
                        background: 'rgba(120,160,255,0.1)',
                        color: 'rgba(120,160,255,0.6)', flexShrink: 0,
                      }}>
                        {childWindows.length}/{grid.cells.length}
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeGrid(grid.id); }}
                        title="Remove grid"
                        aria-label={`Remove grid ${grid.title ?? `${grid.columns}×${grid.rows}`}`}
                        data-testid={`nav-grid-close-${grid.id}`}
                        style={{
                          background: 'none', border: 'none', color: theme.textGhost,
                          cursor: 'pointer', padding: 2, borderRadius: 4, flexShrink: 0,
                          display: 'flex', alignItems: 'center',
                        }}
                      >
                        <LucideIcon name="X" size={10} />
                      </button>
                    </button>
                    {/* Child windows in grid cells */}
                    {childWindows.map(cw => (
                      <div
                        key={cw.id}
                        className="nav-child-item"
                        data-testid={`nav-grid-child-${cw.id}`}
                        style={{
                          width: '100%', display: 'flex', alignItems: 'center', gap: 6,
                          padding: '4px 12px 4px 32px',
                          cursor: 'default',
                          color: theme.textDim,
                          fontSize: 11,
                          transition: 'background 0.1s ease',
                          borderLeft: '2px solid transparent',
                        }}
                      >
                        <LucideIcon name={cw.iconName} size={12} style={{ flexShrink: 0, opacity: 0.6 }} />
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {cw.title}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); removeWindowFromCell(grid.id, cw.id); }}
                          title="Eject from grid"
                          aria-label={`Eject ${cw.title} from grid`}
                          data-testid={`nav-grid-eject-${cw.id}`}
                          style={{
                            background: 'none', border: 'none', color: theme.textGhost,
                            cursor: 'pointer', padding: 2, borderRadius: 4, flexShrink: 0,
                            display: 'flex', alignItems: 'center',
                          }}
                        >
                          <LucideIcon name="Minimize2" size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {/* Unattached items — free-floating attachables on canvas */}
          {attachables.length > 0 && (
            <div>
              <div style={{
                padding: '8px 12px 4px', fontSize: 10, fontWeight: 600,
                textTransform: 'uppercase', letterSpacing: '0.05em',
                color: theme.textGhost,
              }}>
                Unattached ({attachables.length})
              </div>
              {attachables.map(att => {
                const meta = TYPE_META[att.type];
                const attachableTitle = kebabToTitle(att.name);
                return (
                  <div
                    key={att.id}
                    className="nav-child-item"
                    data-testid={`nav-unattached-${att.type}-${att.name}`}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 6,
                      padding: '4px 12px 4px 20px',
                      cursor: 'pointer',
                      color: theme.textDim,
                      fontSize: 11,
                      transition: 'background 0.1s ease',
                      borderLeft: '2px solid transparent',
                    }}
                    onClick={() => {
                      const viewportW = window.innerWidth - 280;
                      const viewportH = window.innerHeight - 60;
                      const centerX = -(att.position.x * canvasZoom) + (viewportW / 2) - (110 * canvasZoom);
                      const centerY = -(att.position.y * canvasZoom) + (viewportH / 2) - (30 * canvasZoom);
                      setCanvasPan({ x: centerX, y: centerY });
                    }}
                  >
                    <LucideIcon
                      name={meta.icon}
                      size={12}
                      style={{ flexShrink: 0, color: meta.color, opacity: 0.8 }}
                    />
                    <span style={{
                      flex: 1, overflow: 'hidden', textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap', fontSize: 11,
                    }}>
                      {attachableTitle}
                    </span>
                    <span style={{
                      fontSize: 8, padding: '0px 4px', borderRadius: 3,
                      background: `${meta.color}15`,
                      color: meta.color,
                      border: `1px solid ${meta.color}30`,
                      flexShrink: 0, textTransform: 'uppercase', fontWeight: 600,
                      letterSpacing: '0.03em',
                    }}>
                      {meta.label}
                    </span>

                    <button
                      onClick={(e) => { e.stopPropagation(); removeAttachable(att.id); }}
                      title="Remove"
                      aria-label={`Remove ${kebabToTitle(att.name)}`}
                      data-testid={`nav-unattached-close-${att.type}-${att.name}`}
                      style={{
                        background: 'none', border: 'none', color: theme.textGhost,
                        cursor: 'pointer', padding: 2, borderRadius: 4, flexShrink: 0,
                        display: 'flex', alignItems: 'center',
                      }}
                    >
                      <LucideIcon name="X" size={10} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Mental Graph Nodes — always visible regardless of mentalMode */}
          {mentalNodes.length > 0 && (
            <div>
              <div style={{
                padding: '8px 12px 4px', fontSize: 10, fontWeight: 600,
                textTransform: 'uppercase', letterSpacing: '0.05em',
                color: theme.textGhost,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <span>Mental Cards ({mentalNodes.length})</span>
                {mentalMode === 'off' && (
                  <button
                    onClick={() => setMentalMode('square')}
                    title="Enable mental authoring"
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: theme.textMuted, fontSize: 9, padding: '0 2px',
                      fontFamily: theme.fontMono, letterSpacing: '0.04em',
                    }}
                  >
                    Show ▸
                  </button>
                )}
              </div>
              {mentalNodes.map(node => {
                const nodeLabel = node.text.trim() || 'Untitled card';
                const edgeCount = mentalEdges.filter(e => e.sourceId === node.id || e.targetId === node.id).length;
                return (
                  <div
                    key={node.id}
                    className="nav-child-item"
                    data-testid={`nav-mental-node-${node.id}`}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 6,
                      padding: '4px 12px 4px 20px',
                      cursor: 'pointer',
                      color: theme.textDim,
                      fontSize: 11,
                      transition: 'background 0.1s ease',
                      borderLeft: '2px solid transparent',
                    }}
                    onClick={() => {
                      const viewportW = window.innerWidth - 280;
                      const viewportH = window.innerHeight - 60;
                      const centerX = -(node.position.x * canvasZoom) + (viewportW / 2) - ((node.width / 2) * canvasZoom);
                      const centerY = -(node.position.y * canvasZoom) + (viewportH / 2) - ((node.height / 2) * canvasZoom);
                      setCanvasPan({ x: centerX, y: centerY });
                    }}
                    onContextMenu={(e) => openContextMenu(e, { kind: 'mental', id: node.id })}
                  >
                    <span
                      style={{
                        width: 10, height: 10, borderRadius: 2,
                        background: node.color, flexShrink: 0,
                        border: `1px solid ${theme.borderLight}`,
                      }}
                    />
                    {renamingItem?.kind === 'mental' && renamingItem.id === node.id ? (
                      <input
                        ref={renameInputRef}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename();
                          if (e.key === 'Escape') setRenamingItem(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        data-testid={`nav-mental-rename-input-${node.id}`}
                        style={{
                          flex: 1, minWidth: 0, fontSize: 11,
                          background: 'rgba(255,255,255,0.08)',
                          border: `1px solid ${ELECTRIC_BLUE}`,
                          borderRadius: 4, padding: '1px 4px',
                          color: theme.textSecondary, outline: 'none',
                        }}
                      />
                    ) : (
                    <span style={{
                      flex: 1, overflow: 'hidden', textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap', fontSize: 11,
                    }}>
                      {nodeLabel}
                    </span>
                    )}
                    {edgeCount > 0 && (
                      <span style={{
                        fontSize: 8, padding: '0px 3px', borderRadius: 3,
                        background: '#A78BFA15',
                        color: '#A78BFA',
                        border: '1px solid #A78BFA30',
                        flexShrink: 0, fontWeight: 600,
                      }}>
                        {edgeCount}
                      </span>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); removeMentalNode(node.id); }}
                      title="Remove"
                      aria-label={`Remove mental card ${nodeLabel}`}
                      data-testid={`nav-mental-node-close-${node.id}`}
                      style={{
                        background: 'none', border: 'none', color: theme.textGhost,
                        cursor: 'pointer', padding: 2, borderRadius: 4, flexShrink: 0,
                        display: 'flex', alignItems: 'center',
                      }}
                    >
                      <LucideIcon name="X" size={10} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

        </>
      )}

      {/* Right-click context menu for all item types */}
      {contextMenu && (
        <div
          data-testid="nodetree-context-menu-backdrop"
          style={{ position: 'fixed', inset: 0, zIndex: 10001 }}
          onClick={() => setContextMenu(null)}
          onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }}
        >
          <div
            data-testid="nodetree-context-menu"
            style={{
              position: 'absolute',
              left: contextMenu.x,
              top: contextMenu.y,
              minWidth: 150,
              padding: '4px 0',
              borderRadius: 8,
              background: 'rgba(20, 20, 20, 0.95)',
              border: '1px solid rgba(255, 255, 255, 0.14)',
              boxShadow: '0 8px 20px rgba(0,0,0,0.35)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {[
              { label: 'Rename', icon: 'Pencil', action: 'rename' },
              { label: 'Locate', icon: 'Navigation', action: 'locate' },
              ...(contextMenu.target.kind === 'window'
                ? [
                  { label: 'Minimize', icon: 'Minus', action: 'minimize' },
                  { label: 'Close window', icon: 'Trash2', action: 'delete' },
                ]
                : [{ label: 'Delete', icon: 'Trash2', action: 'delete' }]),
            ].map((item) => (
              <button
                key={item.action}
                data-testid={`nodetree-ctx-${item.action}`}
                onClick={() => handleContextMenuAction(item.action)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  width: '100%', padding: '6px 12px',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: item.action === 'delete' ? '#f87171' : '#f4f4f5',
                  fontSize: 12, textAlign: 'left',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
              >
                <LucideIcon name={item.icon} size={13} style={{ opacity: 0.6, flexShrink: 0 }} />
                {item.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
