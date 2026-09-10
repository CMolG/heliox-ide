/**
 * seed-card.ts — Putting the card inside the worktree that was cut for it (Cockpit F5)
 *
 * Responsibility:
 * - Copying one `.backlog/<file>.md` from the main tree into a fresh worktree
 *   when — and only when — the worktree does not already have it.
 *
 * Boundaries:
 * - Owns: the copy, the never-overwrite rule, and creating `.backlog/` if the
 *   worktree has none.
 * - Does NOT own: which card a session carries (card-writeback.ts), when the
 *   copy happens (AgentSessionApp's prepare step), or the worktree itself
 *   (worktree-manager.ts).
 *
 * Architectural role:
 * - Pure main-process module: node `fs` only, no Electron, so the rule is
 *   pinned by a unit test rather than by cutting a worktree and looking.
 *
 * ── Why this exists at all (found in the F5 field test, 2026-09-08) ──
 *
 * A session worktree is cut from a freshly fetched `origin/main` (invariant 17
 * of javadaba-web's harness, and decision 3 of the Cockpit plan). A card that
 * has not reached `origin/main` yet — written this session, uncommitted, or
 * committed on a branch nobody pushed — is therefore SIMPLY NOT THERE in the
 * checkout, and the launch prompt's first line ("the card file is
 * `.backlog/<file>`; read it in full first") points at a path that does not
 * exist. The agent then improvises: it looks for the card, does not find it,
 * and either invents the task from its id or stops.
 *
 * Copying is the smallest fix, and it is safe in exactly one direction: this
 * only ever ADDS a file the worktree lacks. A card the worktree already has is
 * the branch's own copy — possibly one the agent has already edited — and
 * overwriting it would destroy work with no warning, so a present file is a
 * successful no-op (`seeded: false`), never a conflict to resolve.
 *
 * It writes an UNTRACKED file into the worktree, which is correct: the agent
 * commits it with the rest of its work, exactly as it would have committed a
 * card it created itself.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Where a card lives inside any checkout — the same relative layout in both trees. */
export const BACKLOG_DIRNAME = '.backlog';

export interface SeedCardResult {
  /** `true` only when a file was actually written by this call. */
  seeded: boolean;
  /** Why nothing was written, when nothing was. Never an error the caller must handle. */
  reason?: 'already_present' | 'source_missing';
  /** Absolute path of the card inside the worktree — written or already there. */
  targetPath?: string;
}

/**
 * Copies `<backlogDir>/<filename>` into `<worktreePath>/.backlog/<filename>`
 * unless the target already exists.
 *
 * Every outcome is a VALUE, including "the source is not there": a session
 * launched from an external backlog, or from a card someone deleted between
 * the click and the worktree, must still start. The card being absent is a
 * thing the agent can report; a crashed prepare step is not.
 */
export async function seedCardIntoWorktree(
  worktreePath: string,
  backlogDir: string,
  filename: string,
): Promise<SeedCardResult> {
  const targetDir = path.join(worktreePath, BACKLOG_DIRNAME);
  const targetPath = path.join(targetDir, filename);

  if (fs.existsSync(targetPath)) {
    return { seeded: false, reason: 'already_present', targetPath };
  }

  const sourcePath = path.join(backlogDir, filename);
  if (!fs.existsSync(sourcePath)) {
    return { seeded: false, reason: 'source_missing' };
  }

  // A worktree cut from a commit that predates `.backlog/` has no such
  // directory at all, and `copyFile` into a missing directory is an ENOENT
  // indistinguishable from a missing source.
  await fs.promises.mkdir(targetDir, { recursive: true });
  try {
    // `COPYFILE_EXCL` rather than a plain copy: the `existsSync` above is a
    // check, this is the guarantee. Between the two, a bootstrap or the agent
    // itself could have created the file, and losing that write silently is
    // the one outcome this module exists to prevent.
    await fs.promises.copyFile(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'EEXIST') throw err;
    return { seeded: false, reason: 'already_present', targetPath };
  }

  return { seeded: true, targetPath };
}
