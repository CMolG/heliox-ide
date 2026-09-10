/**
 * card-writeback.ts — the Cockpit's half of one card file (F3)
 *
 * Responsibility:
 * - Deciding WHICH file a session's card is, and writing the one key the
 *   Cockpit owns on it: `runState`.
 *
 * Boundaries:
 * - Owns: `runState`, and the comment that explains a `failed` one.
 * - Does NOT own: `status`. The AGENT moves the card, because moving it is a
 *   statement about the work and only the agent knows whether the work is
 *   done. Two writers, two keys — the whole concurrency policy fits in that
 *   sentence, and it is why neither writer needs a lock.
 *
 * Architectural role:
 * - Renderer module driven by AgentSessionApp's lifecycle. Every call is
 *   BEST EFFORT: a card file that moved, a directory that is not there, an IPC
 *   that answers `{success:false}` — none of those may throw into the session,
 *   because the agent's work is not less real for the board being wrong.
 *
 * ── The rule that decides the file (architect's decision, not open) ──
 *
 * Attached mode: `<backlogDir>/<filename>` in the main tree.
 * Worktree mode: `<worktreePath>/.backlog/<filename>` — the worktree's own
 * checkout of the SAME card. The agent edits the card it can see, so the
 * Cockpit writes to the file the agent is editing; the main-tree card is left
 * alone and the board shows the live session as an overlay instead. The card
 * travels to `main` inside the PR, exactly as it does today.
 * External backlog (it lives in the IDE's config dir, not in the tree): there
 * is no worktree copy to write to, so worktree mode does not apply at all —
 * the launcher forces `attached` and says so.
 */
import { useFluxorStore } from '../store';
import type { AgentSessionMeta } from '@/types/desktop';
import type { BacklogCard } from '@/types/market';

/** The author every Cockpit-written comment carries, so a person can tell it from an agent's. */
export const COCKPIT_COMMENT_AUTHOR = 'Cockpit';

/**
 * Joins with the separator the path already uses.
 *
 * The renderer has no `node:path` — this is a browser bundle — and the one
 * place that matters is a Windows worktree path, where hard-coding `/` would
 * produce a path git accepts and `fs` does not. Same reason
 * `agent-sessions.ts` hand-writes `basenameOf`.
 */
function joinPath(base: string, ...segments: string[]): string {
  const sep = base.includes('\\') && !base.includes('/') ? '\\' : '/';
  return [base.replace(/[/\\]+$/, ''), ...segments].join(sep);
}

export interface CardFileRef {
  dir: string;
  filename: string;
}

/**
 * The card file this session writes to — or `null` when the window carries no
 * card at all, which is every session opened from the dock rather than a card.
 */
export function cardFileFor(meta: AgentSessionMeta): CardFileRef | null {
  if (!meta.backlogDir || !meta.cardFilename) return null;
  if (meta.mode === 'worktree' && meta.worktreePath && !meta.isExternalBacklog) {
    return { dir: joinPath(meta.worktreePath, '.backlog'), filename: meta.cardFilename };
  }
  return { dir: meta.backlogDir, filename: meta.cardFilename };
}

/** One place to say a write did not land, without ever throwing at the session. */
function reportFailure(what: string, detail?: string): void {
  useFluxorStore.getState().addToast(`${what}${detail ? ` — ${detail}` : ''}`, 'error');
}

async function writeRunState(ref: CardFileRef, runState: BacklogCard['runState']): Promise<boolean> {
  try {
    const result = await window.fluxorAPI?.updateBacklogCardStatus(
      ref.dir, ref.filename, undefined, undefined, runState,
    );
    // `undefined` means the bridge is not there at all (a unit test, a preload
    // that predates this) — silent, because nothing was expected to happen.
    if (result && result.success === false) {
      reportFailure(`Could not mark ${ref.filename} ${runState}`, result.error);
      return false;
    }
    return true;
  } catch (err) {
    reportFailure(`Could not mark ${ref.filename} ${runState}`, err instanceof Error ? err.message : String(err));
    return false;
  }
}

/**
 * `runState: running`, the moment the PTY is actually up.
 *
 * Deliberately not at click time, unlike the three flow launchers' optimistic
 * write: a session that dies on a missing binary or an unreachable worktree
 * never ran anything, and a card left reading "running" with no process behind
 * it is worse than a card that never moved.
 *
 * `status` is NOT touched. The agent's first instruction is to move the card to
 * `doing` itself, and doing it for it would take away the one signal that says
 * the agent actually read its prompt.
 */
export async function markCardRunning(meta: AgentSessionMeta): Promise<void> {
  const ref = cardFileFor(meta);
  if (!ref) return;
  await writeRunState(ref, 'running');
}

/**
 * The terminal write, decided by what the AGENT left behind rather than by the
 * exit code.
 *
 * A CLI that exits 0 has not necessarily finished the task — `claude` exits 0
 * when a person types `exit` — so the exit code cannot be the verdict. The
 * verdict is the card's own `status`: `review` or `deploy` means the agent
 * closed it out as the skill instructs, anything else means the session ended
 * with the work still open.
 *
 * `failed` therefore also carries a comment, because "failed" on its own is a
 * state with no way back into it: the comment names the vendor, the exit code
 * and the transcript, which is the whole of what a person needs to decide
 * whether to resume it or re-cut it.
 */
export async function settleCard(meta: AgentSessionMeta, exitCode?: number | null): Promise<void> {
  const ref = cardFileFor(meta);
  if (!ref) return;

  let cards: BacklogCard[] | undefined;
  try {
    cards = await window.fluxorAPI?.readBacklogDir(ref.dir) as BacklogCard[] | undefined;
  } catch (err) {
    reportFailure(`Could not re-read ${ref.filename}`, err instanceof Error ? err.message : String(err));
    return;
  }
  if (!cards) return; // no bridge — nothing to write to either

  const card = cards.find((c) => c.filename === ref.filename);
  if (!card) {
    // The agent may legitimately have renamed or moved it; that is not an
    // error the session can fix, and guessing a second path would be worse.
    reportFailure(`${ref.filename} is no longer in ${ref.dir}`, 'its runState was left as it was');
    return;
  }

  const closedOut = card.status === 'review' || card.status === 'deploy';
  const runState = closedOut ? 'completed' : 'failed';
  if (!(await writeRunState(ref, runState))) return;
  if (closedOut) return;

  const exit = typeof exitCode === 'number' ? String(exitCode) : 'unknown';
  const transcript = meta.logPath ?? 'not recorded';
  try {
    await window.fluxorAPI?.updateBacklogCardContent(ref.dir, ref.filename, {
      newComment: {
        author: COCKPIT_COMMENT_AUTHOR,
        text: `Session ${meta.vendor} ended (exit ${exit}) without closing the card. Transcript: ${transcript}`,
      },
    });
  } catch (err) {
    reportFailure(`Could not comment on ${ref.filename}`, err instanceof Error ? err.message : String(err));
  }
}
