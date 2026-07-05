import { describe, it, expect } from 'vitest';
import {
  expectedScoreFromGroundTruth,
  calibrateJudge,
  type CalibrationSample,
} from './judge-calibration';

// ---------------------------------------------------------------------------
// expectedScoreFromGroundTruth
// ---------------------------------------------------------------------------

describe('expectedScoreFromGroundTruth', () => {
  it('returns 20 when all tests pass (13/13)', () => {
    expect(expectedScoreFromGroundTruth(13, 13)).toBe(20);
  });

  it('returns 0 when no tests pass (0/13)', () => {
    expect(expectedScoreFromGroundTruth(0, 13)).toBe(0);
  });

  it('rounds correctly for 7/13 → round(20 * 7/13) = 11', () => {
    expect(expectedScoreFromGroundTruth(7, 13)).toBe(11);
  });

  it('returns 0 when total is 0 (no tests ran)', () => {
    expect(expectedScoreFromGroundTruth(0, 0)).toBe(0);
  });

  it('returns 0 when passed is 0 regardless of total', () => {
    expect(expectedScoreFromGroundTruth(0, 100)).toBe(0);
  });

  it('returns 10 for exactly half passing', () => {
    expect(expectedScoreFromGroundTruth(5, 10)).toBe(10);
  });

  it('is always an integer in [0, 20]', () => {
    for (let p = 0; p <= 20; p++) {
      const score = expectedScoreFromGroundTruth(p, 20);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(20);
      expect(Number.isInteger(score)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// calibrateJudge — perfect agreement
// ---------------------------------------------------------------------------

describe('calibrateJudge — perfect agreement', () => {
  it('produces MAE=0, withinTwo=1, perfectAgreement=1, overrules=0 when judge matches ground truth exactly', () => {
    const samples: CalibrationSample[] = [
      { judgeScore: 20, passed: 13, total: 13 },  // expected 20, error 0
      { judgeScore: 0,  passed: 0,  total: 13 },  // expected 0,  error 0
      { judgeScore: 11, passed: 7,  total: 13 },  // expected 11, error 0
      { judgeScore: 10, passed: 5,  total: 10 },  // expected 10, error 0
    ];

    const report = calibrateJudge(samples);

    expect(report.n).toBe(4);
    expect(report.skipped).toBe(0);
    expect(report.meanAbsoluteError).toBe(0);
    expect(report.withinTwo).toBe(1);
    expect(report.perfectAgreement).toBe(1);
    expect(report.overrules).toBe(0);
    expect(report.samples).toHaveLength(4);
  });

  it('records correct per-sample detail', () => {
    const samples: CalibrationSample[] = [
      { judgeScore: 20, passed: 13, total: 13 },
    ];
    const report = calibrateJudge(samples);
    const s = report.samples[0];
    expect(s.judgeScore).toBe(20);
    expect(s.expectedScore).toBe(20);
    expect(s.error).toBe(0);
    expect(s.passed).toBe(13);
    expect(s.total).toBe(13);
  });
});

// ---------------------------------------------------------------------------
// calibrateJudge — overrule detection
// ---------------------------------------------------------------------------

describe('calibrateJudge — overrule detection', () => {
  it('counts a sample where tests failed badly (5/13) but judge gave 20 as an overrule', () => {
    const samples: CalibrationSample[] = [
      { judgeScore: 20, passed: 5, total: 13 },  // overrule: passed < total, judge >= 18
    ];

    const report = calibrateJudge(samples);

    expect(report.n).toBe(1);
    expect(report.overrules).toBeGreaterThanOrEqual(1);
    // The error is large: |20 - 11| = 9
    expect(report.meanAbsoluteError).toBeGreaterThan(0);
    expect(report.samples[0].error).toBeGreaterThan(0);
  });

  it('counts as overrule when judgeScore === 18 exactly (boundary)', () => {
    const samples: CalibrationSample[] = [
      { judgeScore: 18, passed: 0, total: 10 },  // all tests failed, judge gives 18
    ];
    const report = calibrateJudge(samples);
    expect(report.overrules).toBe(1);
  });

  it('does NOT count as overrule when judgeScore === 17 (below threshold)', () => {
    const samples: CalibrationSample[] = [
      { judgeScore: 17, passed: 5, total: 10 },
    ];
    const report = calibrateJudge(samples);
    expect(report.overrules).toBe(0);
  });

  it('does NOT count as overrule when all tests pass (passed === total)', () => {
    const samples: CalibrationSample[] = [
      { judgeScore: 20, passed: 10, total: 10 },
    ];
    const report = calibrateJudge(samples);
    expect(report.overrules).toBe(0);
  });

  it('accumulates multiple overrules in the same batch', () => {
    const samples: CalibrationSample[] = [
      { judgeScore: 20, passed: 2, total: 13 },  // overrule
      { judgeScore: 19, passed: 0, total: 13 },  // overrule
      { judgeScore: 20, passed: 13, total: 13 }, // NOT an overrule
      { judgeScore: 17, passed: 1, total: 13 },  // NOT an overrule (score < 18)
    ];
    const report = calibrateJudge(samples);
    expect(report.overrules).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// calibrateJudge — judgeError and total=0 samples are skipped
// ---------------------------------------------------------------------------

describe('calibrateJudge — skipping logic', () => {
  it('skips samples where judgeError is true', () => {
    const samples: CalibrationSample[] = [
      { judgeScore: null, passed: 13, total: 13, judgeError: true },
      { judgeScore: 20,   passed: 13, total: 13 },
    ];
    const report = calibrateJudge(samples);
    expect(report.n).toBe(1);
    expect(report.skipped).toBe(1);
  });

  it('skips samples where judgeScore is null (independent of judgeError)', () => {
    const samples: CalibrationSample[] = [
      { judgeScore: null, passed: 5, total: 13 },
      { judgeScore: 11,   passed: 7, total: 13 },
    ];
    const report = calibrateJudge(samples);
    expect(report.n).toBe(1);
    expect(report.skipped).toBe(1);
  });

  it('skips samples where total is 0 (no tests ran)', () => {
    const samples: CalibrationSample[] = [
      { judgeScore: 15, passed: 0, total: 0 },
      { judgeScore: 20, passed: 5, total: 5 },
    ];
    const report = calibrateJudge(samples);
    expect(report.n).toBe(1);
    expect(report.skipped).toBe(1);
  });

  it('excludes skipped samples from all metrics', () => {
    const samples: CalibrationSample[] = [
      // These should be skipped
      { judgeScore: null, passed: 0,  total: 13, judgeError: true },
      { judgeScore: null, passed: 5,  total: 10 },
      { judgeScore: 10,   passed: 0,  total: 0  },
      // Only this is usable
      { judgeScore: 20,   passed: 13, total: 13 },
    ];

    const report = calibrateJudge(samples);
    expect(report.n).toBe(1);
    expect(report.skipped).toBe(3);
    expect(report.meanAbsoluteError).toBe(0);
    expect(report.perfectAgreement).toBe(1);
    expect(report.withinTwo).toBe(1);
  });

  it('treats judgeError:false as NOT skipped', () => {
    const samples: CalibrationSample[] = [
      { judgeScore: 15, passed: 10, total: 13, judgeError: false },
    ];
    const report = calibrateJudge(samples);
    expect(report.n).toBe(1);
    expect(report.skipped).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// calibrateJudge — empty input
// ---------------------------------------------------------------------------

describe('calibrateJudge — empty input', () => {
  it('returns n=0, MAE=0, no NaN on empty array', () => {
    const report = calibrateJudge([]);

    expect(report.n).toBe(0);
    expect(report.skipped).toBe(0);
    expect(report.meanAbsoluteError).toBe(0);
    expect(report.withinTwo).toBe(0);
    expect(report.perfectAgreement).toBe(0);
    expect(report.overrules).toBe(0);
    expect(report.samples).toHaveLength(0);

    // Verify no NaN in any numeric field
    for (const [key, value] of Object.entries(report)) {
      if (typeof value === 'number') {
        expect(isNaN(value), `${key} should not be NaN`).toBe(false);
      }
    }
  });

  it('returns n=0 when all samples are skipped', () => {
    const samples: CalibrationSample[] = [
      { judgeScore: null, passed: 0, total: 13, judgeError: true },
      { judgeScore: null, passed: 5, total: 10 },
      { judgeScore: 10,   passed: 0, total: 0  },
    ];
    const report = calibrateJudge(samples);
    expect(report.n).toBe(0);
    expect(report.skipped).toBe(3);
    expect(isNaN(report.meanAbsoluteError)).toBe(false);
    expect(isNaN(report.withinTwo)).toBe(false);
    expect(isNaN(report.perfectAgreement)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// calibrateJudge — MAE and withinTwo accuracy
// ---------------------------------------------------------------------------

describe('calibrateJudge — metric accuracy', () => {
  it('computes MAE correctly for a mixed batch', () => {
    // judge=20, expected=20 → error 0
    // judge=10, expected=20 → error 10
    // judge=11, expected=11 → error 0 (7/13 → round(10.769)=11)
    const samples: CalibrationSample[] = [
      { judgeScore: 20, passed: 13, total: 13 },
      { judgeScore: 10, passed: 13, total: 13 },
      { judgeScore: 11, passed: 7,  total: 13 },
    ];
    const report = calibrateJudge(samples);
    expect(report.n).toBe(3);
    // MAE = (0 + 10 + 0) / 3 = 3.333
    expect(report.meanAbsoluteError).toBeCloseTo(10 / 3, 2);
  });

  it('computes withinTwo correctly', () => {
    // error 0 → within two ✓
    // error 2 → within two ✓ (boundary inclusive)
    // error 3 → NOT within two ✗
    const samples: CalibrationSample[] = [
      { judgeScore: 20, passed: 13, total: 13 }, // error 0
      { judgeScore: 18, passed: 13, total: 13 }, // error 2
      { judgeScore: 17, passed: 13, total: 13 }, // error 3
    ];
    const report = calibrateJudge(samples);
    expect(report.withinTwo).toBeCloseTo(2 / 3, 3);
  });

  it('counts perfect agreement correctly', () => {
    const samples: CalibrationSample[] = [
      { judgeScore: 20, passed: 13, total: 13 }, // perfect
      { judgeScore: 11, passed: 7,  total: 13 }, // perfect
      { judgeScore: 12, passed: 7,  total: 13 }, // off by 1
    ];
    const report = calibrateJudge(samples);
    expect(report.perfectAgreement).toBeCloseTo(2 / 3, 3);
  });

  it('fractions are in [0, 1]', () => {
    const samples: CalibrationSample[] = [
      { judgeScore: 5,  passed: 0,  total: 13 },
      { judgeScore: 20, passed: 13, total: 13 },
    ];
    const report = calibrateJudge(samples);
    expect(report.withinTwo).toBeGreaterThanOrEqual(0);
    expect(report.withinTwo).toBeLessThanOrEqual(1);
    expect(report.perfectAgreement).toBeGreaterThanOrEqual(0);
    expect(report.perfectAgreement).toBeLessThanOrEqual(1);
  });
});
