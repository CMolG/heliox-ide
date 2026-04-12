/**
 * Snapshot Diff Engine
 *
 * Converts two artifacts (before/after) into:
 *  - visual delta (pixelmatch PNG + percent)
 *  - metric deltas (status per metric)
 *  - impact score (weighted normalized aggregate)
 *  - severity gate (ok | warning | block)
 *
 * This module is pure/side-effect free except for in-memory image decoding.
 */
import { SnapshotArtifact, SnapshotDiff, MetricsDelta, MetricChange, PerformanceMetrics, SeverityLevel } from '@/types';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const METRIC_WEIGHTS: Record<string, number> = {
  lcp: 25,
  inp: 20,
  cls: 20,
  tbt: 15,
  jsHeapMB: 10,
  requestCount: 10,
};

const CRITICAL_THRESHOLDS: Partial<Record<keyof PerformanceMetrics, number>> = {
  lcp: 4000,
  cls: 0.25,
  tbt: 600,
};

function computeMetricChange(before: number, after: number, lowerIsBetter = true): MetricChange {
  const deltaPct = before === 0 ? (after > 0 ? 100 : 0) : ((after - before) / before) * 100;
  const improved = lowerIsBetter ? after < before : after > before;
  const degraded = lowerIsBetter ? after > before : after < before;

  let status: MetricChange['status'] = 'neutral';
  if (Math.abs(deltaPct) < 5) status = 'neutral';
  else if (improved) status = 'improved';
  else if (degraded && Math.abs(deltaPct) > 50) status = 'critical';
  else if (degraded) status = 'degraded';

  return { before, after, deltaPct: Math.round(deltaPct * 100) / 100, status };
}

function computeMetricsDelta(before: PerformanceMetrics, after: PerformanceMetrics): MetricsDelta {
  // Contract: all tracked metrics are evaluated using consistent status logic.
  return {
    lcp: computeMetricChange(before.lcp, after.lcp),
    inp: computeMetricChange(before.inp, after.inp),
    cls: computeMetricChange(before.cls, after.cls),
    tbt: computeMetricChange(before.tbt, after.tbt),
    jsHeapMB: computeMetricChange(before.jsHeapMB, after.jsHeapMB),
    requestCount: computeMetricChange(before.requestCount, after.requestCount),
  };
}

function computeImpactScore(delta: MetricsDelta): number {
  // Score is intentionally bounded to [-100, 100] so UI can render a stable
  // gauge independent of outlier regressions.
  let score = 0;
  for (const [key, weight] of Object.entries(METRIC_WEIGHTS)) {
    const change = delta[key as keyof MetricsDelta];
    if (!change) continue;
    const factor = change.status === 'improved' ? 1
      : change.status === 'critical' ? -2
      : change.status === 'degraded' ? -1
      : 0;
    score += factor * weight * (Math.min(Math.abs(change.deltaPct), 100) / 100);
  }
  return Math.round(Math.max(-100, Math.min(100, score)));
}

function determineSeverity(delta: MetricsDelta, afterMetrics: PerformanceMetrics): SeverityLevel {
  // Hard thresholds produce "block" regardless of relative improvements in
  // other metrics to preserve a strict quality gate for key UX dimensions.
  for (const [metric, threshold] of Object.entries(CRITICAL_THRESHOLDS)) {
    const value = afterMetrics[metric as keyof PerformanceMetrics];
    if (typeof value === 'number' && value > threshold) return 'block';
  }
  const hasDegraded = Object.values(delta).some(c => c.status === 'degraded');
  return hasDegraded ? 'warning' : 'ok';
}

/**
 * Computes the visual and metric diff between two snapshot artifacts.
 * Returns a SnapshotDiff with pixel diff image, metrics delta, and severity.
 */
export async function computeDiff(
  before: SnapshotArtifact,
  after: SnapshotArtifact,
): Promise<SnapshotDiff> {
  const metricsDelta = computeMetricsDelta(before.metrics, after.metrics);
  const impactScore = computeImpactScore(metricsDelta);
  const severity = determineSeverity(metricsDelta, after.metrics);

  // Visual pixel diff
  let visualDiffBase64 = '';
  let visualDiffPercent = 0;

  try {
    const img1 = PNG.sync.read(Buffer.from(before.screenshotBase64, 'base64'));
    const img2 = PNG.sync.read(Buffer.from(after.screenshotBase64, 'base64'));
    const { width, height } = img1;
    const diffImg = new PNG({ width, height });

    const numDiffPixels = pixelmatch(
      img1.data, img2.data, diffImg.data,
      width, height,
      { threshold: 0.1 },
    );

    visualDiffPercent = Math.round((numDiffPixels / (width * height)) * 10000) / 100;
    visualDiffBase64 = PNG.sync.write(diffImg).toString('base64');
  } catch {
    // Conservative fallback: unreadable or shape-mismatched images are treated
    // as full visual regression to prevent false "clean" outcomes.
    visualDiffPercent = 100;
  }

  return {
    stepId: before.stepId,
    before,
    after,
    visualDiffBase64,
    visualDiffPercent,
    metricsDelta,
    impactScore,
    severity,
  };
}
