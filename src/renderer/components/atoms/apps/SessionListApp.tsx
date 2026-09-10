/**
 * SessionListApp.tsx — Every agent session on one line each (Cockpit F4)
 *
 * Responsibility:
 * - One row per open `agent-session` window: what card it is on, which vendor,
 *   where it runs, what it is doing, and for how long.
 * - Two controls per row, and both of them do something: Focus brings that
 *   window to the front and moves the camera to it; End kills the process,
 *   behind the same one-step confirmation the terminal's own End carries.
 *
 * Boundaries:
 * - Owns: the row, its wording, and its two controls.
 * - Does NOT own: the sessions themselves (AgentSessionApp.tsx), attention
 *   (attention-machine.ts), or the layout that places this window
 *   (cockpit-layout.ts).
 *
 * Architectural role:
 * - Renderer app component. It reads the store and nothing else: no IPC poll,
 *   no timer except the one clock below, because the desktop already pushes
 *   every state change into the windows this reads.
 *
 * Why the clock ticks every 30 seconds and not every second: this is a
 * glance surface (widgets/AGENTS.md — "Background Efficiency"), and a
 * per-second re-render of every row buys a digit nobody is reading. Elapsed
 * time on a session that has been up for eleven minutes is a magnitude, not a
 * stopwatch.
 *
 * Wrapper Principle: below ~380px the row keeps the two things that identify
 * and prioritise a session — its id and its attention — and drops the rest.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDesktopStore } from '../../../store/desktop-store';
import { describeAttention, formatElapsed } from '../../../lib/agent-sessions';
import { theme } from '../../../logic/theme';
import { LucideIcon } from '../../desktop/LucideIcon';
import type { AgentSessionMeta } from '@/types/desktop';

/** Below this the row is id + attention and nothing else. */
const NARROW_PX = 380;
/** How long a two-step control stays armed — the same as the terminal's. */
const CONFIRM_END_MS = 4000;
/** See the header: a glance surface, not a stopwatch. */
const CLOCK_MS = 30_000;

interface SessionListAppProps {
  windowId: string;
}

interface Row {
  windowId: string;
  meta: AgentSessionMeta;
}

export function SessionListApp({ windowId: _windowId }: SessionListAppProps) {
  // Raw slices, derived with useMemo. A selector that BUILDS the row objects
  // would return a new array every time zustand notifies, and under React 19's
  // useSyncExternalStore that is a render loop, not a slow render (F3, #13).
  const windows = useDesktopStore((s) => s.windows);
  const navigateToWindow = useDesktopStore((s) => s.navigateToWindow);

  const rows = useMemo<Row[]>(() => windows
    .filter((w) => w.type === 'agent-session' && w.agentSession)
    .map((w) => ({ windowId: w.id, meta: w.agentSession as AgentSessionMeta }))
    .sort((a, b) => a.meta.launchedAt - b.meta.launchedAt), [windows]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      setNarrow(container.clientWidth > 0 && container.clientWidth < NARROW_PX);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const handleEnd = useCallback((meta: AgentSessionMeta) => {
    if (confirmEnd !== meta.sessionId) {
      // Killing an agent mid-task loses whatever it had not written yet, so it
      // earns one step of friction — inline and self-cancelling, never a modal.
      setConfirmEnd(meta.sessionId);
      setTimeout(() => setConfirmEnd((current) => (current === meta.sessionId ? null : current)), CONFIRM_END_MS);
      return;
    }
    setConfirmEnd(null);
    void window.fluxorAPI?.ptyKill(meta.sessionId);
  }, [confirmEnd]);

  return (
    <div ref={containerRef} style={S.root} data-testid="session-list">
      {rows.length === 0 ? (
        <div style={S.empty} data-testid="session-list-empty">
          No sessions · open one from a card or the dock
        </div>
      ) : rows.map(({ windowId: id, meta }) => {
        const ended = meta.attention === 'ended';
        const status = describeAttention(
          meta.attention, meta.exitCode, meta.bootstrapExitCode, meta.attentionReason,
        );
        const where = meta.mode === 'worktree' ? (meta.branch ?? 'worktree') : 'attached';
        const tone = ended ? theme.textFaint
          : meta.attention === 'waiting' ? theme.warning
          : meta.attention === 'running' ? theme.accentBlue
          : theme.textMuted;

        return (
          <div key={id} style={S.row} data-testid="session-list-row">
            <span style={S.card} title={meta.cardId ?? 'launched without a card'}>
              {meta.cardId ?? 'no card'}
            </span>

            {!narrow && <span style={S.vendor}>{meta.vendor}</span>}
            {!narrow && <span style={S.where} title={where}>{where}</span>}

            <span
              style={{ ...S.badge, color: tone, borderColor: tone }}
              data-testid="session-list-attention"
            >
              {status}
            </span>

            {!narrow && (
              <span style={S.elapsed} title="Time since this session was opened">
                {formatElapsed(now - meta.launchedAt)}
              </span>
            )}

            <div style={S.spacer} />

            <button
              type="button"
              onClick={() => navigateToWindow(id)}
              style={S.btn}
              title="Bring this session's window to the front and centre the canvas on it"
              data-testid="session-list-focus"
            >
              <LucideIcon name="Eye" size={11} />
              {!narrow && <span>Focus</span>}
            </button>

            <button
              type="button"
              onClick={() => handleEnd(meta)}
              disabled={ended}
              style={{
                ...S.btn,
                ...(ended ? S.btnDisabled : null),
                color: confirmEnd === meta.sessionId ? theme.danger : ended ? theme.textFaint : theme.textMuted,
                borderColor: confirmEnd === meta.sessionId ? theme.dangerBorder : theme.border,
              }}
              // A disabled control that does not say why reads as broken.
              title={ended
                ? 'Cannot end: this session has already exited'
                : confirmEnd === meta.sessionId
                  ? 'Click again to kill the agent process'
                  : 'End this session (kills the agent process)'}
              data-testid="session-list-end"
            >
              <LucideIcon name="Square" size={11} />
              {(!narrow || confirmEnd === meta.sessionId)
                && <span>{confirmEnd === meta.sessionId ? 'Confirm?' : 'End'}</span>}
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0,
    background: theme.bg, overflowY: 'auto', overflowX: 'hidden',
    fontFamily: theme.fontMono, fontSize: 11,
  },
  row: {
    display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
    padding: '5px 8px', borderBottom: `1px solid ${theme.border}`,
    overflow: 'hidden',
  },
  card: {
    color: theme.textSecondary, flexShrink: 0, whiteSpace: 'nowrap',
    overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 130,
  },
  vendor: { color: theme.textMuted, flexShrink: 0 },
  where: {
    color: theme.textFaint, whiteSpace: 'nowrap', overflow: 'hidden',
    textOverflow: 'ellipsis', minWidth: 0,
  },
  badge: {
    flexShrink: 0, padding: '1px 6px', borderRadius: 3,
    border: '1px solid', fontSize: 10, letterSpacing: 0.3,
  },
  elapsed: { color: theme.textFaint, flexShrink: 0, fontSize: 10 },
  spacer: { flex: 1, minWidth: 4 },
  btn: {
    display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
    padding: '2px 6px', borderRadius: 3, cursor: 'pointer',
    background: 'transparent', border: `1px solid ${theme.border}`,
    color: theme.textMuted, fontSize: 10, fontFamily: theme.fontMono,
  },
  btnDisabled: { cursor: 'not-allowed' },
  empty: {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 16, textAlign: 'center', color: theme.textGhost, fontSize: 12,
  },
};
