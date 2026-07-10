import { runPerformanceFrontier } from '../runner';
import { summarize } from './statistics';
import type { StatsSummary } from './statistics';
import type { PFContextMode, PFSuite } from '../types';

export interface BenchRunSample {
  finalScore: number;
  verdict: string;
  judgeError: boolean;
  groundTruth?: unknown; // pass through PFRunResult.groundTruth
}

export interface BenchResult {
  suite: PFSuite;
  modelId: string;
  repetitions: number;
  seeds: number[];
  finalScore: StatsSummary;
  verdictCounts: Record<string, number>;
  judgeErrors: number;
  samples: BenchRunSample[];
}

export interface RunBenchOptions {
  suite: PFSuite;
  modelId: string;
  repetitions: number;
  /** Starting seed. Default: 1. */
  baseSeed?: number;
  /**
   * When false (default): all repetitions use baseSeed — isolates LLM + judge noise
   * on a fixed case.
   * When true: seeds increment baseSeed, baseSeed+1, …, so each rep sees a distinct
   * procedural case variant.
   */
  varySeeds?: boolean;
  /** Forwarded verbatim to every repetition's `runPerformanceFrontier` call — see Step P1. */
  contextMode?: PFContextMode;
}

export async function runBench(opts: RunBenchOptions): Promise<BenchResult> {
  const { suite, modelId, repetitions, contextMode } = opts;
  const baseSeed = opts.baseSeed ?? 1;
  const varySeeds = opts.varySeeds ?? false;

  const samples: BenchRunSample[] = [];
  const seeds: number[] = [];

  for (let i = 0; i < repetitions; i++) {
    const seed = varySeeds ? baseSeed + i : baseSeed;
    seeds.push(seed);

    try {
      const result = await runPerformanceFrontier({ suite, modelId, seed, contextMode });
      samples.push({
        finalScore: result.finalScore,
        verdict: result.verdict,
        judgeError: result.judgeError ?? false,
        groundTruth: result.groundTruth,
      });
    } catch {
      // A thrown error counts as a failed run — record it without aborting the batch.
      samples.push({
        finalScore: 0,
        verdict: 'fail',
        judgeError: true,
      });
    }
  }

  const verdictCounts: Record<string, number> = {};
  let judgeErrors = 0;

  for (const sample of samples) {
    verdictCounts[sample.verdict] = (verdictCounts[sample.verdict] ?? 0) + 1;
    if (sample.judgeError) judgeErrors++;
  }

  const finalScore = summarize(samples.map((s) => s.finalScore));

  return {
    suite,
    modelId,
    repetitions,
    seeds,
    finalScore,
    verdictCounts,
    judgeErrors,
    samples,
  };
}
