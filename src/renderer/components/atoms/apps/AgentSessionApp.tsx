/**
 * AgentSessionApp.tsx — Renderer Embedded App Component
 *
 * Responsibility:
 * - Hosts one vendor CLI (`claude`/`codex`/`opencode`/`gemini`) in a real
 *   terminal: xterm.js here, a PTY in the main process, one `sessionId`
 *   correlating the two.
 * - Owns the four states a session can be in — starting, running, ended, and
 *   "that CLI is not installed" — and makes each one say what it is IN WORDS.
 *
 * Boundaries:
 * - Owns: the terminal, its geometry, the spawn-once guard, the header strip.
 * - Does NOT own: which binary runs (main's vendor registry), worktrees (F2),
 *   backlog cards (F3), or attention signals from CLI hooks (F4).
 *
 * Architectural role:
 * - UI boundary module in the renderer. Everything privileged happens over
 *   `window.fluxorAPI`; this file never touches a process.
 *
 * Wrapper Principle (widgets/AGENTS.md): the header degrades to icons alone
 * below ~440px so a session docked into a narrow strip stays usable — the
 * terminal, not the chrome, is what the space is for.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useDesktopStore } from '../../../store/desktop-store';
import { theme } from '../../../logic/theme';
import { LucideIcon } from '../../desktop/LucideIcon';
import { basenameOf, describeAttention, planPromptTyping } from '../../../lib/agent-sessions';
import type { PtySpawnSuccess, VendorNotFoundError } from '@/main/pty/ipc-pty';

// ─── Constants ───────────────────────────────────────────────────

/** Below this width the header keeps its icons and drops its words. */
const NARROW_HEADER_PX = 440;
/** How long "Confirm end?" stays armed before reverting to "End session". */
const CONFIRM_END_MS = 4000;

/**
 * Sessions this renderer has ALREADY asked to spawn, by sessionId.
 *
 * React 19 StrictMode mounts every effect twice in development, and the store
 * write that flips `ptyStarted` is asynchronous — so a guard that only reads
 * the store loses the race and spawns two CLIs against the same repository.
 * This synchronous set closes that window; `ptyStarted` closes the other one
 * (a remount, or an HMR reload that resets this module).
 */
const spawnRequested = new Set<string>();

// ─── Terminal theme — the tokens, not hand-picked hexes ──────────

const XTERM_THEME = {
  background: theme.bg,
  foreground: theme.textPrimary,
  cursor: theme.accentBlue,
  cursorAccent: theme.bg,
  selectionBackground: theme.accentBlueBg,
} as const;

// ─── Types ───────────────────────────────────────────────────────

interface AgentSessionAppProps {
  windowId: string;
}

interface SpawnFailure {
  kind: 'vendor_not_found' | 'spawn_failed';
  bin?: string;
  message?: string;
}

// ─── Component ───────────────────────────────────────────────────

export function AgentSessionApp({ windowId }: AgentSessionAppProps) {
  const win = useDesktopStore((s) => s.windows.find((w) => w.id === windowId));
  const updateAgentSession = useDesktopStore((s) => s.updateAgentSession);
  const meta = win?.agentSession;

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  /** Read by effects that must not re-run when the session id changes. */
  const sessionIdRef = useRef<string | undefined>(meta?.sessionId);
  sessionIdRef.current = meta?.sessionId;

  // Typing the first prompt into a `'type'` vendor needs two facts that arrive
  // over IPC in an order nobody controls: the spawn response (which vendors
  // need typing) and the first output chunk (when the TUI is up). Each is
  // recorded as it lands and both call the same arm-once function, so the race
  // has no losing branch.
  const promptDeliveryRef = useRef<'arg' | 'type' | null>(null);
  const sawFirstChunkRef = useRef(false);
  const promptArmedRef = useRef(false);
  const promptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const armPromptTyping = useCallback(() => {
    if (promptArmedRef.current) return;
    if (!promptDeliveryRef.current || !sawFirstChunkRef.current) return;
    const current = useDesktopStore.getState().windows.find((w) => w.id === windowId)?.agentSession;
    const plan = planPromptTyping(promptDeliveryRef.current, current?.prompt);
    if (!plan) return;
    promptArmedRef.current = true;
    promptTimerRef.current = setTimeout(() => {
      const id = sessionIdRef.current;
      if (id) void window.fluxorAPI?.ptyWrite(id, plan.payload);
    }, plan.delayMs);
  }, [windowId]);

  const [failure, setFailure] = useState<SpawnFailure | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [narrow, setNarrow] = useState(false);

  // ── Terminal lifecycle: create, fit, keep the PTY's geometry in sync ──
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      fontFamily: theme.fontMono,
      fontSize: 12,
      lineHeight: 1.2,
      cursorBlink: true,
      convertEol: true,
      theme: { ...XTERM_THEME },
      // A CLI agent prints a lot and people scroll back through it.
      scrollback: 10_000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    termRef.current = term;

    // Keystrokes go straight to the PTY — the terminal is not a text field we
    // parse, it is the agent's stdin.
    const keyDisposable = term.onData((data) => {
      const id = sessionIdRef.current;
      if (id) void window.fluxorAPI?.ptyWrite(id, data);
    });

    const applyFit = () => {
      // A hidden or mid-layout window measures 0x0; fit() throws on that.
      if (container.clientWidth <= 0 || container.clientHeight <= 0) return;
      try {
        fit.fit();
      } catch {
        return;
      }
      const id = sessionIdRef.current;
      if (id) void window.fluxorAPI?.ptyResize(id, term.cols, term.rows);
    };

    const observer = new ResizeObserver(() => {
      setNarrow(container.clientWidth > 0 && container.clientWidth < NARROW_HEADER_PX);
      applyFit();
    });
    observer.observe(container);
    applyFit();

    return () => {
      observer.disconnect();
      keyDisposable.dispose();
      term.dispose();
      termRef.current = null;
    };
  }, []);

  // ── PTY output → terminal, and exit → the ended state ──
  useEffect(() => {
    const api = window.fluxorAPI;
    if (!api) return;

    const offData = api.onPtyData(({ sessionId, data }) => {
      if (sessionId !== sessionIdRef.current) return;
      termRef.current?.write(data);
      if (sawFirstChunkRef.current) return;
      sawFirstChunkRef.current = true;
      // First output means the session is doing something; say so.
      updateAgentSession(windowId, { attention: 'running' });
      armPromptTyping();
    });

    const offExit = api.onPtyExit(({ sessionId, exitCode }) => {
      if (sessionId !== sessionIdRef.current) return;
      // The id is dead and will never be spawned again — release it so the
      // guard set does not grow for the lifetime of the app.
      spawnRequested.delete(sessionId);
      updateAgentSession(windowId, { attention: 'ended', exitCode });
    });

    return () => {
      if (promptTimerRef.current) clearTimeout(promptTimerRef.current);
      offData();
      offExit();
    };
  }, [windowId, updateAgentSession, armPromptTyping]);

  // ── Spawn exactly once per sessionId ──
  useEffect(() => {
    const api = window.fluxorAPI;
    const term = termRef.current;
    if (!api || !meta || !term) return;

    const { sessionId } = meta;

    // A window that comes back from persistence carries ptyStarted:true with
    // no live process behind it. Ask who is actually running before deciding.
    if (meta.ptyStarted) {
      if (spawnRequested.has(sessionId)) return;
      // Claim the id BEFORE the async reconciliation: this effect re-runs on
      // every `meta` change, and the reconciliation itself writes to `meta` —
      // without the claim it re-triggers itself forever.
      spawnRequested.add(sessionId);
      let cancelled = false;
      void api.ptyList().then((live) => {
        if (cancelled) return;
        const stillLive = live.some((p) => p.sessionId === sessionId);
        if (stillLive) {
          // Reattached: the scrollback lived in the old terminal, the full
          // transcript lives in the log. Say that rather than showing a blank.
          term.writeln(`\x1b[2m— reattached to a running session · full transcript: ${meta.logPath ?? 'see the Log control'}\x1b[0m`);
          updateAgentSession(windowId, { attention: 'running' });
        } else if (meta.attention !== 'ended') {
          updateAgentSession(windowId, { attention: 'ended' });
        }
      });
      return () => { cancelled = true; };
    }

    if (spawnRequested.has(sessionId)) return;
    spawnRequested.add(sessionId);

    void api
      .ptySpawn({
        sessionId,
        vendor: meta.vendor,
        cwd: meta.cwd,
        prompt: meta.prompt,
        cols: term.cols,
        rows: term.rows,
      })
      .then((result) => {
        if ((result as VendorNotFoundError).error === 'vendor_not_found') {
          const nf = result as VendorNotFoundError;
          // The id stays claimed on purpose. Releasing it would let this
          // effect — which re-runs on every `meta` change, and this branch
          // writes to `meta` — retry the spawn forever against a binary that
          // is not there. Recovery is "Start again", which mints a new id.
          setFailure({ kind: 'vendor_not_found', bin: nf.bin });
          updateAgentSession(windowId, { attention: 'ended', exitCode: null });
          return;
        }
        const ok = result as PtySpawnSuccess;
        setFailure(null);
        promptDeliveryRef.current = ok.promptDelivery;
        updateAgentSession(windowId, { ptyStarted: true, logPath: ok.logPath });
        armPromptTyping();
      })
      .catch((err: unknown) => {
        // Claimed for the same reason as the vendor_not_found branch above.
        setFailure({ kind: 'spawn_failed', message: err instanceof Error ? err.message : String(err) });
        updateAgentSession(windowId, { attention: 'ended', exitCode: null });
      });
  }, [windowId, meta, updateAgentSession, armPromptTyping]);

  // ── Controls ──

  const handleEnd = useCallback(() => {
    if (!meta) return;
    if (!confirmEnd) {
      // Killing an agent mid-task is irreversible and can lose minutes of
      // work, so it earns one step of friction — inline and self-cancelling,
      // not a modal that gets click-through-ed within a week.
      setConfirmEnd(true);
      setTimeout(() => setConfirmEnd(false), CONFIRM_END_MS);
      return;
    }
    setConfirmEnd(false);
    void window.fluxorAPI?.ptyKill(meta.sessionId);
  }, [confirmEnd, meta]);

  const handleRestart = useCallback(() => {
    if (!meta) return;
    termRef.current?.clear();
    setFailure(null);
    if (promptTimerRef.current) clearTimeout(promptTimerRef.current);
    promptDeliveryRef.current = null;
    sawFirstChunkRef.current = false;
    promptArmedRef.current = false;
    // A fresh id, so the restart writes its own transcript instead of appending
    // to the previous run's — and so the spawn guard lets it through.
    updateAgentSession(windowId, {
      sessionId: crypto.randomUUID(),
      ptyStarted: false,
      attention: 'starting',
      exitCode: null,
      logPath: undefined,
      // Deliberately NOT re-sent: the agent has already acted on it once, and
      // replaying it would redo whatever it did.
      prompt: undefined,
    });
  }, [meta, updateAgentSession, windowId]);

  const handleRevealLog = useCallback(() => {
    if (meta?.logPath) void window.fluxorAPI?.revealPath(meta.logPath);
  }, [meta]);

  if (!meta) {
    return (
      <div style={S.empty}>This window has no agent session attached.</div>
    );
  }

  const ended = meta.attention === 'ended';
  const statusText = describeAttention(meta.attention, meta.exitCode);
  const statusTone =
    ended && meta.exitCode === 0 ? theme.success
      : ended ? theme.danger
      : meta.attention === 'running' ? theme.accentBlue
      : theme.textMuted;

  return (
    <div style={S.root}>
      {/* ── Header strip ── */}
      <div style={S.header}>
        <LucideIcon name="Terminal" size={13} style={{ color: theme.textMuted, flexShrink: 0 }} />
        {!narrow && <span style={S.vendor}>{meta.vendor}</span>}
        <span style={S.cwd} title={meta.cwd}>{basenameOf(meta.cwd) || meta.cwd}</span>

        {/* Status says the state in words; the colour is the second channel, never the only one. */}
        <span
          data-testid="agent-session-status"
          style={{ ...S.badge, color: statusTone, borderColor: statusTone }}
        >
          {statusText}
        </span>

        <div style={S.spacer} />

        {meta.logPath && (
          <button
            type="button"
            onClick={handleRevealLog}
            style={S.btn}
            title={`Reveal the session transcript — ${meta.logPath}`}
            data-testid="agent-session-log"
          >
            <LucideIcon name="ScrollText" size={12} />
            {!narrow && <span>Log</span>}
          </button>
        )}

        {ended ? (
          <button
            type="button"
            onClick={handleRestart}
            style={{ ...S.btn, color: theme.accentBlue, borderColor: theme.accentBlueBorder }}
            title="Start another session with the same vendor and directory (without the original prompt)"
            data-testid="agent-session-restart"
          >
            <LucideIcon name="RefreshCw" size={12} />
            {!narrow && <span>Start again</span>}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleEnd}
            style={{
              ...S.btn,
              color: confirmEnd ? theme.danger : theme.textMuted,
              borderColor: confirmEnd ? theme.dangerBorder : theme.border,
            }}
            title={confirmEnd ? 'Click again to kill the agent process' : 'End this session (kills the agent process)'}
            data-testid="agent-session-end"
          >
            <LucideIcon name="Square" size={12} />
            {(!narrow || confirmEnd) && <span>{confirmEnd ? 'Confirm end?' : 'End session'}</span>}
          </button>
        )}
      </div>

      {/* ── Failure state — the terminal has nothing to show, so it says why ── */}
      {failure && (
        <div style={S.failure} data-testid="agent-session-error">
          <div style={S.failureTitle}>
            <LucideIcon name="TriangleAlert" size={13} style={{ color: theme.warning }} />
            {failure.kind === 'vendor_not_found'
              ? `${meta.vendor} is not installed`
              : 'The session could not start'}
          </div>
          {failure.kind === 'vendor_not_found' ? (
            <div style={S.failureBody}>
              <code style={S.code}>{failure.bin}</code> was not found on your PATH. Install that CLI,
              or point Fluxor at an existing binary with{' '}
              <code style={S.code}>FLUXOR_AGENT_BIN_{meta.vendor.toUpperCase()}=/path/to/{failure.bin}</code>
              {' '}and reopen the session.
            </div>
          ) : (
            <div style={S.failureBody}>{failure.message}</div>
          )}
        </div>
      )}

      {/* ── The terminal itself ── */}
      <div ref={containerRef} style={S.term} data-testid="agent-session-terminal" />

      {/* ── Ended footer — the exit code and where the transcript is ── */}
      {ended && !failure && (
        <div style={S.footer} data-testid="agent-session-ended">
          <span style={{ color: meta.exitCode === 0 ? theme.success : theme.danger }}>
            Session ended{typeof meta.exitCode === 'number' ? ` · exit ${meta.exitCode}` : ''}
          </span>
          {meta.logPath && <span style={S.footerPath} title={meta.logPath}>{meta.logPath}</span>}
        </div>
      )}
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0,
    background: theme.bg, overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
    padding: '5px 8px', borderBottom: `1px solid ${theme.border}`,
    background: theme.surface, fontSize: 11, fontFamily: theme.fontMono,
    overflow: 'hidden',
  },
  vendor: { color: theme.textSecondary, flexShrink: 0 },
  cwd: {
    color: theme.textMuted, whiteSpace: 'nowrap', overflow: 'hidden',
    textOverflow: 'ellipsis', minWidth: 0,
  },
  badge: {
    flexShrink: 0, padding: '1px 6px', borderRadius: 3,
    border: '1px solid', fontSize: 10, letterSpacing: 0.3,
  },
  spacer: { flex: 1, minWidth: 4 },
  btn: {
    display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
    padding: '2px 6px', borderRadius: 3, cursor: 'pointer',
    background: 'transparent', border: `1px solid ${theme.border}`,
    color: theme.textMuted, fontSize: 10, fontFamily: theme.fontMono,
  },
  term: { flex: 1, minHeight: 0, padding: '4px 0 0 6px', overflow: 'hidden' },
  failure: {
    flexShrink: 0, padding: '10px 12px', borderBottom: `1px solid ${theme.border}`,
    background: theme.surfaceCard, fontSize: 11, lineHeight: 1.6,
  },
  failureTitle: {
    display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6,
    color: theme.textPrimary, fontSize: 12,
  },
  failureBody: { color: theme.textMuted },
  code: {
    padding: '1px 4px', borderRadius: 3, background: theme.surfaceHover,
    color: theme.textSecondary, fontFamily: theme.fontMono, fontSize: 10,
  },
  footer: {
    display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
    padding: '4px 8px', borderTop: `1px solid ${theme.border}`,
    background: theme.surface, fontSize: 10, fontFamily: theme.fontMono,
    overflow: 'hidden',
  },
  footerPath: {
    color: theme.textFaint, whiteSpace: 'nowrap', overflow: 'hidden',
    textOverflow: 'ellipsis', minWidth: 0, direction: 'rtl',
  },
  empty: {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: theme.textGhost, fontSize: 12,
  },
};
