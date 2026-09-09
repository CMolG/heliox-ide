/**
 * AgentSessionApp.tsx — Renderer Embedded App Component
 *
 * Responsibility:
 * - Hosts one vendor CLI (`claude`/`codex`/`opencode`/`gemini`) in a real
 *   terminal: xterm.js here, a PTY in the main process, one `sessionId`
 *   correlating the two.
 * - Drives the whole life of a session in order — worktree, bootstrap, PTY,
 *   end, and the offer to reclaim the worktree — and makes every one of those
 *   states say what it is IN WORDS.
 *
 * Boundaries:
 * - Owns: the terminal, its geometry, the spawn-once and prepare-once guards,
 *   the header strip, every control's enabled/disabled reason, and WHEN the
 *   card's `runState` is written (F3) — at the two moments only this file
 *   knows: the PTY actually came up, and the PTY actually exited.
 * - Does NOT own: which binary runs (main's vendor registry), git argv
 *   (src/main/worktrees/*), WHAT gets written to a card (card-writeback.ts),
 *   or attention signals (F4).
 *
 * Architectural role:
 * - UI boundary module in the renderer. Everything privileged happens over
 *   `window.fluxorAPI`; this file never touches a process.
 *
 * Why the bootstrap streams into the SAME terminal: an install is the first
 * thing a session does and the first thing that can go wrong, and a second
 * panel for it would mean the window has two logs — one of which is empty
 * most of the time and neither of which is the whole story. The terminal is
 * the log surface, from `git worktree add` to the agent's last line.
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
import { cardFileFor, markCardRunning, settleCard } from '../../../lib/card-writeback';
import { announceHumanEvents, diffForHumanEvents } from '../../../lib/human-cards';
import { theme } from '../../../logic/theme';
import { LucideIcon } from '../../desktop/LucideIcon';
import {
  basenameOf,
  defaultWorktreeBranch,
  defaultWorktreeName,
  describeAttention,
  describeWorktreeVerdict,
  isGitFailed,
  planPromptTyping,
  removalReason,
  stripTitlePrefix,
  titlePrefixFor,
} from '../../../lib/agent-sessions';
import {
  attentionNotice, nextAttention, type AttentionInput, type AttentionState,
} from '../../../lib/attention-machine';
import type {
  AttachedSessionExistsError, CwdNotFoundError, PtySpawnSuccess, VendorNotFoundError,
} from '@/main/pty/ipc-pty';
import type { SpentVerdict } from '@/main/worktrees/worktree-manager';
import type { BacklogCard } from '@/types/market';
import type { AgentSessionMeta } from '@/types/desktop';

// ─── Constants ───────────────────────────────────────────────────

/** Below this width the header keeps its icons and drops its words. */
const NARROW_HEADER_PX = 440;
/** How long a two-step control stays armed before reverting. */
const CONFIRM_END_MS = 4000;

/**
 * How often the silence heuristic is consulted (F4).
 *
 * Four times finer than `IDLE_MS`, so the badge flips within a few seconds of
 * the threshold instead of up to a full period late. It costs one comparison:
 * the tick reads a ref and, on a session that is not `running`, returns the
 * same state object and writes nothing.
 */
const IDLE_TICK_MS = 5000;

/**
 * How long after the FIRST output a hooks-armed session may stay silent before
 * the window says so.
 *
 * This is the difference between a feature that fails loudly and one that
 * fails invisibly: with hooks armed and none arriving, the badge is running on
 * a heuristic nobody asked for, and the only way to notice used to be that the
 * badge never said `waiting` again.
 */
const HOOK_HINT_MS = 30_000;

/**
 * What a NEW session id knows about attention: nothing.
 *
 * The previous session's token was revoked when its process died, so its hooks
 * cannot fire again — carrying `hookSeen: true` across a restart would make the
 * window trust hooks that are not armed yet and stop reading its own terminal.
 */
const ATTENTION_RESET: Partial<AgentSessionMeta> = {
  attentionReason: undefined,
  hooksArmed: false,
  hookSeen: false,
  transcriptPath: undefined,
  lastMessage: undefined,
};

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

/**
 * The same guard for the worktree step, and it protects something more
 * expensive: `git worktree add` twice on one session leaves a second checkout
 * on disk that nothing will ever clean up.
 */
const prepareRequested = new Set<string>();

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
  kind: 'vendor_not_found' | 'spawn_failed' | 'attached_session_exists' | 'cwd_not_found' | 'worktree_failed';
  bin?: string;
  message?: string;
  cwd?: string;
  /** `attached_session_exists` only — the session already holding the main tree. */
  otherSessionId?: string;
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
  /** Same reason, for the callbacks that act on the CURRENT session metadata. */
  const metaRef = useRef(meta);
  metaRef.current = meta;

  // Typing the first prompt into a `'type'` vendor needs two facts that arrive
  // over IPC in an order nobody controls: the spawn response (which vendors
  // need typing) and the first output chunk (when the TUI is up). Each is
  // recorded as it lands and both call the same arm-once function, so the race
  // has no losing branch.
  const promptDeliveryRef = useRef<'arg' | 'type' | null>(null);
  const sawFirstChunkRef = useRef(false);
  const promptArmedRef = useRef(false);
  const promptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** When the session last produced output or the person last pressed Enter. */
  const lastActivityRef = useRef(Date.now());
  /** Armed once, `HOOK_HINT_MS` after the first output. */
  const hookHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hookHintDue, setHookHintDue] = useState(false);

  /**
   * The ONE place a session's attention changes (F4).
   *
   * Everything that can move it — a hook event, output, Enter, the silence
   * tick, the process exiting — goes through the same pure machine, which is
   * what stops the CLI's own redraw from quietly overwriting "waiting for a
   * permission you never saw". Reads the store rather than closing over
   * `meta`, so a callback captured by a long-lived listener is never stale.
   */
  const applyAttention = useCallback((input: AttentionInput) => {
    const state = useDesktopStore.getState();
    const current = state.windows.find((w) => w.id === windowId)?.agentSession;
    if (!current) return;
    const before: AttentionState = {
      attention: current.attention,
      attentionReason: current.attentionReason,
      hooksArmed: current.hooksArmed === true,
      hookSeen: current.hookSeen === true,
    };
    const after = nextAttention(before, input);
    // Identity, not deep equality: the machine returns its input untouched
    // when nothing happened, which is what keeps the 5 s tick from writing to
    // the store forever.
    if (after === before) return;

    state.updateAgentSession(windowId, {
      attention: after.attention,
      attentionReason: after.attentionReason,
      hooksArmed: after.hooksArmed,
      hookSeen: after.hookSeen,
    });

    // Once per WAITING STRETCH, never per event. A session that goes
    // stopped → permission → input is one interruption from where a person
    // sits; three notifications for it is how a channel gets muted.
    if (before.attention !== 'waiting' && after.attention === 'waiting') {
      const message = attentionNotice(current.cardId ?? current.vendor, after.attentionReason);
      state.addNotification(message);
      // The OS notification is the channel that reaches someone in another
      // window, and the least important of the two: it must never throw.
      void Promise.resolve(
        window.fluxorAPI?.showNotification({ title: 'Needs you', body: message }),
      ).catch(() => { /* an OS that refuses notifications is not an error */ });
    }
  }, [windowId]);

  /** Read by the terminal effect, which must never re-run (it owns xterm). */
  const applyAttentionRef = useRef(applyAttention);
  applyAttentionRef.current = applyAttention;

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
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [narrow, setNarrow] = useState(false);
  /** The spent verdict, fetched once the session ends. `null` while unknown. */
  const [verdict, setVerdict] = useState<SpentVerdict | null>(null);
  const [removed, setRemoved] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  /** A dim, prefixed line — the Cockpit talking, never the agent. */
  const writeOwnLine = useCallback((text: string) => {
    termRef.current?.writeln(`\x1b[2m${text}\x1b[0m`);
  }, []);

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
      // Enter is the person answering whatever was in the way — a permission,
      // a question, a plan. `\r`, not `\n`: that is the byte a PTY carries.
      if (data.includes('\r')) {
        lastActivityRef.current = Date.now();
        applyAttentionRef.current({ kind: 'user_enter' });
      }
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
      lastActivityRef.current = Date.now();
      // Only the two states output can actually move (attention-machine.ts):
      // asking the machine on every chunk of a busy TUI would be hundreds of
      // store reads a second to be told nothing changed.
      const now = metaRef.current?.attention;
      if (now === 'starting' || now === 'waiting') applyAttention({ kind: 'output' });
      if (sawFirstChunkRef.current) return;
      sawFirstChunkRef.current = true;
      // The hint clock starts at the first output, not at spawn: before then
      // there is nothing for a hook to have been late to.
      hookHintTimerRef.current = setTimeout(() => setHookHintDue(true), HOOK_HINT_MS);
      armPromptTyping();
    });

    const offExit = api.onPtyExit(({ sessionId, exitCode }) => {
      if (sessionId !== sessionIdRef.current) return;
      // The id is dead and will never be spawned again — release it so the
      // guard set does not grow for the lifetime of the app.
      spawnRequested.delete(sessionId);
      // The code first, then the transition: `describeAttention` reads both,
      // and a badge that says `ended` for one frame before saying
      // `ended · exit 0` is a flicker nobody needs to see.
      updateAgentSession(windowId, { exitCode });
      applyAttention({ kind: 'exit' });
      // F3 — the terminal write-back. Decided by the card the agent left
      // behind, not by this exit code: a CLI exits 0 when a person types
      // `exit`, which says nothing about whether the work is done.
      const current = metaRef.current;
      if (current?.cardId) void settleCard(current, exitCode);
    });

    // The bootstrap's own output, filtered by worktree: two sessions installing
    // at once are two streams, and neither may land in the other's terminal.
    const offProgress = api.onWorktreeProgress?.(({ worktreePath, line }) => {
      if (worktreePath !== metaRef.current?.worktreePath) return;
      termRef.current?.writeln(line);
    }) ?? (() => { /* an older preload has no progress channel */ });

    return () => {
      if (promptTimerRef.current) clearTimeout(promptTimerRef.current);
      if (hookHintTimerRef.current) clearTimeout(hookHintTimerRef.current);
      offData();
      offExit();
      offProgress();
    };
  }, [windowId, updateAgentSession, armPromptTyping, applyAttention]);

  // ── F4: the CLI's own hooks, over the loopback endpoint ──
  //
  // One channel carries every session's events; this window takes only its
  // own. `transcriptPath` and `lastMessage` are FACTS and are stored whatever
  // the machine decides about the state — they are what a person opens next.
  useEffect(() => {
    const api = window.fluxorAPI;
    if (!api?.onAgentHookEvent) return;
    return api.onAgentHookEvent((event) => {
      if (event.sessionId !== sessionIdRef.current) return;
      const patch: Partial<AgentSessionMeta> = {};
      if (event.transcriptPath) patch.transcriptPath = event.transcriptPath;
      if (event.lastMessage) patch.lastMessage = event.lastMessage;
      if (event.transcriptPath || event.lastMessage) updateAgentSession(windowId, patch);
      applyAttention({ kind: 'hook', event });
    });
  }, [windowId, updateAgentSession, applyAttention]);

  // ── F4: the silence heuristic, for the vendors that have no hooks ──
  //
  // Stopped at `ended` rather than left running harmlessly: a timer per closed
  // session is the kind of thing that is free once and expensive at twenty.
  const sessionLive = !!meta && meta.attention !== 'ended';
  useEffect(() => {
    if (!sessionLive) return;
    const id = setInterval(() => {
      applyAttention({ kind: 'idle_tick', silentMs: Date.now() - lastActivityRef.current });
    }, IDLE_TICK_MS);
    return () => clearInterval(id);
  }, [sessionLive, applyAttention]);

  // ── F4: the state, in the window TITLE ──
  //
  // So a canvas of terminals, the dock, and any window list can be read
  // WITHOUT opening one of them. The prefix is stripped before being re-added,
  // which is what stops "waiting · running · claude · ..." from accumulating.
  const attention = meta?.attention;
  const windowTitle = win?.title;
  useEffect(() => {
    if (!attention || windowTitle === undefined) return;
    const next = `${titlePrefixFor(attention)}${stripTitlePrefix(windowTitle)}`;
    if (next !== windowTitle) useDesktopStore.getState().updateWindowTitle(windowId, next);
  }, [attention, windowTitle, windowId]);

  // ── Bootstrap, as its own step so "Retry" can re-run just this half ──
  const runBootstrapStep = useCallback(async (worktreePath: string) => {
    const api = window.fluxorAPI;
    const m = metaRef.current;
    if (!api || !m) return;

    setFailure(null);
    updateAgentSession(windowId, { attention: 'bootstrapping', bootstrapExitCode: null });

    const result = await api.bootstrapRun(worktreePath, m.projectRoot);
    if (isGitFailed(result)) {
      setFailure({ kind: 'worktree_failed', message: result.stderr || result.message });
      updateAgentSession(windowId, { attention: 'ended', exitCode: null });
      return;
    }

    if (result.exitCode === 0) {
      // durationMs 0 means there was no command to run — a project with no
      // lockfile needs no install, and saying "done in 0.0s" would be noise.
      if (result.durationMs > 0) {
        writeOwnLine(`— bootstrap finished in ${(result.durationMs / 1000).toFixed(1)}s`);
      }
      updateAgentSession(windowId, {
        worktreeReady: true, bootstrapExitCode: 0, attention: 'starting',
      });
      return;
    }

    writeOwnLine(`— bootstrap failed · exit ${result.exitCode}`);
    updateAgentSession(windowId, { attention: 'bootstrapping', bootstrapExitCode: result.exitCode });
  }, [updateAgentSession, windowId, writeOwnLine]);

  // ── Worktree first, PTY second — the F2 order ──
  useEffect(() => {
    const api = window.fluxorAPI;
    const term = termRef.current;
    if (!api || !meta || !term) return;
    if (meta.mode !== 'worktree' || meta.worktreeReady || meta.ptyStarted) return;

    const { sessionId } = meta;
    if (prepareRequested.has(sessionId)) return;
    prepareRequested.add(sessionId);

    void (async () => {
      updateAgentSession(windowId, { attention: 'preparing' });

      const name = meta.worktreeName ?? defaultWorktreeName(sessionId);
      const branch = meta.branch ?? defaultWorktreeBranch(sessionId);
      const created = await api.worktreeCreate({ projectRoot: meta.projectRoot, name, branch });

      if (isGitFailed(created)) {
        // The id stays claimed: this effect re-runs on every `meta` change and
        // this branch writes to `meta`, so releasing it would retry a failing
        // git command forever. Recovery is "Start again", which mints a new id.
        setFailure({ kind: 'worktree_failed', message: created.stderr || created.message });
        updateAgentSession(windowId, { attention: 'ended', exitCode: null });
        return;
      }

      writeOwnLine(
        `— preparing worktree ${created.path} on ${created.branch ?? branch} (base ${created.baseRef})`
        + (created.reused ? ' · reused' : ''),
      );
      updateAgentSession(windowId, {
        worktreePath: created.path,
        cwd: created.path,
        worktreeName: name,
        branch: created.branch ?? branch,
        baseRef: created.baseRef,
      });

      // F5 — the card, before the bootstrap and long before the agent.
      //
      // The branch was cut from `origin/main`, so a card that has not reached
      // it yet (written this session, uncommitted, or on an unpushed branch) is
      // NOT in this checkout — and the launch prompt's first line tells the
      // agent to read exactly that file. Copying it is the only step that makes
      // the prompt true; an existing copy is the branch's own and is left alone.
      // Best effort throughout: a session must start even if this cannot.
      if (meta.cardFilename && meta.backlogDir && !meta.isExternalBacklog) {
        const seed = await api.worktreeSeedCard?.(created.path, meta.backlogDir, meta.cardFilename);
        if (seed && !isGitFailed(seed) && seed.seeded) {
          writeOwnLine(`— seeded ${meta.cardFilename} into the worktree (not on origin/main yet)`);
        }
      }

      await runBootstrapStep(created.path);
    })();
  }, [windowId, meta, updateAgentSession, runBootstrapStep, writeOwnLine]);

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

    // The worktree is not scenery: the agent must open INSIDE it, with its
    // dependencies present. Until that is settled there is nothing to spawn in.
    if (meta.mode === 'worktree' && !meta.worktreeReady) return;

    if (spawnRequested.has(sessionId)) return;
    spawnRequested.add(sessionId);

    void api
      .ptySpawn({
        sessionId,
        vendor: meta.vendor,
        cwd: meta.cwd,
        projectRoot: meta.projectRoot,
        mode: meta.mode,
        prompt: meta.prompt,
        cols: term.cols,
        rows: term.rows,
      })
      .then((result) => {
        // Every one of these is an ANSWER, not an exception — see ipc-pty.ts.
        // The id stays claimed in all of them for the reason above.
        const kind = (result as { error?: string }).error;

        if (kind === 'vendor_not_found') {
          setFailure({ kind: 'vendor_not_found', bin: (result as VendorNotFoundError).bin });
          updateAgentSession(windowId, { attention: 'ended', exitCode: null });
          return;
        }
        if (kind === 'attached_session_exists') {
          setFailure({
            kind: 'attached_session_exists',
            otherSessionId: (result as AttachedSessionExistsError).sessionId,
          });
          updateAgentSession(windowId, { attention: 'ended', exitCode: null });
          return;
        }
        if (kind === 'cwd_not_found') {
          setFailure({ kind: 'cwd_not_found', cwd: (result as CwdNotFoundError).cwd });
          updateAgentSession(windowId, { attention: 'ended', exitCode: null });
          return;
        }

        const ok = result as PtySpawnSuccess;
        setFailure(null);
        promptDeliveryRef.current = ok.promptDelivery;
        // `hooksArmed` changes how this window reads its own terminal, so it
        // is persisted the moment the main process answers — only it knows
        // whether the endpoint was up when the CLI was spawned.
        updateAgentSession(windowId, {
          ptyStarted: true, logPath: ok.logPath, hooksArmed: ok.hooksArmed === true,
        });
        armPromptTyping();
        // F3 — `runState: running`, HERE and not at click time: this is the
        // first instant at which a process actually exists. In worktree mode
        // the effect above already gated on `worktreeReady`, so the path
        // card-writeback resolves is the worktree's own copy of the card.
        if (meta.cardId) void markCardRunning({ ...meta, logPath: ok.logPath, ptyStarted: true });
      })
      .catch((err: unknown) => {
        setFailure({ kind: 'spawn_failed', message: err instanceof Error ? err.message : String(err) });
        updateAgentSession(windowId, { attention: 'ended', exitCode: null });
      });
  }, [windowId, meta, updateAgentSession, armPromptTyping]);

  // ── F3: mirror the card the agent is editing INSIDE its worktree ──
  //
  // In worktree mode the Cockpit does not write the main-tree card at all, so
  // the board has no way of knowing the agent already moved its card to
  // `review` on a branch. This watcher is that way: it reads the worktree's own
  // `.backlog`, mirrors the launched card's status onto the session (which the
  // pile renders as `in worktree: review`), and raises a notification for any
  // HUMAN card the session writes — the exact moment a person is needed, and
  // the one event a worktree would otherwise swallow until the PR.
  //
  // Deliberately only those two uses. It is a watcher on a checkout, not a
  // second board: merging its cards into `backlogCards` would replace the
  // project's backlog with one branch's view of it.
  const watchedWorktreeBacklog = meta && meta.mode === 'worktree' && meta.worktreePath
    && meta.cardId && meta.attention !== 'ended'
    ? cardFileFor(meta)?.dir
    : undefined;
  const watchedWorktreeRoot = meta?.worktreePath;
  const watchedCardFilename = meta?.cardFilename;

  useEffect(() => {
    const api = window.fluxorAPI;
    if (!api || !watchedWorktreeBacklog || !watchedWorktreeRoot) return;

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    // Seeded before the first push, so a HUMAN card written seconds later is a
    // comparison against something rather than the silent "initial load" case.
    let previous: BacklogCard[] | null = null;

    void (async () => {
      previous = await api.readBacklogDir(watchedWorktreeBacklog)
        .then((cards) => cards as BacklogCard[])
        .catch(() => null);
      await api.watchBacklogDir(watchedWorktreeBacklog, watchedWorktreeRoot);
      if (cancelled) return;
      unsubscribe = api.onBacklogChanged(({ backlogDir, cards }) => {
        if (backlogDir !== watchedWorktreeBacklog) return;
        const fresh = cards as BacklogCard[];
        // New HUMAN cards only: a card CLOSED on a branch has not reached
        // anyone's board yet, so celebrating it here would be premature.
        announceHumanEvents({ newHuman: diffForHumanEvents(previous, fresh).newHuman, closedHuman: [] }, fresh);
        previous = fresh;
        const mine = fresh.find((c) => c.filename === watchedCardFilename);
        if (mine) updateAgentSession(windowId, { mirroredStatus: mine.status });
      });
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
      void api.unwatchBacklogDir(watchedWorktreeBacklog);
    };
  }, [watchedWorktreeBacklog, watchedWorktreeRoot, watchedCardFilename, windowId, updateAgentSession]);

  // ── Once ended, is there anything left in that worktree to lose? ──
  const endedWorktreePath = meta?.attention === 'ended' && meta.mode === 'worktree'
    ? meta.worktreePath
    : undefined;

  useEffect(() => {
    const api = window.fluxorAPI;
    if (!api || !endedWorktreePath || removed) return;
    let cancelled = false;
    void api.worktreeSpent(endedWorktreePath).then((v) => {
      if (cancelled || isGitFailed(v)) return;
      setVerdict(v);
    });
    return () => { cancelled = true; };
  }, [endedWorktreePath, removed]);

  // ── Controls ──

  /** Shared by "Start again" and "Open in a worktree instead". */
  const resetPromptState = useCallback(() => {
    if (promptTimerRef.current) clearTimeout(promptTimerRef.current);
    if (hookHintTimerRef.current) clearTimeout(hookHintTimerRef.current);
    promptDeliveryRef.current = null;
    sawFirstChunkRef.current = false;
    promptArmedRef.current = false;
    lastActivityRef.current = Date.now();
    setHookHintDue(false);
  }, []);


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
    setVerdict(null);
    resetPromptState();
    // A fresh id, so the restart writes its own transcript instead of appending
    // to the previous run's — and so the spawn guard lets it through. The
    // worktree it already has is REUSED (same name, same branch): re-cutting
    // one per attempt would leave a checkout behind on every retry.
    updateAgentSession(windowId, {
      ...ATTENTION_RESET,
      sessionId: crypto.randomUUID(),
      ptyStarted: false,
      attention: meta.mode === 'worktree' && !meta.worktreeReady ? 'preparing' : 'starting',
      exitCode: null,
      logPath: undefined,
      // Deliberately NOT re-sent: the agent has already acted on it once, and
      // replaying it would redo whatever it did.
      prompt: undefined,
    });
  }, [meta, resetPromptState, updateAgentSession, windowId]);

  /**
   * The way out of `attached_session_exists`. It does not queue behind the
   * other session and it does not fail: it turns THIS window into a worktree
   * session, which is what the one-attached-session rule is asking for.
   */
  const handleOpenInWorktree = useCallback(() => {
    if (!metaRef.current) return;
    termRef.current?.clear();
    setFailure(null);
    resetPromptState();
    const sessionId = crypto.randomUUID();
    updateAgentSession(windowId, {
      ...ATTENTION_RESET,
      sessionId,
      mode: 'worktree',
      worktreeName: defaultWorktreeName(sessionId),
      branch: defaultWorktreeBranch(sessionId),
      worktreeReady: false,
      bootstrapExitCode: null,
      ptyStarted: false,
      exitCode: null,
      logPath: undefined,
      attention: 'preparing',
      // The prompt is KEPT here, unlike "Start again": nothing ran, so the
      // agent has not acted on it yet.
    });
  }, [resetPromptState, updateAgentSession, windowId]);

  const handleRetryBootstrap = useCallback(() => {
    const path = metaRef.current?.worktreePath;
    if (path) void runBootstrapStep(path);
  }, [runBootstrapStep]);

  /** Spawns in the worktree anyway — useful when the missing deps do not matter. */
  const handleOpenAnyway = useCallback(() => {
    updateAgentSession(windowId, { worktreeReady: true, attention: 'starting' });
  }, [updateAgentSession, windowId]);

  const handleRemoveWorktree = useCallback(() => {
    const path = metaRef.current?.worktreePath;
    if (!path) return;
    if (!confirmRemove) {
      setConfirmRemove(true);
      setTimeout(() => setConfirmRemove(false), CONFIRM_END_MS);
      return;
    }
    setConfirmRemove(false);
    setRemoveError(null);
    void window.fluxorAPI?.worktreeRemove(path).then((result) => {
      if (isGitFailed(result)) {
        setRemoveError(result.stderr || result.message);
        return;
      }
      setRemoved(true);
    });
  }, [confirmRemove]);

  const handleRevealLog = useCallback(() => {
    if (meta?.logPath) void window.fluxorAPI?.revealPath(meta.logPath);
  }, [meta]);

  // The other session's window, so the refusal can name it rather than
  // printing an id nobody can place.
  const otherSessionId = failure?.kind === 'attached_session_exists' ? failure.otherSessionId : undefined;
  const otherSessionTitle = useDesktopStore((s) => (otherSessionId
    ? s.windows.find((w) => w.agentSession?.sessionId === otherSessionId)?.title
    : undefined));

  if (!meta) {
    return (
      <div style={S.empty}>This window has no agent session attached.</div>
    );
  }

  const ended = meta.attention === 'ended';
  const bootstrapFailed = meta.attention === 'bootstrapping'
    && typeof meta.bootstrapExitCode === 'number'
    && meta.bootstrapExitCode !== 0
    && !meta.worktreeReady;
  const statusText = describeAttention(
    meta.attention, meta.exitCode, meta.bootstrapExitCode, meta.attentionReason,
  );
  const statusTone =
    bootstrapFailed ? theme.warning
      : ended && meta.exitCode === 0 ? theme.success
      : ended ? theme.danger
      : meta.attention === 'waiting' ? theme.warning
      : meta.attention === 'running' ? theme.accentBlue
      : theme.textMuted;
  // Armed, output flowing, and half a minute without a single event: the
  // endpoint is not answering, and the badge everyone is reading is a guess.
  const hooksSilent = hookHintDue && meta.hooksArmed === true && meta.hookSeen !== true && !ended;

  const removeBlockedBy = verdict ? removalReason(verdict) : 'checking the worktree…';

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
          title={meta.lastMessage ?? undefined}
        >
          {statusText}
        </span>

        {hooksSilent && (
          <span
            style={S.hint}
            data-testid="agent-session-hook-hint"
            title={'This session was launched with its attention hooks armed, and none has arrived. '
              + 'The badge is running on the output/idle heuristic instead.'}
          >
            hooks: no event yet
          </span>
        )}

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
            title="Start another session with the same vendor and worktree (without the original prompt)"
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

      {/* ── Bootstrap failure — two ways forward, both of them real ── */}
      {bootstrapFailed && (
        <div style={S.failure} data-testid="agent-session-bootstrap-error">
          <div style={S.failureTitle}>
            <LucideIcon name="TriangleAlert" size={13} style={{ color: theme.warning }} />
            Bootstrap failed · exit {meta.bootstrapExitCode}
          </div>
          <div style={S.failureBody}>
            The worktree exists at <code style={S.code}>{meta.worktreePath}</code>, but installing its
            dependencies did not finish. The output above is the whole log.
          </div>
          <div style={S.actions}>
            <button
              type="button"
              onClick={handleRetryBootstrap}
              style={{ ...S.btn, color: theme.accentBlue, borderColor: theme.accentBlueBorder }}
              title="Run the bootstrap command again in this worktree"
              data-testid="agent-session-bootstrap-retry"
            >
              <LucideIcon name="RefreshCw" size={12} />
              <span>Retry</span>
            </button>
            <button
              type="button"
              onClick={handleOpenAnyway}
              style={S.btn}
              title="Start the agent in this worktree without its dependencies installed"
              data-testid="agent-session-bootstrap-open-anyway"
            >
              <LucideIcon name="Play" size={12} />
              <span>Open anyway</span>
            </button>
          </div>
        </div>
      )}

      {/* ── Failure state — the terminal has nothing to show, so it says why ── */}
      {failure && (
        <div style={S.failure} data-testid="agent-session-error">
          <div style={S.failureTitle}>
            <LucideIcon name="TriangleAlert" size={13} style={{ color: theme.warning }} />
            {failure.kind === 'vendor_not_found' ? `${meta.vendor} is not installed`
              : failure.kind === 'attached_session_exists' ? 'Another session already holds this project'
              : failure.kind === 'cwd_not_found' ? 'That directory is not there'
              : failure.kind === 'worktree_failed' ? 'The worktree could not be prepared'
              : 'The session could not start'}
          </div>

          {failure.kind === 'vendor_not_found' ? (
            <div style={S.failureBody}>
              <code style={S.code}>{failure.bin}</code> was not found on your PATH. Install that CLI,
              or point Fluxor at an existing binary with{' '}
              <code style={S.code}>FLUXOR_AGENT_BIN_{meta.vendor.toUpperCase()}=/path/to/{failure.bin}</code>
              {' '}and reopen the session.
            </div>
          ) : failure.kind === 'attached_session_exists' ? (
            <>
              <div style={S.failureBody}>
                <code style={S.code}>{otherSessionTitle ?? failure.otherSessionId}</code> is already
                running in this project&apos;s own working tree. Two agents writing there at once share
                one git index and one build cache, and neither of them is told — so the second session
                gets its own worktree instead.
              </div>
              <div style={S.actions}>
                <button
                  type="button"
                  onClick={handleOpenInWorktree}
                  style={{ ...S.btn, color: theme.accentBlue, borderColor: theme.accentBlueBorder }}
                  title="Create a dedicated git worktree and branch for this session"
                  data-testid="agent-session-open-in-worktree"
                >
                  <LucideIcon name="GitBranch" size={12} />
                  <span>Open in a worktree instead</span>
                </button>
              </div>
            </>
          ) : failure.kind === 'cwd_not_found' ? (
            <div style={S.failureBody}>
              <code style={S.code}>{failure.cwd}</code> does not exist. If it was a worktree, it has
              been removed since — &ldquo;Start again&rdquo; will build it back.
            </div>
          ) : (
            <div style={S.failureBody}>{failure.message}</div>
          )}
        </div>
      )}

      {/* ── The terminal itself ── */}
      <div ref={containerRef} style={S.term} data-testid="agent-session-terminal" />

      {/* ── Ended footer — the exit code, the worktree, and where the transcript is ── */}
      {ended && !failure && (
        <div style={S.footer} data-testid="agent-session-ended">
          <span style={{ color: meta.exitCode === 0 ? theme.success : theme.danger }}>
            Session ended{typeof meta.exitCode === 'number' ? ` · exit ${meta.exitCode}` : ''}
          </span>
          {meta.logPath && <span style={S.footerPath} title={meta.logPath}>{meta.logPath}</span>}
        </div>
      )}

      {/* ── The worktree this session leaves behind, and whether it is safe to drop ── */}
      {ended && meta.mode === 'worktree' && meta.worktreePath && (
        <div style={S.footer} data-testid="agent-session-worktree">
          {removed ? (
            <span style={{ color: theme.textMuted }}>
              worktree removed · branch {meta.branch} kept
            </span>
          ) : (
            <>
              <span style={{ color: theme.textMuted }}>
                {verdict ? describeWorktreeVerdict(verdict) : `worktree ${meta.branch ?? ''} · checking…`}
              </span>
              <div style={S.spacer} />
              {removeError && <span style={{ color: theme.danger }}>{removeError}</span>}
              <button
                type="button"
                onClick={handleRemoveWorktree}
                disabled={!!removeBlockedBy}
                style={{
                  ...S.btn,
                  ...(removeBlockedBy ? S.btnDisabled : null),
                  color: confirmRemove ? theme.danger : removeBlockedBy ? theme.textFaint : theme.textMuted,
                  borderColor: confirmRemove ? theme.dangerBorder : theme.border,
                }}
                // A disabled control that does not say why reads as broken.
                title={removeBlockedBy
                  ? `Cannot remove: this worktree ${removeBlockedBy}`
                  : 'Delete the worktree directory (the branch is kept)'}
                data-testid="agent-session-remove-worktree"
              >
                <LucideIcon name="Trash2" size={12} />
                <span>
                  {confirmRemove ? 'Confirm remove?'
                    : removeBlockedBy ? `Remove worktree — ${removeBlockedBy}`
                    : 'Remove worktree'}
                </span>
              </button>
            </>
          )}
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
  hint: {
    flexShrink: 0, color: theme.textFaint, fontSize: 10, letterSpacing: 0.3,
    whiteSpace: 'nowrap',
  },
  spacer: { flex: 1, minWidth: 4 },
  btn: {
    display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
    padding: '2px 6px', borderRadius: 3, cursor: 'pointer',
    background: 'transparent', border: `1px solid ${theme.border}`,
    color: theme.textMuted, fontSize: 10, fontFamily: theme.fontMono,
  },
  btnDisabled: { cursor: 'not-allowed' },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 },
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
