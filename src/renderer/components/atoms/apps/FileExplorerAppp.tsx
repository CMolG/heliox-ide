/**
 * FileExplorerAppp.tsx — Renderer Embedded App Component
 *
 * Responsibility:
 * - Renders the FileExplorerAppp surface in the renderer layer.
 * - Encapsulates Embedded mini-app surface mounted inside desktop windows.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/atoms/apps/FileExplorerAppp.tsx — Split-pane file explorer with tree, tabbed Monaco editor, and drag-out
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useHelioxStore } from '../../../store';
import { useDesktopStore } from '../../../store/desktop-store';
import { LucideIcon } from '../../desktop/LucideIcon';
import { theme } from '../../../logic/theme';
import { detectLanguage, getExtensionColor } from '../../../logic/monaco-config';
import { CodeEditor } from '../../ui/CodeEditor';

interface FileExplorerWindowProps {
  windowId: string;
}

interface TreeNode {
  name: string;
  path: string;        // absolute path
  relPath: string;     // relative to project root
  isDirectory: boolean;
  children?: TreeNode[];
  loaded?: boolean;
}

interface CtxMenuState {
  x: number; y: number;
  node: TreeNode | null; // null = root-level
}

interface FileTab {
  path: string;
  relPath: string;
  name: string;
  content: string;
  dirty: boolean;
}

const FILE_ICON_MAP: Record<string, string> = {
  ts: 'FileCode2', tsx: 'FileCode2', js: 'FileCode2', jsx: 'FileCode2',
  json: 'Braces', md: 'BookOpen', css: 'Palette', scss: 'Palette',
  html: 'Globe', yml: 'FileText', yaml: 'FileText', toml: 'FileText',
  py: 'FileCode2', rs: 'FileCode2', go: 'FileCode2', java: 'FileCode2',
  sh: 'Terminal', bash: 'Terminal', zsh: 'Terminal',
  png: 'Image', jpg: 'Image', jpeg: 'Image', svg: 'Image', gif: 'Image',
  lock: 'Lock', env: 'ShieldCheck',
};

function getFileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (name === '.gitignore' || name === '.env') return 'ShieldCheck';
  if (name === 'Dockerfile') return 'Container';
  return FILE_ICON_MAP[ext] || 'FileText';
}

function getFileColor(name: string): string {
  return getExtensionColor(name);
}

export function FileExplorerAppp({ windowId }: FileExplorerWindowProps) {
  const projectPath = useHelioxStore(s => s.projectPath);
  const addWindow = useDesktopStore(s => s.addWindow);

  // Persistent state from store (survives minimize/maximize/restart)
  const savedState = useDesktopStore(s => s.fileExplorerStates[windowId]);
  const setFileExplorerState = useDesktopStore(s => s.setFileExplorerState);

  const [rootNodes, setRootNodes] = useState<TreeNode[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() =>
    savedState?.expandedDirs ? new Set(savedState.expandedDirs) : new Set()
  );
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  // Tab state — initialized from saved metadata (content loaded in effect)
  const [openTabs, setOpenTabs] = useState<FileTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(savedState?.activeTabPath ?? null);

  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const [inlineInput, setInlineInput] = useState<{ parentPath: string; type: 'file' | 'folder'; value: string } | null>(null);
  const [renameInput, setRenameInput] = useState<{ node: TreeNode; value: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const inlineRootRef = useRef<HTMLInputElement>(null);
  const inlineNestedRef = useRef<HTMLInputElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  // Drag-out state for tabs
  const [dragTabPath, setDragTabPath] = useState<string | null>(null);
  const restoredTabs = useRef(false);

  // Resizable sidebar
  const [sidebarWidth, setSidebarWidth] = useState(() => savedState?.sidebarWidth ?? 220);

  const activeTab = useMemo(() => openTabs.find(t => t.path === activeTabPath), [openTabs, activeTabPath]);

  // ── Directory Loading ─────────────────────────────────────────
  const loadDir = useCallback(async (dirPath: string): Promise<TreeNode[]> => {
    if (!window.helioxAPI || !projectPath) return [];
    try {
      const entries = await window.helioxAPI.readDirectory(dirPath);
      return entries
        .filter(e => !e.name.startsWith('.') || e.name === '.gitignore' || e.name === '.env')
        .map(e => ({
          name: e.name,
          path: e.path,
          relPath: e.path.replace(projectPath + '/', ''),
          isDirectory: e.isDirectory,
          children: e.isDirectory ? [] : undefined,
          loaded: !e.isDirectory,
        }));
    } catch {
      return [];
    }
  }, [projectPath]);

  useEffect(() => {
    if (!projectPath) return;
    setLoading(true);
    loadDir(projectPath).then(nodes => {
      setRootNodes(nodes);
      setLoading(false);
    });
  }, [projectPath, loadDir]);

  // ── Restore saved state: expand dirs + reopen tabs from disk ──
  useEffect(() => {
    if (!projectPath || !savedState || restoredTabs.current) return;
    restoredTabs.current = true;

    (async () => {
      // Restore expanded directories by loading their children into the tree
      const dirs = savedState.expandedDirs || [];
      if (dirs.length > 0) {
        const loadPromises = dirs.map(async (dirPath) => {
          try { return { dirPath, children: await loadDir(dirPath) }; } catch { return null; }
        });
        const results = await Promise.all(loadPromises);
        const loaded = results.filter(Boolean) as Array<{ dirPath: string; children: TreeNode[] }>;

        if (loaded.length > 0) {
          setRootNodes(prev => {
            let tree = [...prev];
            for (const { dirPath, children } of loaded) {
              const update = (nodes: TreeNode[]): TreeNode[] =>
                nodes.map(n => {
                  if (n.path === dirPath) return { ...n, children, loaded: true };
                  if (n.children) return { ...n, children: update(n.children) };
                  return n;
                });
              tree = update(tree);
            }
            return tree;
          });
        }
      }

      // Restore open tabs by re-reading file contents from disk
      const tabMetas = savedState.openTabs || [];
      if (tabMetas.length > 0 && window.helioxAPI) {
        const tabs: FileTab[] = [];
        for (const meta of tabMetas) {
          try {
            const content = await window.helioxAPI.readFile(meta.path);
            if (content !== null) {
              tabs.push({ path: meta.path, relPath: meta.relPath, name: meta.name, content, dirty: false });
            }
          } catch { /* file may have been deleted */ }
        }
        if (tabs.length > 0) {
          setOpenTabs(tabs);
          const savedActive = savedState.activeTabPath;
          setActiveTabPath(tabs.find(t => t.path === savedActive) ? savedActive : tabs[0].path);
        }
      }
    })();
  }, [projectPath, savedState, loadDir]);

  // ── Sync state to store (debounced) ───────────────────────────
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      setFileExplorerState(windowId, {
        expandedDirs: Array.from(expandedDirs),
        openTabs: openTabs.map(t => ({ path: t.path, relPath: t.relPath, name: t.name })),
        activeTabPath,
        sidebarWidth,
      });
    }, 300);
    return () => { if (syncTimer.current) clearTimeout(syncTimer.current); };
  }, [expandedDirs, openTabs, activeTabPath, sidebarWidth, windowId, setFileExplorerState]);

  const toggleDir = useCallback(async (node: TreeNode) => {
    const path = node.path;
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(path)) { next.delete(path); return next; }
      next.add(path);
      return next;
    });
    if (!node.loaded) {
      const children = await loadDir(path);
      const updateTree = (nodes: TreeNode[]): TreeNode[] =>
        nodes.map(n => {
          if (n.path === path) return { ...n, children, loaded: true };
          if (n.children) return { ...n, children: updateTree(n.children) };
          return n;
        });
      setRootNodes(prev => updateTree(prev));
    }
  }, [loadDir]);

  // ── Tab Operations ────────────────────────────────────────────
  const openFileInTab = useCallback(async (node: TreeNode) => {
    if (!window.helioxAPI) return;
    setSelectedPath(node.path);

    // If already open, just activate
    const existing = openTabs.find(t => t.path === node.path);
    if (existing) {
      setActiveTabPath(node.path);
      return;
    }

    const content = await window.helioxAPI.readFile(node.path);
    if (content !== null) {
      const newTab: FileTab = {
        path: node.path,
        relPath: node.relPath,
        name: node.name,
        content,
        dirty: false,
      };
      setOpenTabs(prev => [...prev, newTab]);
      setActiveTabPath(node.path);
    }
  }, [openTabs]);

  const closeTab = useCallback((tabPath: string) => {
    setOpenTabs(prev => {
      const filtered = prev.filter(t => t.path !== tabPath);
      if (activeTabPath === tabPath) {
        const idx = prev.findIndex(t => t.path === tabPath);
        const nextActive = filtered[Math.min(idx, filtered.length - 1)]?.path ?? null;
        setActiveTabPath(nextActive);
      }
      return filtered;
    });
  }, [activeTabPath]);

  const updateTabContent = useCallback((tabPath: string, newContent: string) => {
    setOpenTabs(prev => prev.map(t =>
      t.path === tabPath ? { ...t, content: newContent, dirty: true } : t
    ));
  }, []);

  const saveTab = useCallback(async (tabPath: string) => {
    const tab = openTabs.find(t => t.path === tabPath);
    if (!tab || !tab.dirty || !window.helioxAPI) return;
    setSaving(true);
    const ok = await window.helioxAPI.writeFile(tab.path, tab.content);
    if (ok) {
      setOpenTabs(prev => prev.map(t =>
        t.path === tabPath ? { ...t, dirty: false } : t
      ));
    }
    setSaving(false);
  }, [openTabs]);

  // ── Save handler for current tab ─────────────────────────────
  const handleCurrentTabSave = useCallback(() => {
    if (activeTabPath) saveTab(activeTabPath);
  }, [activeTabPath, saveTab]);

  // ── Tab Reorder via Mouse ─────────────────────────────────────
  const handleTabReorder = useCallback((fromPath: string, toPath: string) => {
    setOpenTabs(prev => {
      const fromIdx = prev.findIndex(t => t.path === fromPath);
      const toIdx = prev.findIndex(t => t.path === toPath);
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return prev;
      const updated = [...prev];
      const [moved] = updated.splice(fromIdx, 1);
      updated.splice(toIdx, 0, moved);
      return updated;
    });
  }, []);

  // ── Tab Drag-out (spawn file-viewer window) ───────────────────
  // Pure mousedown/mousemove — instant with ghost preview, no HTML5 drag delay.
  const handleTabMouseDown = useCallback((e: React.MouseEvent, tabPath: string) => {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let popped = false;
    let ghost: HTMLDivElement | null = null;
    let dragging = false;

    const tab = openTabs.find(t => t.path === tabPath);
    if (!tab) return;

    const createGhost = () => {
      ghost = document.createElement('div');
      ghost.textContent = tab.name;
      ghost.style.cssText = `
        position:fixed;pointer-events:none;z-index:999999;
        padding:6px 14px;border-radius:8px;font-size:11px;font-weight:600;
        font-family:'Inter',sans-serif;color:#e4e4e7;
        background:rgba(30,30,30,0.92);border:1px solid rgba(255,255,255,0.12);
        box-shadow:0 8px 24px rgba(0,0,0,0.5);white-space:nowrap;
        backdrop-filter:blur(8px);
        left:${startX + 12}px;top:${startY - 14}px;
      `;
      document.body.appendChild(ghost);
    };

    const onMouseMove = (ev: MouseEvent) => {
      if (popped) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Show ghost after 4px of movement
      if (!dragging && dist > 4) {
        dragging = true;
        createGhost();
      }

      // Update ghost position
      if (ghost) {
        ghost.style.left = `${ev.clientX + 12}px`;
        ghost.style.top = `${ev.clientY - 14}px`;
      }

      // Threshold for drag-out: 50px downward or 100px horizontal
      if (dy > 50 || Math.abs(dx) > 100) {
        popped = true;
        const { canvasPan, canvasZoom } = useDesktopStore.getState();
        const winW = 560;
        const winH = 480;
        addWindow('file-viewer', {
          title: tab.name,
          filePath: tab.path,
          position: {
            x: (ev.clientX - canvasPan.x) / canvasZoom - winW / 2,
            y: (ev.clientY - canvasPan.y) / canvasZoom - winH / 4,
          },
          size: { width: winW, height: winH },
        });
        closeTab(tabPath);
        cleanup();
      }
    };

    const onMouseUp = (ev: MouseEvent) => {
      // If dragged horizontally within tab bar, reorder
      if (dragging && !popped) {
        const tabBar = (e.target as HTMLElement).closest('[data-testid="file-tabs"]');
        if (tabBar) {
          const tabEls = tabBar.querySelectorAll<HTMLElement>('[data-testid^="file-tab-"]');
          for (const el of tabEls) {
            const rect = el.getBoundingClientRect();
            if (ev.clientX >= rect.left && ev.clientX <= rect.right) {
              const testId = el.getAttribute('data-testid') ?? '';
              const targetName = testId.replace('file-tab-', '');
              const targetTab = openTabs.find(t => t.name === targetName);
              if (targetTab && targetTab.path !== tabPath) {
                handleTabReorder(tabPath, targetTab.path);
              }
              break;
            }
          }
        }
      }
      cleanup();
    };

    const cleanup = () => {
      if (ghost) { ghost.remove(); ghost = null; }
      setDragTabPath(null);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    setDragTabPath(tabPath);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [openTabs, addWindow, closeTab, handleTabReorder]);

  // ── File Operations ───────────────────────────────────────────
  const refreshDir = useCallback(async (dirPath: string) => {
    const children = await loadDir(dirPath);
    if (dirPath === projectPath) {
      setRootNodes(children);
      return;
    }
    const updateTree = (nodes: TreeNode[]): TreeNode[] =>
      nodes.map(n => {
        if (n.path === dirPath) return { ...n, children, loaded: true };
        if (n.children) return { ...n, children: updateTree(n.children) };
        return n;
      });
    setRootNodes(prev => updateTree(prev));
  }, [loadDir, projectPath]);

  const commitInlineCreate = useCallback(async () => {
    if (!inlineInput || !inlineInput.value.trim() || !window.helioxAPI) return;
    const name = inlineInput.value.trim();
    const fullPath = `${inlineInput.parentPath}/${name}`;
    const ok = inlineInput.type === 'folder'
      ? await window.helioxAPI.createDirectory(fullPath)
      : await window.helioxAPI.createFile(fullPath);
    if (ok) await refreshDir(inlineInput.parentPath);
    setInlineInput(null);
  }, [inlineInput, refreshDir]);

  const commitRename = useCallback(async () => {
    if (!renameInput || !renameInput.value.trim() || !window.helioxAPI) return;
    const parentDir = renameInput.node.path.replace(/\/[^/]+$/, '');
    const newPath = `${parentDir}/${renameInput.value.trim()}`;
    const ok = await window.helioxAPI.renamePath(renameInput.node.path, newPath);
    if (ok) await refreshDir(parentDir);
    setRenameInput(null);
  }, [renameInput, refreshDir]);

  const deleteNode = useCallback(async (node: TreeNode) => {
    if (!window.helioxAPI) return;
    const ok = node.isDirectory
      ? await window.helioxAPI.deleteDirectory(node.path)
      : await window.helioxAPI.deleteFile(node.path);
    if (ok) {
      const parentDir = node.path.replace(/\/[^/]+$/, '');
      await refreshDir(parentDir);
      // Close tab if file was deleted
      if (openTabs.some(t => t.path === node.path)) {
        closeTab(node.path);
      }
    }
  }, [refreshDir, openTabs, closeTab]);

  const handleContextMenu = useCallback((e: React.MouseEvent, node: TreeNode | null) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, node });
  }, []);

  useEffect(() => {
    if (!inlineInput) return;
    const target = inlineInput.parentPath === projectPath ? inlineRootRef.current : inlineNestedRef.current;
    target?.focus();
  }, [inlineInput, projectPath]);
  useEffect(() => { renameRef.current?.focus(); renameRef.current?.select(); }, [renameInput]);

  // ── Absorb file-viewer windows dropped onto this explorer ──────
  useEffect(() => {
    const handler = async (e: Event) => {
      const { explorerId, filePath } = (e as CustomEvent).detail;
      if (explorerId !== windowId) return;
      // Avoid duplicates
      if (openTabs.some(t => t.path === filePath)) {
        setActiveTabPath(filePath);
        return;
      }
      if (!window.helioxAPI) return;
      const content = await window.helioxAPI.readFile(filePath);
      if (content !== null) {
        const name = filePath.split('/').pop() ?? filePath;
        const relPath = filePath; // best-effort, matches existing pattern
        const newTab: FileTab = { path: filePath, relPath, name, content, dirty: false };
        setOpenTabs(prev => [...prev, newTab]);
        setActiveTabPath(filePath);
      }
    };
    window.addEventListener('heliox:absorb-file-viewer', handler);
    return () => window.removeEventListener('heliox:absorb-file-viewer', handler);
  }, [windowId, openTabs]);

  // ── Tree Rendering ────────────────────────────────────────────
  const renderNode = (node: TreeNode, depth: number = 0): React.ReactNode => {
    const isExpanded = expandedDirs.has(node.path);
    const isSelected = selectedPath === node.path;
    const isRenaming = renameInput?.node.path === node.path;

    if (isRenaming) {
      return (
        <div key={node.path} style={{ padding: `2px 8px 2px ${(node.isDirectory ? 8 : 24) + depth * 16}px` }}>
          <input
            ref={renameRef}
            data-testid="rename-input"
            value={renameInput!.value}
            onChange={e => setRenameInput({ ...renameInput!, value: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenameInput(null); }}
            onBlur={commitRename}
            style={{
              width: '100%', background: theme.surfaceCard, border: `1px solid ${theme.success}`,
              borderRadius: 3, color: theme.textPrimary, fontSize: 12, padding: '2px 4px',
              fontFamily: theme.fontMono, outline: 'none',
            }}
          />
        </div>
      );
    }

    if (node.isDirectory) {
      return (
        <div key={node.path} role="treeitem" aria-expanded={isExpanded}>
          <button
            onClick={() => toggleDir(node)}
            onContextMenu={e => handleContextMenu(e, node)}
            aria-label={`${node.name} folder`}
            data-testid={`folder-${node.relPath}`}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 5,
              padding: `3px 8px 3px ${8 + depth * 16}px`,
              background: isSelected ? 'rgba(255,255,255,0.05)' : 'none',
              border: 'none', color: theme.textSecondary,
              fontSize: 12, cursor: 'pointer', textAlign: 'left',
            }}
            className="file-tree-item"
          >
            <span aria-hidden="true" style={{
              transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
              transition: 'transform 0.1s', fontSize: 9, flexShrink: 0,
            }}>▼</span>
            <LucideIcon name={isExpanded ? 'FolderOpen' : 'Folder'} size={14}
              style={{ color: '#E8A838', flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>
              {node.name}
            </span>
          </button>
          {isExpanded && (
            <div role="group">
              {inlineInput && inlineInput.parentPath === node.path && (
                <div style={{ padding: `2px 8px 2px ${24 + (depth + 1) * 16}px`, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <LucideIcon name={inlineInput.type === 'folder' ? 'FolderPlus' : 'FilePlus'} size={12} style={{ color: theme.success, flexShrink: 0 }} />
                  <input
                    ref={inlineNestedRef}
                    data-testid="inline-create-input"
                    value={inlineInput.value}
                    onChange={e => setInlineInput({ ...inlineInput, value: e.target.value })}
                    onKeyDown={e => { if (e.key === 'Enter') commitInlineCreate(); if (e.key === 'Escape') setInlineInput(null); }}
                    onBlur={commitInlineCreate}
                    placeholder={inlineInput.type === 'folder' ? 'folder name…' : 'file name…'}
                    style={{
                      flex: 1, background: theme.surfaceCard, border: `1px solid ${theme.success}`,
                      borderRadius: 3, color: theme.textPrimary, fontSize: 12, padding: '2px 6px',
                      fontFamily: theme.fontMono, outline: 'none',
                    }}
                  />
                </div>
              )}
              {node.children?.map(child => renderNode(child, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    // File node
    return (
      <div key={node.path} role="treeitem" aria-label={node.name}>
        <button
          onClick={() => openFileInTab(node)}
          onContextMenu={e => handleContextMenu(e, node)}
          data-testid={`file-${node.relPath}`}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 5,
            padding: `3px 8px 3px ${24 + depth * 16}px`,
            background: isSelected ? 'rgba(255,255,255,0.06)' : 'none',
            border: 'none', color: isSelected ? theme.textPrimary : theme.textMuted,
            fontSize: 12, cursor: 'pointer', textAlign: 'left',
          }}
          className="file-tree-item"
        >
          <LucideIcon name={getFileIcon(node.name)} size={13}
            style={{ color: getFileColor(node.name), flexShrink: 0, opacity: 0.7 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {node.name}
          </span>
        </button>
      </div>
    );
  };

  // ── Context Menu ──────────────────────────────────────────────
  const renderContextMenu = () => {
    if (!ctxMenu) return null;
    const node = ctxMenu.node;
    const isDir = node?.isDirectory ?? true;
    const parentDir = node ? (isDir ? node.path : node.path.replace(/\/[^/]+$/, '')) : projectPath!;

    const items: Array<{ label: string; icon: string; action: () => void; color?: string }> = [];
    if (isDir || !node) {
      items.push({ label: 'New File', icon: 'FilePlus', action: () => {
        if (node && !expandedDirs.has(node.path)) toggleDir(node);
        setInlineInput({ parentPath: parentDir, type: 'file', value: '' });
      }});
      items.push({ label: 'New Folder', icon: 'FolderPlus', action: () => {
        if (node && !expandedDirs.has(node.path)) toggleDir(node);
        setInlineInput({ parentPath: parentDir, type: 'folder', value: '' });
      }});
    }
    if (node) {
      items.push({ label: 'Rename', icon: 'Pencil', action: () => setRenameInput({ node, value: node.name }) });
      items.push({ label: 'Delete', icon: 'Trash2', action: () => deleteNode(node), color: theme.danger });
    }
    items.push({ label: 'Refresh', icon: 'RefreshCw', action: () => refreshDir(node?.isDirectory ? node.path : projectPath!) });

    return createPortal(
      <div
        data-testid="file-context-menu"
        onClick={() => setCtxMenu(null)}
        style={{ position: 'fixed', inset: 0, zIndex: 10001 }}
      >
        <div onClick={e => e.stopPropagation()} style={{
          position: 'absolute', left: ctxMenu.x, top: ctxMenu.y,
          background: theme.surfaceCard, borderRadius: 8,
          border: `1px solid ${theme.borderLight}`,
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          padding: '4px 0', minWidth: 160,
        }}>
          {items.map((item, i) => (
            <button
              key={i}
              data-testid={`file-ctx-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
              onClick={() => { item.action(); setCtxMenu(null); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                width: '100%', padding: '6px 12px',
                background: 'none', border: 'none', cursor: 'pointer',
                color: item.color ?? theme.textSecondary, fontSize: 12,
                fontFamily: theme.fontInter, textAlign: 'left',
              }}
              onMouseEnter={e => { (e.target as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; }}
              onMouseLeave={e => { (e.target as HTMLElement).style.background = 'none'; }}
            >
              <LucideIcon name={item.icon} size={13} style={{ opacity: 0.7, flexShrink: 0 }} />
              {item.label}
            </button>
          ))}
        </div>
      </div>,
      document.body,
    );
  };

  // ── Resizable sidebar ───────────────────────────────────────
  const isResizing = useRef(false);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(220);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    resizeStartX.current = e.clientX;
    resizeStartW.current = sidebarWidth;

    const onMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      const delta = ev.clientX - resizeStartX.current;
      const next = Math.max(120, Math.min(480, resizeStartW.current + delta));
      setSidebarWidth(next);
    };
    const onUp = () => {
      isResizing.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [sidebarWidth]);

  // ── Main Split Layout ─────────────────────────────────────────
  return (
    <div
      data-testid="file-explorer"
      style={{ display: 'flex', height: '100%', background: theme.bg, overflow: 'hidden' }}
    >
      {/* ─── Left: File Tree (always visible) ─────────────────── */}
      <div
        style={{
          width: openTabs.length > 0 ? sidebarWidth : '100%',
          minWidth: 120,
          display: 'flex', flexDirection: 'column',
          borderRight: openTabs.length > 0 ? `1px solid ${theme.borderLight}` : 'none',
          flexShrink: 0,
        }}
        onContextMenu={e => handleContextMenu(e, null)}
      >
        {/* Tree header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
          borderBottom: `1px solid ${theme.borderLight}`, background: theme.surface,
          fontSize: 11, color: theme.textDim, flexShrink: 0, fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          <LucideIcon name="FolderOpen" size={12} style={{ color: '#E8A838' }} />
          Files
          <span style={{ flex: 1 }} />
          <button onClick={() => setInlineInput({ parentPath: projectPath!, type: 'file', value: '' })}
            aria-label="New file" title="New file" data-testid="new-file-btn"
            style={{ background: 'none', border: 'none', color: theme.textGhost, cursor: 'pointer', padding: 2 }}>
            <LucideIcon name="FilePlus" size={13} />
          </button>
          <button onClick={() => setInlineInput({ parentPath: projectPath!, type: 'folder', value: '' })}
            aria-label="New folder" title="New folder" data-testid="new-folder-btn"
            style={{ background: 'none', border: 'none', color: theme.textGhost, cursor: 'pointer', padding: 2 }}>
            <LucideIcon name="FolderPlus" size={13} />
          </button>
          <button onClick={() => refreshDir(projectPath!)}
            aria-label="Refresh files" title="Refresh" data-testid="refresh-files-btn"
            style={{ background: 'none', border: 'none', color: theme.textGhost, cursor: 'pointer', padding: 2 }}>
            <LucideIcon name="RefreshCw" size={12} />
          </button>
        </div>

        {/* Root-level inline create */}
        {inlineInput && inlineInput.parentPath === projectPath && (
          <div style={{ padding: '2px 8px 2px 16px', display: 'flex', alignItems: 'center', gap: 4 }}>
            <LucideIcon name={inlineInput.type === 'folder' ? 'FolderPlus' : 'FilePlus'} size={12} style={{ color: theme.success, flexShrink: 0 }} />
            <input
              ref={inlineRootRef}
              data-testid="inline-create-input"
              value={inlineInput.value}
              onChange={e => setInlineInput({ ...inlineInput, value: e.target.value })}
              onKeyDown={e => { if (e.key === 'Enter') commitInlineCreate(); if (e.key === 'Escape') setInlineInput(null); }}
              onBlur={commitInlineCreate}
              placeholder={inlineInput.type === 'folder' ? 'folder name…' : 'file name…'}
              style={{
                flex: 1, background: theme.surfaceCard, border: `1px solid ${theme.success}`,
                borderRadius: 3, color: theme.textPrimary, fontSize: 12, padding: '2px 6px',
                fontFamily: theme.fontMono, outline: 'none',
              }}
            />
          </div>
        )}

        {/* File tree */}
        <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }} role="tree" aria-label="Project files">
          {loading ? (
            <div style={{ padding: 16, textAlign: 'center', color: theme.textGhost, fontSize: 12 }}>
              <LucideIcon name="Loader2" size={16} style={{ animation: 'spin 1s linear infinite' }} />
              <div style={{ marginTop: 6 }}>Loading files…</div>
            </div>
          ) : rootNodes.length === 0 ? (
            <div style={{ padding: 16, textAlign: 'center', color: theme.textGhost, fontSize: 12 }}>
              No files loaded
            </div>
          ) : (
            rootNodes.map(node => renderNode(node))
          )}
        </div>
      </div>

      {/* ─── Resize Handle ────────────────────────────────────── */}
      {openTabs.length > 0 && (
        <div
          onMouseDown={handleResizeStart}
          style={{
            width: 5,
            cursor: 'col-resize',
            flexShrink: 0,
            background: 'transparent',
            transition: 'background 0.15s ease',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(129,140,248,0.25)'; }}
          onMouseLeave={e => { if (!isResizing.current) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          title="Drag to resize"
        />
      )}

      {/* ─── Right: Tabbed Editor Panel ───────────────────────── */}
      {openTabs.length > 0 && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
          {/* Tab bar */}
          <div
            data-testid="file-tabs"
            style={{
              display: 'flex', alignItems: 'center',
              borderBottom: `1px solid ${theme.borderLight}`,
              background: theme.surface, flexShrink: 0,
              overflow: 'auto', gap: 0,
            }}
          >
            {openTabs.map(tab => {
              const isActive = tab.path === activeTabPath;
              return (
                <div
                  key={tab.path}
                  data-testid={`file-tab-${tab.name}`}
                  onMouseDown={(e) => handleTabMouseDown(e, tab.path)}
                  onClick={() => setActiveTabPath(tab.path)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    padding: '5px 8px', cursor: 'pointer',
                    background: isActive ? theme.surfaceCard : 'transparent',
                    borderBottom: isActive ? `2px solid ${getFileColor(tab.name)}` : '2px solid transparent',
                    borderRight: `1px solid ${theme.borderLight}`,
                    transition: 'background 0.1s ease',
                    flexShrink: 0, maxWidth: 180,
                  }}
                >
                  <LucideIcon name={getFileIcon(tab.name)} size={12}
                    style={{ color: getFileColor(tab.name), flexShrink: 0, opacity: 0.7 }} />
                  <span style={{
                    fontSize: 11, color: isActive ? theme.textPrimary : theme.textDim,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    fontWeight: isActive ? 600 : 400,
                  }}>
                    {tab.name}
                  </span>
                  {tab.dirty && (
                    <span style={{ fontSize: 8, color: theme.warning, fontWeight: 700, flexShrink: 0 }}>●</span>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); closeTab(tab.path); }}
                    aria-label={`Close ${tab.name}`}
                    style={{
                      background: 'none', border: 'none', padding: 0,
                      color: theme.textGhost, cursor: 'pointer', display: 'flex',
                      marginLeft: 2, flexShrink: 0,
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = theme.textPrimary; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = theme.textGhost; }}
                  >
                    <LucideIcon name="X" size={10} />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Editor area */}
          {activeTab ? (
            <div style={{ flex: 1, position: 'relative', background: '#2B2B2B' }}>
              <CodeEditor
                editorKey={activeTab.path}
                fileName={activeTab.name}
                value={activeTab.content}
                onChange={(v) => updateTabContent(activeTab.path, v)}
                onSave={handleCurrentTabSave}
                scrollbarSize={10}
              />
              {/* Save indicator */}
              {activeTab.dirty && (
                <button
                  onClick={() => saveTab(activeTab.path)}
                  disabled={saving}
                  data-testid="file-editor-save"
                  style={{
                    position: 'absolute', top: 8, right: 12, zIndex: 5,
                    background: 'rgba(160,246,149,0.12)',
                    border: `1px solid ${theme.success}`,
                    borderRadius: 4, padding: '3px 10px', fontSize: 11,
                    color: theme.success, cursor: 'pointer', fontWeight: 600,
                    backdropFilter: 'blur(8px)',
                  }}
                >
                  {saving ? 'Saving…' : '⌘S Save'}
                </button>
              )}
            </div>
          ) : (
            <div style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: theme.textGhost, fontSize: 12,
            }}>
              Select a tab to view its contents
            </div>
          )}
        </div>
      )}

      {renderContextMenu()}
    </div>
  );
}
