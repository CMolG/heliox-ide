/**
 * env-compat.test.ts — Tests for the FLUXOR_* vs HELIOX_* env-compat helper.
 *
 * Covers the three contractual behaviors from the 2026-07-10 rebranding plan:
 * the new name wins when set, the legacy name is accepted as a fallback, and
 * the legacy fallback warns exactly once per name per process.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const warnSpy = vi.fn();

vi.mock('../logger', () => ({
  log: { warn: (...args: unknown[]) => warnSpy(...args) },
}));

import { readBrandEnv } from './env-compat';
import { resetWarnOnceForTests } from './warn-once';

const VAR_NAME = 'FLUXOR_TEST_TOKEN' as const;
const LEGACY_NAME = 'HELIOX_TEST_TOKEN';

describe('readBrandEnv', () => {
  const originalNew = process.env[VAR_NAME];
  const originalLegacy = process.env[LEGACY_NAME];

  beforeEach(() => {
    delete process.env[VAR_NAME];
    delete process.env[LEGACY_NAME];
    warnSpy.mockClear();
    resetWarnOnceForTests();
  });

  afterEach(() => {
    if (originalNew === undefined) delete process.env[VAR_NAME];
    else process.env[VAR_NAME] = originalNew;
    if (originalLegacy === undefined) delete process.env[LEGACY_NAME];
    else process.env[LEGACY_NAME] = originalLegacy;
  });

  it('returns undefined when neither the new nor the legacy var is set', () => {
    expect(readBrandEnv(VAR_NAME)).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('the new FLUXOR_* name wins when set, with no warning', () => {
    process.env[VAR_NAME] = 'new-value';
    expect(readBrandEnv(VAR_NAME)).toBe('new-value');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('falls back to the legacy HELIOX_* name when the new one is unset', () => {
    process.env[LEGACY_NAME] = 'legacy-value';
    expect(readBrandEnv(VAR_NAME)).toBe('legacy-value');
  });

  it('prefers the new name over the legacy one when both are set', () => {
    process.env[VAR_NAME] = 'new-value';
    process.env[LEGACY_NAME] = 'legacy-value';
    expect(readBrandEnv(VAR_NAME)).toBe('new-value');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns exactly once per legacy name across repeated reads', () => {
    process.env[LEGACY_NAME] = 'legacy-value';
    readBrandEnv(VAR_NAME);
    readBrandEnv(VAR_NAME);
    readBrandEnv(VAR_NAME);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain(LEGACY_NAME);
    expect(warnSpy.mock.calls[0][0]).toContain(VAR_NAME);
  });
});
