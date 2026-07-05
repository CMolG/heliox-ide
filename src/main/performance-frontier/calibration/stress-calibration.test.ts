/**
 * stress-calibration.test.ts — Unit tests for collectStressCalibration.
 *
 * All tests are fully offline: `verify` and `judge` are injected stubs,
 * so no live model calls, no vitest sub-process, and no network I/O occur.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  collectStressCalibration,
  DEFAULT_STRESS_VARIANTS,
  type StressVariant,
} from './stress-calibration';
import { calibrateJudge } from './judge-calibration';
import type { PFJudgeResult, PFJudgeInput } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a scripted judge stub that returns a fixed algorithmicAccuracy score
 * based on the runId prefix ("stress-<label>").
 */
function makeJudgeStub(
  scoreMap: Record<string, number>,
): (input: PFJudgeInput) => Promise<PFJudgeResult> {
  return async (input) => {
    const label = input.runId.replace(/^stress-/, '');
    const score = scoreMap[label] ?? 0;
    return {
      runId: input.runId,
      caseId: input.caseId,
      suite: input.suite,
      modelUnderTest: input.modelUnderTest,
      verdict: score >= 14 ? 'pass' : score >= 7 ? 'partial' : 'fail',
      finalScore: score,
      semanticScore: score,
      semanticMaxScore: 110,
      telemetryScore: 10,
      evaluations: {
        telemetryEfficiency: {
          score: 10,
          justification: 'stub',
          latencyMs: 0,
          totalTokens: 0,
        },
        algorithmicAccuracy: { score, justification: 'stub', edgeCasesCovered: [], edgeCasesMissed: [] },
      },
      criticalFailures: [],
      telemetry: input.telemetry,
      cognitiveTrace: [],
    } satisfies PFJudgeResult;
  };
}

/**
 * Build a scripted verify stub that returns fixed pass/total per variant label.
 * The label is derived from the vfs key "/workspace/calculator.ts" content
 * matching against the DEFAULT_STRESS_VARIANTS (by identity of the stub string
 * returned from collectStressCalibration). Instead, we rely on execution order:
 * variants are processed sequentially so we queue results.
 */
function makeVerifyStub(
  results: Array<{ ran: boolean; passed: number; failed: number; total: number }>,
): (vfs: Record<string, string>) => Promise<{ ran: boolean; passed: number; failed: number; total: number }> {
  let idx = 0;
  return async (_vfs) => {
    if (idx >= results.length) {
      return { ran: false, passed: 0, failed: 0, total: 0 };
    }
    return results[idx++];
  };
}

/** Four scripted verify results matching the DEFAULT_STRESS_VARIANTS order. */
const SCRIPTED_VERIFY = [
  { ran: true, passed: 13, failed: 0,  total: 13 }, // correct
  { ran: true, passed: 5,  failed: 8,  total: 13 }, // happy-path
  { ran: true, passed: 7,  failed: 6,  total: 13 }, // cheat
  { ran: true, passed: 0,  failed: 13, total: 13 }, // empty
];

/** Perfectly-calibrated judge scores for the scripted verify results above. */
const PERFECT_JUDGE_SCORES: Record<string, number> = {
  correct: 20,    // 13/13 → expectedScore = 20
  'happy-path': 8, // 5/13  → expectedScore = round(20*5/13) = round(7.69) = 8
  cheat: 11,      // 7/13  → expectedScore = round(20*7/13) = round(10.77) = 11
  empty: 0,       // 0/13  → expectedScore = 0
};

// ---------------------------------------------------------------------------
// Test: perfectly calibrated judge
// ---------------------------------------------------------------------------

describe('collectStressCalibration — perfectly calibrated judge', () => {
  it('returns 4 samples with the scripted judgeScore and passed/total', async () => {
    const samples = await collectStressCalibration({
      variants: DEFAULT_STRESS_VARIANTS,
      verify: makeVerifyStub(SCRIPTED_VERIFY),
      judge: makeJudgeStub(PERFECT_JUDGE_SCORES),
    });

    expect(samples).toHaveLength(4);

    expect(samples[0]).toMatchObject({ judgeScore: 20, passed: 13, total: 13 });
    expect(samples[0].judgeError).toBeFalsy();
    expect(samples[1]).toMatchObject({ judgeScore: 8,  passed: 5,  total: 13 });
    expect(samples[2]).toMatchObject({ judgeScore: 11, passed: 7,  total: 13 });
    expect(samples[3]).toMatchObject({ judgeScore: 0,  passed: 0,  total: 13 });
  });

  it('produces MAE=0 and overrules=0 when calibrateJudge runs on perfectly calibrated samples', async () => {
    const samples = await collectStressCalibration({
      variants: DEFAULT_STRESS_VARIANTS,
      verify: makeVerifyStub(SCRIPTED_VERIFY),
      judge: makeJudgeStub(PERFECT_JUDGE_SCORES),
    });

    const report = calibrateJudge(samples);

    expect(report.n).toBe(4);
    expect(report.skipped).toBe(0);
    expect(report.meanAbsoluteError).toBe(0);
    expect(report.overrules).toBe(0);
    expect(report.perfectAgreement).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Test: overruling judge (always scores 20 regardless of test failures)
// ---------------------------------------------------------------------------

describe('collectStressCalibration — overruling judge', () => {
  it('produces overrules >= 1 and large MAE when judge gives 20 for broken variants', async () => {
    // The judge always returns 20 (full marks) even when tests fail badly.
    const alwaysMaxJudge = makeJudgeStub({
      correct: 20,
      'happy-path': 20, // overrule: 5/13 failed but judge says perfect
      cheat: 20,        // overrule: 7/13 failed but judge says perfect
      empty: 20,        // overrule: 0/13 passed but judge says perfect
    });

    const samples = await collectStressCalibration({
      variants: DEFAULT_STRESS_VARIANTS,
      verify: makeVerifyStub(SCRIPTED_VERIFY),
      judge: alwaysMaxJudge,
    });

    const report = calibrateJudge(samples);

    // At minimum 3 of the 4 samples have passed < total but judgeScore = 20.
    expect(report.overrules).toBeGreaterThanOrEqual(1);

    // MAE must be large: the broken variants each contribute high error.
    // Worst case: happy-path error=|20-8|=12, cheat error=|20-11|=9, empty error=|20-0|=20.
    expect(report.meanAbsoluteError).toBeGreaterThan(3);
  });

  it('reports exactly 3 overrules when 3 of 4 variants have tests failing but judge scores 20', async () => {
    const alwaysMaxJudge = makeJudgeStub({
      correct: 20,
      'happy-path': 20,
      cheat: 20,
      empty: 20,
    });

    const samples = await collectStressCalibration({
      variants: DEFAULT_STRESS_VARIANTS,
      verify: makeVerifyStub(SCRIPTED_VERIFY),
      judge: alwaysMaxJudge,
    });

    const report = calibrateJudge(samples);

    // correct (13/13 passed) is NOT an overrule.
    // happy-path (5/13), cheat (7/13), empty (0/13) all have passed < total → overrule.
    expect(report.overrules).toBe(3);
  });

  it('captures zero overrules when all tests pass (even if judge scores high)', async () => {
    // All variants pretend to have passed all 13 tests.
    const allPassVerify = makeVerifyStub([
      { ran: true, passed: 13, failed: 0, total: 13 },
      { ran: true, passed: 13, failed: 0, total: 13 },
      { ran: true, passed: 13, failed: 0, total: 13 },
      { ran: true, passed: 13, failed: 0, total: 13 },
    ]);
    const alwaysMaxJudge = makeJudgeStub({
      correct: 20, 'happy-path': 20, cheat: 20, empty: 20,
    });

    const samples = await collectStressCalibration({
      variants: DEFAULT_STRESS_VARIANTS,
      verify: allPassVerify,
      judge: alwaysMaxJudge,
    });

    const report = calibrateJudge(samples);
    expect(report.overrules).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Test: judge error resilience
// ---------------------------------------------------------------------------

describe('collectStressCalibration — error handling', () => {
  it('catches a thrown verify error and emits a degraded sample (judgeError:true, totals zero)', async () => {
    const failingVerify = async (_vfs: Record<string, string>) => {
      throw new Error('sandbox exploded');
    };

    const samples = await collectStressCalibration({
      variants: [DEFAULT_STRESS_VARIANTS[0]],
      verify: failingVerify,
      judge: makeJudgeStub({ correct: 20 }),
    });

    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({ judgeScore: null, passed: 0, total: 0, judgeError: true });
  });

  it('catches a thrown judge error and emits a degraded sample', async () => {
    const failingJudge = async (_input: PFJudgeInput): Promise<PFJudgeResult> => {
      throw new Error('LLM timed out');
    };

    const samples = await collectStressCalibration({
      variants: [DEFAULT_STRESS_VARIANTS[0]],
      verify: makeVerifyStub([{ ran: true, passed: 13, failed: 0, total: 13 }]),
      judge: failingJudge,
    });

    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({ judgeScore: null, passed: 0, total: 0, judgeError: true });
  });

  it('continues processing remaining variants after a single variant error', async () => {
    let callCount = 0;
    const partialVerify = async (_vfs: Record<string, string>) => {
      callCount++;
      if (callCount === 1) throw new Error('first variant failed');
      return { ran: true, passed: 13, failed: 0, total: 13 };
    };

    const samples = await collectStressCalibration({
      variants: DEFAULT_STRESS_VARIANTS.slice(0, 3),
      verify: partialVerify,
      // Variant 0 (correct) throws in verify, so the judge is never called for it.
      // Variants 1 and 2 are happy-path and cheat — judge returns 8 and 11.
      judge: makeJudgeStub({ correct: 20, 'happy-path': 8, cheat: 11 }),
    });

    // 3 variants: first fails, remaining 2 succeed.
    expect(samples).toHaveLength(3);
    expect(samples[0]).toMatchObject({ judgeScore: null, judgeError: true });
    // sample[1] is happy-path with 13/13 (from partialVerify), score 8
    expect(samples[1]).toMatchObject({ judgeScore: 8, passed: 13, total: 13 });
    // sample[2] is cheat with 13/13 (from partialVerify), score 11
    expect(samples[2]).toMatchObject({ judgeScore: 11, passed: 13, total: 13 });
  });

  it('propagates judgeError:true from a degraded PFJudgeResult (all attempts exhausted)', async () => {
    const degradedJudge = async (input: PFJudgeInput): Promise<PFJudgeResult> => ({
      runId: input.runId,
      caseId: input.caseId,
      suite: input.suite,
      modelUnderTest: input.modelUnderTest,
      verdict: 'fail',
      finalScore: 0,
      semanticScore: 0,
      semanticMaxScore: 110,
      telemetryScore: 0,
      evaluations: {
        telemetryEfficiency: { score: 0, justification: 'degraded', latencyMs: 0, totalTokens: 0 },
      },
      criticalFailures: ['JUDGE_ERROR: all attempts exhausted'],
      telemetry: input.telemetry,
      cognitiveTrace: [],
      judgeError: true,
    });

    const samples = await collectStressCalibration({
      variants: [DEFAULT_STRESS_VARIANTS[0]],
      verify: makeVerifyStub([{ ran: true, passed: 13, failed: 0, total: 13 }]),
      judge: degradedJudge,
    });

    expect(samples).toHaveLength(1);
    expect(samples[0].judgeScore).toBeNull();
    expect(samples[0].judgeError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test: DEFAULT_STRESS_VARIANTS shape
// ---------------------------------------------------------------------------

describe('DEFAULT_STRESS_VARIANTS', () => {
  const REQUIRED_LABELS = ['correct', 'happy-path', 'cheat', 'empty'] as const;
  const REQUIRED_EXPORTS = ['divide', 'factorial', 'average', 'safeParseAmount'];

  it('has exactly 4 variants', () => {
    expect(DEFAULT_STRESS_VARIANTS).toHaveLength(4);
  });

  it('contains the 4 required labels in order', () => {
    const labels = DEFAULT_STRESS_VARIANTS.map((v) => v.label);
    expect(labels).toEqual(REQUIRED_LABELS);
  });

  for (const label of REQUIRED_LABELS) {
    it(`variant "${label}" has a non-empty calculatorTs string`, () => {
      const variant = DEFAULT_STRESS_VARIANTS.find((v) => v.label === label);
      expect(variant).toBeDefined();
      expect(typeof variant!.calculatorTs).toBe('string');
      expect(variant!.calculatorTs.trim().length).toBeGreaterThan(0);
    });

    it(`variant "${label}" exports all 4 required function names`, () => {
      const variant = DEFAULT_STRESS_VARIANTS.find((v) => v.label === label)!;
      for (const fn of REQUIRED_EXPORTS) {
        expect(
          variant.calculatorTs,
          `Expected "${label}" to export "${fn}"`,
        ).toContain(`export function ${fn}`);
      }
    });
  }

  it('variant "correct" includes guards for divide-by-zero and finite checks', () => {
    const correct = DEFAULT_STRESS_VARIANTS.find((v) => v.label === 'correct')!;
    expect(correct.calculatorTs).toContain('isFinite');
    expect(correct.calculatorTs).toContain('Number.isInteger');
  });

  it('variant "empty" stubs throw "not implemented"', () => {
    const empty = DEFAULT_STRESS_VARIANTS.find((v) => v.label === 'empty')!;
    expect(empty.calculatorTs).toContain('not implemented');
  });

  it('variant "happy-path" lacks throw guards', () => {
    const happyPath = DEFAULT_STRESS_VARIANTS.find((v) => v.label === 'happy-path')!;
    // Should NOT contain guard-like patterns for divide-by-zero
    expect(happyPath.calculatorTs).not.toContain('b === 0');
    expect(happyPath.calculatorTs).not.toContain('isFinite(b)');
  });

  it('variant "cheat" hardcodes the known test literal for divide(10,2)', () => {
    const cheat = DEFAULT_STRESS_VARIANTS.find((v) => v.label === 'cheat')!;
    expect(cheat.calculatorTs).toContain('a === 10 && b === 2');
  });

  it('variant "cheat" includes a factorial lookup table', () => {
    const cheat = DEFAULT_STRESS_VARIANTS.find((v) => v.label === 'cheat')!;
    expect(cheat.calculatorTs).toContain('FACTORIAL_TABLE');
  });
});

// ---------------------------------------------------------------------------
// Test: custom variants and modelId passthrough
// ---------------------------------------------------------------------------

describe('collectStressCalibration — configuration options', () => {
  it('uses provided modelId as the modelUnderTest on judgeInput', async () => {
    const capturedInputs: PFJudgeInput[] = [];

    const capturingJudge = async (input: PFJudgeInput): Promise<PFJudgeResult> => {
      capturedInputs.push(input);
      return makeJudgeStub({ myvariant: 15 })(input);
    };

    await collectStressCalibration({
      modelId: 'test-model-xyz',
      variants: [{ label: 'myvariant', calculatorTs: DEFAULT_STRESS_VARIANTS[0].calculatorTs }],
      verify: makeVerifyStub([{ ran: true, passed: 13, failed: 0, total: 13 }]),
      judge: capturingJudge,
    });

    expect(capturedInputs).toHaveLength(1);
    expect(capturedInputs[0].modelUnderTest).toBe('test-model-xyz');
  });

  it('defaults modelUnderTest to "unknown" when modelId is not provided', async () => {
    const capturedInputs: PFJudgeInput[] = [];

    const capturingJudge = async (input: PFJudgeInput): Promise<PFJudgeResult> => {
      capturedInputs.push(input);
      return makeJudgeStub({ myvariant: 15 })(input);
    };

    await collectStressCalibration({
      variants: [{ label: 'myvariant', calculatorTs: DEFAULT_STRESS_VARIANTS[0].calculatorTs }],
      verify: makeVerifyStub([{ ran: true, passed: 13, failed: 0, total: 13 }]),
      judge: capturingJudge,
    });

    expect(capturedInputs[0].modelUnderTest).toBe('unknown');
  });

  it('uses custom variants when provided', async () => {
    const customVariants: StressVariant[] = [
      { label: 'alpha', calculatorTs: DEFAULT_STRESS_VARIANTS[0].calculatorTs },
      { label: 'beta', calculatorTs: DEFAULT_STRESS_VARIANTS[3].calculatorTs },
    ];

    const samples = await collectStressCalibration({
      variants: customVariants,
      verify: makeVerifyStub([
        { ran: true, passed: 13, failed: 0, total: 13 },
        { ran: true, passed: 0,  failed: 13, total: 13 },
      ]),
      judge: makeJudgeStub({ alpha: 20, beta: 0 }),
    });

    expect(samples).toHaveLength(2);
    expect(samples[0]).toMatchObject({ judgeScore: 20, passed: 13, total: 13 });
    expect(samples[1]).toMatchObject({ judgeScore: 0,  passed: 0,  total: 13 });
  });

  it('sets runId to "stress-<label>" on the judgeInput', async () => {
    const capturedRunIds: string[] = [];

    const capturingJudge = async (input: PFJudgeInput): Promise<PFJudgeResult> => {
      capturedRunIds.push(input.runId);
      return makeJudgeStub({ correct: 20, empty: 0 })(input);
    };

    await collectStressCalibration({
      variants: [
        DEFAULT_STRESS_VARIANTS[0], // correct
        DEFAULT_STRESS_VARIANTS[3], // empty
      ],
      verify: makeVerifyStub([
        { ran: true, passed: 13, failed: 0,  total: 13 },
        { ran: true, passed: 0,  failed: 13, total: 13 },
      ]),
      judge: capturingJudge,
    });

    expect(capturedRunIds).toEqual(['stress-correct', 'stress-empty']);
  });

  it('passes vfs with the test file keyed at /workspace/calculator.test.ts', async () => {
    const capturedVfs: Record<string, string>[] = [];

    const capturingVerify = async (vfs: Record<string, string>) => {
      capturedVfs.push(vfs);
      return { ran: true, passed: 13, failed: 0, total: 13 };
    };

    await collectStressCalibration({
      variants: [DEFAULT_STRESS_VARIANTS[0]],
      verify: capturingVerify,
      judge: makeJudgeStub({ correct: 20 }),
    });

    expect(capturedVfs).toHaveLength(1);
    expect(capturedVfs[0]).toHaveProperty('/workspace/calculator.test.ts');
    expect(capturedVfs[0]).toHaveProperty('/workspace/calculator.ts');
    expect(capturedVfs[0]['/workspace/calculator.test.ts']).toContain('divide');
    expect(capturedVfs[0]['/workspace/calculator.ts']).toContain('export function divide');
  });

  it('embeds groundTruth.tests in the judgeInput', async () => {
    const capturedInputs: PFJudgeInput[] = [];

    const capturingJudge = async (input: PFJudgeInput): Promise<PFJudgeResult> => {
      capturedInputs.push(input);
      return makeJudgeStub({ 'happy-path': 8 })(input);
    };

    await collectStressCalibration({
      variants: [DEFAULT_STRESS_VARIANTS[1]], // happy-path
      verify: makeVerifyStub([{ ran: true, passed: 5, failed: 8, total: 13 }]),
      judge: capturingJudge,
    });

    expect(capturedInputs[0].groundTruth?.tests).toMatchObject({
      ran: true, passed: 5, failed: 8, total: 13,
    });
  });
});

// ---------------------------------------------------------------------------
// Test: CalibrationSample fields mapped correctly from PFJudgeResult
// ---------------------------------------------------------------------------

describe('collectStressCalibration — CalibrationSample field mapping', () => {
  it('extracts judgeScore from evaluations.algorithmicAccuracy.score', async () => {
    const samples = await collectStressCalibration({
      variants: [DEFAULT_STRESS_VARIANTS[0]],
      verify: makeVerifyStub([{ ran: true, passed: 13, failed: 0, total: 13 }]),
      judge: makeJudgeStub({ correct: 17 }),
    });

    expect(samples[0].judgeScore).toBe(17);
  });

  it('sets judgeScore to null when algorithmicAccuracy is absent', async () => {
    const noAlgorithmicJudge = async (input: PFJudgeInput): Promise<PFJudgeResult> => ({
      runId: input.runId,
      caseId: input.caseId,
      suite: input.suite,
      modelUnderTest: input.modelUnderTest,
      verdict: 'pass',
      finalScore: 80,
      semanticScore: 70,
      semanticMaxScore: 110,
      telemetryScore: 10,
      // evaluations deliberately lacks algorithmicAccuracy
      evaluations: {
        telemetryEfficiency: { score: 10, justification: 'ok', latencyMs: 0, totalTokens: 0 },
      },
      criticalFailures: [],
      telemetry: input.telemetry,
      cognitiveTrace: [],
    });

    const samples = await collectStressCalibration({
      variants: [DEFAULT_STRESS_VARIANTS[0]],
      verify: makeVerifyStub([{ ran: true, passed: 13, failed: 0, total: 13 }]),
      judge: noAlgorithmicJudge,
    });

    expect(samples[0].judgeScore).toBeNull();
  });

  it('reflects passed and total from the verify result', async () => {
    const samples = await collectStressCalibration({
      variants: [DEFAULT_STRESS_VARIANTS[3]], // empty
      verify: makeVerifyStub([{ ran: true, passed: 0, failed: 13, total: 13 }]),
      judge: makeJudgeStub({ empty: 0 }),
    });

    expect(samples[0].passed).toBe(0);
    expect(samples[0].total).toBe(13);
  });
});
