/**
 * FileTree.tsx — Renderer Composite Component
 *
 * Responsibility:
 * - Renders the FileTree surface in the renderer layer.
 * - Encapsulates Feature-level composition used by the renderer shell and panels.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/FileTree.tsx — Project file tree browser with search, icons, and context menu
import React, { useState, useEffect, useCallback } from 'react';
import { useHelioxStore } from '../store';
import type { FileEntry } from '@/types';
import { FileTreeContextMenu } from './FileTreeContextMenu';
import type { ContextMenuState } from './FileTreeContextMenu';
import { FileTreeNode } from './FileTreeNode';
import { theme } from '../logic/theme';

// ─── FileTree (exported) ─────────────────────────────────────────

export function FileTree() {
  const projectPath = useHelioxStore((s) => s.projectPath);
  const setOpenFilePath = useHelioxStore((s) => s.setOpenFilePath);
  const addToast = useHelioxStore((s) => s.addToast);
  const addLogEntry = useHelioxStore((s) => s.addLogEntry);
  const [rootEntries, setRootEntries] = useState<FileEntry[]>([]);
  const [filter, setFilter] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingEntry, setRenamingEntry] = useState<FileEntry | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<FileEntry | null>(null);
  const [historyLines, setHistoryLines] = useState<string[] | null>(null);
  const [historyEntry, setHistoryEntry] = useState<FileEntry | null>(null);

  const refreshEntries = useCallback(() => {
    if (!projectPath || !window.helioxAPI) return;
    window.helioxAPI.readDirectory(projectPath).then(setRootEntries);
  }, [projectPath]);

  useEffect(() => { refreshEntries(); }, [refreshEntries]);

  const handleDoubleClick = useCallback((entry: FileEntry) => {
    if (!entry.isDirectory) {
      setOpenFilePath(entry.path);
    }
  }, [setOpenFilePath]);

  const handleContextMenu = useCallback((e: React.MouseEvent, entry: FileEntry) => {
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  }, []);

  // Rename handler
  const handleRename = useCallback((entry: FileEntry) => {
    setRenamingEntry(entry);
    setRenameValue(entry.name);
  }, []);

  const submitRename = useCallback(async () => {
    if (!renamingEntry || !renameValue.trim() || !projectPath || !window.helioxAPI) {
      setRenamingEntry(null);
      return;
    }
    if (renameValue === renamingEntry.name) {
      setRenamingEntry(null);
      return;
    }
    try {
      const dir = renamingEntry.path.substring(0, renamingEntry.path.lastIndexOf('/'));
      const newPath = `${dir}/${renameValue}`;
      // Use git mv if available, otherwise fall back to OS rename via a shell-like approach
      // Since we only have IPC, we use a write-based approach: read, write new, delete old
      // But simplest is to just ask the main process. For now, let the agent handle rename via git.
      // We'll dispatch a rename event that the main process can handle.
      const result = await (window.helioxAPI as any).renameFile?.(renamingEntry.path, newPath);
      if (result === false) {
        addToast(`Failed to rename ${renamingEntry.name}`, 'error');
      } else {
        addToast(`Renamed to ${renameValue}`, 'success');
        addLogEntry({ timestamp: Date.now(), level: 'info', message: `Renamed: ${renamingEntry.name} → ${renameValue}` });
        refreshEntries();
      }
    } catch {
      addToast(`Rename not supported yet — use the terminal`, 'info');
    }
    setRenamingEntry(null);
  }, [renamingEntry, renameValue, projectPath, addToast, addLogEntry, refreshEntries]);

  // Delete handler
  const handleDelete = useCallback((entry: FileEntry) => {
    setDeleteConfirm(entry);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!deleteConfirm || !window.helioxAPI) return;
    try {
      const result = await (window.helioxAPI as any).deleteFile?.(deleteConfirm.path);
      if (result === false) {
        addToast(`Failed to delete ${deleteConfirm.name}`, 'error');
      } else {
        addToast(`Deleted ${deleteConfirm.name}`, 'success');
        addLogEntry({ timestamp: Date.now(), level: 'info', message: `Deleted: ${deleteConfirm.name}` });
        refreshEntries();
      }
    } catch {
      addToast(`Delete not supported yet — use the terminal`, 'info');
    }
    setDeleteConfirm(null);
  }, [deleteConfirm, addToast, addLogEntry, refreshEntries]);

  // View change history handler
  const handleViewHistory = useCallback(async (entry: FileEntry) => {
    if (!projectPath || !window.helioxAPI) return;
    const relativePath = entry.path.startsWith(projectPath)
      ? entry.path.slice(projectPath.length + 1)
      : entry.path;
    try {
      // Use git log for this file via the existing gitDiffFiles or a custom method
      const log = await (window.helioxAPI as any).gitFileLog?.(projectPath, relativePath);
      if (log && typeof log === 'string') {
        setHistoryLines(log.split('\n').filter((l: string) => l.trim()));
        setHistoryEntry(entry);
      } else {
        addToast(`No git history for ${entry.name}`, 'info');
      }
    } catch {
      addToast(`History not available — file may not be tracked`, 'info');
    }
  }, [projectPath, addToast]);

  return (
    <div className="flex flex-col h-full" style={{ background: theme.bgApp }}>
      {/* Search filter */}
      <div className="px-2 pt-2 pb-1 shrink-0">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter files…"
          aria-label="Filter files"
          className="w-full px-3 py-1.5 rounded-md text-xs outline-none"
          style={{
            fontFamily: theme.fontManrope,
            color: theme.textTertiary,
            background: theme.surfaceLight,
            border: '1px solid rgba(63,63,70,0.2)',
          }}
        />
      </div>

      {/* Inline rename input */}
      {renamingEntry && (
        <div className="px-3 py-2 shrink-0" style={{ background: theme.surfaceLight, borderBottom: `1px solid ${theme.borderLight}` }}>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide" style={{ fontFamily: theme.fontInter, color: theme.textFaint }}>Rename</span>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitRename();
                if (e.key === 'Escape') setRenamingEntry(null);
              }}
              autoFocus
              aria-label="Rename file"
              className="flex-1 px-2 py-1 rounded text-xs outline-none"
              style={{ fontFamily: theme.fontMono, color: theme.textPrimary, background: theme.bg, border: `1px solid ${theme.borderLight}` }}
            />
            <button
              onClick={submitRename}
              className="px-2 py-1 rounded text-[10px] cursor-pointer"
              style={{ fontFamily: theme.fontManrope, color: theme.success, background: theme.successBg }}
            >
              OK
            </button>
            <button
              onClick={() => setRenamingEntry(null)}
              className="px-2 py-1 rounded text-[10px] cursor-pointer"
              style={{ fontFamily: theme.fontManrope, color: theme.textMuted }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div className="px-3 py-2 shrink-0" style={{ background: 'rgba(240,37,37,0.08)', borderBottom: `1px solid rgba(240,37,37,0.2)` }}>
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ fontFamily: theme.fontManrope, color: theme.danger }}>
              Delete "{deleteConfirm.name}"?
            </span>
            <button
              onClick={confirmDelete}
              className="px-2 py-1 rounded text-[10px] cursor-pointer"
              style={{ fontFamily: theme.fontManrope, color: '#fff', background: theme.danger }}
            >
              Delete
            </button>
            <button
              onClick={() => setDeleteConfirm(null)}
              className="px-2 py-1 rounded text-[10px] cursor-pointer"
              style={{ fontFamily: theme.fontManrope, color: theme.textMuted }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* History overlay */}
      {historyLines && historyEntry && (
        <div className="px-3 py-2 shrink-0 max-h-48 overflow-y-auto" style={{ background: theme.surfaceLight, borderBottom: `1px solid ${theme.borderLight}` }}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] uppercase tracking-wide" style={{ fontFamily: theme.fontInter, color: theme.textFaint }}>
              History — {historyEntry.name}
            </span>
            <button
              onClick={() => { setHistoryLines(null); setHistoryEntry(null); }}
              className="text-xs px-1 cursor-pointer"
              style={{ color: theme.textMuted }}
            >
              ✕
            </button>
          </div>
          {historyLines.map((line, i) => (
            <div key={i} className="text-[10px] py-0.5" style={{ fontFamily: theme.fontMono, color: theme.textDim }}>
              {line}
            </div>
          ))}
        </div>
      )}

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1" role="tree" aria-label="File explorer">
        {rootEntries.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <span className="text-sm" style={{ fontFamily: theme.fontManrope, color: theme.textFaint }}>
              No files found
            </span>
          </div>
        ) : (
          rootEntries.map((entry) => (
            <FileTreeNode
              key={entry.path}
              entry={entry}
              depth={0}
              onDoubleClick={handleDoubleClick}
              onContextMenu={handleContextMenu}
              filter={filter}
            />
          ))
        )}
      </div>

      {/* Context menu */}
      {contextMenu && projectPath && (
        <FileTreeContextMenu
          state={contextMenu}
          onClose={() => setContextMenu(null)}
          projectPath={projectPath}
          onRename={handleRename}
          onDelete={handleDelete}
          onViewHistory={handleViewHistory}
        />
      )}
    </div>
  );
}

