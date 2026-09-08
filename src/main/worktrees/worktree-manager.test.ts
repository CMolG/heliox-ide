/**
 * worktree-manager.test.ts — The worktree manager, twice over
 *
 * Two halves, because neither one alone would be honest:
 *
 *  (a) UNIT, with a fake `execFile` that records argv. This is where the exact
 *      git commands are pinned — which flags, in which order, with which cwd —
 *      because that is the part a reader cannot verify by looking at the class
 *      and the part that silently changes meaning when someone "tidies" it.
 *
 *  (b) INTEGRATION, against a real temporary repository with a real `origin`.
 *      A fake exec can be made to agree with any theory of how git behaves; the
 *      squash-merge case in particular — content identical to the base while
 *      the commits are NOT ancestors — is exactly the shape a mock would get
 *      wrong, and it is the whole reason `detectSpent` exists.
 *
 * The integration half skips cleanly when `git` is not installed, and runs
 * with `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` pointed at /dev/null so the
 * machine's own git configuration cannot change its result.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  EXCLUDE_LINE,
  FETCH_TIMEOUT_MS,
  WorktreeManager,
  parseWorktreeList,
  sanitizeWorktreeName,
  type GitExecFn,
} from './worktree-manager';

// ─── (a) Unit half — a fake exec that records argv ──────────────────────────

interface RecordedCall { file: string; args: string[]; cwd: string; timeout: number }
interface FakeResponse { stdout?: string; stderr?: string; fail?: boolean }

/**
 * Keys are the whole command line (`git rev-list --count origin/main..HEAD`).
 * Anything not listed succeeds with empty output, which is git's own way of
 * saying "no" for the `rev-parse --verify --quiet` probes.
 */
function fakeExec(responses: Record<string, FakeResponse> = {}) {
  const calls: RecordedCall[] = [];
  const exec: GitExecFn = async (file, args, opts) => {
    calls.push({ file, args, cwd: opts.cwd, timeout: opts.timeout });
    const r = responses[[file, ...args].join(' ')];
    if (r?.fail) {
      const err = new Error(`${file} ${args.join(' ')} failed`) as Error & { stderr?: string };
      err.stderr = r.stderr ?? '';
      throw err;
    }
    return { stdout: r?.stdout ?? '', stderr: r?.stderr ?? '' };
  };
  /** Command lines, in order, as `git worktree add -b x /p origin/main`. */
  const lines = () => calls.map((c) => [c.file, ...c.args].join(' '));
  return { exec, calls, lines };
}

const ORIGIN_MAIN = { 'git symbolic-ref --short refs/remotes/origin/HEAD': { stdout: 'origin/main\n' } };

describe('sanitizeWorktreeName', () => {
  it('keeps a name that is already a safe directory name', () => {
    expect(sanitizeWorktreeName('jdb-205')).toBe('jdb-205');
  });

  it('flattens anything that could climb out of the directory', () => {
    expect(sanitizeWorktreeName('../../etc/passwd')).toBe('etc-passwd');
    expect(sanitizeWorktreeName('feat/Cockpit F2')).toBe('feat-cockpit-f2');
  });

  it('never returns an empty name', () => {
    expect(sanitizeWorktreeName('///')).toBe('session');
    expect(sanitizeWorktreeName('   ')).toBe('session');
  });
});

describe('parseWorktreeList', () => {
  it('reads the porcelain form and marks the first record as the main worktree', () => {
    const parsed = parseWorktreeList([
      'worktree /repo',
      'HEAD aaaa',
      'branch refs/heads/main',
      '',
      'worktree /repo/.claude/worktrees/x',
      'HEAD bbbb',
      'branch refs/heads/cockpit/x',
      '',
      'worktree /repo/.claude/worktrees/d',
      'HEAD cccc',
      'detached',
      '',
    ].join('\n'));

    expect(parsed).toEqual([
      { path: '/repo', branch: 'main', head: 'aaaa', isMain: true },
      { path: '/repo/.claude/worktrees/x', branch: 'cockpit/x', head: 'bbbb', isMain: false },
      { path: '/repo/.claude/worktrees/d', branch: null, head: 'cccc', isMain: false },
    ]);
  });
});

describe('defaultBaseRef', () => {
  it('asks the remote first', async () => {
    const { exec } = fakeExec(ORIGIN_MAIN);
    expect(await new WorktreeManager({ exec }).defaultBaseRef('/repo')).toBe('origin/main');
  });

  it('falls back to origin/main when the remote HEAD is not set', async () => {
    const { exec } = fakeExec({
      'git symbolic-ref --short refs/remotes/origin/HEAD': { fail: true },
      'git rev-parse --verify --quiet refs/remotes/origin/main': { stdout: 'abc\n' },
    });
    expect(await new WorktreeManager({ exec }).defaultBaseRef('/repo')).toBe('origin/main');
  });

  it('falls back to a LOCAL default branch in a repo with no remote', async () => {
    const { exec } = fakeExec({
      'git symbolic-ref --short refs/remotes/origin/HEAD': { fail: true },
      'git rev-parse --verify --quiet refs/heads/master': { stdout: 'abc\n' },
    });
    expect(await new WorktreeManager({ exec }).defaultBaseRef('/repo')).toBe('master');
  });

  it('answers HEAD rather than a name that does not exist', async () => {
    const { exec } = fakeExec({ 'git symbolic-ref --short refs/remotes/origin/HEAD': { fail: true } });
    expect(await new WorktreeManager({ exec }).defaultBaseRef('/repo')).toBe('HEAD');
  });
});

describe('create', () => {
  it('fetches, then cuts a NEW branch off the fetched base — exact argv', async () => {
    const { exec, calls, lines } = fakeExec(ORIGIN_MAIN);
    const created = await new WorktreeManager({ exec }).create({
      projectRoot: '/repo', name: 'JDB 205', branch: 'cockpit/jdb-205',
    });

    expect(lines()).toEqual([
      'git rev-parse --git-common-dir',
      'git symbolic-ref --short refs/remotes/origin/HEAD',
      'git fetch origin main -q',
      'git worktree list --porcelain',
      'git rev-parse --verify --quiet refs/heads/cockpit/jdb-205',
      'git worktree add -b cockpit/jdb-205 /repo/.claude/worktrees/jdb-205 origin/main',
      'git rev-parse HEAD',
    ]);
    // The fetch is the only call allowed to touch the network, and the only
    // one with the longer budget.
    expect(calls.find((c) => c.args[0] === 'fetch')?.timeout).toBe(FETCH_TIMEOUT_MS);
    expect(created).toMatchObject({
      path: path.join('/repo', '.claude', 'worktrees', 'jdb-205'),
      branch: 'cockpit/jdb-205',
      baseRef: 'origin/main',
      reused: false,
      isMain: false,
    });
  });

  it('checks out an EXISTING branch instead of re-cutting it from the base', async () => {
    const { exec, lines } = fakeExec({
      ...ORIGIN_MAIN,
      'git rev-parse --verify --quiet refs/heads/cockpit/x': { stdout: 'deadbeef\n' },
    });
    await new WorktreeManager({ exec }).create({ projectRoot: '/repo', name: 'x', branch: 'cockpit/x' });

    expect(lines()).toContain('git worktree add /repo/.claude/worktrees/x cockpit/x');
    expect(lines().some((l) => l.includes('worktree add -b'))).toBe(false);
  });

  it('returns the worktree already registered at that path, without adding a second one', async () => {
    const { exec, lines } = fakeExec({
      ...ORIGIN_MAIN,
      'git worktree list --porcelain': {
        stdout: [
          'worktree /repo', 'HEAD aaa', 'branch refs/heads/main', '',
          'worktree /repo/.claude/worktrees/x', 'HEAD bbb', 'branch refs/heads/cockpit/x', '',
        ].join('\n'),
      },
    });
    const created = await new WorktreeManager({ exec }).create({
      projectRoot: '/repo', name: 'x', branch: 'cockpit/x',
    });

    expect(created).toMatchObject({ reused: true, branch: 'cockpit/x', baseRef: 'origin/main' });
    expect(lines().some((l) => l.includes('worktree add'))).toBe(false);
  });

  it('survives an offline fetch and REPORTS the ref it actually used', async () => {
    const { exec, lines } = fakeExec({
      ...ORIGIN_MAIN,
      'git fetch origin main -q': { fail: true, stderr: 'could not resolve host' },
      'git rev-parse --verify --quiet refs/heads/main': { stdout: 'abc\n' },
    });
    const created = await new WorktreeManager({ exec }).create({
      projectRoot: '/repo', name: 'x', branch: 'cockpit/x',
    });

    expect(created.baseRef).toBe('main');
    expect(lines()).toContain('git worktree add -b cockpit/x /repo/.claude/worktrees/x main');
  });
});

describe('detectSpent', () => {
  function verdictExec(over: Record<string, FakeResponse>) {
    return fakeExec({
      ...ORIGIN_MAIN,
      'git rev-parse --abbrev-ref HEAD': { stdout: 'cockpit/x\n' },
      'git rev-list --count origin/main..HEAD': { stdout: '0\n' },
      'git status --porcelain': { stdout: '' },
      'gh pr list --head cockpit/x --state merged --json number --limit 1': { fail: true },
      ...over,
    });
  }

  it('is SPENT when the content is already in the base and the commits are not — the squash case', async () => {
    const { exec } = verdictExec({
      'git diff --quiet origin/main HEAD': { stdout: '' },
      'git rev-list --count origin/main..HEAD': { stdout: '3\n' },
    });
    const v = await new WorktreeManager({ exec }).detectSpent('/repo/.claude/worktrees/x');
    expect(v).toMatchObject({
      same: true, ahead: 3, clean: true, changes: 0, prMerged: null,
      spent: true, removable: true, baseRef: 'origin/main', branch: 'cockpit/x',
    });
  });

  it('is spent but NOT removable while there are uncommitted changes', async () => {
    const { exec } = verdictExec({
      'git diff --quiet origin/main HEAD': { stdout: '' },
      'git rev-list --count origin/main..HEAD': { stdout: '3\n' },
      'git status --porcelain': { stdout: ' M src/a.ts\n?? src/b.ts\n' },
    });
    const v = await new WorktreeManager({ exec }).detectSpent('/w');
    expect(v).toMatchObject({ spent: true, clean: false, changes: 2, removable: false });
  });

  it('is NOT spent while the content still differs from the base', async () => {
    const { exec } = verdictExec({
      'git diff --quiet origin/main HEAD': { fail: true },
      'git rev-list --count origin/main..HEAD': { stdout: '2\n' },
    });
    const v = await new WorktreeManager({ exec }).detectSpent('/w');
    expect(v).toMatchObject({ same: false, ahead: 2, spent: false, removable: false });
  });

  it('accepts a merged PR as the record even with nothing ahead', async () => {
    const { exec } = verdictExec({
      'git diff --quiet origin/main HEAD': { stdout: '' },
      'gh pr list --head cockpit/x --state merged --json number --limit 1': { stdout: '[{"number":55}]' },
    });
    const v = await new WorktreeManager({ exec }).detectSpent('/w');
    expect(v).toMatchObject({ prMerged: true, ahead: 0, spent: true, removable: true });
  });

  it('reads an empty gh answer as "no merged PR", and a missing gh as "unknown"', async () => {
    const withGh = verdictExec({
      'git diff --quiet origin/main HEAD': { stdout: '' },
      'gh pr list --head cockpit/x --state merged --json number --limit 1': { stdout: '[]' },
    });
    expect((await new WorktreeManager({ exec: withGh.exec }).detectSpent('/w')))
      .toMatchObject({ prMerged: false, spent: false });

    const noGh = verdictExec({ 'git diff --quiet origin/main HEAD': { stdout: '' } });
    expect((await new WorktreeManager({ exec: noGh.exec }).detectSpent('/w')))
      .toMatchObject({ prMerged: null, spent: false });
  });

  it('never asks gh about a detached HEAD', async () => {
    const { exec, lines } = verdictExec({ 'git rev-parse --abbrev-ref HEAD': { stdout: 'HEAD\n' } });
    const v = await new WorktreeManager({ exec }).detectSpent('/w');
    expect(v.branch).toBeNull();
    expect(v.prMerged).toBeNull();
    expect(lines().some((l) => l.startsWith('gh '))).toBe(false);
  });
});

describe('remove', () => {
  const listing = {
    'git worktree list --porcelain': {
      stdout: [
        'worktree /repo', 'HEAD aaa', 'branch refs/heads/main', '',
        'worktree /repo/.claude/worktrees/x', 'HEAD bbb', 'branch refs/heads/cockpit/x', '',
      ].join('\n'),
    },
  };

  it('refuses a dirty worktree, naming what is in the way', async () => {
    const { exec, lines } = fakeExec({ ...listing, 'git status --porcelain': { stdout: ' M a.ts\n' } });
    await expect(new WorktreeManager({ exec }).remove('/repo/.claude/worktrees/x'))
      .rejects.toThrow(/1 uncommitted change/);
    expect(lines().some((l) => l.includes('worktree remove'))).toBe(false);
  });

  it('removes and prunes from the MAIN worktree, and keeps the branch', async () => {
    const { exec, calls, lines } = fakeExec(listing);
    await new WorktreeManager({ exec }).remove('/repo/.claude/worktrees/x');

    expect(lines()).toEqual([
      'git status --porcelain',
      'git worktree list --porcelain',
      'git worktree remove /repo/.claude/worktrees/x',
      'git worktree prune',
    ]);
    // Run from the main worktree: git refuses to delete the directory it is in.
    expect(calls.at(-1)?.cwd).toBe('/repo');
    // The branch is the cheapest possible undo — nothing here may delete it.
    expect(lines().some((l) => l.includes('branch -D') || l.includes('branch -d'))).toBe(false);
  });

  it('forces past a dirty worktree only when asked', async () => {
    const { exec, lines } = fakeExec({ ...listing, 'git status --porcelain': { stdout: ' M a.ts\n' } });
    await new WorktreeManager({ exec }).remove('/repo/.claude/worktrees/x', { force: true });
    expect(lines()).toContain('git worktree remove --force /repo/.claude/worktrees/x');
  });
});

describe('ensureExcluded', () => {
  let dir: string;
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxor-exclude-')); });
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('appends once and never again — and never touches the tree\'s own .gitignore', async () => {
    const { exec } = fakeExec({ 'git rev-parse --git-common-dir': { stdout: '.git\n' } });
    const mgr = new WorktreeManager({ exec });

    await mgr.ensureExcluded(dir);
    await mgr.ensureExcluded(dir);

    const exclude = fs.readFileSync(path.join(dir, '.git', 'info', 'exclude'), 'utf-8');
    const occurrences = exclude.split('\n').filter((l) => l.trim() === EXCLUDE_LINE).length;
    expect(occurrences).toBe(1);
    expect(fs.existsSync(path.join(dir, '.gitignore'))).toBe(false);
  });
});

// ─── (b) Integration half — a real repository, a real origin ────────────────

function hasGit(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Hermetic: the machine's own git config cannot reach these repositories. */
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
};

function git(cwd: string, ...args: string[]): string {
  // stderr is PIPED, not inherited: `git push` writes its progress there, and
  // an otherwise green suite that prints four lines of remote chatter reads
  // like something went wrong.
  return execFileSync('git', args, {
    cwd, env: GIT_ENV, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

describe.skipIf(!hasGit())('WorktreeManager against a real repository', () => {
  let root: string;
  let origin: string;
  let clone: string;
  const branch = 'cockpit/session-int';
  const mgr = new WorktreeManager({});

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxor-wt-'));
    origin = path.join(root, 'origin.git');
    clone = path.join(root, 'work');

    execFileSync('git', ['init', '--bare', '-b', 'main', origin], { env: GIT_ENV, stdio: 'ignore' });
    execFileSync('git', ['clone', origin, clone], { env: GIT_ENV, stdio: 'ignore' });
    git(clone, 'config', 'user.email', 'cockpit@example.test');
    git(clone, 'config', 'user.name', 'Cockpit Test');
    git(clone, 'config', 'commit.gpgsign', 'false');

    fs.writeFileSync(path.join(clone, 'README.md'), '# fixture\n');
    git(clone, 'add', '-A');
    git(clone, 'commit', '-m', 'first');
    git(clone, 'push', '-u', 'origin', 'main');
  }, 30_000);

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('creates the worktree, registers the branch, and judges it through its whole life', async () => {
    // 1. Create.
    const created = await mgr.create({ projectRoot: clone, name: 'session-int', branch });
    expect(created.reused).toBe(false);
    expect(fs.existsSync(created.path)).toBe(true);
    expect(git(clone, 'worktree', 'list')).toContain(branch);
    // And the checkout is ignored without the project's .gitignore changing.
    expect(git(clone, 'status', '--porcelain')).toBe('');

    // Re-creating the same one is a no-op that hands back the same directory.
    const again = await mgr.create({ projectRoot: clone, name: 'session-int', branch });
    expect(again.reused).toBe(true);
    expect(again.path).toBe(created.path);

    // 2. Work in it: not spent, because the content is not in the base.
    fs.writeFileSync(path.join(created.path, 'feature.txt'), 'work\n');
    git(created.path, 'add', '-A');
    git(created.path, 'commit', '-m', 'the work');
    const working = await mgr.detectSpent(created.path);
    expect(working).toMatchObject({ same: false, clean: true, spent: false, removable: false });
    expect(working.ahead).toBeGreaterThan(0);

    // 3. Squash-merge it into origin/main — the case ancestry gets wrong. The
    //    content lands on main under a DIFFERENT commit, so the branch's own
    //    commit stays outside main's history forever.
    git(clone, 'merge', '--squash', branch);
    git(clone, 'commit', '-m', 'squashed');
    git(clone, 'push', 'origin', 'main');
    git(clone, 'fetch', 'origin');

    const spent = await mgr.detectSpent(created.path);
    expect(spent.same).toBe(true);
    expect(spent.ahead).toBeGreaterThan(0);
    expect(spent.spent).toBe(true);
    expect(spent.removable).toBe(true);
    // No GitHub behind a file:// remote, so `gh` cannot answer — and "unknown"
    // must not be read as "no".
    expect(spent.prMerged).toBeNull();

    // 4. One uncommitted file is enough to take the offer away.
    fs.writeFileSync(path.join(created.path, 'scratch.txt'), 'unsaved\n');
    const dirty = await mgr.detectSpent(created.path);
    expect(dirty).toMatchObject({ spent: true, clean: false, changes: 1, removable: false });
    await expect(mgr.remove(created.path)).rejects.toThrow(/uncommitted/);
    expect(fs.existsSync(created.path)).toBe(true);

    // 5. Remove for real. The directory goes; the branch stays.
    fs.rmSync(path.join(created.path, 'scratch.txt'));
    await mgr.remove(created.path);
    expect(fs.existsSync(created.path)).toBe(false);
    expect(git(clone, 'worktree', 'list')).not.toContain(created.path);
    expect(git(clone, 'branch', '--list', branch)).toContain(branch);
  }, 60_000);
});
