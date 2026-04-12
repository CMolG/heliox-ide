/**
 * SessionView.tsx — Renderer Center Panel Component
 *
 * Responsibility:
 * - Renders the SessionView surface in the renderer layer.
 * - Encapsulates Center-pane visualization for sessions, diffs, and code context.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/center/SessionView.tsx — Session detail view with snapshots
import React, { useState, useEffect } from 'react';
import { useHelioxStore } from '@/renderer/store';
import { FileTree } from '@/renderer/components/FileTree';
import { VscTerminal, VscOutput } from 'react-icons/vsc';
import { theme } from '@/renderer/logic/theme';
import { CodeViewer } from './CodeViewer';
import { GitFilesView } from './GitFilesView';
import { CodeDiffView } from './CodeDiffView';
import { DiffHistoryView } from './DiffHistoryView';
import { DiffImage } from './DiffImage';
import { MetricItem } from './MetricItem';
import { ToggleButton } from './ToggleButton';

export function SessionView() {
  const diffViewMode = useHelioxStore((s) => s.diffViewMode);
  const setDiffViewMode = useHelioxStore((s) => s.setDiffViewMode);
  const pendingDiffs = useHelioxStore((s) => s.pendingDiffs);
  const selectedSessionId = useHelioxStore((s) => s.selectedSessionId);
  const sessions = useHelioxStore((s) => s.sessions);
  const approveDiff = useHelioxStore((s) => s.approveDiff);
  const rejectDiff = useHelioxStore((s) => s.rejectDiff);
  const isRunningAgent = useHelioxStore((s) => s.isRunningAgent);
  const openFilePath = useHelioxStore((s) => s.openFilePath);
  const setOpenFilePath = useHelioxStore((s) => s.setOpenFilePath);
  const bottomPanel = useHelioxStore((s) => s.bottomPanel);
  const toggleBottomPanel = useHelioxStore((s) => s.toggleBottomPanel);

  const selectedSession = sessions.find(s => s.id === selectedSessionId);
  const [selectedDiffIdx, setSelectedDiffIdx] = useState(0);
  const currentDiff = pendingDiffs[selectedDiffIdx];

  // Keyboard shortcuts for diff approval/rejection
  useEffect(() => {
    if (pendingDiffs.length === 0) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      if (!currentDiff) return;
      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        approveDiff(currentDiff.stepId);
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        rejectDiff(currentDiff.stepId);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setSelectedDiffIdx(i => Math.max(0, i - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setSelectedDiffIdx(i => Math.min(pendingDiffs.length - 1, i + 1));
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [pendingDiffs, currentDiff, approveDiff, rejectDiff]);

  // Show code viewer when a file is open and no diffs are pending
  if (openFilePath && pendingDiffs.length === 0) {
    return (
      <div className="flex flex-col overflow-hidden h-full" style={{ background: theme.bg }}>
        <CodeViewer filePath={openFilePath} onClose={() => setOpenFilePath(null)} />
      </div>
    );
  }

  if (!selectedSession) {
    return (
      <div className="flex flex-col overflow-hidden h-full" style={{ background: theme.bgApp }}>
        <FileTree />
      </div>
    );
  }

  return (
    <div className="flex flex-col overflow-hidden h-full" style={{ background: theme.bgApp }}>
      {/* Header */}
      <div
        className="h-16 px-8 flex items-center justify-between shrink-0"
        style={{ borderBottom: `1px solid ${theme.border}` }}
      >
        <div className="flex items-center gap-14">
          <span className="text-sm font-medium leading-5" style={{ fontFamily: theme.fontGrotesk, color: theme.textSecondary }}>
            VISUAL REGRESSION
          </span>
          <div
            className="p-1 rounded-full flex items-start gap-0.75"
            style={{ background: '#000000', outline: `1px solid ${theme.border}`, outlineOffset: '-1px' }}
            role="tablist"
          >
            <ToggleButton active={diffViewMode === 'visual'} onClick={() => setDiffViewMode('visual')} label="Visual Diff" />
            <ToggleButton active={diffViewMode === 'code'} onClick={() => setDiffViewMode('code')} label="Code Diff" />
            <ToggleButton active={diffViewMode === 'files'} onClick={() => setDiffViewMode('files')} label="Files" />
            <ToggleButton active={diffViewMode === 'history'} onClick={() => setDiffViewMode('history')} label="History" />
          </div>
        </div>
        {pendingDiffs.length > 1 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedDiffIdx(Math.max(0, selectedDiffIdx - 1))}
              disabled={selectedDiffIdx === 0}
              className="px-2 py-1 rounded text-xs text-neutral-500 hover:text-neutral-300 disabled:opacity-30 transition"
              aria-label="Previous diff"
            >
              ←
            </button>
            <span className="text-[10px] font-mono" style={{ color: theme.textDim }}>
              {selectedDiffIdx + 1} / {pendingDiffs.length}
            </span>
            <button
              onClick={() => setSelectedDiffIdx(Math.min(pendingDiffs.length - 1, selectedDiffIdx + 1))}
              disabled={selectedDiffIdx === pendingDiffs.length - 1}
              className="px-2 py-1 rounded text-xs text-neutral-500 hover:text-neutral-300 disabled:opacity-30 transition"
              aria-label="Next diff"
            >
              →
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      {diffViewMode === 'history' ? (
        <div role="tabpanel"><DiffHistoryView /></div>
      ) : diffViewMode === 'files' ? (
        <div className="flex-1 overflow-hidden" role="tabpanel">
          <GitFilesView />
        </div>
      ) : diffViewMode === 'code' ? (
        <div className="flex flex-col flex-1 min-h-0" role="tabpanel">
          <CodeDiffView />
        </div>
      ) : pendingDiffs.length === 0 ? (
        isRunningAgent ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-8 h-8 mx-auto mb-4 rounded-full border-2 border-t-stone-300 border-stone-700" style={{ animation: 'spin 1s linear infinite' }} />
              <span className="text-sm" style={{ fontFamily: theme.fontGrotesk, color: theme.textSecondary }}>
                Agent is running…
              </span>
              <p className="text-xs mt-2" style={{ fontFamily: theme.fontManrope, color: theme.textFaint }}>
                Visual diffs will appear here when the agent completes
              </p>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-hidden">
            <FileTree />
          </div>
        )
      ) : diffViewMode === 'visual' ? (
        <div className="flex-1 p-8 overflow-y-auto" role="tabpanel">
          <div className="flex gap-6 justify-center">
            <div className="flex-1 max-w-md flex flex-col gap-3">
              <span className="text-xl font-normal" style={{ fontFamily: theme.fontLexend, color: '#ffffff' }}>Before</span>
              <DiffImage diff={currentDiff} side="before" />
            </div>
            <div className="flex-1 max-w-md flex flex-col gap-3">
              <span className="text-xl font-normal" style={{ fontFamily: theme.fontLexend, color: '#ffffff' }}>After</span>
              <DiffImage diff={currentDiff} side="after" />
            </div>
          </div>
          {currentDiff && (
            <div className="flex justify-center gap-4 mt-6">
              <button
                onClick={() => approveDiff(currentDiff.stepId)}
                className="px-6 py-2 rounded-full text-xs font-bold uppercase tracking-wider transition hover:brightness-110"
                style={{ fontFamily: theme.fontGrotesk, background: theme.successBg, color: theme.success, border: `1px solid ${theme.successBorder}` }}
                aria-label="Approve diff (A)"
              >
                Approve <kbd className="ml-1 text-[9px] opacity-60">A</kbd>
              </button>
              <button
                onClick={() => rejectDiff(currentDiff.stepId)}
                className="px-6 py-2 rounded-full text-xs font-bold uppercase tracking-wider transition hover:brightness-110"
                style={{ fontFamily: theme.fontGrotesk, background: theme.dangerBg, color: theme.danger, border: `1px solid ${theme.dangerBorder}` }}
                aria-label="Reject diff (R)"
              >
                Reject <kbd className="ml-1 text-[9px] opacity-60">R</kbd>
              </button>
            </div>
          )}
        </div>
      ) : null}

      {/* Metrics bar */}
      {pendingDiffs.length > 0 && currentDiff && (
        <div
          className="h-24 px-14 flex items-center gap-6 shrink-0"
          style={{ background: 'rgba(23,23,23,0.5)', borderTop: `1px solid ${theme.border}`, backdropFilter: 'blur(6px)' }}
        >
          <MetricItem
            label="Visual Diff"
            value={`${currentDiff.visualDiffPercent.toFixed(1)}%`}
            valueColor={currentDiff.visualDiffPercent > 5 ? theme.danger : theme.success}
          />
          <div className="w-px h-8" style={{ background: theme.borderMedium }} />
          <MetricItem
            label="Impact Score"
            value={`${currentDiff.impactScore > 0 ? '+' : ''}${currentDiff.impactScore}`}
            valueColor={currentDiff.impactScore >= 0 ? theme.success : theme.danger}
          />
          <div className="w-px h-8" style={{ background: theme.borderMedium }} />
          <MetricItem
            label="LCP Delta"
            value={`${currentDiff.metricsDelta.lcp.deltaPct > 0 ? '+' : ''}${currentDiff.metricsDelta.lcp.deltaPct.toFixed(0)}%`}
            valueColor={currentDiff.metricsDelta.lcp.status === 'improved' ? theme.success : currentDiff.metricsDelta.lcp.status === 'degraded' ? theme.danger : theme.textPrimary}
          />
          <div className="w-px h-8" style={{ background: theme.borderMedium }} />
          <MetricItem
            label="Severity"
            value={currentDiff.severity.toUpperCase()}
            valueColor={currentDiff.severity === 'ok' ? theme.success : currentDiff.severity === 'warning' ? theme.warning : theme.danger}
          />
        </div>
      )}

      {/* Context-sensitive bottom bar — changes by active tab */}
      {selectedSession && (
        <div
          className="h-12 px-8 flex items-center justify-between shrink-0"
          style={{ background: 'rgba(23,23,23,0.5)', borderTop: `1px solid ${theme.border}` }}
        >
          {/* Left: Tab-specific status info */}
          <div className="flex items-center gap-5">
            {diffViewMode === 'visual' && (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wide" style={{ fontFamily: theme.fontInter, color: theme.textFaint }}>Pending Diffs</span>
                  <span className="text-xs font-bold" style={{ fontFamily: theme.fontGrotesk, color: pendingDiffs.length > 0 ? theme.warning : theme.textPrimary }}>{pendingDiffs.length}</span>
                </div>
                <div className="w-px h-4" style={{ background: theme.borderMedium }} />
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wide" style={{ fontFamily: theme.fontInter, color: theme.textFaint }}>Session</span>
                  <span className="text-xs font-bold" style={{ fontFamily: theme.fontGrotesk, color: theme.textPrimary }}>{selectedSession.status.toUpperCase()}</span>
                </div>
              </>
            )}
            {diffViewMode === 'code' && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wide" style={{ fontFamily: theme.fontInter, color: theme.textFaint }}>Code Diff</span>
                <span className="text-[10px]" style={{ fontFamily: theme.fontManrope, color: theme.textDim }}>Session changes · unstaged vs HEAD</span>
              </div>
            )}
            {diffViewMode === 'files' && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wide" style={{ fontFamily: theme.fontInter, color: theme.textFaint }}>Working Tree</span>
                <span className="text-[10px]" style={{ fontFamily: theme.fontManrope, color: theme.textDim }}>New=green · Modified=yellow · Deleted=red</span>
              </div>
            )}
            {diffViewMode === 'history' && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wide" style={{ fontFamily: theme.fontInter, color: theme.textFaint }}>Diff History</span>
                <span className="text-xs font-bold" style={{ fontFamily: theme.fontGrotesk, color: theme.textPrimary }}>{selectedSession.messages.length} messages</span>
              </div>
            )}
          </div>
          {/* Right: Terminal + Logs toggle buttons */}
          <div className="flex items-center gap-2">
            {([['terminal', 'Toggle Terminal (⌘T)', VscTerminal], ['logs', 'Toggle Logs (⌘L)', VscOutput]] as const).map(([panel, title, Icon]) => (
              <button
                key={panel}
                onClick={() => toggleBottomPanel(panel)}
                className="p-2 rounded-lg transition-colors hover:bg-white/5"
                style={{
                  color: bottomPanel === panel ? theme.textSecondary : theme.textFaint,
                  background: bottomPanel === panel ? 'rgba(214,211,209,0.08)' : 'transparent',
                  border: bottomPanel === panel ? `1px solid ${theme.borderLight}` : '1px solid transparent',
                }}
                title={title}
                aria-label={title.replace(/ \(.*/, '')}
                aria-pressed={bottomPanel === panel}
              >
                <Icon size={14} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
