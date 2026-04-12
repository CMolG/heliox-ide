/**
 * GitFileTreeNode.tsx — Renderer Center Panel Component
 *
 * Responsibility:
 * - Renders the GitFileTreeNode surface in the renderer layer.
 * - Encapsulates Center-pane visualization for sessions, diffs, and code context.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/center/GitFileTreeNode.tsx — Recursive tree node for git files
import React, { useState, useCallback } from 'react';
import { getFileIcon, getFolderIcon } from '@/renderer/logic/file-icons';
import { theme } from '@/renderer/logic/theme';
import { GIT_STATUS, type GitEntry } from './helpers';

export function GitFileTreeNode({ entry, depth, onOpenFile }: {
  entry: GitEntry;
  depth: number;
  onOpenFile: (path: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [children, setChildren] = useState<GitEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const toggle = useCallback(async () => {
    if (!entry.isDir) {
      onOpenFile(entry.path);
      return;
    }
    if (isOpen) {
      setIsOpen(false);
      return;
    }
    if (children.length === 0 && window.helioxAPI) {
      setIsLoading(true);
      try {
        const raw = await window.helioxAPI.readDirectory(entry.path);
        setChildren(raw.map(e => ({ path: e.path, name: e.name, isDir: e.isDirectory })));
      } catch { /* ignore */ }
      setIsLoading(false);
    }
    setIsOpen(true);
  }, [entry, isOpen, children.length, onOpenFile]);

  const color = entry.gitStatus ? (GIT_STATUS[entry.gitStatus]?.color ?? theme.textMuted) : entry.isDir ? theme.textSecondary : theme.textMuted;
  const icon = entry.isDir ? getFolderIcon(isOpen, 12) : getFileIcon(entry.name, 12);

  return (
    <div>
      <button
        onClick={toggle}
        className="w-full flex items-center gap-2 py-1 hover:bg-white/5 transition rounded-sm"
        style={{ paddingLeft: `${depth * 14 + 12}px` }}
      >
        <span style={{ lineHeight: 1, flexShrink: 0 }}>{icon}</span>
        <span
          className="text-sm truncate"
          style={{ fontFamily: entry.isDir ? theme.fontGrotesk : theme.fontManrope, color, fontWeight: entry.isDir ? 500 : 400 }}
        >
          {entry.name}
        </span>
        {entry.gitStatus && (
          <span className="ml-auto text-[9px] font-bold shrink-0" style={{ color: GIT_STATUS[entry.gitStatus]?.color }}>
            {GIT_STATUS[entry.gitStatus]?.label}
          </span>
        )}
        {isLoading && <span className="ml-auto text-xs" style={{ color: theme.textFaint }}>…</span>}
      </button>
      {isOpen && children.map(child => (
        <GitFileTreeNode key={child.path} entry={child} depth={depth + 1} onOpenFile={onOpenFile} />
      ))}
    </div>
  );
}
