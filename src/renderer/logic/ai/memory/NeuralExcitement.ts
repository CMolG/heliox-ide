/**
 * NeuralExcitement.ts — AI Memory System
 *
 * Responsibility:
 * - Pure computation engine for memory scoring and ranking
 * - Computes excitement scores from positive/negative signal counts
 * - Applies time decay to age out stale memory signals
 * - Ranks dimensions by absolute excitement magnitude
 *
 * Boundaries:
 * - Owns: scoring math, decay curves, confidence thresholds, ranking
 * - Does NOT own: signal storage (MemoryLedger), prompt generation (MemoryComposerPlugin)
 *
 * Design note:
 * "Neural excitement" borrows from neuroscience — signals that fire together
 * wire together. Frequently approved patterns build excitatory connections,
 * frequently rejected patterns build inhibitory connections. The metaphor
 * guides both the scoring math and the prompt language.
 */
import type { MemorySignal, MemoryEntry, RankedDimension } from './types';

/** Minimum total signals before a dimension has meaningful confidence */
const CONFIDENCE_THRESHOLD = 8;

/** Half-life for time decay in milliseconds (14 days) */
const DECAY_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Pure computation engine — all methods are static, no instance state.
 * Consumers call these to transform raw signal data into actionable scores.
 */
export class NeuralExcitement {

  /**
   * Compute a normalized excitement score from positive and negative counts.
   *
   * Formula: (P - N) / (P + N)
   * Range: [-1, +1]
   *   +1 = universally approved
   *   -1 = universally rejected
   *    0 = perfectly balanced or no data
   *
   * A small Laplace smoothing term prevents extreme scores from tiny samples.
   */
  static computeScore(positiveCount: number, negativeCount: number): number {
    const total = positiveCount + negativeCount;
    if (total === 0) return 0;

    // Laplace smoothing: add 1 to each to prevent ±1 from single signals
    const smoothedP = positiveCount + 1;
    const smoothedN = negativeCount + 1;
    const smoothedTotal = smoothedP + smoothedN;

    return (smoothedP - smoothedN) / smoothedTotal;
  }

  /**
   * Compute confidence level based on sample size.
   *
   * Range: [0, 1]
   * Reaches 1.0 when sample size meets CONFIDENCE_THRESHOLD.
   * Uses a logarithmic curve so early signals matter more.
   */
  static computeConfidence(sampleSize: number): number {
    if (sampleSize <= 0) return 0;
    return Math.min(1, Math.log2(sampleSize + 1) / Math.log2(CONFIDENCE_THRESHOLD + 1));
  }

  /**
   * Apply exponential time decay to a set of memory signals.
   *
   * Older signals are weighted less, simulating natural memory fade.
   * Returns a new array with decayed weight factors attached.
   *
   * Half-life: ~14 days (a signal from 14 days ago has 50% weight).
   */
  static applyTimeDecay(signals: MemorySignal[], now: number = Date.now()): Array<{ signal: MemorySignal; weight: number }> {
    return signals.map(signal => {
      const age = now - signal.timestamp;
      const weight = Math.pow(0.5, age / DECAY_HALF_LIFE_MS);
      return { signal, weight };
    });
  }

  /**
   * Compute a weighted excitement score from time-decayed signals.
   *
   * Uses the same (P - N) / (P + N) formula, but each signal
   * contributes its time-decay weight instead of a flat +1 or -1.
   */
  static computeDecayedScore(
    signals: Array<{ signal: MemorySignal; weight: number }>,
  ): { score: number; positiveWeight: number; negativeWeight: number } {
    let positiveWeight = 0;
    let negativeWeight = 0;

    for (const { signal, weight } of signals) {
      if (signal.polarity === 'positive') {
        positiveWeight += weight;
      } else {
        negativeWeight += weight;
      }
    }

    const total = positiveWeight + negativeWeight;
    if (total === 0) return { score: 0, positiveWeight: 0, negativeWeight: 0 };

    const score = (positiveWeight - negativeWeight) / (total + 2); // +2 Laplace smoothing
    return { score, positiveWeight, negativeWeight };
  }

  /**
   * Rank dimensions by absolute excitement magnitude (strongest first).
   *
   * Filters out low-confidence entries to prevent noise from leaking
   * into prompt context. Only dimensions with confidence > minConfidence
   * are included.
   */
  static rankDimensions(
    entries: MemoryEntry[],
    minConfidence = 0.3,
  ): RankedDimension[] {
    return entries
      .filter(e => e.confidence >= minConfidence)
      .map(e => ({
        dimension: e.dimension,
        score: e.score,
        confidence: e.confidence,
        label: NeuralExcitement.dimensionToLabel(e.dimension),
        sampleSize: e.positiveCount + e.negativeCount,
      }))
      .sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
  }

  /**
   * Convert a dimension key into a human-readable label.
   * "keyword:refactor" → "keyword 'refactor'"
   * "agent:auto-reducer-finite" → "agent 'auto-reducer-finite'"
   */
  static dimensionToLabel(dimension: string): string {
    const colonIdx = dimension.indexOf(':');
    if (colonIdx === -1) return dimension;
    const type = dimension.slice(0, colonIdx);
    const value = dimension.slice(colonIdx + 1);
    return `${type} '${value}'`;
  }
}
