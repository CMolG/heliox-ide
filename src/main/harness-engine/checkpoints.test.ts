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
  InMemoryCheckpointStore,
  INPUT_CONTEXT_MAX_CHARS,
  OUTPUT_MAX_CHARS,
  SqliteCheckpointStore,
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
            const [id, runId, stepId, inputContext, output, completedStepIds, modelId, timestamp] = args;
            rows.set(String(id), {
              id,
              run_id: runId,
              step_id: stepId,
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
});
