/**
 * GitFilesView.tsx — Renderer Center Panel Component
 *
 * Responsibility:
 * - Renders the GitFilesView surface in the renderer layer.
 * - Encapsulates Center-pane visualization for sessions, diffs, and code context.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/center/GitFilesView.tsx — Git status file list
import React, { useState, useEffect, useCallback } from 'react';
import { useHelioxStore } from '@/renderer/store';
import { theme } from '@/renderer/logic/theme';
import { GIT_STATUS, type GitEntry } from './helpers';
import { GitFileTree } from './GitFileTree';

export function GitFilesView() {
  const projectPath = useHelioxStore((s) => s.projectPath);
  const [fileStatuses, setFileStatuses] = useState<Array<{ path: string; status: string }>>([]);
  const [allEntries, setAllEntries] = useState<Array<{ path: string; name: string; isDir: boolean; gitStatus?: string }>>([]);
  const [loading, setLoading] = useState(false);
  const setOpenFilePath = useHelioxStore((s) => s.setOpenFilePath);

  const refresh = useCallback(async () => {
    if (!projectPath || !window.helioxAPI) return;
    setLoading(true);
    try {
      const [rootDir, statuses] = await Promise.all([
        window.helioxAPI.readDirectory(projectPath),
        window.helioxAPI.gitFileStatuses(projectPath).catch(() => [] as Array<{ path: string; status: string }>),
      ]);
      setFileStatuses(statuses);
      const statusMap = new Map(statuses.map(s => [s.path, s.status]));
      const entries = rootDir.map(e => {
        const rel = e.path.startsWith(projectPath + '/') ? e.path.slice(projectPath.length + 1) : e.path;
        return { path: e.path, name: e.name, isDir: e.isDirectory, gitStatus: statusMap.get(rel) };
      });
      setAllEntries(entries);
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => { refresh(); }, [refresh]);

  // Refresh on file changes
  useEffect(() => {
    const handler = () => refresh();
    window.addEventListener('heliox:files-changed', handler);
    return () => window.removeEventListener('heliox:files-changed', handler);
  }, [refresh]);

  const changedFiles = fileStatuses.length;

  return (
    <div className="flex flex-col h-full" style={{ background: theme.bgApp }}>
      <div className="px-4 pt-3 pb-2 flex items-center justify-between shrink-0">
        <span className="text-[10px] font-bold uppercase tracking-wide" style={{ fontFamily: theme.fontInter, color: theme.textFaint }}>
          Working Tree {changedFiles > 0 ? `· ${changedFiles} changed` : '· clean'}
        </span>
        <button
          onClick={refresh}
          className="text-[10px] px-2 py-0.5 rounded transition hover:bg-white/5"
          style={{ fontFamily: theme.fontInter, color: theme.textDim }}
          title="Refresh"
        >
          ↺
        </button>
      </div>

      {/* Changed files summary at top */}
      {fileStatuses.length > 0 && (
        <div className="px-4 pb-2 shrink-0 flex flex-col gap-1 max-h-40 overflow-y-auto">
          {fileStatuses.map(({ path, status }) => (
            <button
              key={path}
              onClick={() => setOpenFilePath(projectPath ? `${projectPath}/${path}` : path)}
              className="flex items-center gap-2 py-0.5 text-left hover:bg-white/5 rounded transition px-1"
            >
              <span
                className="text-[9px] font-bold w-3 shrink-0"
                style={{ color: GIT_STATUS[status]?.color ?? theme.textDim }}
              >
                {GIT_STATUS[status]?.label ?? '?'}
              </span>
              <span className="text-[11px] truncate" style={{ fontFamily: theme.fontMono, color: GIT_STATUS[status]?.color ?? theme.textMuted }}>
                {path}
              </span>
            </button>
          ))}
        </div>
      )}

      {fileStatuses.length > 0 && (
        <div className="mx-4 mb-2 shrink-0" style={{ borderBottom: `1px solid ${theme.border}` }} />
      )}

      {/* Full file tree */}
      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <span className="text-xs" style={{ color: theme.textFaint }}>Loading…</span>
          </div>
        ) : (
          <GitFileTree entries={allEntries} projectPath={projectPath ?? ''} />
        )}
      </div>
    </div>
  );
}
