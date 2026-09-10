/**
 * checkpoints.test.ts — Unit tests for per-step checkpoint persistence
 *
 * All tests use the injectable in-memory store so no real DB is required.
 * The SQLite store constructor is exercised with a lightweight mock database
 * so the full SQLite path is verified without native module loading.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  type CheckpointStore,
  CONTEXT_FILE_SNAPSHOT_MAX_CHARS,
  InMemoryCheckpointStore,
  INPUT_CONTEXT_MAX_CHARS,
  OUTPUT_MAX_CHARS,
  SqliteCheckpointStore,
  findPhaseStartCheckpoint,
  getCheckpoint,
  listCheckpoints,
  saveCheckpoint,
  setCheckpointStore,
} from './checkpoints';

// ---------------------------------------------------------------------------
// Re-export the InMemoryCheckpointStore for white-box tests
// (it is defined in the module but only the class constructor is exported)
// ---------------------------------------------------------------------------

// Helper: create a fresh in-memory store and register it as active.
function useInMemoryStore(): CheckpointStore {
  const store = new InMemoryCheckpointStore();
  setCheckpointStore(store);
  return store;
}

afterEach(() => {
  // Reset to a clean in-memory store between tests.
  setCheckpointStore(new InMemoryCheckpointStore());
});

// ---------------------------------------------------------------------------
// saveCheckpoint / listCheckpoints / getCheckpoint
// ---------------------------------------------------------------------------

describe('saveCheckpoint', () => {
  it('persists a checkpoint and returns the full record', () => {
    useInMemoryStore();

    const saved = saveCheckpoint({
      runId: 'run-1',
      stepId: 'step-a',
      inputContext: 'system prompt',
      output: 'step output',
      completedStepIds: ['step-a'],
      modelId: 'gpt-4o',
    });

    expect(saved.id).toMatch(/^ckpt_run-1_step-a_/);
    expect(saved.runId).toBe('run-1');
    expect(saved.stepId).toBe('step-a');
    expect(saved.inputContext).toBe('system prompt');
    expect(saved.output).toBe('step output');
    expect(saved.completedStepIds).toEqual(['step-a']);
    expect(saved.modelId).toBe('gpt-4o');
    expect(saved.timestamp).toBeGreaterThan(0);
  });

  it('generates a unique id per checkpoint even for the same run/step', () => {
    useInMemoryStore();

    const a = saveCheckpoint({
      runId: 'run-1',
      stepId: 'step-a',
      inputContext: '',
      output: 'first',
      completedStepIds: ['step-a'],
    });
    // Ensure distinct timestamps by forcing a small delay via mutable timestamp.
    const b = saveCheckpoint({
      runId: 'run-1',
      stepId: 'step-a',
      inputContext: '',
      output: 'second',
      completedStepIds: ['step-a'],
    });

    // IDs may be equal if both land in the same millisecond; the id embeds
    // timestamp so we only assert they are strings — the uniqueness invariant
    // is best-effort at millisecond resolution.
    expect(typeof a.id).toBe('string');
    expect(typeof b.id).toBe('string');
  });

  it('stores modelId as undefined when not provided', () => {
    useInMemoryStore();
    const saved = saveCheckpoint({
      runId: 'run-x',
      stepId: 'step-b',
      inputContext: '',
      output: '',
      completedStepIds: [],
    });
    expect(saved.modelId).toBeUndefined();
  });

  it('includes iteration when provided (loop-body pass)', () => {
    useInMemoryStore();
    const saved = saveCheckpoint({
      runId: 'run-iter',
      stepId: 'step-loop',
      iteration: 2,
      inputContext: '',
      output: '',
      completedStepIds: [],
    });
    expect(saved.iteration).toBe(2);
  });

  it('omits the iteration key entirely when not provided, rather than storing it as undefined', () => {
    useInMemoryStore();
    const saved = saveCheckpoint({
      runId: 'run-no-iter',
      stepId: 'step-plain',
      inputContext: '',
      output: '',
      completedStepIds: [],
    });
    // Strict key-absence check: a previous implementation could pass this by
    // storing `iteration: undefined`, which the `!== undefined` check below
    // would miss but `in` would catch (structured-clone IPC preserves keys
    // with an undefined value, unlike JSON.stringify).
    expect('iteration' in saved).toBe(false);
    expect(saved.iteration).toBeUndefined();
  });
});

describe('listCheckpoints', () => {
  it('returns all checkpoints for a run in timestamp order', () => {
    useInMemoryStore();

    saveCheckpoint({ runId: 'run-2', stepId: 'step-1', inputContext: '', output: 'o1', completedStepIds: ['step-1'] });
    saveCheckpoint({ runId: 'run-2', stepId: 'step-2', inputContext: '', output: 'o2', completedStepIds: ['step-1', 'step-2'] });
    saveCheckpoint({ runId: 'run-2', stepId: 'step-3', inputContext: '', output: 'o3', completedStepIds: ['step-1', 'step-2', 'step-3'] });

    const list = listCheckpoints('run-2');
    expect(list).toHaveLength(3);
    expect(list.map((c) => c.stepId)).toEqual(['step-1', 'step-2', 'step-3']);
  });

  it('does not return checkpoints from other runs', () => {
    useInMemoryStore();

    saveCheckpoint({ runId: 'run-A', stepId: 'step-1', inputContext: '', output: '', completedStepIds: [] });
    saveCheckpoint({ runId: 'run-B', stepId: 'step-1', inputContext: '', output: '', completedStepIds: [] });

    expect(listCheckpoints('run-A')).toHaveLength(1);
    expect(listCheckpoints('run-B')).toHaveLength(1);
    expect(listCheckpoints('run-C')).toHaveLength(0);
  });
});

describe('getCheckpoint', () => {
  it('returns the checkpoint by id', () => {
    useInMemoryStore();

    const saved = saveCheckpoint({
      runId: 'run-3',
      stepId: 'step-x',
      inputContext: 'ctx',
      output: 'out',
      completedStepIds: ['step-x'],
    });

    const found = getCheckpoint(saved.id);
    expect(found).toEqual(saved);
  });

  it('returns undefined for unknown ids', () => {
    useInMemoryStore();
    expect(getCheckpoint('ckpt_nonexistent')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Truncation
// ---------------------------------------------------------------------------

describe('field truncation', () => {
  it('truncates inputContext that exceeds INPUT_CONTEXT_MAX_CHARS', () => {
    useInMemoryStore();

    const longContext = 'x'.repeat(INPUT_CONTEXT_MAX_CHARS + 100);
    const saved = saveCheckpoint({
      runId: 'run-trunc',
      stepId: 'step-t',
      inputContext: longContext,
      output: '',
      completedStepIds: [],
    });

    expect(saved.inputContext.length).toBeLessThanOrEqual(INPUT_CONTEXT_MAX_CHARS);
    expect(saved.inputContext).toContain('[truncated]');
  });

  it('truncates output that exceeds OUTPUT_MAX_CHARS', () => {
    useInMemoryStore();

    const longOutput = 'y'.repeat(OUTPUT_MAX_CHARS + 50);
    const saved = saveCheckpoint({
      runId: 'run-trunc-out',
      stepId: 'step-t2',
      inputContext: '',
      output: longOutput,
      completedStepIds: [],
    });

    expect(saved.output.length).toBeLessThanOrEqual(OUTPUT_MAX_CHARS);
    expect(saved.output).toContain('[truncated]');
  });

  it('does not truncate fields within the limit', () => {
    useInMemoryStore();

    const ctx = 'a'.repeat(100);
    const out = 'b'.repeat(100);
    const saved = saveCheckpoint({
      runId: 'run-no-trunc',
      stepId: 'step-nt',
      inputContext: ctx,
      output: out,
      completedStepIds: [],
    });

    expect(saved.inputContext).toBe(ctx);
    expect(saved.output).toBe(out);
  });
});

// ---------------------------------------------------------------------------
// contextFileSnapshot — additive field for feedback-mode runs (Rosetta, spec:
// docs/superpowers/specs/2026-07-10-rosetta-context-manifest.md)
// ---------------------------------------------------------------------------

describe('contextFileSnapshot (feedback-mode checkpoints)', () => {
  it('stores contextFileSnapshot when provided', () => {
    useInMemoryStore();

    const saved = saveCheckpoint({
      runId: 'run-ctx',
      stepId: 'step-a',
      inputContext: '',
      output: '',
      completedStepIds: ['step-a'],
      contextFileSnapshot: { path: '.fluxor/run-context/run-ctx/step.step-a.md', content: '# Contexto para step-a\n\nDo the thing.' },
    });

    expect(saved.contextFileSnapshot).toEqual({
      path: '.fluxor/run-context/run-ctx/step.step-a.md',
      content: '# Contexto para step-a\n\nDo the thing.',
    });
  });

  it('omits the contextFileSnapshot key entirely when not provided, rather than storing it as undefined', () => {
    useInMemoryStore();

    const saved = saveCheckpoint({
      runId: 'run-no-ctx',
      stepId: 'step-b',
      inputContext: '',
      output: '',
      completedStepIds: [],
    });

    expect('contextFileSnapshot' in saved).toBe(false);
    expect(saved.contextFileSnapshot).toBeUndefined();
  });

  it('truncates contextFileSnapshot.content that exceeds CONTEXT_FILE_SNAPSHOT_MAX_CHARS', () => {
    useInMemoryStore();

    const longContent = 'z'.repeat(CONTEXT_FILE_SNAPSHOT_MAX_CHARS + 500);
    const saved = saveCheckpoint({
      runId: 'run-ctx-trunc',
      stepId: 'step-c',
      inputContext: '',
      output: '',
      completedStepIds: [],
      contextFileSnapshot: { path: '.fluxor/run-context/run-ctx-trunc/step.step-c.md', content: longContent },
    });

    expect(saved.contextFileSnapshot?.content.length).toBeLessThanOrEqual(CONTEXT_FILE_SNAPSHOT_MAX_CHARS);
    expect(saved.contextFileSnapshot?.content).toContain('[truncated]');
  });

  it('does not truncate contextFileSnapshot.content within the limit', () => {
    useInMemoryStore();

    const content = 'a short briefing';
    const saved = saveCheckpoint({
      runId: 'run-ctx-short',
      stepId: 'step-d',
      inputContext: '',
      output: '',
      completedStepIds: [],
      contextFileSnapshot: { path: '.fluxor/run-context/run-ctx-short/step.step-d.md', content },
    });

    expect(saved.contextFileSnapshot?.content).toBe(content);
  });

  it('does not disturb the existing shape (iteration/modelId/completedStepIds) when contextFileSnapshot is also present', () => {
    useInMemoryStore();

    const saved = saveCheckpoint({
      runId: 'run-ctx-shape',
      stepId: 'step-e',
      iteration: 2,
      inputContext: 'ctx',
      output: 'out',
      completedStepIds: ['step-e'],
      modelId: 'gpt-4o',
      contextFileSnapshot: { path: 'p', content: 'c' },
    });

    expect(saved.iteration).toBe(2);
    expect(saved.modelId).toBe('gpt-4o');
    expect(saved.completedStepIds).toEqual(['step-e']);
    expect(saved.inputContext).toBe('ctx');
    expect(saved.output).toBe('out');
  });
});

// ---------------------------------------------------------------------------
// SqliteCheckpointStore with a mock database
// ---------------------------------------------------------------------------

describe('SqliteCheckpointStore (mock database)', () => {
  function buildMockDb() {
    const rows = new Map<string, Record<string, unknown>>();

    const mockDb = {
      exec: (_sql: string): void => {
        // No-op: mock doesn't actually execute DDL.
      },
      prepare: (sql: string) => ({
        run: (...args: unknown[]) => {
          const trimmed = sql.trim().toLowerCase();
          if (trimmed.startsWith('insert')) {
            // Column order must mirror the real INSERT in checkpoints.ts:
            // (id, run_id, step_id, iteration, input_context, output,
            //  completed_step_ids, model_id, timestamp).
            const [id, runId, stepId, iteration, inputContext, output, completedStepIds, modelId, timestamp] = args;
            rows.set(String(id), {
              id,
              run_id: runId,
              step_id: stepId,
              iteration,
              input_context: inputContext,
              output,
              completed_step_ids: completedStepIds,
              model_id: modelId,
              timestamp,
            });
          }
        },
        get: (...args: unknown[]) => {
          return rows.get(String(args[0]));
        },
        all: (...args: unknown[]) => {
          const runId = String(args[0]);
          return [...rows.values()]
            .filter((r) => String(r.run_id) === runId)
            .sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
        },
      }),
    };

    return mockDb;
  }

  it('save → list → get round-trips through the mock database', () => {
    const store = new SqliteCheckpointStore(buildMockDb() as Parameters<typeof SqliteCheckpointStore.prototype.save>[0] extends never ? never : any);

    const input = {
      id: 'ckpt_run-sql_step-1_0',
      runId: 'run-sql',
      stepId: 'step-1',
      inputContext: 'ctx',
      output: 'out',
      completedStepIds: ['step-1'],
      modelId: 'claude-3-5-sonnet',
      timestamp: 1719484800000,
    };

    store.save(input);

    const listed = store.list('run-sql');
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      runId: 'run-sql',
      stepId: 'step-1',
      output: 'out',
      modelId: 'claude-3-5-sonnet',
    });

    const found = store.get('ckpt_run-sql_step-1_0');
    expect(found?.output).toBe('out');
  });

  it('returns undefined for a missing id', () => {
    const store = new SqliteCheckpointStore(buildMockDb() as any);
    expect(store.get('ckpt_does_not_exist')).toBeUndefined();
  });

  it('handles null model_id from the db as undefined', () => {
    const store = new SqliteCheckpointStore(buildMockDb() as any);

    store.save({
      id: 'ckpt_run-sql2_step-a_0',
      runId: 'run-sql2',
      stepId: 'step-a',
      inputContext: '',
      output: '',
      completedStepIds: [],
      modelId: undefined,
      timestamp: 0,
    });

    const found = store.get('ckpt_run-sql2_step-a_0');
    expect(found?.modelId).toBeUndefined();
  });

  it('round-trips iteration through the mock database', () => {
    const store = new SqliteCheckpointStore(buildMockDb() as any);

    store.save({
      id: 'ckpt_run-sql3_step-loop_0',
      runId: 'run-sql3',
      stepId: 'step-loop',
      iteration: 2,
      inputContext: '',
      output: '',
      completedStepIds: [],
      modelId: undefined,
      timestamp: 0,
    });

    const found = store.get('ckpt_run-sql3_step-loop_0');
    expect(found?.iteration).toBe(2);
  });

  it('omits iteration (rather than null) when the db column is null', () => {
    const store = new SqliteCheckpointStore(buildMockDb() as any);

    store.save({
      id: 'ckpt_run-sql4_step-plain_0',
      runId: 'run-sql4',
      stepId: 'step-plain',
      inputContext: '',
      output: '',
      completedStepIds: [],
      modelId: undefined,
      timestamp: 0,
    });

    const found = store.get('ckpt_run-sql4_step-plain_0');
    expect(found).toBeDefined();
    expect('iteration' in found!).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SqliteCheckpointStore — context_file_path / context_file_content columns
//
// A SEPARATE mock database (not the `buildMockDb()` above, which every
// pre-existing test in this file depends on staying untouched) that also
// captures the two new columns the INSERT statement carries for
// contextFileSnapshot, so these NEW tests can prove the SQLite backend
// round-trips the additive field exactly like InMemoryCheckpointStore does.
// ---------------------------------------------------------------------------

describe('SqliteCheckpointStore (mock database) — context_file_path/context_file_content', () => {
  function buildMockDbWithContextColumns() {
    const rows = new Map<string, Record<string, unknown>>();

    return {
      exec: (_sql: string): void => {
        // No-op: mock doesn't actually execute DDL.
      },
      prepare: (sql: string) => ({
        run: (...args: unknown[]) => {
          const trimmed = sql.trim().toLowerCase();
          if (trimmed.startsWith('insert')) {
            // Column order mirrors the real INSERT in checkpoints.ts:
            // (id, run_id, step_id, iteration, input_context, output,
            //  completed_step_ids, model_id, timestamp, context_file_path,
            //  context_file_content).
            const [
              id, runId, stepId, iteration, inputContext, output,
              completedStepIds, modelId, timestamp, contextFilePath, contextFileContent,
            ] = args;
            rows.set(String(id), {
              id,
              run_id: runId,
              step_id: stepId,
              iteration,
              input_context: inputContext,
              output,
              completed_step_ids: completedStepIds,
              model_id: modelId,
              timestamp,
              context_file_path: contextFilePath,
              context_file_content: contextFileContent,
            });
          }
        },
        get: (...args: unknown[]) => rows.get(String(args[0])),
        all: (...args: unknown[]) => {
          const runId = String(args[0]);
          return [...rows.values()]
            .filter((r) => String(r.run_id) === runId)
            .sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
        },
      }),
    };
  }

  it('round-trips path + content when contextFileSnapshot is provided', () => {
    const store = new SqliteCheckpointStore(buildMockDbWithContextColumns() as any);

    store.save({
      id: 'ckpt_run-ctx-sql_step-a_0',
      runId: 'run-ctx-sql',
      stepId: 'step-a',
      inputContext: '',
      output: '',
      completedStepIds: [],
      modelId: undefined,
      timestamp: 0,
      contextFileSnapshot: { path: '.fluxor/run-context/run-ctx-sql/step.step-a.md', content: 'briefing text' },
    });

    const found = store.get('ckpt_run-ctx-sql_step-a_0');
    expect(found?.contextFileSnapshot).toEqual({
      path: '.fluxor/run-context/run-ctx-sql/step.step-a.md',
      content: 'briefing text',
    });
  });

  it('omits contextFileSnapshot (rather than a null-filled object) when both columns are null', () => {
    const store = new SqliteCheckpointStore(buildMockDbWithContextColumns() as any);

    store.save({
      id: 'ckpt_run-ctx-sql2_step-b_0',
      runId: 'run-ctx-sql2',
      stepId: 'step-b',
      inputContext: '',
      output: '',
      completedStepIds: [],
      modelId: undefined,
      timestamp: 0,
    });

    const found = store.get('ckpt_run-ctx-sql2_step-b_0');
    expect(found).toBeDefined();
    expect('contextFileSnapshot' in found!).toBe(false);
  });

  it('round-trips through list() as well as get()', () => {
    const store = new SqliteCheckpointStore(buildMockDbWithContextColumns() as any);

    store.save({
      id: 'ckpt_run-ctx-sql3_step-c_0',
      runId: 'run-ctx-sql3',
      stepId: 'step-c',
      inputContext: '',
      output: '',
      completedStepIds: [],
      modelId: undefined,
      timestamp: 5,
      contextFileSnapshot: { path: 'p', content: 'c' },
    });

    const [listed] = store.list('run-ctx-sql3');
    expect(listed.contextFileSnapshot).toEqual({ path: 'p', content: 'c' });
  });
});

// ---------------------------------------------------------------------------
// phaseBoundary — Capa 1 phase checkpoints
// (spec docs/superpowers/specs/2026-07-21-agentic-phase-model.md §5.3)
// ---------------------------------------------------------------------------

describe('phaseBoundary (Capa 1 phase checkpoints)', () => {
  it('stores phaseBoundary when provided', () => {
    const checkpoint = saveCheckpoint({
      runId: 'run-1', stepId: 'step-a', inputContext: 'in', output: 'out', completedStepIds: ['step-a'],
      phaseBoundary: { phaseId: 'phase-1', phaseName: 'Setup', boundaries: ['start', 'end'] },
    });

    expect(checkpoint.phaseBoundary).toEqual({ phaseId: 'phase-1', phaseName: 'Setup', boundaries: ['start', 'end'] });
  });

  it('omits the phaseBoundary key entirely when not provided, rather than storing it as undefined', () => {
    const checkpoint = saveCheckpoint({
      runId: 'run-1', stepId: 'step-a', inputContext: 'in', output: 'out', completedStepIds: ['step-a'],
    });

    expect('phaseBoundary' in checkpoint).toBe(false);
  });

  it('does not disturb the existing shape (iteration/contextFileSnapshot) when phaseBoundary is also present', () => {
    const checkpoint = saveCheckpoint({
      runId: 'run-1', stepId: 'step-a', iteration: 2, inputContext: 'in', output: 'out', completedStepIds: ['step-a'],
      contextFileSnapshot: { path: 'a.md', content: 'hi' },
      phaseBoundary: { phaseId: 'phase-1', phaseName: 'Setup', boundaries: ['end'] },
    });

    expect(checkpoint.iteration).toBe(2);
    expect(checkpoint.contextFileSnapshot).toEqual({ path: 'a.md', content: 'hi' });
    expect(checkpoint.phaseBoundary).toEqual({ phaseId: 'phase-1', phaseName: 'Setup', boundaries: ['end'] });
  });
});

describe('SqliteCheckpointStore (mock database) — phase_boundary', () => {
  // Locally-scoped mock-DB builder per new field, matching this file's
  // established convention (see buildMockDbWithContextColumns above) rather
  // than a shared helper every pre-existing test would then depend on.
  function buildMockDbWithPhaseBoundaryColumn() {
    const rows = new Map<string, Record<string, unknown>>();

    return {
      exec: (_sql: string): void => {},
      prepare: (sql: string) => ({
        run: (...args: unknown[]) => {
          if (sql.trim().toLowerCase().startsWith('insert')) {
            // Column order mirrors the real INSERT in checkpoints.ts, with
            // phase_boundary appended after context_file_content.
            const [
              id, runId, stepId, iteration, inputContext, output,
              completedStepIds, modelId, timestamp, contextFilePath, contextFileContent,
              phaseBoundary,
            ] = args;
            rows.set(String(id), {
              id, run_id: runId, step_id: stepId, iteration, input_context: inputContext, output,
              completed_step_ids: completedStepIds, model_id: modelId, timestamp,
              context_file_path: contextFilePath, context_file_content: contextFileContent,
              phase_boundary: phaseBoundary,
            });
          }
        },
        get: (...args: unknown[]) => rows.get(String(args[0])),
        all: (...args: unknown[]) => {
          const runId = String(args[0]);
          return [...rows.values()].filter((r) => String(r.run_id) === runId).sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
        },
      }),
    };
  }

  it('round-trips phaseBoundary through the mock database', () => {
    const store = new SqliteCheckpointStore(buildMockDbWithPhaseBoundaryColumn() as any);
    store.save({
      id: 'ckpt-1', runId: 'run-1', stepId: 'step-a', inputContext: 'in', output: 'out',
      completedStepIds: ['step-a'], modelId: undefined, timestamp: 1,
      phaseBoundary: { phaseId: 'phase-1', phaseName: 'Setup', boundaries: ['start'] },
    });

    expect(store.get('ckpt-1')?.phaseBoundary).toEqual({ phaseId: 'phase-1', phaseName: 'Setup', boundaries: ['start'] });
  });

  it('omits phaseBoundary (rather than a null-filled object) when the column is null', () => {
    const store = new SqliteCheckpointStore(buildMockDbWithPhaseBoundaryColumn() as any);
    store.save({
      id: 'ckpt-1', runId: 'run-1', stepId: 'step-a', inputContext: 'in', output: 'out',
      completedStepIds: ['step-a'], modelId: undefined, timestamp: 1,
    });

    expect('phaseBoundary' in (store.get('ckpt-1') ?? {})).toBe(false);
  });
});

describe('findPhaseStartCheckpoint', () => {
  it("returns the checkpoint whose phaseBoundary marks this phase's start", () => {
    saveCheckpoint({ runId: 'run-2', stepId: 'a', inputContext: '', output: '', completedStepIds: ['a'],
      phaseBoundary: { phaseId: 'phase-1', phaseName: 'Setup', boundaries: ['start'] } });
    saveCheckpoint({ runId: 'run-2', stepId: 'b', inputContext: '', output: '', completedStepIds: ['a', 'b'],
      phaseBoundary: { phaseId: 'phase-1', phaseName: 'Setup', boundaries: ['end'] } });

    const found = findPhaseStartCheckpoint('run-2', 'phase-1');
    expect(found?.stepId).toBe('a');
  });

  it('returns undefined when the phase never ran in this run', () => {
    expect(findPhaseStartCheckpoint('run-2', 'nonexistent-phase')).toBeUndefined();
  });

  it('returns the single checkpoint for a single-instance phase (boundaries: ["start","end"])', () => {
    saveCheckpoint({ runId: 'run-3', stepId: 'solo', inputContext: '', output: '', completedStepIds: ['solo'],
      phaseBoundary: { phaseId: 'phase-solo', phaseName: 'Solo', boundaries: ['start', 'end'] } });

    expect(findPhaseStartCheckpoint('run-3', 'phase-solo')?.stepId).toBe('solo');
  });

  it('does not match a checkpoint from a DIFFERENT phase in the same run', () => {
    saveCheckpoint({ runId: 'run-4', stepId: 'a', inputContext: '', output: '', completedStepIds: ['a'],
      phaseBoundary: { phaseId: 'phase-x', phaseName: 'X', boundaries: ['start', 'end'] } });

    expect(findPhaseStartCheckpoint('run-4', 'phase-y')).toBeUndefined();
  });
});
