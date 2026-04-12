/**
 * FileTreeNode.tsx — Renderer Composite Component
 *
 * Responsibility:
 * - Renders the FileTreeNode surface in the renderer layer.
 * - Encapsulates Feature-level composition used by the renderer shell and panels.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/FileTreeNode.tsx — Recursive tree node for the file explorer
import React, { useState, useEffect, useCallback } from 'react';
import type { FileEntry } from '@/types';
import { getFileIcon, getFolderIcon } from '../logic/file-icons';
import { fuzzyMatch } from './file-tree-helpers';
import { theme } from '../logic/theme';

export function FileTreeNode({ entry, depth, onDoubleClick, onContextMenu, filter }: {
  entry: FileEntry;
  depth: number;
  onDoubleClick: (entry: FileEntry) => void;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void;
  filter: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [children, setChildren] = useState<FileEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const shouldAutoExpand = filter.length > 0 && entry.isDirectory;

  useEffect(() => {
    if (shouldAutoExpand && children.length === 0 && window.helioxAPI) {
      setIsLoading(true);
      window.helioxAPI.readDirectory(entry.path).then((entries) => {
        setChildren(entries);
        setIsLoading(false);
        setIsOpen(true);
      }).catch(() => setIsLoading(false));
    }
  }, [shouldAutoExpand, children.length, entry.path]);

  useEffect(() => {
    if (shouldAutoExpand && children.length > 0) setIsOpen(true);
  }, [shouldAutoExpand, children.length]);

  const toggle = useCallback(async () => {
    if (!entry.isDirectory) return;

    if (isOpen) {
      setIsOpen(false);
      return;
    }

    if (children.length === 0 && window.helioxAPI) {
      setIsLoading(true);
      try {
        const entries = await window.helioxAPI.readDirectory(entry.path);
        setChildren(entries);
      } catch { /* ignore */ }
      setIsLoading(false);
    }
    setIsOpen(true);
  }, [entry, isOpen, children.length]);

  const handleDoubleClick = useCallback(() => {
    if (!entry.isDirectory) {
      onDoubleClick(entry);
    }
  }, [entry, onDoubleClick]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    onContextMenu(e, entry);
  }, [entry, onContextMenu]);

  // Filter logic: if filter active, hide non-matching files; always show directories that might have matching children
  if (filter) {
    if (!entry.isDirectory && !fuzzyMatch(filter, entry.name)) return null;
    if (entry.isDirectory && isOpen && children.length > 0) {
      const hasVisibleChild = children.some(c =>
        c.isDirectory || fuzzyMatch(filter, c.name)
      );
      if (!hasVisibleChild) return null;
    }
  }

  const icon = entry.isDirectory ? getFolderIcon(isOpen) : getFileIcon(entry.name);

  return (
    <div role="treeitem" aria-expanded={entry.isDirectory ? isOpen : undefined}>
      <button
        onClick={toggle}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        className="w-full flex items-center gap-2 py-1 px-2 hover:bg-white/5 transition rounded-sm group cursor-pointer"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <span className="text-xs shrink-0" style={{ fontSize: '13px', lineHeight: 1 }}>
          {icon}
        </span>
        <span
          className="text-sm truncate"
          style={{
            fontFamily: entry.isDirectory ? theme.fontGrotesk : theme.fontManrope,
            color: entry.isDirectory ? theme.textSecondary : theme.textMuted,
            fontWeight: entry.isDirectory ? 500 : 400,
          }}
        >
          {entry.name}
        </span>
        {isLoading && (
          <span className="text-xs ml-auto" style={{ color: theme.textFaint }}>…</span>
        )}
      </button>

      {isOpen && (
        <div role="group">
          {children.map((child) => (
            <FileTreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              onDoubleClick={onDoubleClick}
              onContextMenu={onContextMenu}
              filter={filter}
            />
          ))}
        </div>
      )}
    </div>
  );
}
