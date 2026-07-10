/**
 * context-manifest.test.ts — Unit tests for the Rosetta context manifest
 * (spec: docs/superpowers/specs/2026-07-10-rosetta-context-manifest.md).
 *
 * Pure, side-effect-free module — no filesystem, no executor. Covers every
 * shape the spec enumerates: a linear chain, parallel (fan-out/fan-in) steps,
 * a bounded loop (N iterations), a single-step flow, and a chain with a
 * `retriever` step in the middle (exempt from briefing duties).
 */
import { describe, expect, it } from 'vitest';
import type { AgenticFlow, AgenticStep } from '../../types/harness';
import { buildExecutionPlan } from './loop-plan';
import {
  CONTEXT_MANIFEST_VERSION,
  DEFAULT_CONTEXT_BUDGET_BYTES,
  buildContextManifest,
  buildTopologySummaryLines,
  contextArtifactPathPattern,
  contextRunDir,
  contextRunSubdir,
  manifestKeyForInstance,
  relativeContextFilePath,
  seedContextFiles,
  summarizePurpose,
} from './context-manifest';

// ---------------------------------------------------------------------------
// Helpers (mirroring the exact style of loop-plan.test.ts / executor.test.ts)
// ---------------------------------------------------------------------------

function makeStep(
  id: string,
  prevStepIds: string[],
  nextStepIds: string[],
  overrides: Partial<AgenticStep> = {},
): AgenticStep {
  return {
    id,
    type: 'llm_call',
    prompt: `Prompt for ${id}`,
    tools: [],
    prevStepIds,
    nextStepIds,
    mods: [],
    roles: [],
    mentalContext: [],
    ...overrides,
  };
}

function makeFlow(
  stepsRecord: Record<string, AgenticStep>,
  rootStepId: string,
  loops?: AgenticFlow['loops'],
): AgenticFlow {
  return {
    id: 'flow-test',
    name: 'Test Flow',
    rootStepId,
    stepsRecord,
    contextMode: 'feedback',
    ...(loops ? { loops } : {}),
  };
}

// ---------------------------------------------------------------------------
// contextRunSubdir / contextRunDir
// ---------------------------------------------------------------------------

describe('contextRunSubdir / contextRunDir', () => {
  it('builds the rootDir-relative run-context subdirectory', () => {
    expect(contextRunSubdir('run-123')).toBe('.fluxor/run-context/run-123');
  });

  it('joins rootDir with the run-context subdirectory', () => {
    expect(contextRunDir('/workspace', 'run-123')).toBe('/workspace/.fluxor/run-context/run-123');
  });

  it('strips a trailing slash from rootDir before joining', () => {
    expect(contextRunDir('/workspace/', 'run-123')).toBe('/workspace/.fluxor/run-context/run-123');
  });
});

// ---------------------------------------------------------------------------
// relativeContextFilePath / contextArtifactPathPattern
// ---------------------------------------------------------------------------

describe('relativeContextFilePath', () => {
  it('builds the rootDir-relative path a step\'s FS tools would use', () => {
    expect(relativeContextFilePath('run-123', 'step.foo.md')).toBe('.fluxor/run-context/run-123/step.foo.md');
  });
});

describe('contextArtifactPathPattern', () => {
  it('anchors on the end of the path so it matches regardless of absolute prefix', () => {
    const pattern = contextArtifactPathPattern('run-123', 'step.foo.md');
    expect(new RegExp(pattern).test('/workspace/.fluxor/run-context/run-123/step.foo.md')).toBe(true);
    expect(new RegExp(pattern).test('/Users/dev/project/.fluxor/run-context/run-123/step.foo.md')).toBe(true);
    expect(new RegExp(pattern).test('/workspace/.fluxor/run-context/OTHER-run/step.foo.md')).toBe(false);
    expect(new RegExp(pattern).test('/workspace/.fluxor/run-context/run-123/step.bar.md')).toBe(false);
  });

  it('escapes regexp-special characters in runId/filename', () => {
    const pattern = contextArtifactPathPattern('run.1+2', 'step.a.md');
    // A literal-dot runId must NOT match an arbitrary character in its place.
    expect(new RegExp(pattern).test('/workspace/.fluxor/run-context/runX1X2/step.a.md')).toBe(false);
    expect(new RegExp(pattern).test('/workspace/.fluxor/run-context/run.1+2/step.a.md')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// summarizePurpose
// ---------------------------------------------------------------------------

describe('summarizePurpose', () => {
  it('collapses newlines/whitespace into a single line', () => {
    expect(summarizePurpose('Line one.\n\n  Line two.\t\tLine three.')).toBe('Line one. Line two. Line three.');
  });

  it('returns short prompts unchanged', () => {
    expect(summarizePurpose('Write the landing page.')).toBe('Write the landing page.');
  });

  it('truncates to at most 140 characters, ending with an ellipsis marker', () => {
    const long = 'x'.repeat(200);
    const summary = summarizePurpose(long);
    expect(summary.length).toBeLessThanOrEqual(140);
    expect(summary.endsWith('…')).toBe(true);
  });

  it('respects a custom maxChars', () => {
    const summary = summarizePurpose('0123456789', 5);
    expect(summary.length).toBeLessThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// buildContextManifest — chain (linear DAG, no loops)
// ---------------------------------------------------------------------------

describe('buildContextManifest — linear chain', () => {
  it('builds one entry per step keyed by bare stepId, with contextFile/purpose/readBy/writesTo', () => {
    const stepsRecord = {
      root: makeStep('root', [], ['middle'], { prompt: 'Kick off the chain.' }),
      middle: makeStep('middle', ['root'], ['leaf'], { prompt: 'Do the middle work.' }),
      leaf: makeStep('leaf', ['middle'], [], { prompt: 'Wrap it up.' }),
    };
    const flow = makeFlow(stepsRecord, 'root');
    const plan = buildExecutionPlan(flow);

    const manifest = buildContextManifest(flow, plan, 'run-1');

    expect(manifest.version).toBe(CONTEXT_MANIFEST_VERSION);
    expect(manifest.runId).toBe('run-1');
    expect(manifest.flowId).toBe('flow-test');
    expect(manifest.contextMode).toBe('feedback');
    expect(manifest.budgetBytes).toBe(DEFAULT_CONTEXT_BUDGET_BYTES);

    expect(Object.keys(manifest.steps).sort()).toEqual(['leaf', 'middle', 'root']);

    expect(manifest.steps.root).toEqual({
      contextFile: 'step.root.md',
      purpose: 'Kick off the chain.',
      readBy: ['root'],
      writesTo: ['step.middle.md'],
    });
    expect(manifest.steps.middle).toEqual({
      contextFile: 'step.middle.md',
      purpose: 'Do the middle work.',
      readBy: ['middle'],
      writesTo: ['step.leaf.md'],
    });
    expect(manifest.steps.leaf).toEqual({
      contextFile: 'step.leaf.md',
      purpose: 'Wrap it up.',
      readBy: ['leaf'],
      writesTo: [], // terminal step promises nothing downstream
    });
  });

  it('accepts a custom budget', () => {
    const stepsRecord = { root: makeStep('root', [], []) };
    const flow = makeFlow(stepsRecord, 'root');
    const plan = buildExecutionPlan(flow);

    const manifest = buildContextManifest(flow, plan, 'run-budget', 4000);
    expect(manifest.budgetBytes).toBe(4000);
  });
});

// ---------------------------------------------------------------------------
// buildContextManifest — parallel (same-Kahn-wave) steps
// ---------------------------------------------------------------------------

describe('buildContextManifest — parallel steps (fan-out/fan-in)', () => {
  it('fans a producer\'s writesTo out to every parallel consumer, and consumers do not write to each other', () => {
    const stepsRecord = {
      root: makeStep('root', [], ['branch-a', 'branch-b']),
      'branch-a': makeStep('branch-a', ['root'], ['merge']),
      'branch-b': makeStep('branch-b', ['root'], ['merge']),
      merge: makeStep('merge', ['branch-a', 'branch-b'], []),
    };
    const flow = makeFlow(stepsRecord, 'root');
    const plan = buildExecutionPlan(flow);

    const manifest = buildContextManifest(flow, plan, 'run-2');

    // root fans out to BOTH parallel consumers' files.
    expect(manifest.steps.root.writesTo.sort()).toEqual(['step.branch-a.md', 'step.branch-b.md']);
    // Parallel siblings never write to each other (no edge between them).
    expect(manifest.steps['branch-a'].writesTo).toEqual(['step.merge.md']);
    expect(manifest.steps['branch-b'].writesTo).toEqual(['step.merge.md']);
    expect(manifest.steps.merge.writesTo).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildContextManifest — bounded loop (N iterations)
// ---------------------------------------------------------------------------

describe('buildContextManifest — bounded loop', () => {
  it('keys loop-body instances as stepId#iterN and derives per-iteration writesTo from the expanded plan', () => {
    const stepsRecord = {
      root: makeStep('root', [], ['b1']),
      b1: makeStep('b1', ['root'], ['b2']),
      b2: makeStep('b2', ['b1'], ['down']),
      down: makeStep('down', ['b2'], []),
    };
    const flow = makeFlow(stepsRecord, 'root', [
      { id: 'loop-1', sourceStepId: 'b2', targetStepId: 'b1', maxIterations: 3 },
    ]);
    const plan = buildExecutionPlan(flow);

    const manifest = buildContextManifest(flow, plan, 'run-loop');

    // Non-loop steps keep bare keys; loop-body steps get #iterN — every pass,
    // including iteration 1.
    expect(Object.keys(manifest.steps).sort()).toEqual([
      'b1#iter1', 'b1#iter2', 'b1#iter3',
      'b2#iter1', 'b2#iter2', 'b2#iter3',
      'down', 'root',
    ].sort());

    // The internal loop-plan `@` namespace never leaks into manifest keys.
    for (const key of Object.keys(manifest.steps)) {
      expect(key).not.toContain('@');
    }

    expect(manifest.steps['b1#iter1'].contextFile).toBe('step.b1.iter1.md');
    expect(manifest.steps['b1#iter2'].contextFile).toBe('step.b1.iter2.md');
    expect(manifest.steps['b2#iter3'].contextFile).toBe('step.b2.iter3.md');

    // readBy always names the real stepId (not the iteration-suffixed key).
    expect(manifest.steps['b1#iter2'].readBy).toEqual(['b1']);

    // Chain edge: b1's pass k writes to b2's pass k (same iteration, same body).
    expect(manifest.steps['b1#iter1'].writesTo).toEqual(['step.b2.iter1.md']);
    expect(manifest.steps['b1#iter2'].writesTo).toEqual(['step.b2.iter2.md']);
    // b2's pass k (k<3) re-triggers b1's pass k+1 — the chain edge feeds b1's NEXT iteration file.
    expect(manifest.steps['b2#iter1'].writesTo).toEqual(['step.b1.iter2.md']);
    expect(manifest.steps['b2#iter2'].writesTo).toEqual(['step.b1.iter3.md']);
    // Exit edge: only the LAST pass of the tail connects onward, to the
    // (non-looped) downstream step's plain file.
    expect(manifest.steps['b2#iter3'].writesTo).toEqual(['step.down.md']);

    // root (pre-loop) and down (post-loop) sit outside the loop body.
    expect(manifest.steps.root.contextFile).toBe('step.root.md');
    expect(manifest.steps.down.contextFile).toBe('step.down.md');
    expect(manifest.steps.root.writesTo).toEqual(['step.b1.iter1.md']);
  });
});

// ---------------------------------------------------------------------------
// buildContextManifest — single-step flow
// ---------------------------------------------------------------------------

describe('buildContextManifest — single-step flow', () => {
  it('produces exactly one entry with no writesTo', () => {
    const stepsRecord = { solo: makeStep('solo', [], [], { prompt: 'Do the whole thing alone.' }) };
    const flow = makeFlow(stepsRecord, 'solo');
    const plan = buildExecutionPlan(flow);

    const manifest = buildContextManifest(flow, plan, 'run-solo');

    expect(Object.keys(manifest.steps)).toEqual(['solo']);
    expect(manifest.steps.solo).toEqual({
      contextFile: 'step.solo.md',
      purpose: 'Do the whole thing alone.',
      readBy: ['solo'],
      writesTo: [],
    });
  });
});

// ---------------------------------------------------------------------------
// buildContextManifest — chain with a retriever step in the middle
// ---------------------------------------------------------------------------

describe('buildContextManifest — retriever exemption', () => {
  it('marks a retriever-type step exempt with writesTo: [] and empty readBy, regardless of its real DAG edges', () => {
    const stepsRecord = {
      root: makeStep('root', [], ['fetch']),
      fetch: makeStep('fetch', ['root'], ['use'], { type: 'retriever' }),
      use: makeStep('use', ['fetch'], []),
    };
    const flow = makeFlow(stepsRecord, 'root');
    const plan = buildExecutionPlan(flow);

    const manifest = buildContextManifest(flow, plan, 'run-retriever');

    expect(manifest.steps.fetch.exempt).toBe('retriever');
    expect(manifest.steps.fetch.writesTo).toEqual([]);
    expect(manifest.steps.fetch.readBy).toEqual([]);
    // It still gets a contextFile (seeded, per spec) even though nobody reads it.
    expect(manifest.steps.fetch.contextFile).toBe('step.fetch.md');

    // The retriever's own upstream producer is unaffected — it still promises
    // a briefing to the retriever's file (mechanically derived from the DAG;
    // the retriever just never reads it).
    expect(manifest.steps.root.writesTo).toEqual(['step.fetch.md']);

    // Non-exempt steps elsewhere in the same flow are untouched.
    expect(manifest.steps.use.exempt).toBeUndefined();
    expect(manifest.steps.use.readBy).toEqual(['use']);
  });
});

// ---------------------------------------------------------------------------
// manifestKeyForInstance
// ---------------------------------------------------------------------------

describe('manifestKeyForInstance', () => {
  it('returns the bare stepId for a non-loop instance', () => {
    expect(manifestKeyForInstance({ stepId: 'root', iteration: 1 })).toBe('root');
  });

  it('returns stepId#iterN for a loop-body instance, even iteration 1', () => {
    expect(manifestKeyForInstance({
      stepId: 'b1', iteration: 1, loop: { id: 'loop-1', totalIterations: 3 },
    })).toBe('b1#iter1');
    expect(manifestKeyForInstance({
      stepId: 'b1', iteration: 2, loop: { id: 'loop-1', totalIterations: 3 },
    })).toBe('b1#iter2');
  });
});

// ---------------------------------------------------------------------------
// seedContextFiles
// ---------------------------------------------------------------------------

describe('seedContextFiles', () => {
  it('seeds one file per manifest entry, keyed by bare filename, with a deterministic header + purpose', () => {
    const stepsRecord = {
      root: makeStep('root', [], ['leaf'], { prompt: 'Kick off the chain.' }),
      leaf: makeStep('leaf', ['root'], [], { prompt: 'Wrap it up.' }),
    };
    const flow = makeFlow(stepsRecord, 'root');
    const plan = buildExecutionPlan(flow);
    const manifest = buildContextManifest(flow, plan, 'run-seed');

    const seeds = seedContextFiles(manifest);

    expect(Object.keys(seeds).sort()).toEqual(['step.leaf.md', 'step.root.md']);
    expect(seeds['step.root.md']).toContain('# Contexto para root');
    expect(seeds['step.root.md']).toContain('Kick off the chain.');
    expect(seeds['step.leaf.md']).toContain('# Contexto para leaf');
    expect(seeds['step.leaf.md']).toContain('Wrap it up.');
  });

  it('annotates a loop-body seed with its iteration/total for human readability', () => {
    const stepsRecord = {
      root: makeStep('root', [], ['b1']),
      b1: makeStep('b1', ['root'], ['b2']),
      b2: makeStep('b2', ['b1'], []),
    };
    const flow = makeFlow(stepsRecord, 'root', [
      { id: 'loop-1', sourceStepId: 'b2', targetStepId: 'b1', maxIterations: 2 },
    ]);
    const plan = buildExecutionPlan(flow);
    const manifest = buildContextManifest(flow, plan, 'run-seed-loop');

    const seeds = seedContextFiles(manifest);
    expect(seeds['step.b1.iter1.md']).toContain('iteración 1/2');
    expect(seeds['step.b1.iter2.md']).toContain('iteración 2/2');
  });
});

// ---------------------------------------------------------------------------
// buildTopologySummaryLines
// ---------------------------------------------------------------------------

describe('buildTopologySummaryLines', () => {
  it('produces one line per REAL step (not per loop iteration) in canonical topo order', () => {
    const stepsRecord = {
      root: makeStep('root', [], ['b1'], { prompt: 'Root prompt.' }),
      b1: makeStep('b1', ['root'], ['b2'], { prompt: 'Loop body step one.' }),
      b2: makeStep('b2', ['b1'], ['down'], { prompt: 'Loop body step two.' }),
      down: makeStep('down', ['b2'], [], { prompt: 'Final step.' }),
    };
    const flow = makeFlow(stepsRecord, 'root', [
      { id: 'loop-1', sourceStepId: 'b2', targetStepId: 'b1', maxIterations: 5 },
    ]);
    const plan = buildExecutionPlan(flow);

    const lines = buildTopologySummaryLines(flow, plan);

    // Exactly 4 lines — one per real step, NOT one per the 12 expanded instances.
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('root');
    expect(lines[0]).toContain('Root prompt.');
    expect(lines[1]).toContain('b1');
    expect(lines[1]).toMatch(/loop.*5|5.*loop/i);
    expect(lines[3]).toContain('down');
  });

  it('truncates the listing and appends a summary line when the flow has more real steps than maxLines', () => {
    const stepsRecord: Record<string, AgenticStep> = {};
    for (let i = 0; i < 40; i++) {
      const id = `s${String(i).padStart(2, '0')}`;
      const next = i < 39 ? [`s${String(i + 1).padStart(2, '0')}`] : [];
      const prev = i > 0 ? [`s${String(i - 1).padStart(2, '0')}`] : [];
      stepsRecord[id] = makeStep(id, prev, next);
    }
    const flow = makeFlow(stepsRecord, 's00');
    const plan = buildExecutionPlan(flow);

    const lines = buildTopologySummaryLines(flow, plan, 10);

    expect(lines.length).toBeLessThanOrEqual(10);
    expect(lines.at(-1)).toMatch(/more step/i);
  });

  it('returns an empty array for a flow with zero steps worth summarizing is unreachable (at least root exists) — single-step flow yields one line', () => {
    const flow = makeFlow({ solo: makeStep('solo', [], []) }, 'solo');
    const plan = buildExecutionPlan(flow);
    expect(buildTopologySummaryLines(flow, plan)).toHaveLength(1);
  });
});
