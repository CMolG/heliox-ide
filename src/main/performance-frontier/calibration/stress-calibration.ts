/**
 * stress-calibration.ts — Stress-tests the Performance Frontier judge by feeding
 * it KNOWN-broken implementations of calculator.ts and measuring whether the judge
 * correctly LOWERS its algorithmicAccuracy score when tests fail.
 *
 * The existing `collectDevelopmentCalibration` only ever sampled runs where the
 * model wrote correct code, so it never exercised the judge's ability to:
 *   1. Lower the score proportionally when tests fail.
 *   2. Refrain from "overruling" objective ground truth (i.e. not giving 20/20
 *      when only a handful of tests pass).
 *
 * This collector closes that gap by injecting 4 hand-crafted calculator.ts
 * implementations with known, deterministic pass-rates across the 13-test suite
 * produced by `mutateDevelopmentCase`.
 */

import type { CalibrationSample } from './judge-calibration';
import type { PFJudgeInput, PFJudgeResult } from '../types';
import { verifyDevelopment } from '../execution/development-verifier';
import { runJudge } from '../judge/judge-runner';
import { createDevelopmentCase } from '../procedural/case-factory';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface StressVariant {
  /** Short human-readable label, used as the runId prefix. */
  label: string;
  /** Content of /workspace/calculator.ts for this variant. */
  calculatorTs: string;
}

export interface CollectStressOptions {
  /** Judge model id (passed to runJudge via model resolution); optional. */
  modelId?: string;
  /** Development case seed (default 7) — provides the real test file. */
  seed?: number;
  /** Defaults to DEFAULT_STRESS_VARIANTS. */
  variants?: StressVariant[];
  /**
   * Injectable verify function (default: real verifyDevelopment).
   * Signature matches verifyDevelopment's return type.
   */
  verify?: (vfs: Record<string, string>) => Promise<{
    ran: boolean;
    passed: number;
    failed: number;
    total: number;
  }>;
  /**
   * Injectable judge function (default: real runJudge).
   * Receives a full PFJudgeInput and returns a PFJudgeResult.
   */
  judge?: (input: PFJudgeInput) => Promise<PFJudgeResult>;
}

// ---------------------------------------------------------------------------
// DEFAULT_STRESS_VARIANTS
//
// All four variants export the four required names: divide, factorial, average,
// safeParseAmount. They differ by how many of the 13 test cases they satisfy.
//
// Intended pass-rate spread (against the seed-7 test file — 13 tests total):
//
//  "correct"    — all guards present → should pass ALL 13 tests (20/20 expected).
//  "happy-path" — arithmetic only, no edge-case guards → passes the basic
//                 arithmetic tests but fails the throw/guard tests.
//                 Expected: ~6/13 (divide basic, factorial N+0, average basic,
//                 safeParseAmount 3 tests). Borderline tests depend on runtime.
//  "cheat"      — arithmetic + lookup table for factorial (to survive any seed
//                 in [5,9] and 0) + hardcoded divide check for 10/2=5, but no
//                 throw guards. Passes more arithmetic cases than happy-path but
//                 still fails all throw-tests. Expected: ~7/13.
//  "empty"      — all four stubs throw 'not implemented' → passes 0/13.
//
// This spread (0, ~6, ~7, 13) gives the calibration its discriminating power.
// ---------------------------------------------------------------------------

export const DEFAULT_STRESS_VARIANTS: StressVariant[] = [
  {
    label: 'correct',
    calculatorTs: `
export function divide(a: number, b: number): number {
  if (!isFinite(a) || !isFinite(b)) throw new Error('Operands must be finite');
  if (b === 0) throw new Error('Division by zero');
  return a / b;
}

export function factorial(n: number): number {
  if (!Number.isInteger(n)) throw new Error('Input must be an integer');
  if (n < 0) throw new Error('Input must be non-negative');
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

export function average(nums: number[]): number {
  if (nums.length === 0) return 0;
  for (const n of nums) {
    if (!isFinite(n)) throw new Error('All elements must be finite');
  }
  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}

export function safeParseAmount(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  if (!isFinite(n)) return 0;
  return n;
}
`.trim(),
  },
  {
    label: 'happy-path',
    calculatorTs: `
// Happy-path only — no edge-case guards.
// Fails: divide-by-zero throw, non-finite operand throw, factorial(-3) throw,
// factorial(2.5) throw, average([1,NaN]) throw, average([]) → NaN not 0.
export function divide(a: number, b: number): number {
  return a / b;
}

export function factorial(n: number): number {
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

export function average(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}

export function safeParseAmount(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  if (isNaN(n)) return 0;
  return n;
}
`.trim(),
  },
  {
    label: 'cheat',
    calculatorTs: `
// Cheat variant — hardcodes specific test literals to gain extra arithmetic
// passes, but still has no throw-guards. A model gaming the test harness.
// Passes: divide(10,2)=5 via literal check + a/b fallback (but not throw tests),
// factorial via lookup (covers seeds 5-9 and 0), average basic + empty,
// safeParseAmount all 3. Fails: all 7 throw-tests.
const FACTORIAL_TABLE: Record<number, number> = {
  0: 1, 1: 1, 2: 2, 3: 6, 4: 24, 5: 120, 6: 720, 7: 5040, 8: 40320, 9: 362880,
};

export function divide(a: number, b: number): number {
  if (a === 10 && b === 2) return 5;
  return a / b;
}

export function factorial(n: number): number {
  if (n in FACTORIAL_TABLE) return FACTORIAL_TABLE[n];
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

export function average(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}

export function safeParseAmount(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  if (isNaN(n)) return 0;
  return n;
}
`.trim(),
  },
  {
    label: 'empty',
    calculatorTs: `
// Empty stubs — every call throws 'not implemented'.
// Expected to fail all 13 tests.
export function divide(_a: number, _b: number): number {
  throw new Error('not implemented');
}

export function factorial(_n: number): number {
  throw new Error('not implemented');
}

export function average(_nums: number[]): number {
  throw new Error('not implemented');
}

export function safeParseAmount(_value: unknown): number {
  throw new Error('not implemented');
}
`.trim(),
  },
];

// ---------------------------------------------------------------------------
// collectStressCalibration
// ---------------------------------------------------------------------------

/**
 * Runs each variant through the verifier and judge, then maps results to
 * CalibrationSample records that `calibrateJudge` can consume.
 *
 * Execution is sequential — one failure does NOT abort the batch. On error
 * the variant contributes `{ judgeScore: null, passed: 0, total: 0, judgeError: true }`.
 */
export async function collectStressCalibration(
  opts?: CollectStressOptions,
): Promise<CalibrationSample[]> {
  const seed = opts?.seed ?? 7;
  const variants = opts?.variants ?? DEFAULT_STRESS_VARIANTS;
  const modelId = opts?.modelId;
  const verifyFn = opts?.verify ?? verifyDevelopment;
  const judgeFn = opts?.judge ?? runJudge;

  // Extract the deterministic test file and prompt from the case factory.
  const devCase = createDevelopmentCase({ seed });
  const testFile = devCase.initialFiles!['calculator.test.ts'];
  const userPrompt = devCase.prompt;

  const samples: CalibrationSample[] = [];

  for (const variant of variants) {
    try {
      const vfs: Record<string, string> = {
        '/workspace/calculator.test.ts': testFile,
        '/workspace/calculator.ts': variant.calculatorTs,
      };

      // Ground truth from the real verifier (or injected stub).
      const gt = await verifyFn(vfs);

      // Build a minimal PFJudgeInput for the development suite.
      const judgeInput: PFJudgeInput = {
        runId: `stress-${variant.label}`,
        caseId: 'stress',
        suite: 'development',
        modelUnderTest: modelId ?? 'unknown',
        userPrompt,
        conversation: [
          { role: 'assistant', content: 'Wrote calculator.ts.' },
        ],
        vfsSnapshot: vfs,
        telemetry: {
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 0,
          latencyMs: 0,
          stepCount: 0,
          toolCallsCount: 0,
          toolResultsCount: 0,
          mcpToolCalls: 0,
          mcpSuccessfulToolCalls: 0,
          mcpInterceptedToolCalls: 0,
          mcpSchemaErrors: 0,
          mcpSyntaxPrecision: 1,
        },
        toolEvents: [],
        cognitiveTrace: [],
        groundTruth: {
          tests: gt,
        },
      };

      const result = await judgeFn(judgeInput);

      const judgeError = result.judgeError === true;
      const judgeScore: number | null = judgeError
        ? null
        : ((result.evaluations.algorithmicAccuracy as { score: number } | undefined)?.score ?? null);

      samples.push({
        judgeScore,
        passed: gt.passed,
        total: gt.total,
        judgeError,
      });
    } catch {
      // Any thrown error (network, parse, timeout) → fully degraded sample.
      samples.push({ judgeScore: null, passed: 0, total: 0, judgeError: true });
    }
  }

  return samples;
}
