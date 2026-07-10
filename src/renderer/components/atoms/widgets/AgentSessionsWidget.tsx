/**
 * AgentSessionsWidget.tsx — Renderer IDE Widget Component
 *
 * Responsibility:
 * - HUD widget "control panel" for in-flight agent sessions. Migrated from the
 *   former floating SessionStatusDock so it carries the SAME status spinner
 *   (RunningBars), click-to-open and right-click "finish" behaviour into the
 *   widget system.
 *
 * Boundaries:
 * - Owns: widget-level rendering + local interaction wiring.
 * - Does NOT own: session orchestration, IPC, or persistence.
 */
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useFluxorStore } from '../../../store';
import { useDesktopStore } from '../../../store/desktop-store';
import { RunningBars } from '../plugins/RunningBars';
import { TickSvg } from '../plugins/TickSvg';
import { CrossSvg } from '../plugins/CrossSvg';
import { theme } from '../../../logic/theme';
import type { SessionStatus } from '@/types';

// ─── Helpers (ported from SessionStatusDock) ─────────────────────

function formatDuration(startMs: number, endMs?: number): string {
  const secs = Math.floor(((endMs ?? Date.now()) - startMs) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ${secs % 60}s`;
}

function formatTimeAgo(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// Status icon — RunningBars is the live spinner the old dock used.
function StatusIcon({ status }: { status: SessionStatus }) {
  if (status === 'running') return <RunningBars />;
  if (status === 'completed') return <TickSvg />;
  if (status === 'error' || status === 'stopped') return <CrossSvg />;
  return (
    <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(255,255,255,0.4)', display: 'inline-block' }} />
  );
}

// ─── Component ───────────────────────────────────────────────────

export function AgentSessionsWidget() {
  const sessions = useFluxorStore(s => s.sessions);
  const projectPath = useFluxorStore(s => s.projectPath);
  const updateSessionStatus = useFluxorStore(s => s.updateSessionStatus);
  const setSelectedSessionId = useFluxorStore(s => s.setSelectedSessionId);
  const addToast = useFluxorStore(s => s.addToast);
  const windows = useDesktopStore(s => s.windows);

  const [finishedIds, setFinishedIds] = useState<Set<string>>(new Set());

  const visibleSessions = useMemo(() =>
    sessions
      .filter(s =>
        (s.projectId === (projectPath ?? undefined) || (!s.projectId && !projectPath)) &&
        (s.status === 'running' || s.status === 'completed' || s.status === 'error' || s.status === 'stopped' || s.status === 'waiting') &&
        !finishedIds.has(s.id)
      )
      .map(s => ({
        id: s.id,
        number: s.number,
        status: s.status,
        description: s.description || `Session #${s.number}`,
        startedAt: s.startedAt ?? s.createdAt,
        endedAt: s.endedAt,
      })),
    [sessions, projectPath, finishedIds, windows]
  );

  // Re-render running sessions every second for elapsed time
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!visibleSessions.some(s => s.status === 'running')) return;
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [visibleSessions]);

  // Right-click context menu
  const [contextMenu, setContextMenu] = useState<{ sessionId: string; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setContextMenu(null); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  // chats→steps re-architecture (F0 decision 2, 2026-07-10): 'chat' windows
  // are retired — no window type can ever bind to a session id again (see
  // DesktopWindow['type']'s doc comment in types/desktop.ts), so the old
  // "focus its window, or open a fresh one" behavior has no destination left
  // to open/focus. `setSelectedSessionId` is preserved (harmless — no
  // current UI reads it, see this task's final report) but the click no
  // longer silently no-ops: it surfaces what happened via the existing
  // toast system. OPEN QUESTION flagged for the orchestrator, not guessed:
  // what should activating a session do now — nothing once agent-manager
  // itself is fully retired (F0 decision 3, pending C2's dead-code sweep),
  // or does this widget need a new destination (e.g. a future per-run
  // evidence surface)? Left unresolved rather than invented.
  const handleActivate = useCallback((sessionId: string) => {
    setSelectedSessionId(sessionId);
    addToast('This session ran in the retired chat surface — start new work from the Auto-Chat panel or by double-clicking the canvas.', 'info');
  }, [setSelectedSessionId, addToast]);

  const handleFinish = useCallback(() => {
    if (!contextMenu) return;
    const session = sessions.find(s => s.id === contextMenu.sessionId);
    if (session && session.status === 'running') {
      updateSessionStatus(contextMenu.sessionId, 'stopped', Date.now());
    }
    setFinishedIds(prev => new Set(prev).add(contextMenu.sessionId));
    setContextMenu(null);
  }, [contextMenu, sessions, updateSessionStatus]);

  if (visibleSessions.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 56, color: theme.textGhost, fontSize: 11, fontFamily: theme.fontGrotesk }}>
        No active sessions
      </div>
    );
  }

  const badge = (status: SessionStatus): React.CSSProperties => ({
    fontFamily: theme.fontMono, fontSize: 9, padding: '1px 5px', borderRadius: 4,
    background: status === 'running' ? theme.successBg : status === 'error' ? theme.dangerBg : theme.surfaceHover,
    color: status === 'running' ? theme.success : status === 'error' ? theme.danger : theme.textFaint,
    flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.04em',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }} role="list" aria-label="Agent sessions">
      {visibleSessions.map(s => (
        <button
          key={s.id}
          type="button"
          role="listitem"
          data-testid={`agent-session-${s.id}`}
          data-status={s.status}
          onClick={() => handleActivate(s.id)}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ sessionId: s.id, x: e.clientX, y: e.clientY }); }}
          title={s.description}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%',
            padding: '5px 6px', borderRadius: 6, border: 'none', background: 'transparent',
            cursor: 'pointer', textAlign: 'left',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = theme.surfaceHover; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
        >
          <span style={{ width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <StatusIcon status={s.status} />
          </span>
          <span style={{ fontFamily: theme.fontMono, fontSize: 11, color: theme.textMuted, flexShrink: 0 }}>#{s.number}</span>
          <span style={{ fontFamily: theme.fontGrotesk, fontSize: 11, color: theme.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {s.description}
          </span>
          <span style={{ fontFamily: theme.fontMono, fontSize: 9, color: theme.textFaint, flexShrink: 0 }}>
            {s.status === 'running' ? formatDuration(s.startedAt) : s.endedAt ? formatDuration(s.startedAt, s.endedAt) : formatTimeAgo(s.startedAt)}
          </span>
          <span style={badge(s.status)}>{s.status}</span>
        </button>
      ))}

      {contextMenu && (
        <div
          data-testid="agent-session-context-menu"
          role="menu"
          style={{
            position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 10000,
            minWidth: 160, padding: 4, borderRadius: 8, background: theme.surfaceCard,
            border: `1px solid ${theme.borderMedium}`, boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            data-testid="agent-session-finish"
            onClick={handleFinish}
            style={{
              width: '100%', textAlign: 'left', padding: '6px 10px', borderRadius: 6,
              border: 'none', background: 'transparent', color: theme.textPrimary,
              fontSize: 12, cursor: 'pointer', fontFamily: theme.fontInter,
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = theme.surfaceHover; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
          >
            Finish session
          </button>
        </div>
      )}
    </div>
  );
}
