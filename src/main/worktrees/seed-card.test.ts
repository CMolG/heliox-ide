/**
 * seed-card.test.ts — Unit tests for the worktree card seed (Cockpit F5)
 *
 * What is pinned here:
 *   1. A card absent from the worktree is copied, byte for byte.
 *   2. A card already in the worktree is NEVER overwritten — that copy may be
 *      one the agent has already edited, and losing it silently is the whole
 *      reason this rule exists.
 *   3. A missing source is an answer, not an exception: a session must still
 *      start when the card it names has gone.
 *   4. A worktree with no `.backlog/` at all gets one.
 *
 * Real files in a real temp directory rather than a mocked `fs`: the thing
 * under test IS the filesystem behaviour (existence, exclusivity, mkdir -p),
 * and a mock would only pin this file's opinion of it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BACKLOG_DIRNAME, seedCardIntoWorktree } from './seed-card';

const FILENAME = 'JDB-205-cockpit.md';
const SOURCE_BODY = '---\ntask_id: JDB-205\nstatus: todo\n---\n# Cockpit\n';

let root: string;
let backlogDir: string;
let worktreePath: string;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fluxor-seed-card-')));
  backlogDir = path.join(root, 'main-tree', BACKLOG_DIRNAME);
  worktreePath = path.join(root, 'worktree');
  fs.mkdirSync(backlogDir, { recursive: true });
  fs.mkdirSync(worktreePath, { recursive: true });
  fs.writeFileSync(path.join(backlogDir, FILENAME), SOURCE_BODY, 'utf-8');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('seedCardIntoWorktree', () => {
  it('copies a card the worktree does not have', async () => {
    const result = await seedCardIntoWorktree(worktreePath, backlogDir, FILENAME);

    expect(result.seeded).toBe(true);
    expect(result.targetPath).toBe(path.join(worktreePath, BACKLOG_DIRNAME, FILENAME));
    expect(fs.readFileSync(result.targetPath!, 'utf-8')).toBe(SOURCE_BODY);
  });

  it('creates .backlog/ when the worktree has none', async () => {
    expect(fs.existsSync(path.join(worktreePath, BACKLOG_DIRNAME))).toBe(false);

    await seedCardIntoWorktree(worktreePath, backlogDir, FILENAME);

    expect(fs.existsSync(path.join(worktreePath, BACKLOG_DIRNAME, FILENAME))).toBe(true);
  });

  it('never overwrites a card the worktree already has', async () => {
    const target = path.join(worktreePath, BACKLOG_DIRNAME, FILENAME);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // What the agent has already written on its branch. This is the byte
    // sequence that must survive.
    fs.writeFileSync(target, '---\ntask_id: JDB-205\nstatus: doing\n---\n# Edited on the branch\n', 'utf-8');

    const result = await seedCardIntoWorktree(worktreePath, backlogDir, FILENAME);

    expect(result).toEqual({ seeded: false, reason: 'already_present', targetPath: target });
    expect(fs.readFileSync(target, 'utf-8')).toContain('status: doing');
    expect(fs.readFileSync(target, 'utf-8')).not.toContain('status: todo');
  });

  it('answers instead of throwing when the source card is not there', async () => {
    const result = await seedCardIntoWorktree(worktreePath, backlogDir, 'JDB-999-gone.md');

    expect(result).toEqual({ seeded: false, reason: 'source_missing' });
    // And it leaves nothing behind — not even an empty `.backlog/`.
    expect(fs.existsSync(path.join(worktreePath, BACKLOG_DIRNAME, 'JDB-999-gone.md'))).toBe(false);
  });

  it('is idempotent: the second call seeds nothing', async () => {
    await expect(seedCardIntoWorktree(worktreePath, backlogDir, FILENAME))
      .resolves.toMatchObject({ seeded: true });
    await expect(seedCardIntoWorktree(worktreePath, backlogDir, FILENAME))
      .resolves.toMatchObject({ seeded: false, reason: 'already_present' });
  });
});
