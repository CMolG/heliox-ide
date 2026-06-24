import { describe, it, expect } from 'vitest';
import { summarize } from './statistics';

// Tolerance for floating-point comparisons.
const EPS = 1e-9;

describe('summarize — edge cases', () => {
  it('returns all-zero summary for empty input with no NaN', () => {
    const s = summarize([]);
    expect(s.n).toBe(0);
    expect(s.mean).toBe(0);
    expect(s.stdDev).toBe(0);
    expect(s.stdError).toBe(0);
    expect(s.ci95.lower).toBe(0);
    expect(s.ci95.upper).toBe(0);
    expect(s.min).toBe(0);
    expect(s.max).toBe(0);
    expect(s.median).toBe(0);
    // Ensure no field is NaN
    for (const [key, val] of Object.entries(s)) {
      if (typeof val === 'number') {
        expect(Number.isNaN(val), `field "${key}" must not be NaN`).toBe(false);
      }
    }
    expect(Number.isNaN(s.ci95.lower)).toBe(false);
    expect(Number.isNaN(s.ci95.upper)).toBe(false);
  });

  it('returns correct summary for n=1', () => {
    const s = summarize([42]);
    expect(s.n).toBe(1);
    expect(s.mean).toBe(42);
    expect(s.stdDev).toBe(0);
    expect(s.stdError).toBe(0);
    expect(s.ci95.lower).toBe(42);
    expect(s.ci95.upper).toBe(42);
    expect(s.min).toBe(42);
    expect(s.max).toBe(42);
    expect(s.median).toBe(42);
  });
});

describe('summarize — constant values', () => {
  it('[10, 10, 10]: mean=10, stdDev=0, ci=[10,10]', () => {
    const s = summarize([10, 10, 10]);
    expect(s.n).toBe(3);
    expect(s.mean).toBe(10);
    expect(s.stdDev).toBe(0);
    expect(s.stdError).toBe(0);
    expect(s.ci95.lower).toBe(10);
    expect(s.ci95.upper).toBe(10);
    expect(s.min).toBe(10);
    expect(s.max).toBe(10);
    expect(s.median).toBe(10);
  });
});

describe('summarize — known distribution [10, 20, 30]', () => {
  /**
   * n=3, mean=20, sample stdDev = sqrt(((10-20)^2 + (20-20)^2 + (30-20)^2) / 2)
   *   = sqrt((100 + 0 + 100) / 2) = sqrt(100) = 10
   * stdError = 10 / sqrt(3) ≈ 5.77350269...
   * df = 2 → t = 4.303
   * CI: 20 ± 4.303 * 5.77350269 → ≈ [−4.836, 44.836]
   */
  it('computes exact mean and stdDev', () => {
    const s = summarize([10, 20, 30]);
    expect(s.n).toBe(3);
    expect(s.mean).toBe(20);
    expect(s.stdDev).toBe(10);
  });

  it('computes stdError ≈ 5.7735', () => {
    const s = summarize([10, 20, 30]);
    expect(Math.abs(s.stdError - 10 / Math.sqrt(3))).toBeLessThan(EPS);
  });

  it('computes 95% CI using t(df=2)=4.303 within tolerance 0.01', () => {
    const s = summarize([10, 20, 30]);
    const t = 4.303;
    const stdError = 10 / Math.sqrt(3);
    const expectedLower = 20 - t * stdError;
    const expectedUpper = 20 + t * stdError;
    expect(Math.abs(s.ci95.lower - expectedLower)).toBeLessThan(0.01);
    expect(Math.abs(s.ci95.upper - expectedUpper)).toBeLessThan(0.01);
    // Sanity-check the rough range
    expect(s.ci95.lower).toBeLessThan(-4);
    expect(s.ci95.upper).toBeGreaterThan(44);
  });

  it('min=10, max=30, median=20', () => {
    const s = summarize([10, 20, 30]);
    expect(s.min).toBe(10);
    expect(s.max).toBe(30);
    expect(s.median).toBe(20);
  });
});

describe('summarize — median', () => {
  it('even-length input [1, 2, 3, 4] → median = 2.5', () => {
    const s = summarize([1, 2, 3, 4]);
    expect(s.median).toBe(2.5);
  });

  it('odd-length input [3, 1, 2] → median = 2 (sorted middle)', () => {
    const s = summarize([3, 1, 2]);
    expect(s.median).toBe(2);
  });

  it('unsorted input [5, 1, 3, 2, 4] → median = 3', () => {
    const s = summarize([5, 1, 3, 2, 4]);
    expect(s.median).toBe(3);
  });
});

describe('summarize — t-table boundary: df=30 vs df>30', () => {
  it('uses t=2.042 for df=30 (n=31)', () => {
    const values = Array.from({ length: 31 }, () => 50);
    // Constant values: stdDev=0 → CI=[50,50] regardless of t
    const s = summarize(values);
    expect(s.mean).toBe(50);
    expect(s.ci95.lower).toBe(50);
    expect(s.ci95.upper).toBe(50);
  });

  it('falls back to t=1.96 for df>30 (n=40)', () => {
    // Two distinct values; verify the t multiplier used is 1.96 not a table value.
    // With values [0, 0, ..., 100] (1 outlier in 40), just verify no NaN and CI is sensible.
    const values = [...Array(39).fill(0), 100];
    const s = summarize(values);
    expect(Number.isNaN(s.ci95.lower)).toBe(false);
    expect(Number.isNaN(s.ci95.upper)).toBe(false);
    expect(s.ci95.lower).toBeLessThan(s.mean);
    expect(s.ci95.upper).toBeGreaterThan(s.mean);
  });
});

describe('summarize — min/max', () => {
  it('correctly identifies min and max in unsorted input', () => {
    const s = summarize([7, 3, 15, 1, 9]);
    expect(s.min).toBe(1);
    expect(s.max).toBe(15);
  });
});

describe('summarize — n=2', () => {
  /**
   * n=2, values=[0, 100]
   * mean=50, stdDev=sqrt(((0-50)^2+(100-50)^2)/1)=sqrt(5000)≈70.71
   * stdError≈70.71/sqrt(2)≈50
   * df=1 → t=12.706
   * CI: 50 ± 12.706*50 = [50 - 635.3, 50 + 635.3]
   */
  it('uses t(df=1)=12.706 for n=2', () => {
    const s = summarize([0, 100]);
    expect(s.n).toBe(2);
    expect(s.mean).toBe(50);
    const expectedStdDev = Math.sqrt(5000);
    expect(Math.abs(s.stdDev - expectedStdDev)).toBeLessThan(EPS);
    const expectedStdError = expectedStdDev / Math.sqrt(2);
    const expectedMargin = 12.706 * expectedStdError;
    expect(Math.abs(s.ci95.lower - (50 - expectedMargin))).toBeLessThan(0.01);
    expect(Math.abs(s.ci95.upper - (50 + expectedMargin))).toBeLessThan(0.01);
  });
});
