/**
 * bootstrap.test.ts — Detection, override precedence, and a real run
 *
 * What is pinned here:
 *   1. The lockfile table, including its precedence when a repository carries
 *      more than one lockfile (it happens, and picking the wrong one installs
 *      a second dependency tree).
 *   2. That an override wins whenever it EXISTS — `null` included, which is
 *      the "this project needs no bootstrap" answer detection must not undo.
 *   3. `runBootstrap` really streams lines, really reports a non-zero exit,
 *      and really stops a command that overruns its budget.
 *
 * The run half uses `/bin/sh` for real rather than a mock: the whole value of
 * this function is what it does with a live process's stdio and its clock, and
 * a mocked child process proves none of it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BOOTSTRAP_TIMEOUT_EXIT_CODE,
  COCKPIT_CONFIG_FILE,
  detectBootstrapCommand,
  effectiveBootstrapCommand,
  readCockpitConfig,
  resolveBootstrap,
  runBootstrap,
  writeBootstrapOverride,
} from './bootstrap';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxor-bootstrap-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('detectBootstrapCommand', () => {
  it('reads pnpm from its lockfile — offline-PREFERRED, not offline-only', () => {
    fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');
    // `--offline` alone was measured failing on one tarball absent from the
    // store (javadaba-web, 2026-09-08); this flag is the fix, not a taste.
    expect(detectBootstrapCommand(dir)).toBe('pnpm install --prefer-offline --frozen-lockfile');
  });

  it('reads npm from its lockfile', () => {
    fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');
    expect(detectBootstrapCommand(dir)).toBe('npm ci --prefer-offline');
  });

  it('reads yarn from its lockfile', () => {
    fs.writeFileSync(path.join(dir, 'yarn.lock'), '');
    expect(detectBootstrapCommand(dir)).toBe('yarn install --frozen-lockfile');
  });

  it('answers null for a project with no lockfile, instead of inventing one', () => {
    fs.writeFileSync(path.join(dir, 'package.json'), '{}');
    expect(detectBootstrapCommand(dir)).toBeNull();
  });

  it('has a fixed precedence when a repository carries two lockfiles', () => {
    fs.writeFileSync(path.join(dir, 'yarn.lock'), '');
    fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');
    expect(detectBootstrapCommand(dir)).toContain('pnpm');
  });
});

describe('the override', () => {
  it('wins over detection', () => {
    expect(effectiveBootstrapCommand('pnpm install', 'make setup')).toBe('make setup');
  });

  it('wins as an explicit NONE — a stored null is a decision, not a gap', () => {
    expect(effectiveBootstrapCommand('pnpm install', null)).toBeNull();
  });

  it('leaves detection alone when it was never set', () => {
    expect(effectiveBootstrapCommand('pnpm install', undefined)).toBe('pnpm install');
  });

  it('round-trips through the project config file, keeping other keys', async () => {
    fs.writeFileSync(
      path.join(dir, COCKPIT_CONFIG_FILE),
      JSON.stringify({ somethingElse: 1 }),
    );
    await writeBootstrapOverride(dir, 'make setup');

    const config = await readCockpitConfig(dir);
    expect(config.bootstrapCommand).toBe('make setup');
    expect((config as Record<string, unknown>).somethingElse).toBe(1);

    await writeBootstrapOverride(dir, null);
    expect((await readCockpitConfig(dir)).bootstrapCommand).toBeNull();
  });

  it('treats an absent or unreadable config as "nothing overridden"', async () => {
    expect(await readCockpitConfig(path.join(dir, 'nope'))).toEqual({});
    fs.writeFileSync(path.join(dir, COCKPIT_CONFIG_FILE), 'not json at all');
    expect(await readCockpitConfig(dir)).toEqual({});
  });

  it('resolves detection and override together', async () => {
    fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');
    const configDir = path.join(dir, 'config');
    fs.mkdirSync(configDir);

    expect(await resolveBootstrap(dir, configDir)).toEqual({
      detected: 'pnpm install --prefer-offline --frozen-lockfile',
      override: undefined,
      effective: 'pnpm install --prefer-offline --frozen-lockfile',
    });

    await writeBootstrapOverride(configDir, null);
    expect(await resolveBootstrap(dir, configDir)).toEqual({
      detected: 'pnpm install --prefer-offline --frozen-lockfile',
      override: null,
      effective: null,
    });
  });
});

describe('runBootstrap', () => {
  it('streams stdout line by line, in order, last line included', async () => {
    const lines: string[] = [];
    // The last line has no trailing newline on purpose: a package manager's
    // final progress line often does not, and dropping it would lose exactly
    // the line that says what went wrong.
    const result = await runBootstrap(dir, 'printf "first\nsecond\nno trailing newline"', (l) => lines.push(l));

    expect(result.exitCode).toBe(0);
    expect(lines).toEqual(['first', 'second', 'no trailing newline']);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('captures stderr too — that is where installers say what broke', async () => {
    const lines: string[] = [];
    // Ordering BETWEEN the two streams is deliberately not asserted: they are
    // separate pipes, and under load the OS interleaves them however it likes.
    // A test that pins that ordering passes alone and flakes in a full run.
    await runBootstrap(dir, 'echo out; echo boom >&2', (l) => lines.push(l));
    expect(lines.sort()).toEqual(['boom', 'out']);
  });

  it('runs inside the worktree, not wherever the app was launched from', async () => {
    const lines: string[] = [];
    await runBootstrap(dir, 'pwd', (l) => lines.push(l));
    expect(fs.realpathSync(lines[0])).toBe(fs.realpathSync(dir));
  });

  it('reports a failing command\'s own exit code', async () => {
    const result = await runBootstrap(dir, 'echo nope >&2; exit 7', () => { /* ignored */ });
    expect(result.exitCode).toBe(7);
  });

  it('kills a command that overruns its budget and reports 124', async () => {
    const started = Date.now();
    const result = await runBootstrap(dir, 'sleep 30', () => { /* ignored */ }, { timeoutMs: 100 });

    expect(result.exitCode).toBe(BOOTSTRAP_TIMEOUT_EXIT_CODE);
    // The point of the timeout is that it does not wait for `sleep 30`.
    expect(Date.now() - started).toBeLessThan(5_000);
  }, 10_000);
});
