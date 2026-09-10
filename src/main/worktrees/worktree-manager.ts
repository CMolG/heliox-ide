/**
 * worktree-manager.ts — One session, one git worktree, one branch (Cockpit F2)
 *
 * Responsibility:
 * - Creates, lists, judges and removes the git worktrees a Cockpit session
 *   runs in: `<projectRoot>/.claude/worktrees/<name>` on its own branch, cut
 *   from a freshly fetched default branch.
 * - Answers the one question that decides whether a worktree may be thrown
 *   away — is it SPENT? — with the same test `rama-al-dia.sh` uses in
 *   javadaba-web, because ancestry lies after a squash merge.
 *
 * Boundaries:
 * - Owns: argv for every git/gh invocation, the layout of the worktree
 *   directory, the spent verdict, the refusal to remove dirty work.
 * - Does NOT own: dependency installation (bootstrap.ts), IPC (ipc-worktrees.ts),
 *   sessions (src/main/pty/*), or any UI.
 *
 * Architectural role:
 * - Pure main-process service. `execFile` is INJECTED (same shape as
 *   vendors.ts's `ExecFileFn`, plus the `{ cwd, timeout }` every git call
 *   needs), so the unit half of its test records argv without running git and
 *   the integration half runs the real thing against a temporary repository.
 *
 * Two things it will never do, on purpose: `git push` and `git branch -D`.
 * Publishing is the user's call (invariant 2 in javadaba-web's harness), and a
 * branch is the only thing left after the worktree directory is gone — the
 * cheapest possible undo for a removal that turns out to be wrong.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

/**
 * The slice of `promisify(execFile)` this module uses. `cwd` and `timeout` are
 * both required rather than optional: a git call with no cwd runs against
 * whatever directory the app happened to be launched from, and one with no
 * timeout can hang the main process forever on a network remote.
 */
export type GitExecFn = (
  file: string,
  args: string[],
  opts: { cwd: string; timeout: number },
) => Promise<{ stdout: string; stderr: string }>;

const execFileAsync = promisify(execFile) as unknown as GitExecFn;

/** Plenty for any local git operation; nothing here is expected to touch the network. */
export const GIT_TIMEOUT_MS = 10_000;
/** `git fetch` DOES touch the network, and a slow remote must not block a session. */
export const FETCH_TIMEOUT_MS = 15_000;
/** `gh` authenticates against GitHub; same reasoning, and its answer is optional. */
export const GH_TIMEOUT_MS = 10_000;

/** Where Claude Code itself puts worktrees (`claude -w`), so ours are indistinguishable. */
export const WORKTREE_DIR = path.join('.claude', 'worktrees');
/** What `ensureExcluded` appends. Matched verbatim, which is what makes it idempotent. */
export const EXCLUDE_LINE = '**/.claude/worktrees/';

export interface WorktreeInfo {
  path: string;
  /** Short branch name, or `null` when the worktree is detached. */
  branch: string | null;
  head: string;
  isMain: boolean;
}

export interface SpentVerdict {
  /** `git diff --quiet <baseRef> HEAD` — the CONTENT is already in the base. */
  same: boolean;
  /** Commits the base does not have. After a squash merge this stays > 0 forever. */
  ahead: number;
  clean: boolean;
  /** How many entries `git status --porcelain` reported — for "N changes" in the UI. */
  changes: number;
  /** `null` when `gh` is absent or could not answer — not the same as "no PR". */
  prMerged: boolean | null;
  spent: boolean;
  removable: boolean;
  baseRef: string;
  /** The branch the verdict is about, or `null` when detached. */
  branch: string | null;
}

export interface CreateWorktreeRequest {
  projectRoot: string;
  name: string;
  branch: string;
}

export type CreatedWorktree = WorktreeInfo & { baseRef: string; reused: boolean };

/** One command's outcome, failure included — git uses exit codes as answers, not only as errors. */
interface ExecOutcome {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/**
 * Directory name a worktree may occupy. Everything outside `[a-z0-9._-]`
 * collapses to `-`, so a card id, a branch name or a sentence all land
 * somewhere predictable and nothing can climb out of the directory with `..`.
 */
export function sanitizeWorktreeName(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+/, '')
    .replace(/[-.]+$/, '');
  return cleaned || 'session';
}

/**
 * The path git itself would print. On macOS `os.tmpdir()` hands back
 * `/var/folders/…` while git reports the resolved `/private/var/folders/…`,
 * and a raw string comparison between the two says "not registered" about a
 * worktree that plainly is. Everything this module RETURNS goes through here
 * too, so a freshly created worktree and a reused one are the same string —
 * the renderer filters bootstrap output by that string.
 */
function resolvedPath(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    // Not created yet (or already gone): the lexical form is the best answer.
    return path.resolve(p);
  }
}

function samePath(a: string, b: string): boolean {
  return resolvedPath(a) === resolvedPath(b);
}

/** `git worktree list --porcelain` → one entry per record, main worktree first. */
export function parseWorktreeList(porcelain: string): WorktreeInfo[] {
  const out: WorktreeInfo[] = [];
  let current: Partial<WorktreeInfo> | null = null;

  const flush = () => {
    if (current?.path) {
      out.push({
        path: current.path,
        branch: current.branch ?? null,
        head: current.head ?? '',
        // git always emits the main worktree first; every later record is linked.
        isMain: out.length === 0,
      });
    }
    current = null;
  };

  for (const raw of porcelain.split('\n')) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (line.startsWith('worktree ')) {
      flush();
      current = { path: line.slice('worktree '.length) };
    } else if (line.startsWith('HEAD ') && current) {
      current.head = line.slice('HEAD '.length);
    } else if (line.startsWith('branch ') && current) {
      current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    }
    // `detached`, `bare`, `locked`, `prunable` need no field: branch stays null.
  }
  flush();
  return out;
}

export class WorktreeManager {
  private readonly exec: GitExecFn;

  constructor(deps: { exec?: GitExecFn } = {}) {
    this.exec = deps.exec ?? execFileAsync;
  }

  // ── Command plumbing ───────────────────────────────────────────

  private async git(cwd: string, args: string[], timeout = GIT_TIMEOUT_MS): Promise<string> {
    const { stdout } = await this.exec('git', args, { cwd, timeout });
    return stdout;
  }

  /** For the calls where a non-zero exit is an ANSWER ("that ref does not exist"). */
  private async tryExec(
    file: string, cwd: string, args: string[], timeout = GIT_TIMEOUT_MS,
  ): Promise<ExecOutcome> {
    try {
      const { stdout, stderr } = await this.exec(file, args, { cwd, timeout });
      return { ok: true, stdout, stderr };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      return { ok: false, stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? '' };
    }
  }

  // ── Queries ────────────────────────────────────────────────────

  /**
   * The ref a new branch is cut from, in descending order of how much it is
   * actually KNOWN rather than assumed:
   *   1. `refs/remotes/origin/HEAD` — the remote's own answer.
   *   2. `origin/main`, if the remote has one.
   *   3. a local `main`/`master` — the no-remote case (a fresh `git init`).
   *   4. `HEAD`, the only ref guaranteed to resolve in a repo with a commit.
   */
  async defaultBaseRef(projectRoot: string): Promise<string> {
    const sym = await this.tryExec('git', projectRoot, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
    const symRef = sym.stdout.trim();
    if (sym.ok && symRef) return symRef;

    const originMain = await this.tryExec('git', projectRoot, ['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main']);
    if (originMain.ok && originMain.stdout.trim()) return 'origin/main';

    for (const local of ['main', 'master']) {
      const found = await this.tryExec('git', projectRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${local}`]);
      if (found.ok && found.stdout.trim()) return local;
    }
    return 'HEAD';
  }

  async list(projectRoot: string): Promise<WorktreeInfo[]> {
    return parseWorktreeList(await this.git(projectRoot, ['worktree', 'list', '--porcelain']));
  }

  /**
   * Keeps `.claude/worktrees/` out of `git status` WITHOUT touching the tree.
   *
   * `<git-common-dir>/info/exclude` is per-clone and unversioned, which is the
   * whole point: writing this into the project's own `.gitignore` would be a
   * Cockpit modification showing up in the user's next diff, in every repo it
   * ever opens. `--git-common-dir` (not `--git-dir`) so it is the SHARED
   * directory even when called from inside a linked worktree.
   */
  async ensureExcluded(projectRoot: string): Promise<void> {
    const common = (await this.git(projectRoot, ['rev-parse', '--git-common-dir'])).trim();
    if (!common) return;
    const infoDir = path.join(path.resolve(projectRoot, common), 'info');
    const excludeFile = path.join(infoDir, 'exclude');

    let existing = '';
    try {
      existing = await fs.promises.readFile(excludeFile, 'utf-8');
    } catch {
      // No exclude file yet (or no info/ at all) — both are normal.
    }
    if (existing.split('\n').some((l) => l.trim() === EXCLUDE_LINE)) return;

    const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
    await fs.promises.mkdir(infoDir, { recursive: true });
    await fs.promises.appendFile(
      excludeFile,
      `${prefix}# Fluxor Cockpit — agent session worktrees (also Claude Code's own \`claude -w\` layout)\n${EXCLUDE_LINE}\n`,
      'utf-8',
    );
  }

  // ── Creation ───────────────────────────────────────────────────

  /**
   * `<projectRoot>/.claude/worktrees/<name>` on `branch`, cut from a freshly
   * fetched default ref.
   *
   * Three outcomes, all of them normal:
   *  - the path is already a registered worktree → it comes back `reused`,
   *    because re-opening a card must land in the same tree, not a second one;
   *  - the branch exists but has no worktree → it is checked out there;
   *  - neither exists → a new branch off `baseRef`.
   *
   * A failed fetch is NOT a failure of the whole operation: offline is a
   * normal state for a laptop, and a branch cut from a slightly stale local
   * ref is worth more than a session that refuses to open. What the caller
   * gets back is `baseRef` — the ref that was ACTUALLY used, not the one that
   * was wanted.
   */
  async create(req: CreateWorktreeRequest): Promise<CreatedWorktree> {
    const { projectRoot, branch } = req;
    await this.ensureExcluded(projectRoot);

    let baseRef = await this.defaultBaseRef(projectRoot);
    if (baseRef.startsWith('origin/')) {
      const remoteBranch = baseRef.slice('origin/'.length);
      const fetched = await this.tryExec('git', projectRoot, ['fetch', 'origin', remoteBranch, '-q'], FETCH_TIMEOUT_MS);
      if (!fetched.ok) {
        const local = await this.tryExec('git', projectRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${remoteBranch}`]);
        if (local.ok && local.stdout.trim()) baseRef = remoteBranch;
      }
    }

    const name = sanitizeWorktreeName(req.name);
    const targetPath = path.join(projectRoot, WORKTREE_DIR, name);

    const registered = (await this.list(projectRoot)).find((w) => samePath(w.path, targetPath));
    if (registered) return { ...registered, baseRef, reused: true };

    const branchExists = await this.tryExec('git', projectRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
    if (branchExists.ok && branchExists.stdout.trim()) {
      // The branch already carries work — check it out where it is, do not
      // re-cut it from the base and silently discard what is on it.
      await this.git(projectRoot, ['worktree', 'add', targetPath, branch]);
    } else {
      await this.git(projectRoot, ['worktree', 'add', '-b', branch, targetPath, baseRef]);
    }

    const head = (await this.git(targetPath, ['rev-parse', 'HEAD'])).trim();
    return { path: resolvedPath(targetPath), branch, head, isMain: false, baseRef, reused: false };
  }

  // ── The spent verdict ──────────────────────────────────────────

  /**
   * Is there anything left to lose in this worktree?
   *
   * This is `rama-al-dia.sh`'s test (javadaba-web, lines 112-115 and 147),
   * ported unchanged because of what it learned the hard way: PRs there are
   * SQUASH-merged, so a merged branch stops being an ancestor of main and the
   * ancestry counter says "9 commits pending" about work that shipped weeks
   * ago. The two things that do not lie are the CONTENT (`git diff`) and the
   * RECORD (`gh`) — ancestry is not one of them, which is exactly why `ahead`
   * appears here as evidence of a squash rather than as a blocker.
   */
  async detectSpent(worktreePath: string): Promise<SpentVerdict> {
    const baseRef = await this.defaultBaseRef(worktreePath);

    const branchOut = await this.tryExec('git', worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const branchName = branchOut.stdout.trim();
    const branch = branchOut.ok && branchName && branchName !== 'HEAD' ? branchName : null;

    const same = (await this.tryExec('git', worktreePath, ['diff', '--quiet', baseRef, 'HEAD'])).ok;

    const aheadOut = await this.tryExec('git', worktreePath, ['rev-list', '--count', `${baseRef}..HEAD`]);
    const ahead = Number.parseInt(aheadOut.stdout.trim(), 10);

    const statusOut = await this.tryExec('git', worktreePath, ['status', '--porcelain']);
    const changes = statusOut.stdout.split('\n').filter((l) => l.trim()).length;

    const prMerged = branch ? await this.prMerged(worktreePath, branch) : null;

    const aheadCount = Number.isFinite(ahead) ? ahead : 0;
    const clean = changes === 0;
    const spent = same && (prMerged === true || aheadCount > 0);

    return {
      same, ahead: aheadCount, clean, changes, prMerged, spent,
      removable: spent && clean,
      baseRef, branch,
    };
  }

  /**
   * `null`, not `false`, when `gh` is absent or cannot answer: "we do not
   * know" and "there is no merged PR" lead to different decisions, and
   * collapsing them would let a missing CLI look like evidence.
   */
  private async prMerged(cwd: string, branch: string): Promise<boolean | null> {
    const out = await this.tryExec(
      'gh', cwd,
      ['pr', 'list', '--head', branch, '--state', 'merged', '--json', 'number', '--limit', '1'],
      GH_TIMEOUT_MS,
    );
    if (!out.ok) return null;
    try {
      const parsed = JSON.parse(out.stdout.trim() || '[]') as unknown[];
      return Array.isArray(parsed) ? parsed.length > 0 : null;
    } catch {
      return null;
    }
  }

  // ── Removal ────────────────────────────────────────────────────

  /**
   * Removes the worktree DIRECTORY and keeps the BRANCH.
   *
   * Deliberate: the directory is reproducible from the branch in under a
   * second (`git worktree add` measured at 0.85 s), while the branch is the
   * only remaining copy of anything that was never pushed. Deleting both would
   * make a wrong removal unrecoverable; deleting one makes it an inconvenience.
   *
   * Refuses a dirty worktree unless forced — `git worktree remove` would
   * refuse too, but its message is about git's internals, and this one is
   * about the user's uncommitted work.
   */
  async remove(worktreePath: string, opts: { force?: boolean } = {}): Promise<void> {
    if (!opts.force) {
      const status = await this.tryExec('git', worktreePath, ['status', '--porcelain']);
      const changes = status.stdout.split('\n').filter((l) => l.trim()).length;
      if (changes > 0) {
        throw new Error(
          `Refusing to remove ${worktreePath}: it has ${changes} uncommitted change${changes === 1 ? '' : 's'}. Commit them, or remove with force.`,
        );
      }
    }

    // `git worktree remove` must not be run from inside the directory it is
    // deleting; the main worktree is always the first record of the list.
    const all = await this.list(worktreePath);
    const main = all.find((w) => w.isMain)?.path ?? worktreePath;

    const args = ['worktree', 'remove', ...(opts.force ? ['--force'] : []), worktreePath];
    await this.git(main, args);
    // Registrations survive a directory that vanished by other means; prune
    // keeps `list()` honest for the next `create` that reuses the name.
    await this.git(main, ['worktree', 'prune']);
  }
}
