/**
 * FileDiffCard.tsx — Renderer Center Panel Component
 *
 * Responsibility:
 * - Renders the FileDiffCard surface in the renderer layer.
 * - Encapsulates Center-pane visualization for sessions, diffs, and code context.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/center/FileDiffCard.tsx — Card showing file diffs
import React, { useState } from 'react';
import { getFileIcon } from '@/renderer/logic/file-icons';
import { theme } from '@/renderer/logic/theme';
import type { ParsedFileDiff } from './helpers';
import { DiffBadge } from './DiffBadge';

const DIFF_CLR: Record<string, { bg: string; mark: string; text: string }> = {
  '+': { bg: 'rgba(160,246,149,0.06)', mark: '#A0F695', text: '#c8ffc2' },
  '-': { bg: 'rgba(240,37,37,0.06)', mark: '#F02525', text: '#ff8080' },
};

export function FileDiffCard({
  file,
  isSessionFile,
  sessionStats,
}: {
  file: ParsedFileDiff;
  isSessionFile: boolean;
  sessionStats?: { linesAdded: number; linesRemoved: number };
}) {
  const [collapsed, setCollapsed] = useState(true);
  const fileName = file.path.split('/').pop() ?? file.path;
  const dirPath = file.path.includes('/')
    ? file.path.slice(0, file.path.lastIndexOf('/'))
    : '';
  const fileIcon = getFileIcon(fileName, 11);

  const added = file.linesAdded;
  const removed = file.linesRemoved;
  const totalLines = file.hunks.reduce((s, h) => s + h.lines.length, 0);

  return (
    <div
      className="rounded-xl overflow-hidden transition-all shrink-0"
      style={{
        background: '#0d0d0d',
        border: isSessionFile
          ? '1px solid rgba(99,102,241,0.35)'
          : `1px solid ${theme.border}`,
        boxShadow: isSessionFile
          ? '0 0 0 1px rgba(99,102,241,0.1), inset 0 1px 0 rgba(255,255,255,0.04)'
          : 'inset 0 1px 0 rgba(255,255,255,0.03)',
      }}
    >
      {/* Card header */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full min-w-0 flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/2"
        style={{ cursor: 'pointer' }}
        aria-label={collapsed ? 'Expand diff' : 'Collapse diff'}
      >
        {/* File icon + name */}
        <span style={{ lineHeight: 1, flexShrink: 0 }}>{fileIcon}</span>
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          {dirPath && (
            <span
              className="text-[11px] truncate"
              style={{ fontFamily: theme.fontMono, color: theme.textFaint }}
            >
              {dirPath}/
            </span>
          )}
          <span
            className="text-[12px] font-semibold truncate"
            style={{ fontFamily: theme.fontMono, color: theme.textPrimary }}
          >
            {fileName}
          </span>
          {file.isNew && (
            <DiffBadge label="new" bg="rgba(160,246,149,0.12)" color="#A0F695" border="1px solid rgba(160,246,149,0.2)" />
          )}
          {file.isDeleted && (
            <DiffBadge label="deleted" bg="rgba(240,37,37,0.12)" color="#F02525" border="1px solid rgba(240,37,37,0.2)" />
          )}
          {isSessionFile && (
            <DiffBadge label="this session" bg="rgba(99,102,241,0.15)" color="#818cf8" border="1px solid rgba(99,102,241,0.25)" />
          )}
        </div>

        {/* Stats */}
        <div className="flex items-center gap-2 shrink-0">
          {added > 0 && (
            <span
              className="text-[11px] font-mono font-semibold"
              style={{ color: '#A0F695' }}
            >
              +{added}
            </span>
          )}
          {removed > 0 && (
            <span
              className="text-[11px] font-mono font-semibold"
              style={{ color: '#F02525' }}
            >
              −{removed}
            </span>
          )}
          {/* Visual bar */}
          <div className="flex items-center gap-0.5" aria-hidden>
            {Array.from({ length: Math.min(5, added + removed) }, (_, i) => (
              <div
                key={i}
                className="rounded-sm"
                style={{
                  width: 7,
                  height: 10,
                  background: i < Math.round((added / Math.max(added + removed, 1)) * Math.min(5, added + removed))
                    ? '#A0F695'
                    : '#F02525',
                }}
              />
            ))}
          </div>
          {/* Collapse chevron */}
          <span
            className="text-[10px] ml-1 transition-transform"
            style={{
              color: theme.textFaint,
              transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
              display: 'inline-block',
            }}
          >
            ▾
          </span>
        </div>
      </button>

      {/* Diff body */}
      {!collapsed && (
        <div
          style={{
            maxHeight: 400,
            overflowY: 'auto',
            overflowX: 'auto',
            borderTop: `1px solid ${theme.border}`,
          }}
        >
          <div style={{ minWidth: 'max-content', width: '100%' }}>
            {file.hunks.map((hunk, hi) => (
              <div key={hi}>
                {/* Hunk header */}
                <div
                  className="px-4 py-1 text-[10px] select-none"
                  style={{
                    fontFamily: theme.fontMono,
                    color: '#60a5fa',
                    background: 'rgba(96,165,250,0.05)',
                    borderBottom: '1px solid rgba(96,165,250,0.1)',
                  }}
                >
                  {hunk.header}
                </div>
                {/* Lines */}
                {hunk.lines.map((line, li) => (
                  <div
                    key={li}
                    className="flex"
                    style={{
                      background: DIFF_CLR[line.type]?.bg ?? 'transparent',
                    }}
                  >
                    <span
                      className="select-none shrink-0 py-px"
                      style={{
                        fontFamily: theme.fontMono,
                        fontSize: 11,
                        width: 20,
                        textAlign: 'center',
                        color: DIFF_CLR[line.type]?.mark ?? theme.textFaint,
                      }}
                    >
                      {line.type === ' ' ? '' : line.type}
                    </span>
                    <pre
                      style={{
                        fontFamily: theme.fontMono,
                        fontSize: 11,
                        lineHeight: '20px',
                        padding: '1px 8px',
                        margin: 0,
                        whiteSpace: 'pre',
                        color: DIFF_CLR[line.type]?.text ?? theme.textMuted,
                      }}
                    >
                      {line.content || '\u00A0'}
                    </pre>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
