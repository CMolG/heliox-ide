/**
 * FileTreeContextMenu.tsx — Renderer Composite Component
 *
 * Responsibility:
 * - Renders the FileTreeContextMenu surface in the renderer layer.
 * - Encapsulates Feature-level composition used by the renderer shell and panels.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/FileTreeContextMenu.tsx — Right-click context menu for file tree entries
import React, { useEffect, useRef } from 'react';
import type { FileEntry } from '@/types';
import { theme } from '../logic/theme';

export interface ContextMenuState {
  x: number;
  y: number;
  entry: FileEntry;
}

export function FileTreeContextMenu({ state, onClose, projectPath, onRename, onDelete, onViewHistory }: {
  state: ContextMenuState;
  onClose: () => void;
  projectPath: string;
  onRename: (entry: FileEntry) => void;
  onDelete: (entry: FileEntry) => void;
  onViewHistory: (entry: FileEntry) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  {/* TODO duplicate, solve it */}
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const relativePath = state.entry.path.startsWith(projectPath)
    ? state.entry.path.slice(projectPath.length + 1)
    : state.entry.path;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    onClose();
  };

  const items: { label: string; action: () => void; danger?: boolean; separator?: boolean }[] = [
    { label: 'Copy path', action: () => copyToClipboard(relativePath) },
    { label: 'Copy full path', action: () => copyToClipboard(state.entry.path) },
  ];

  if (state.entry.isDirectory) {
    items.push({
      label: 'Open in terminal',
      action: () => {
        if (window.helioxAPI) {
          window.helioxAPI.openFileDialog?.(state.entry.path);
        }
        onClose();
      },
    });
  }

  items.push({ label: '', action: () => {}, separator: true });
  items.push({
    label: 'Rename…',
    action: () => { onRename(state.entry); onClose(); },
  });
  items.push({
    label: 'View Change History',
    action: () => { onViewHistory(state.entry); onClose(); },
  });
  items.push({ label: '', action: () => {}, separator: true });
  items.push({
    label: 'Delete',
    action: () => { onDelete(state.entry); onClose(); },
    danger: true,
  });

  return (
    <div
      ref={menuRef}
      className="fixed z-50 py-1 rounded-lg shadow-xl"
      role="menu"
      style={{
        left: state.x,
        top: state.y,
        background: theme.surfaceRaised,
        border: '1px solid rgba(63,63,70,0.3)',
        minWidth: 200,
      }}
    >
      {items.map((item, i) =>
        item.separator ? (
          <div key={`sep-${i}`} className="my-1 mx-2" style={{ height: 1, background: 'rgba(63,63,70,0.3)' }} />
        ) : (
          <button
            key={item.label}
            onClick={item.action}
            role="menuitem"
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/8 transition cursor-pointer"
            style={{
              fontFamily: theme.fontManrope,
              color: item.danger ? theme.danger : theme.textTertiary,
            }}
          >
            {item.label}
          </button>
        )
      )}
    </div>
  );
}
