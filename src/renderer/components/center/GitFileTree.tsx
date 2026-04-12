/**
 * GitFileTree.tsx — Renderer Center Panel Component
 *
 * Responsibility:
 * - Renders the GitFileTree surface in the renderer layer.
 * - Encapsulates Center-pane visualization for sessions, diffs, and code context.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/center/GitFileTree.tsx — Tree wrapper for git file entries
import React, { useCallback } from 'react';
import { useHelioxStore } from '@/renderer/store';
import { GitFileTreeNode } from './GitFileTreeNode';
import type { GitEntry } from './helpers';

export function GitFileTree({ entries, projectPath }: { entries: GitEntry[]; projectPath: string }) {
  const setOpenFilePath = useHelioxStore((s) => s.setOpenFilePath);
  const handleOpen = useCallback((path: string) => setOpenFilePath(path), [setOpenFilePath]);

  return (
    <div className="overflow-y-auto h-full py-1">
      {entries.map(entry => (
        <GitFileTreeNode key={entry.path} entry={entry} depth={0} onOpenFile={handleOpen} />
      ))}
    </div>
  );
}
