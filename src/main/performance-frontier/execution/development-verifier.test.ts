/**
 * development-verifier.test.ts — Tests for the ground-truth verifier.
 *
 * Contains two suites:
 *
 * 1. Unit suite (mocked runInSandbox) — fast, deterministic assertions that
 *    prove the test-file discovery logic and the no-test-file guard without
 *    spawning real vitest processes.  Uses `mockResolvedValueOnce` so each
 *    call returns a controlled value; all other calls pass through to the real
 *    implementation.
 *
 * 2. End-to-end suite — actually spawns real vitest processes to confirm the
 *    verifier works against real TypeScript/vitest output.  These carry a
 *    generous per-test timeout (120 s).
 */

import { describe, expect, it, vi } from 'vitest';
import { createDevelopmentCase } from '../procedural/case-factory';
import { verifyDevelopment } from './development-verifier';

// ---------------------------------------------------------------------------
// Module mock
//
// vi.mock is hoisted before imports.  The factory wraps the real runInSandbox
// in a vi.fn so we can queue one-shot return values per test while the E2E
// suite uses the real implementation (vi.fn passes through to the original
// when no queued value is set).
// ---------------------------------------------------------------------------

vi.mock('./sandbox-runner', async (importOriginal) => {
  const real = await importOriginal<typeof import('./sandbox-runner')>();
  return {
    runInSandbox: vi.fn(real.runInSandbox),
  };
});

import { runInSandbox } from './sandbox-runner';

const mockedRunInSandbox = vi.mocked(runInSandbox);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal vitest JSON output that parseVitestJson can parse. */
function makeVitestJson(passed: number, failed: number): string {
  return JSON.stringify({
    numTotalTests: passed + failed,
    numPassedTests: passed,
    numFailedTests: failed,
  });
}

function stubbedSandboxResult(stdout: string) {
  return {
    exitCode: 0 as number | null,
    stdout,
    timedOut: false,
    durationMs: 10,
  };
}

// ---------------------------------------------------------------------------
// 1. Unit suite — one-shot mocked runInSandbox values
// ---------------------------------------------------------------------------

describe('verifyDevelopment (unit — mocked sandbox)', () => {
  it('discovers calculator.test.ts and passes it as a vitest arg', async () => {
    mockedRunInSandbox.mockResolvedValueOnce(
      stubbedSandboxResult(makeVitestJson(3, 0)),
    );

    const snapshot: Record<string, string> = {
      '/workspace/calculator.test.ts': '// test',
      '/workspace/calculator.ts': '// impl',
    };

    const result = await verifyDevelopment(snapshot);

    expect(result.ran).toBe(true);
    expect(result.errorMessage).toBeUndefined();

    const lastCall = mockedRunInSandbox.mock.calls.at(-1)![0];
    // Confirm the discovered test file (not a hardcoded constant) was forwarded.
    const testArgs = lastCall.args.filter((a) => /\.(test|spec)\.(tsx?)$/.test(a));
    expect(testArgs).toEqual(['calculator.test.ts']);
  });

  it('discovers matrix.test.ts for a differently-named module', async () => {
    mockedRunInSandbox.mockResolvedValueOnce(
      stubbedSandboxResult(makeVitestJson(5, 0)),
    );

    const snapshot: Record<string, string> = {
      '/workspace/matrix.test.ts': '// matrix tests',
      '/workspace/matrix.ts': '// matrix impl',
    };

    const result = await verifyDevelopment(snapshot);

    expect(result.ran).toBe(true);
    expect(result.errorMessage).toBeUndefined();

    const lastCall = mockedRunInSandbox.mock.calls.at(-1)![0];
    const testArgs = lastCall.args.filter((a) => /\.(test|spec)\.(tsx?)$/.test(a));
    expect(testArgs).toEqual(['matrix.test.ts']);
  });

  it('discovers multiple test files and passes all of them sorted', async () => {
    mockedRunInSandbox.mockResolvedValueOnce(
      stubbedSandboxResult(makeVitestJson(8, 0)),
    );

    const snapshot: Record<string, string> = {
      '/workspace/z-utils.test.ts': '// z tests',
      '/workspace/a-math.test.ts': '// a tests',
      '/workspace/a-math.ts': '// impl',
      '/workspace/z-utils.ts': '// impl',
    };

    await verifyDevelopment(snapshot);

    const lastCall = mockedRunInSandbox.mock.calls.at(-1)![0];
    const testArgs = lastCall.args.filter((a) => a.endsWith('.test.ts'));
    // Sorted order: a-math before z-utils.
    expect(testArgs).toEqual(['a-math.test.ts', 'z-utils.test.ts']);
  });

  it('returns ran:false with the exact message when no test file is present', async () => {
    const callsBefore = mockedRunInSandbox.mock.calls.length;

    const snapshot: Record<string, string> = {
      '/workspace/calculator.ts': '// impl only — no test file',
    };

    const result = await verifyDevelopment(snapshot);

    expect(result.ran).toBe(false);
    expect(result.passed).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.total).toBe(0);
    expect(result.output).toBe('');
    expect(result.errorMessage).toBe('No *.test.ts file found in the snapshot.');

    // runInSandbox must NOT be called when there are no test files.
    expect(mockedRunInSandbox.mock.calls.length).toBe(callsBefore);
  });

  it('ignores VFS keys outside /workspace prefix', async () => {
    mockedRunInSandbox.mockResolvedValueOnce(
      stubbedSandboxResult(makeVitestJson(2, 0)),
    );

    const snapshot: Record<string, string> = {
      '/workspace/foo.test.ts': '// real test',
      '/workspace/foo.ts': '// impl',
      '/other/bar.test.ts': '// outside workspace — must be ignored',
    };

    await verifyDevelopment(snapshot);

    const lastCall = mockedRunInSandbox.mock.calls.at(-1)![0];
    const testArgs = lastCall.args.filter((a) => a.includes('.test.ts'));
    // Only the /workspace-prefixed file should appear.
    expect(testArgs).toEqual(['foo.test.ts']);
  });
});

// ---------------------------------------------------------------------------
// 2. End-to-end suite — real vitest spawns
//
// No mock values are queued here, so the vi.fn wrapper falls through to the
// real runInSandbox implementation.
// ---------------------------------------------------------------------------

// Grab the test file from the case factory (seed 7).
// With seed 7: factorialInput=6 (720), datasetA=38, datasetB=65 (avg=51.5).
const pfCase = createDevelopmentCase({ seed: 7 });
const testFileContent = pfCase.initialFiles!['calculator.test.ts'];

/** A correct implementation that passes every assertion in the generated test. */
const CORRECT_CALCULATOR = `
export function divide(a: number, b: number): number {
  if (!isFinite(a) || !isFinite(b)) {
    throw new Error('divide: operands must be finite');
  }
  if (b === 0) {
    throw new Error('divide: division by zero');
  }
  return a / b;
}

export function factorial(n: number): number {
  if (!Number.isInteger(n)) {
    throw new Error('factorial: input must be an integer');
  }
  if (n < 0) {
    throw new Error('factorial: input must be non-negative');
  }
  let result = 1;
  for (let i = 2; i <= n; i += 1) {
    result *= i;
  }
  return result;
}

export function average(nums: number[]): number {
  if (nums.length === 0) return 0;
  for (const n of nums) {
    if (!isFinite(n)) {
      throw new Error('average: all members must be finite');
    }
  }
  return nums.reduce((acc, n) => acc + n, 0) / nums.length;
}

export function safeParseAmount(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return isFinite(n) ? n : 0;
}
`.trim();

/** A broken implementation that only handles the happy path — no guards. */
const BROKEN_CALCULATOR = `
export function divide(a: number, b: number): number {
  return a / b;
}

export function factorial(n: number): number {
  let result = 1;
  for (let i = 2; i <= n; i += 1) result *= i;
  return result;
}

export function average(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((acc, n) => acc + n, 0) / nums.length;
}

export function safeParseAmount(value: unknown): number {
  return Number(value) || 0;
}
`.trim();

describe('verifyDevelopment (end-to-end)', () => {
  it(
    'returns all tests passing for a correct implementation',
    async () => {
      const snapshot: Record<string, string> = {
        '/workspace/calculator.test.ts': testFileContent,
        '/workspace/calculator.ts': CORRECT_CALCULATOR,
      };

      const result = await verifyDevelopment(snapshot);

      expect(result.ran, `ran must be true — errorMessage: ${result.errorMessage ?? 'none'}`).toBe(true);
      expect(result.errorMessage).toBeUndefined();
      expect(result.total).toBeGreaterThan(0);
      expect(result.passed).toBe(result.total);
      expect(result.failed).toBe(0);
    },
    120_000,
  );

  it(
    'reports failures for a broken implementation (no edge-case guards)',
    async () => {
      const snapshot: Record<string, string> = {
        '/workspace/calculator.test.ts': testFileContent,
        '/workspace/calculator.ts': BROKEN_CALCULATOR,
      };

      const result = await verifyDevelopment(snapshot);

      expect(result.ran, `ran must be true — errorMessage: ${result.errorMessage ?? 'none'}`).toBe(true);
      expect(result.failed).toBeGreaterThan(0);
    },
    120_000,
  );
});
