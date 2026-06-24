/**
 * Thin harness that drives the `development` suite across multiple seeds and
 * extracts a CalibrationSample from each run.
 *
 * NOT unit-tested — it requires real model runs and network I/O.
 */
import type { CalibrationSample } from './judge-calibration';
import { runPerformanceFrontier } from '../runner';

export interface CollectCalibrationOptions {
  /** Model to evaluate, e.g. 'mimo/mimo-v2.5-pro'. */
  modelId: string;
  /** One development run per seed — collect enough for statistical confidence (≥10). */
  seeds: number[];
}

/**
 * Runs the `development` suite once per seed and extracts a CalibrationSample
 * from each result.
 *
 * - One failure in a seed does NOT abort the batch; the failed run contributes
 *   a sample with judgeScore=null, total=0, judgeError=true.
 * - Access paths reflect the PFRunResult shape:
 *     result.judgeError             → degraded judge flag
 *     result.evaluations.algorithmicAccuracy?.score → 0-20 judge score
 *     result.groundTruth?.tests     → { ran, passed, failed, total }
 */
export async function collectDevelopmentCalibration(
  opts: CollectCalibrationOptions,
): Promise<CalibrationSample[]> {
  const { modelId, seeds } = opts;
  const samples: CalibrationSample[] = [];

  for (const seed of seeds) {
    try {
      const result = await runPerformanceFrontier({
        suite: 'development',
        modelId,
        seed,
      });

      const judgeError = result.judgeError === true;
      const judgeScore: number | null = judgeError
        ? null
        : (result.evaluations.algorithmicAccuracy as { score: number } | undefined)?.score ?? null;

      const tests = result.groundTruth?.tests;
      const passed = tests?.passed ?? 0;
      const total = tests?.total ?? 0;

      samples.push({ judgeScore, passed, total, judgeError });
    } catch {
      // Any thrown error (timeout, network, parse failure) is treated as a
      // fully-degraded sample so the rest of the batch continues.
      samples.push({ judgeScore: null, passed: 0, total: 0, judgeError: true });
    }
  }

  return samples;
}
