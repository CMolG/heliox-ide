/**
 * Pure, dependency-free statistical utilities for the Performance Frontier bench tool.
 *
 * All calculations use exact floating-point arithmetic — rounding is left to callers.
 */

export interface StatsSummary {
  n: number;
  mean: number;
  stdDev: number;    // sample standard deviation (n-1 denominator); 0 when n < 2
  stdError: number;  // stdDev / sqrt(n); 0 when n < 2
  ci95: { lower: number; upper: number }; // 95% CI via Student's t; equals [mean, mean] when n < 2
  min: number;
  max: number;
  median: number;
}

/**
 * Two-tailed Student's t critical values for α = 0.05 (95% CI), df = 1..30.
 * Source: standard t-distribution table.
 */
const T_TABLE: Record<number, number> = {
  1:  12.706,
  2:   4.303,
  3:   3.182,
  4:   2.776,
  5:   2.571,
  6:   2.447,
  7:   2.365,
  8:   2.306,
  9:   2.262,
  10:  2.228,
  11:  2.201,
  12:  2.179,
  13:  2.160,
  14:  2.145,
  15:  2.131,
  16:  2.120,
  17:  2.110,
  18:  2.101,
  19:  2.093,
  20:  2.086,
  21:  2.080,
  22:  2.074,
  23:  2.069,
  24:  2.064,
  25:  2.060,
  26:  2.056,
  27:  2.052,
  28:  2.048,
  29:  2.045,
  30:  2.042,
};

/** Large-sample fallback (z_{0.025} = 1.96) for df > 30. */
const T_LARGE_SAMPLE = 1.96;

function tCritical(df: number): number {
  if (df <= 0) return 0;
  return T_TABLE[df] ?? T_LARGE_SAMPLE;
}

function computeMedian(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Summarise an array of numeric values.
 *
 * Edge cases:
 *   - Empty array  → all zeros, ci95 = {lower: 0, upper: 0}, no NaN.
 *   - n === 1      → mean = value, stdDev = 0, stdError = 0, ci95 = [value, value].
 *   - n >= 2       → full sample statistics with Student's t 95% CI.
 */
export function summarize(values: number[]): StatsSummary {
  const n = values.length;

  if (n === 0) {
    return {
      n: 0,
      mean: 0,
      stdDev: 0,
      stdError: 0,
      ci95: { lower: 0, upper: 0 },
      min: 0,
      max: 0,
      median: 0,
    };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const median = computeMedian(sorted);
  const mean = values.reduce((acc, v) => acc + v, 0) / n;

  if (n === 1) {
    return {
      n: 1,
      mean,
      stdDev: 0,
      stdError: 0,
      ci95: { lower: mean, upper: mean },
      min,
      max,
      median,
    };
  }

  // Sample variance: Σ(x - mean)² / (n - 1)
  const sumSqDiff = values.reduce((acc, v) => acc + (v - mean) ** 2, 0);
  const variance = sumSqDiff / (n - 1);
  const stdDev = Math.sqrt(variance);
  const stdError = stdDev / Math.sqrt(n);

  const df = n - 1;
  const t = tCritical(df);
  const margin = t * stdError;

  return {
    n,
    mean,
    stdDev,
    stdError,
    ci95: { lower: mean - margin, upper: mean + margin },
    min,
    max,
    median,
  };
}
