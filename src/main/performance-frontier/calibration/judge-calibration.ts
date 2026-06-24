/**
 * Judge-calibration logic — pure, dependency-free.
 *
 * Measures how well the LLM judge's subjective `algorithmicAccuracy` score
 * tracks the objective, deterministic ground truth from vitest pass/fail counts.
 */

export interface CalibrationSample {
  /** Judge algorithmicAccuracy score (0-20). null when judgeError === true. */
  judgeScore: number | null;
  /** Tests that passed (from groundTruth.tests.passed). */
  passed: number;
  /** Total tests in the suite (from groundTruth.tests.total). */
  total: number;
  /** True when the judge itself failed (degraded run). */
  judgeError?: boolean;
}

export interface CalibrationReport {
  /** Usable samples: judgeScore is non-null, total > 0, judgeError !== true. */
  n: number;
  /** Samples excluded (judgeError or total === 0). */
  skipped: number;
  /**
   * Mean |judgeScore - expectedScore| over usable samples.
   * 0 when n === 0 (never NaN).
   */
  meanAbsoluteError: number;
  /** Fraction [0..1] of usable samples where |error| <= 2. 0 when n === 0. */
  withinTwo: number;
  /** Fraction [0..1] of usable samples where judgeScore === expectedScore exactly. 0 when n === 0. */
  perfectAgreement: number;
  /**
   * Count of usable samples where tests FAILED (passed < total) but the judge
   * gave algorithmicAccuracy >= 18 — the worst failure mode: judge ignored
   * objective evidence that the implementation was broken.
   */
  overrules: number;
  /** Per-sample detail for the usable set. */
  samples: Array<{
    judgeScore: number;
    expectedScore: number;
    passed: number;
    total: number;
    error: number;
  }>;
}

/**
 * Converts ground-truth test counts into the corresponding 0–20 judge scale.
 *
 * - total === 0 → 0 (no tests ran; no signal).
 * - Otherwise   → round(20 * passed / total), clamped to [0, 20].
 */
export function expectedScoreFromGroundTruth(passed: number, total: number): number {
  if (total === 0) return 0;
  return Math.round(20 * passed / total);
}

/**
 * Computes a calibration report from a batch of samples.
 *
 * Excludes samples where:
 *   - judgeError === true
 *   - judgeScore === null
 *   - total === 0
 *
 * All excluded samples are counted in `skipped`.
 * All included samples contribute to `n` and every metric.
 * No metric ever produces NaN (division by zero is guarded by n === 0 checks).
 */
export function calibrateJudge(samples: CalibrationSample[]): CalibrationReport {
  const usable: CalibrationReport['samples'] = [];
  let skipped = 0;

  for (const s of samples) {
    if (s.judgeError === true || s.judgeScore === null || s.total === 0) {
      skipped++;
      continue;
    }
    const expectedScore = expectedScoreFromGroundTruth(s.passed, s.total);
    const error = Math.abs(s.judgeScore - expectedScore);
    usable.push({ judgeScore: s.judgeScore, expectedScore, passed: s.passed, total: s.total, error });
  }

  const n = usable.length;

  if (n === 0) {
    return {
      n: 0,
      skipped,
      meanAbsoluteError: 0,
      withinTwo: 0,
      perfectAgreement: 0,
      overrules: 0,
      samples: [],
    };
  }

  const sumError = usable.reduce((acc, s) => acc + s.error, 0);
  const meanAbsoluteError = round3(sumError / n);

  const withinTwoCount = usable.filter((s) => s.error <= 2).length;
  const withinTwo = round3(withinTwoCount / n);

  const perfectCount = usable.filter((s) => s.judgeScore === s.expectedScore).length;
  const perfectAgreement = round3(perfectCount / n);

  // Overrule: tests failed (passed < total) but judge gave >= 18 — judge ignored
  // objective evidence of brokenness, the worst calibration failure.
  // Note: we use the original sample's passed/total, not the computed expectedScore,
  // to stay close to the raw signal.
  const overrules = usable.filter(
    (s) => s.passed < s.total && s.judgeScore >= 18,
  ).length;

  return {
    n,
    skipped,
    meanAbsoluteError,
    withinTwo,
    perfectAgreement,
    overrules,
    samples: usable,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Round to 3 decimal places, removing floating-point noise. */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
