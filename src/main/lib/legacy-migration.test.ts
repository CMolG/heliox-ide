/**
 * legacy-migration.test.ts — Tests for the Heliox → Fluxor directory migration.
 *
 * Exercises real tmp directories (no fs mocking) so the rename semantics —
 * including "never clobber an existing new-named dir" and the nested
 * leaderboard filename rename — are proven against the real filesystem.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  migrateLegacyDirectories,
  migrateLegacyDotDir,
  migrateLegacyProjectDir,
} from './legacy-migration';

let base: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'fluxor-migration-test-'));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('migrateLegacyProjectDir', () => {
  it('renames heliox/ to fluxor/ when only the old dir exists', () => {
    mkdirSync(join(base, 'heliox'), { recursive: true });
    writeFileSync(join(base, 'heliox', 'flows.json'), '{"flows":[]}', 'utf-8');

    migrateLegacyProjectDir(base);

    expect(existsSync(join(base, 'heliox'))).toBe(false);
    expect(existsSync(join(base, 'fluxor', 'flows.json'))).toBe(true);
    expect(readFileSync(join(base, 'fluxor', 'flows.json'), 'utf-8')).toBe('{"flows":[]}');
  });

  it('is a no-op when neither dir exists', () => {
    expect(() => migrateLegacyProjectDir(base)).not.toThrow();
    expect(existsSync(join(base, 'fluxor'))).toBe(false);
  });

  it('never clobbers an existing fluxor/ dir when heliox/ also exists', () => {
    mkdirSync(join(base, 'heliox'), { recursive: true });
    writeFileSync(join(base, 'heliox', 'flows.json'), 'old', 'utf-8');
    mkdirSync(join(base, 'fluxor'), { recursive: true });
    writeFileSync(join(base, 'fluxor', 'flows.json'), 'new', 'utf-8');

    migrateLegacyProjectDir(base);

    expect(readFileSync(join(base, 'fluxor', 'flows.json'), 'utf-8')).toBe('new');
    expect(readFileSync(join(base, 'heliox', 'flows.json'), 'utf-8')).toBe('old');
  });

  it('is idempotent — running it twice does not error', () => {
    mkdirSync(join(base, 'heliox'), { recursive: true });
    migrateLegacyProjectDir(base);
    expect(() => migrateLegacyProjectDir(base)).not.toThrow();
  });
});

describe('migrateLegacyDotDir', () => {
  it('renames .heliox/ to .fluxor/, carrying context-map.json along with it', () => {
    mkdirSync(join(base, '.heliox'), { recursive: true });
    writeFileSync(join(base, '.heliox', 'context-map.json'), '{"version":1}', 'utf-8');

    migrateLegacyDotDir(base);

    expect(existsSync(join(base, '.heliox'))).toBe(false);
    expect(existsSync(join(base, '.fluxor', 'context-map.json'))).toBe(true);
    expect(readFileSync(join(base, '.fluxor', 'context-map.json'), 'utf-8')).toBe('{"version":1}');
  });

  it('renames the nested Arena leaderboard file after the directory-level rename', () => {
    mkdirSync(join(base, '.heliox', 'performance-frontier'), { recursive: true });
    writeFileSync(
      join(base, '.heliox', 'performance-frontier', 'heliox-leaderboard.json'),
      '[]',
      'utf-8',
    );

    migrateLegacyDotDir(base);

    expect(existsSync(join(base, '.fluxor', 'performance-frontier', 'heliox-leaderboard.json'))).toBe(false);
    expect(existsSync(join(base, '.fluxor', 'performance-frontier', 'fluxor-leaderboard.json'))).toBe(true);
  });

  it('renames a stray old-named leaderboard file even if .fluxor/ already exists', () => {
    // Simulates a partially-migrated project: .fluxor/ already created (e.g. by
    // context-map activity) before performance-frontier ever wrote a ledger.
    mkdirSync(join(base, '.fluxor', 'performance-frontier'), { recursive: true });
    writeFileSync(
      join(base, '.fluxor', 'performance-frontier', 'heliox-leaderboard.json'),
      '[]',
      'utf-8',
    );

    migrateLegacyDotDir(base);

    expect(existsSync(join(base, '.fluxor', 'performance-frontier', 'fluxor-leaderboard.json'))).toBe(true);
  });

  it('is a no-op when neither dir exists', () => {
    expect(() => migrateLegacyDotDir(base)).not.toThrow();
    expect(existsSync(join(base, '.fluxor'))).toBe(false);
  });

  it('never clobbers an existing .fluxor/ dir when .heliox/ also exists', () => {
    mkdirSync(join(base, '.heliox'), { recursive: true });
    writeFileSync(join(base, '.heliox', 'context-map.json'), 'old', 'utf-8');
    mkdirSync(join(base, '.fluxor'), { recursive: true });
    writeFileSync(join(base, '.fluxor', 'context-map.json'), 'new', 'utf-8');

    migrateLegacyDotDir(base);

    expect(readFileSync(join(base, '.fluxor', 'context-map.json'), 'utf-8')).toBe('new');
  });
});

describe('migrateLegacyDirectories', () => {
  it('migrates both heliox/ and .heliox/ in one call', () => {
    mkdirSync(join(base, 'heliox'), { recursive: true });
    mkdirSync(join(base, '.heliox'), { recursive: true });

    migrateLegacyDirectories(base);

    expect(existsSync(join(base, 'fluxor'))).toBe(true);
    expect(existsSync(join(base, '.fluxor'))).toBe(true);
  });
});
