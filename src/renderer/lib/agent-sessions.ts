/**
 * agent-sessions.ts — Opening and driving agent-session windows (Cockpit F1/F2)
 *
 * Responsibility:
 * - `openAgentSession` — the one way a session window comes into existence,
 *   including the worktree name and branch a `'worktree'` session defaults to.
 * - The pure rules the session component needs but should not decide inline:
 *   how a `'type'` vendor's prompt gets delivered, how a status reads, and
 *   whether a spent worktree may be removed — and if not, WHY not.
 *
 * Boundaries:
 * - Owns: window creation for `'agent-session'`, prompt-delivery policy, the
 *   wording of every state and every refusal.
 * - Does NOT own: the terminal itself (AgentSessionApp.tsx), the PTY
 *   (src/main/pty/*), git (src/main/worktrees/*), or backlog cards (F3).
 *
 * Architectural role:
 * - Renderer-side module with no React and no DOM, so its decisions are unit
 *   testable without mounting a terminal.
 */
import { useDesktopStore } from '../store/desktop-store';
import type {
  AgentSessionAttention, AgentSessionAttentionReason, AgentSessionMeta, AgentVendorId,
} from '@/types/desktop';
import type { SpentVerdict } from '@/main/worktrees/worktree-manager';
import type { GitFailed } from '@/main/worktrees/ipc-worktrees';

/**
 * How long to wait AFTER the first output chunk before typing the prompt into
 * a `promptDelivery: 'type'` vendor.
 *
 * `opencode` in TUI mode has no initial-prompt flag (`opencode [project]` takes
 * a DIRECTORY), so the only way to hand it a first instruction is to type it
 * the way a person would. First output means "something rendered"; it does not
 * mean the input box is focused and accepting keys, and typing into a TUI that
 * is still laying itself out drops characters. This delay is empirical, not
 * derived — if a vendor grows a real flag, delete the whole path rather than
 * tuning the number.
 */
export const PROMPT_TYPE_DELAY_MS = 1500;

export type PromptDelivery = 'arg' | 'type';

export interface PromptTypingPlan {
  /** Exactly what to write into the PTY — the prompt plus the Enter that submits it. */
  payload: string;
  /** Milliseconds to wait after the first output chunk. */
  delayMs: number;
}

/**
 * Decides whether the session has to TYPE its prompt, and what to type.
 *
 * Returns `null` in the three cases where it must not: there is no prompt, the
 * prompt is blank, or the vendor already received it through argv. Pure, so
 * the "did we send it twice / did we send an empty line" question is answered
 * by a unit test rather than by watching a terminal.
 */
export function planPromptTyping(
  promptDelivery: PromptDelivery,
  prompt: string | undefined,
): PromptTypingPlan | null {
  if (promptDelivery !== 'type') return null;
  if (!prompt || !prompt.trim()) return null;
  // `\r`, not `\n`: a PTY in canonical mode reads Enter as carriage return, and
  // a TUI that reads raw keys expects the same byte the keyboard would send.
  return { payload: `${prompt}\r`, delayMs: PROMPT_TYPE_DELAY_MS };
}

/**
 * The status line the header badge shows. Words, never colour alone — a badge
 * that only changes hue says nothing in greyscale, in a screenshot, or to a
 * colour blind reader (and it is what the e2e suite asserts on).
 *
 * `bootstrapExitCode` is separate from `exitCode` on purpose: a failed install
 * and a failed AGENT are different events with different ways out, and one
 * number carrying both would make the window unable to tell them apart.
 *
 * F4 added `reason`, and it is the same idea one level down: `waiting` alone
 * does not tell anyone whether to go and approve something or go and read
 * something, so the badge says which — `waiting · permission`.
 */
export function describeAttention(
  attention: AgentSessionAttention,
  exitCode?: number | null,
  bootstrapExitCode?: number | null,
  reason?: AgentSessionAttentionReason,
): string {
  if (attention === 'preparing') return 'preparing worktree';
  if (attention === 'bootstrapping') {
    return typeof bootstrapExitCode === 'number' && bootstrapExitCode !== 0
      ? `bootstrap failed · exit ${bootstrapExitCode}`
      : 'bootstrapping';
  }
  if (attention === 'ended') {
    return typeof exitCode === 'number' ? `ended · exit ${exitCode}` : 'ended';
  }
  if (attention === 'waiting' && reason) return `waiting · ${reason}`;
  return attention;
}

/**
 * The leading word of a session window's TITLE — `waiting · `, `running · `,
 * `ended · `.
 *
 * It exists so a canvas full of terminals, or any list of window titles, can
 * be read WITHOUT opening a single one. Empty for the setup states, which are
 * transient and whose window nobody is scanning yet.
 */
export function titlePrefixFor(attention: AgentSessionAttention): string {
  if (attention === 'waiting' || attention === 'running' || attention === 'ended') {
    return `${attention} · `;
  }
  return '';
}

/** Strips whatever `titlePrefixFor` last added, so prefixes never stack. */
export function stripTitlePrefix(title: string): string {
  return title.replace(/^(?:waiting|running|ended) · /, '');
}

/** `7:04` — how long this session has been open. Minutes are not capped at 60. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

// ─── Worktrees (F2) ──────────────────────────────────────────────

/**
 * Did that worktree call fail?
 *
 * The guard lives HERE, not beside its type in `ipc-worktrees.ts`, because the
 * renderer cannot import that module at runtime — it reaches `electron` and
 * the whole main process behind it. The type crosses as `import type`, which
 * is erased; the two-line predicate is written on this side.
 */
export function isGitFailed(result: unknown): result is GitFailed {
  return !!result && typeof result === 'object'
    && (result as GitFailed).error === 'git_failed';
}

/**
 * Default directory name for a session with no card behind it yet — F3 will
 * hand the card id instead. Eight hex characters of the session's own uuid:
 * short enough to read in a path, unique enough that two dock launches in the
 * same second do not collide.
 */
export function defaultWorktreeName(sessionId: string): string {
  return `session-${sessionId.slice(0, 8)}`;
}

/** Namespaced, so a Cockpit branch is recognisable in `git branch` at a glance. */
export function defaultWorktreeBranch(sessionId: string): string {
  return `cockpit/${defaultWorktreeName(sessionId)}`;
}

/**
 * Why this worktree may NOT be removed — or `null` when it may.
 *
 * A disabled control that does not say why reads as broken, not as guarded
 * (interface-psychology rule, point 1), and this is the one control in the
 * window that can destroy work.
 */
export function removalReason(verdict: SpentVerdict): string | null {
  if (verdict.removable) return null;
  if (!verdict.clean) return 'has uncommitted changes';
  // Content differs from the base AND there are commits: real work that no PR
  // has carried anywhere. Ancestry alone would not prove this — after a squash
  // merge `ahead` stays positive forever — which is why `same` is the other half.
  if (!verdict.same && verdict.ahead > 0) return 'has commits no PR carried';
  return 'not spent yet';
}

/** `worktree <branch> · spent · clean` — the ended footer's one extra line. */
export function describeWorktreeVerdict(verdict: SpentVerdict): string {
  const branch = verdict.branch ?? 'detached HEAD';
  const spent = verdict.spent ? 'spent' : 'not spent';
  const changes = verdict.clean
    ? 'clean'
    : `${verdict.changes} change${verdict.changes === 1 ? '' : 's'}`;
  return `worktree ${branch} · ${spent} · ${changes}`;
}

/** Last path segment, trailing separators ignored. `''` for an empty path. */
export function basenameOf(p: string): string {
  const parts = p.replace(/[/\\]+$/, '').split(/[/\\]/);
  return parts[parts.length - 1] ?? '';
}

export interface OpenAgentSessionOptions {
  vendor: AgentVendorId;
  cwd: string;
  /** The project the session belongs to. Required — see `AgentSessionMeta.projectRoot`. */
  projectRoot: string;
  prompt?: string;
  mode?: AgentSessionMeta['mode'];
  title?: string;
  /** Worktree mode only. Defaults to `session-<8 hex>` / `cockpit/session-<8 hex>`. */
  worktreeName?: string;
  branch?: string;
  // ── F3: the card that opened this session, if any ──
  cardId?: string;
  backlogDir?: string;
  cardFilename?: string;
  isExternalBacklog?: boolean;
}

/**
 * Creates an 'agent-session' window. Neither the PTY nor the worktree is
 * created here: the terminal has to be mounted and measured first, because a
 * PTY spawned at the wrong geometry renders a TUI it can never re-lay-out
 * correctly — and the worktree's own progress is written INTO that terminal,
 * so it cannot start before there is one. AgentSessionApp drives both, guarded
 * by `worktreeReady` and `ptyStarted`.
 */
export function openAgentSession(opts: OpenAgentSessionOptions): string {
  const sessionId = crypto.randomUUID();
  const mode = opts.mode ?? 'attached';
  const worktreeName = mode === 'worktree'
    ? (opts.worktreeName ?? defaultWorktreeName(sessionId))
    : undefined;
  const branch = mode === 'worktree'
    ? (opts.branch ?? defaultWorktreeBranch(sessionId))
    : undefined;

  const agentSession: AgentSessionMeta = {
    sessionId,
    vendor: opts.vendor,
    cwd: opts.cwd,
    projectRoot: opts.projectRoot,
    mode,
    worktreeName,
    branch,
    prompt: opts.prompt,
    cardId: opts.cardId,
    backlogDir: opts.backlogDir,
    cardFilename: opts.cardFilename,
    isExternalBacklog: opts.isExternalBacklog,
    launchedAt: Date.now(),
    ptyStarted: false,
    // A worktree session's first act is creating its worktree, and the badge
    // has to say that from the very first frame — 'starting' would be a lie
    // for as long as the fetch takes.
    attention: mode === 'worktree' ? 'preparing' : 'starting',
  };

  return useDesktopStore.getState().addWindow('agent-session', {
    // A desktop of windows all called "Agent session" is a desktop you cannot
    // navigate. Attached sessions are told apart by their directory; worktree
    // sessions by their worktree, since they all share one project root.
    title: opts.title ?? `${opts.vendor} · ${worktreeName ?? (basenameOf(opts.cwd) || opts.cwd)}`,
    iconName: 'Terminal',
    agentSession,
  });
}

// ─── Cards ↔ sessions (F3) ───────────────────────────────────────

/** The minimum of a desktop window this module needs — so the lookup stays testable. */
export interface SessionWindowLike {
  id: string;
  agentSession?: AgentSessionMeta;
}

export type BacklogSessionCorrelation = Record<string, { backlogDir: string; filename: string; cardId: string }>;

/**
 * The session window a card currently has, if any.
 *
 * Two routes in on purpose, and neither is redundant. The window's own
 * `cardFilename` is the durable one: it survives "Start again", which mints a
 * fresh `sessionId` and would otherwise orphan the correlation entry the
 * launcher wrote. The correlation map is the authoritative one at launch, and
 * is what a future consumer with only a sessionId in hand can ask.
 *
 * When several match — a card relaunched after an earlier session ended — the
 * most recently launched wins, because that is the one the overlay is about.
 */
export function findCardSessionWindow(
  windows: SessionWindowLike[],
  correlation: BacklogSessionCorrelation,
  filename: string,
): { windowId: string; meta: AgentSessionMeta } | null {
  let best: { windowId: string; meta: AgentSessionMeta } | null = null;
  for (const win of windows) {
    const meta = win.agentSession;
    if (!meta) continue;
    const matches = meta.cardFilename === filename
      || correlation[meta.sessionId]?.filename === filename;
    if (!matches) continue;
    if (!best || meta.launchedAt >= best.meta.launchedAt) best = { windowId: win.id, meta };
  }
  return best;
}

/**
 * What the card's overlay says about its session, in words and in a tooltip.
 *
 * The label is F1's attention word — the same vocabulary the session window's
 * own badge uses, so the two surfaces never describe one session differently.
 * In worktree mode it also carries the card's status INSIDE the worktree when
 * that has moved ahead of the main tree's: that divergence is not a fault, it
 * is the whole shape of the feature (the agent closed its card on a branch,
 * and the branch has not merged yet), and a board that hid it would be lying
 * about work that is already done.
 */
export function describeCardSession(
  meta: AgentSessionMeta,
  cardStatus: string,
): { label: string; tooltip: string } {
  const base = describeAttention(meta.attention, meta.exitCode, meta.bootstrapExitCode, meta.attentionReason);
  const mirrored = meta.mode === 'worktree' && meta.mirroredStatus && meta.mirroredStatus !== cardStatus
    ? ` · in worktree: ${meta.mirroredStatus}`
    : '';
  const where = meta.mode === 'worktree' ? (meta.branch ?? 'worktree') : 'attached';
  return { label: `${base}${mirrored}`, tooltip: `session ${meta.vendor} · ${where}` };
}
