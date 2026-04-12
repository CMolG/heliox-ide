/**
 * CodeDiffView.tsx — Renderer Center Panel Component
 *
 * Responsibility:
 * - Renders the CodeDiffView surface in the renderer layer.
 * - Encapsulates Center-pane visualization for sessions, diffs, and code context.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/center/CodeDiffView.tsx — Code diff viewer panel
import React, { useState, useEffect, useCallback } from 'react';
import { useHelioxStore } from '@/renderer/store';
import { theme } from '@/renderer/logic/theme';
import type { DiffHunk, ParsedFileDiff } from './helpers';
import { FileDiffCard } from './FileDiffCard';

// ─── Unified diff parser ─────────────────────────────────────────

function parseUnifiedDiff(raw: string): ParsedFileDiff[] {
  const files: ParsedFileDiff[] = [];
  let current: ParsedFileDiff | null = null;
  let currentHunk: DiffHunk | null = null;

  for (const line of raw.split('\n')) {
    if (line.startsWith('diff --git ')) {
      if (current) files.push(current);
      const match = line.match(/diff --git a\/(.*) b\/(.*)/);
      current = {
        path: match?.[2] ?? line.slice(10),
        oldPath: match?.[1] ?? line.slice(10),
        hunks: [],
        linesAdded: 0,
        linesRemoved: 0,
        isNew: false,
        isDeleted: false,
      };
      currentHunk = null;
    } else if (line.startsWith('new file mode')) {
      if (current) current.isNew = true;
    } else if (line.startsWith('deleted file mode')) {
      if (current) current.isDeleted = true;
    } else if (line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('index ')) {
      // skip header lines
    } else if (line.startsWith('@@ ')) {
      if (current) {
        currentHunk = { header: line, lines: [] };
        current.hunks.push(currentHunk);
      }
    } else if (currentHunk && current) {
      if (line.startsWith('+')) {
        currentHunk.lines.push({ type: '+', content: line.slice(1) });
        current.linesAdded++;
      } else if (line.startsWith('-')) {
        currentHunk.lines.push({ type: '-', content: line.slice(1) });
        current.linesRemoved++;
      } else if (line.startsWith(' ') || line === '') {
        currentHunk.lines.push({ type: ' ', content: line.slice(1) });
      }
    }
  }
  if (current) files.push(current);
  return files.filter(f => f.hunks.length > 0 || f.isNew || f.isDeleted);
}

// ─── Code Diff View ──────────────────────────────────────────────

export function CodeDiffView() {
  const projectPath = useHelioxStore((s) => s.projectPath);
  const selectedSessionId = useHelioxStore((s) => s.selectedSessionId);
  const sessionChangedFiles = useHelioxStore((s) => s.sessionChangedFiles);
  const isRunningAgent = useHelioxStore((s) => s.isRunningAgent);
  const [rawDiff, setRawDiff] = useState('');
  const [loading, setLoading] = useState(false);

  const sessionFiles = selectedSessionId
    ? (sessionChangedFiles[selectedSessionId] ?? [])
    : [];
  const sessionFilePaths = new Set(sessionFiles.map(f => f.path));

  const load = useCallback(() => {
    if (!projectPath || !window.helioxAPI) return;
    setLoading(true);
    const filePaths = sessionFiles.map(f => f.path);
    const diffPromise = filePaths.length > 0
      ? window.helioxAPI.gitDiffFiles(projectPath, filePaths)
      : window.helioxAPI.gitDiff(projectPath);
    diffPromise
      .then(d => { setRawDiff(d); setLoading(false); })
      .catch(() => { setRawDiff(''); setLoading(false); });
  }, [projectPath, sessionFiles]);

  useEffect(() => { load(); }, [load]);

  const parsedFiles = parseUnifiedDiff(rawDiff);

  // Sort: session files first, then rest alphabetically
  const sorted = [...parsedFiles].sort((a, b) => {
    const aSession = sessionFilePaths.has(a.path);
    const bSession = sessionFilePaths.has(b.path);
    if (aSession && !bSession) return -1;
    if (!aSession && bSession) return 1;
    return a.path.localeCompare(b.path);
  });

  const totalAdded = parsedFiles.reduce((s, f) => s + f.linesAdded, 0);
  const totalRemoved = parsedFiles.reduce((s, f) => s + f.linesRemoved, 0);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="text-sm" style={{ color: theme.textFaint }}>Loading diff…</span>
      </div>
    );
  }

  if (parsedFiles.length === 0) {
    return (
      <div className="h-full flex items-center justify-center flex-col gap-3">
        <div className="text-2xl" style={{ opacity: 0.15 }}>◈</div>
        <span className="text-sm" style={{ fontFamily: theme.fontManrope, color: theme.textFaint }}>
          {isRunningAgent ? 'Agent is running…' : sessionFiles.length > 0 ? 'No unstaged changes for this session' : 'No changes in working tree'}
        </span>
        {!isRunningAgent && (
          <button
            onClick={load}
            className="text-xs px-3 py-1 rounded transition hover:bg-white/5"
            style={{ color: theme.textDim }}
          >
            Refresh
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-0 h-full">
      {/* Toolbar */}
      <div
        className="flex items-center justify-between px-4 py-2.5 shrink-0"
        style={{ borderBottom: `1px solid ${theme.border}` }}
      >
        <div className="flex items-center gap-3">
          <span
            className="text-[10px] font-bold uppercase tracking-widest"
            style={{ fontFamily: theme.fontInter, color: theme.textFaint }}
          >
            {sessionFiles.length > 0 ? 'Session Changes' : 'Working Tree'}
          </span>
          <span
            className="text-[11px] px-2 py-0.5 rounded-full"
            style={{ background: theme.surfaceLight, color: theme.textDim, fontFamily: theme.fontMono }}
          >
            {parsedFiles.length} {parsedFiles.length === 1 ? 'file' : 'files'}
          </span>
          {totalAdded > 0 && (
            <span className="text-[11px] font-semibold" style={{ fontFamily: theme.fontMono, color: '#A0F695' }}>
              +{totalAdded}
            </span>
          )}
          {totalRemoved > 0 && (
            <span className="text-[11px] font-semibold" style={{ fontFamily: theme.fontMono, color: '#F02525' }}>
              −{totalRemoved}
            </span>
          )}
        </div>
        <button
          onClick={load}
          className="text-[10px] px-2 py-0.5 rounded transition hover:bg-white/5"
          style={{ color: theme.textDim }}
          aria-label="Refresh diff"
        >
          ↺ Refresh
        </button>
      </div>

      {/* Bento card list */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-3">
        {sorted.map((file) => (
          <FileDiffCard
            key={file.path}
            file={file}
            isSessionFile={sessionFilePaths.has(file.path)}
            sessionStats={sessionFiles.find(f => f.path === file.path)}
          />
        ))}
      </div>
    </div>
  );
}
