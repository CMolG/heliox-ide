import { describe, expect, it } from 'vitest';
import {
  buildComparison,
  effectiveContextMode,
  parseLedger,
  renderComparisonMarkdown,
  type PFLedgerRecord,
} from './comparator';

function record(overrides: Partial<PFLedgerRecord> & Pick<PFLedgerRecord, 'runId' | 'suite' | 'seed' | 'modelId'>): PFLedgerRecord {
  return {
    finalScore: 90,
    telemetry: { totalTokens: 1000, latencyMs: 5000 },
    ...overrides,
  };
}

describe('parseLedger', () => {
  // Edge: ledger vacío.
  it('returns [] for an empty string', () => {
    expect(parseLedger('')).toEqual([]);
  });

  it('returns [] for a whitespace/newline-only ledger', () => {
    expect(parseLedger('\n   \n\n')).toEqual([]);
  });

  it('parses one JSON object per line, ignoring a trailing newline', () => {
    const raw = `${JSON.stringify({ runId: 'a', suite: 's', seed: 1, modelId: 'm', finalScore: 1 })}\n`
      + `${JSON.stringify({ runId: 'b', suite: 's', seed: 1, modelId: 'm', finalScore: 2 })}\n`;
    const records = parseLedger(raw);
    expect(records).toHaveLength(2);
    expect(records[0].runId).toBe('a');
    expect(records[1].runId).toBe('b');
  });

  it('ignores blank lines interspersed between records', () => {
    const raw = `${JSON.stringify({ runId: 'a', suite: 's', seed: 1, modelId: 'm', finalScore: 1 })}\n\n\n`
      + `${JSON.stringify({ runId: 'b', suite: 's', seed: 1, modelId: 'm', finalScore: 2 })}\n`;
    expect(parseLedger(raw)).toHaveLength(2);
  });

  it('throws a clear, line-numbered error on malformed JSON (loud, not a silent skip)', () => {
    const raw = `${JSON.stringify({ runId: 'a', suite: 's', seed: 1, modelId: 'm', finalScore: 1 })}\n`
      + 'not-json{{{\n';
    expect(() => parseLedger(raw)).toThrow(/malformed JSON on line 2/);
  });
});

describe('effectiveContextMode', () => {
  // Edge: registros viejos sin campo = blind al leer.
  it('reads an absent contextMode field as "blind"', () => {
    expect(effectiveContextMode({})).toBe('blind');
    expect(effectiveContextMode({ contextMode: undefined })).toBe('blind');
  });

  it('reads "feedback" verbatim', () => {
    expect(effectiveContextMode({ contextMode: 'feedback' })).toBe('feedback');
  });

  it('reads "blind" verbatim', () => {
    expect(effectiveContextMode({ contextMode: 'blind' })).toBe('blind');
  });

  it('defensively reads a garbage/corrupted value as "blind" rather than throwing', () => {
    expect(effectiveContextMode({ contextMode: 'sandbox-typo' })).toBe('blind');
  });
});

describe('buildComparison', () => {
  it('returns no rows and no unpaired entries for an empty ledger', () => {
    const result = buildComparison([], { seed: 7 });
    expect(result.rows).toEqual([]);
    expect(result.unpaired).toEqual([]);
  });

  it('pairs a blind + feedback run sharing (suite, seed, modelId)', () => {
    const records = [
      record({ runId: 'run-blind', suite: 'team-work', seed: 7, modelId: 'mimo/mimo-v2.5-pro', contextMode: 'blind', finalScore: 80, telemetry: { totalTokens: 1000, latencyMs: 4000 } }),
      record({ runId: 'run-feedback', suite: 'team-work', seed: 7, modelId: 'mimo/mimo-v2.5-pro', contextMode: 'feedback', finalScore: 90, telemetry: { totalTokens: 1300, latencyMs: 5200 } }),
    ];

    const result = buildComparison(records, { seed: 7 });
    expect(result.unpaired).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      suite: 'team-work',
      modelId: 'mimo/mimo-v2.5-pro',
      blind: { runId: 'run-blind', finalScore: 80, totalTokens: 1000, latencyMs: 4000 },
      feedback: { runId: 'run-feedback', finalScore: 90, totalTokens: 1300, latencyMs: 5200 },
    });
  });

  // Edge: sin pareja blind/feedback.
  it('reports a blind-only group as unpaired instead of silently dropping it', () => {
    const records = [
      record({ runId: 'run-blind', suite: 'progression', seed: 7, modelId: 'mimo/mimo-v2.5-pro', contextMode: 'blind' }),
    ];
    const result = buildComparison(records, { seed: 7 });
    expect(result.rows).toEqual([]);
    expect(result.unpaired).toEqual([
      { suite: 'progression', modelId: 'mimo/mimo-v2.5-pro', mode: 'blind', runId: 'run-blind' },
    ]);
  });

  it('reports a feedback-only group as unpaired', () => {
    const records = [
      record({ runId: 'run-feedback', suite: 'progression', seed: 7, modelId: 'mimo/mimo-v2.5-pro', contextMode: 'feedback' }),
    ];
    const result = buildComparison(records, { seed: 7 });
    expect(result.rows).toEqual([]);
    expect(result.unpaired).toEqual([
      { suite: 'progression', modelId: 'mimo/mimo-v2.5-pro', mode: 'feedback', runId: 'run-feedback' },
    ]);
  });

  // Edge: seeds distintas — must NOT be paired even though suite+model match.
  it('does not pair runs with different seeds', () => {
    const records = [
      record({ runId: 'run-blind-seed5', suite: 'team-work', seed: 5, modelId: 'mimo/mimo-v2.5-pro', contextMode: 'blind' }),
      record({ runId: 'run-feedback-seed6', suite: 'team-work', seed: 6, modelId: 'mimo/mimo-v2.5-pro', contextMode: 'feedback' }),
    ];

    const resultAtSeed5 = buildComparison(records, { seed: 5 });
    expect(resultAtSeed5.rows).toEqual([]);
    expect(resultAtSeed5.unpaired).toEqual([
      { suite: 'team-work', modelId: 'mimo/mimo-v2.5-pro', mode: 'blind', runId: 'run-blind-seed5' },
    ]);

    const resultAtSeed6 = buildComparison(records, { seed: 6 });
    expect(resultAtSeed6.rows).toEqual([]);
    expect(resultAtSeed6.unpaired).toEqual([
      { suite: 'team-work', modelId: 'mimo/mimo-v2.5-pro', mode: 'feedback', runId: 'run-feedback-seed6' },
    ]);
  });

  // Edge: registros viejos sin campo — an old record with NO contextMode key
  // at all pairs correctly as the "blind" side against a new "feedback" one.
  it('pairs an old pre-P2 record (no contextMode field) as the blind side', () => {
    // No `contextMode` in the overrides at all — simulates a ledger line
    // written before Step P2 ever added the field, not merely `undefined`.
    const oldRecord = record({ runId: 'run-old', suite: 'architecture', seed: 3, modelId: 'mimo/mimo-v2.5-pro' });
    expect('contextMode' in oldRecord).toBe(false);
    const newRecord = record({ runId: 'run-new', suite: 'architecture', seed: 3, modelId: 'mimo/mimo-v2.5-pro', contextMode: 'feedback' });

    const result = buildComparison([oldRecord, newRecord], { seed: 3 });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].blind.runId).toBe('run-old');
    expect(result.rows[0].feedback.runId).toBe('run-new');
  });

  it('keeps the LAST record when multiple runs share (suite, seed, modelId, mode) — re-run supersedes', () => {
    const records = [
      record({ runId: 'blind-stale', suite: 'team-work', seed: 7, modelId: 'm', contextMode: 'blind', finalScore: 50 }),
      record({ runId: 'blind-fresh', suite: 'team-work', seed: 7, modelId: 'm', contextMode: 'blind', finalScore: 95 }),
      record({ runId: 'feedback-only', suite: 'team-work', seed: 7, modelId: 'm', contextMode: 'feedback', finalScore: 96 }),
    ];
    const result = buildComparison(records, { seed: 7 });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].blind.runId).toBe('blind-fresh');
    expect(result.rows[0].blind.finalScore).toBe(95);
  });

  it('filters by the --suites allowlist, dropping non-matching suites entirely', () => {
    const records = [
      record({ runId: 'tw-b', suite: 'team-work', seed: 7, modelId: 'm', contextMode: 'blind' }),
      record({ runId: 'tw-f', suite: 'team-work', seed: 7, modelId: 'm', contextMode: 'feedback' }),
      record({ runId: 'pr-b', suite: 'progression', seed: 7, modelId: 'm', contextMode: 'blind' }),
      record({ runId: 'pr-f', suite: 'progression', seed: 7, modelId: 'm', contextMode: 'feedback' }),
    ];
    const result = buildComparison(records, { seed: 7, suites: ['team-work'] });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].suite).toBe('team-work');
  });

  it('groups distinct suites and distinct models independently at the same seed', () => {
    const records = [
      record({ runId: 'tw-model-a-b', suite: 'team-work', seed: 7, modelId: 'model-a', contextMode: 'blind' }),
      record({ runId: 'tw-model-a-f', suite: 'team-work', seed: 7, modelId: 'model-a', contextMode: 'feedback' }),
      record({ runId: 'tw-model-b-b', suite: 'team-work', seed: 7, modelId: 'model-b', contextMode: 'blind' }),
      record({ runId: 'tw-model-b-f', suite: 'team-work', seed: 7, modelId: 'model-b', contextMode: 'feedback' }),
      record({ runId: 'pr-model-a-b', suite: 'progression', seed: 7, modelId: 'model-a', contextMode: 'blind' }),
      record({ runId: 'pr-model-a-f', suite: 'progression', seed: 7, modelId: 'model-a', contextMode: 'feedback' }),
    ];
    const result = buildComparison(records, { seed: 7 });
    expect(result.rows).toHaveLength(3);
    expect(result.unpaired).toEqual([]);
    // Sorted by suite then modelId.
    expect(result.rows.map((r) => `${r.suite}/${r.modelId}`)).toEqual([
      'progression/model-a',
      'team-work/model-a',
      'team-work/model-b',
    ]);
  });
});

describe('renderComparisonMarkdown', () => {
  it('renders a graceful message (not an error) when there are no pairs', () => {
    const markdown = renderComparisonMarkdown({ rows: [], unpaired: [] }, { seed: 9 });
    expect(markdown).toContain('Seed: 9');
    expect(markdown).toContain('No blind/feedback pairs found');
  });

  it('renders a markdown table with blind → feedback (Δ%) cells for score/tokens/wall-time', () => {
    const markdown = renderComparisonMarkdown({
      rows: [{
        suite: 'team-work',
        modelId: 'mimo/mimo-v2.5-pro',
        blind: { runId: 'run-blind', finalScore: 80, totalTokens: 1000, latencyMs: 4000 },
        feedback: { runId: 'run-feedback', finalScore: 92, totalTokens: 1300, latencyMs: 5200 },
      }],
      unpaired: [],
    }, { seed: 7, suites: ['team-work'] });

    expect(markdown).toContain('Seed: 7');
    expect(markdown).toContain('Suites: team-work');
    expect(markdown).toContain('| Suite | Model |');
    expect(markdown).toContain('team-work');
    expect(markdown).toContain('mimo/mimo-v2.5-pro');
    expect(markdown).toContain('80 → 92 (+15.00%)');
    expect(markdown).toContain('1000 → 1300 (+30.00%)');
    expect(markdown).toContain('4000 → 5200 (+30.00%)');
  });

  it('formats a negative delta with a leading minus and no double sign', () => {
    const markdown = renderComparisonMarkdown({
      rows: [{
        suite: 's',
        modelId: 'm',
        blind: { runId: 'b', finalScore: 100, totalTokens: 100, latencyMs: 100 },
        feedback: { runId: 'f', finalScore: 90, totalTokens: 100, latencyMs: 100 },
      }],
      unpaired: [],
    }, { seed: 1 });
    expect(markdown).toContain('100 → 90 (-10.00%)');
  });

  // Edge: division-by-zero baseline must never render Infinity/NaN.
  it('renders "N/A" when the blind baseline is 0 and feedback is not', () => {
    const markdown = renderComparisonMarkdown({
      rows: [{
        suite: 's',
        modelId: 'm',
        blind: { runId: 'b', finalScore: 0, totalTokens: 0, latencyMs: 0 },
        feedback: { runId: 'f', finalScore: 10, totalTokens: 500, latencyMs: 200 },
      }],
      unpaired: [],
    }, { seed: 1 });
    expect(markdown).toContain('0 → 10 (N/A)');
    expect(markdown).not.toContain('Infinity');
    expect(markdown).not.toContain('NaN');
  });

  it('renders "0.00%" when both blind and feedback are 0', () => {
    const markdown = renderComparisonMarkdown({
      rows: [{
        suite: 's',
        modelId: 'm',
        blind: { runId: 'b', finalScore: 0, totalTokens: 0, latencyMs: 0 },
        feedback: { runId: 'f', finalScore: 0, totalTokens: 0, latencyMs: 0 },
      }],
      unpaired: [],
    }, { seed: 1 });
    expect(markdown).toContain('0 → 0 (0.00%)');
  });

  it('lists unpaired runs with their mode and runId', () => {
    const markdown = renderComparisonMarkdown({
      rows: [],
      unpaired: [{ suite: 'progression', modelId: 'm', mode: 'blind', runId: 'run-1' }],
    }, { seed: 7 });
    expect(markdown).toContain('Unpaired runs');
    expect(markdown).toContain('progression / m: only `blind` ran (run-1).');
  });

  it('escapes a pipe character in a suite/model cell so it cannot break the table', () => {
    const markdown = renderComparisonMarkdown({
      rows: [{
        suite: 's',
        modelId: 'weird|model',
        blind: { runId: 'b', finalScore: 1, totalTokens: 1, latencyMs: 1 },
        feedback: { runId: 'f', finalScore: 1, totalTokens: 1, latencyMs: 1 },
      }],
      unpaired: [],
    }, { seed: 1 });
    expect(markdown).toContain('weird\\|model');
  });
});
