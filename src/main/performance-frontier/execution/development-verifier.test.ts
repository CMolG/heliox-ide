/**
 * development-verifier.test.ts — End-to-end tests for the ground-truth verifier.
 *
 * These tests actually spawn real vitest processes to prove the verifier works
 * deterministically, so they carry a generous per-test timeout (120 s).
 */

import { describe, expect, it } from 'vitest';
import { createDevelopmentCase } from '../procedural/case-factory';
import { verifyDevelopment } from './development-verifier';

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
