/**
 * checkpoints.ts — Immutable per-step checkpoint persistence
 *
 * Persists a snapshot of executor state after each step completes, enabling
 * time-travel debugging (rewind → edit → fork). Records are immutable once
 * written; only reads are allowed after creation.
 *
 * Storage is injectable: the default is an in-memory store (safe for tests
 * and dev), with an optional better-sqlite3 backing for production use.
 *
 * Field size limits:
 *   - `inputContext`  max 64 KiB (65_536 chars) — trimmed with a marker
 *   - `output`        max 32 KiB (32_768 chars) — trimmed with a marker
 *   - `completedStepIds` serialised as JSON; no separate cap (step-count bounded)
 */

/** Max character length for the inputContext field before truncation. */
export const INPUT_CONTEXT_MAX_CHARS = 65_536;
/** Max character length for the output field before truncation. */
export const OUTPUT_MAX_CHARS = 32_768;
const TRUNCATION_MARKER = '…[truncated]';

/** Immutable snapshot recorded after a step completes. */
export interface Checkpoint {
  /** Unique checkpoint id — `ckpt_<runId>_<stepId>_<timestamp>`. */
  id: string;
  /** The run (flow execution) this checkpoint belongs to. */
  runId: string;
  /** The step whose completion triggered this checkpoint. */
  stepId: string;
  /** Serialised system+user prompts fed to the step (size-capped). */
  inputContext: string;
  /** LLM output produced by the step (size-capped). */
  output: string;
  /** Ordered list of all step ids completed up to and including this step. */
  completedStepIds: string[];
  /** Model id used for the step, if known. */
  modelId: string | undefined;
  /** Unix epoch milliseconds when the checkpoint was recorded. */
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Truncation helper
// ---------------------------------------------------------------------------

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return value.slice(0, maxChars - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
}

// ---------------------------------------------------------------------------
// Injectable store interface
// ---------------------------------------------------------------------------

/** Injectable storage backend for checkpoints. */
export interface CheckpointStore {
  /** Write an immutable checkpoint record. Called once per step completion. */
  save(checkpoint: Checkpoint): void;
  /** Return all checkpoints for a run, in creation order. */
  list(runId: string): Checkpoint[];
  /** Return a single checkpoint by id, or undefined if not found. */
  get(id: string): Checkpoint | undefined;
}

// ---------------------------------------------------------------------------
// In-memory store (default — zero dependencies, fast in tests)
// ---------------------------------------------------------------------------

export class InMemoryCheckpointStore implements CheckpointStore {
  private readonly records = new Map<string, Checkpoint>();

  save(checkpoint: Checkpoint): void {
    this.records.set(checkpoint.id, checkpoint);
  }

  list(runId: string): Checkpoint[] {
    return [...this.records.values()]
      .filter((c) => c.runId === runId)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  get(id: string): Checkpoint | undefined {
    return this.records.get(id);
  }
}

// ---------------------------------------------------------------------------
// SQLite store (production — requires better-sqlite3 native module)
// ---------------------------------------------------------------------------

interface BetterSqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...args: unknown[]): unknown;
    get(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown[];
  };
}

/**
 * SQLite-backed checkpoint store.
 *
 * Accepts a `better-sqlite3` Database instance rather than importing it
 * directly so Electron's native module loading is the caller's concern and
 * tests can remain dependency-free.
 */
export class SqliteCheckpointStore implements CheckpointStore {
  private readonly db: BetterSqliteDatabase;

  constructor(db: BetterSqliteDatabase) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS harness_checkpoints (
        id               TEXT PRIMARY KEY,
        run_id           TEXT NOT NULL,
        step_id          TEXT NOT NULL,
        input_context    TEXT NOT NULL,
        output           TEXT NOT NULL,
        completed_step_ids TEXT NOT NULL,
        model_id         TEXT,
        timestamp        INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_checkpoints_run_id
        ON harness_checkpoints (run_id, timestamp);
    `);
  }

  save(checkpoint: Checkpoint): void {
    this.db.prepare(`
      INSERT INTO harness_checkpoints
        (id, run_id, step_id, input_context, output, completed_step_ids, model_id, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      checkpoint.id,
      checkpoint.runId,
      checkpoint.stepId,
      checkpoint.inputContext,
      checkpoint.output,
      JSON.stringify(checkpoint.completedStepIds),
      checkpoint.modelId ?? null,
      checkpoint.timestamp,
    );
  }

  list(runId: string): Checkpoint[] {
    const rows = this.db.prepare(`
      SELECT * FROM harness_checkpoints
      WHERE run_id = ?
      ORDER BY timestamp ASC
    `).all(runId) as Array<Record<string, unknown>>;
    return rows.map((row) => this.rowToCheckpoint(row));
  }

  get(id: string): Checkpoint | undefined {
    const row = this.db.prepare(`
      SELECT * FROM harness_checkpoints WHERE id = ?
    `).get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToCheckpoint(row) : undefined;
  }

  private rowToCheckpoint(row: Record<string, unknown>): Checkpoint {
    return {
      id: String(row.id),
      runId: String(row.run_id),
      stepId: String(row.step_id),
      inputContext: String(row.input_context),
      output: String(row.output),
      completedStepIds: JSON.parse(String(row.completed_step_ids)) as string[],
      modelId: row.model_id != null ? String(row.model_id) : undefined,
      timestamp: Number(row.timestamp),
    };
  }
}

// ---------------------------------------------------------------------------
// Module-level store (defaults to in-memory; can be swapped at startup)
// ---------------------------------------------------------------------------

let activeStore: CheckpointStore = new InMemoryCheckpointStore();

/**
 * Replace the active checkpoint store.
 *
 * Call this once during app startup to switch from the in-memory default to
 * a SQLite-backed store (or any other implementation).
 *
 * @example
 *   import Database from 'better-sqlite3';
 *   import { SqliteCheckpointStore, setCheckpointStore } from './checkpoints';
 *   setCheckpointStore(new SqliteCheckpointStore(new Database('heliox.db')));
 */
export function setCheckpointStore(store: CheckpointStore): void {
  activeStore = store;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a unique checkpoint id.
 * Format: `ckpt_<runId>_<stepId>_<timestamp>` — readable in logs.
 */
function buildCheckpointId(runId: string, stepId: string, timestamp: number): string {
  return `ckpt_${runId}_${stepId}_${timestamp}`;
}

export interface SaveCheckpointInput {
  runId: string;
  stepId: string;
  inputContext: string;
  output: string;
  completedStepIds: string[];
  modelId?: string;
}

/**
 * Persist an immutable checkpoint after a step completes.
 *
 * Large fields (`inputContext`, `output`) are automatically truncated at
 * their respective limits before storage so the store never receives
 * unbounded blobs.
 *
 * @returns The persisted Checkpoint record (with the generated id).
 */
export function saveCheckpoint(input: SaveCheckpointInput): Checkpoint {
  const timestamp = Date.now();
  const checkpoint: Checkpoint = {
    id: buildCheckpointId(input.runId, input.stepId, timestamp),
    runId: input.runId,
    stepId: input.stepId,
    inputContext: truncate(input.inputContext, INPUT_CONTEXT_MAX_CHARS),
    output: truncate(input.output, OUTPUT_MAX_CHARS),
    completedStepIds: input.completedStepIds,
    modelId: input.modelId,
    timestamp,
  };
  activeStore.save(checkpoint);
  return checkpoint;
}

/**
 * Return all checkpoints for a run, ordered by creation time (oldest first).
 */
export function listCheckpoints(runId: string): Checkpoint[] {
  return activeStore.list(runId);
}

/**
 * Return a single checkpoint by id.
 *
 * @returns The checkpoint or undefined if not found.
 */
export function getCheckpoint(id: string): Checkpoint | undefined {
  return activeStore.get(id);
}
