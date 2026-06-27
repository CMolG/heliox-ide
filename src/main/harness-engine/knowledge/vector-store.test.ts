/**
 * vector-store.test.ts — Unit tests for InMemoryVectorStore + cosine ranking
 *
 * All tests use InMemoryVectorStore directly — no SQLite dependency, fully
 * deterministic, offline-capable. SqliteVectorStore.deleteChunksByDocId is
 * tested via a lightweight in-memory mock of BetterSqliteDatabase.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryVectorStore,
  SqliteVectorStore,
  cosineSimilarity,
  type Chunk,
} from './vector-store';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a unit vector pointing in a single axis direction. */
function axisVec(dim: number, axis: number): number[] {
  const v = new Array<number>(dim).fill(0);
  v[axis] = 1;
  return v;
}

/** Build a chunk with a given id and embedding (text and docId are minimal). */
function makeChunk(id: string, embedding: number[], docId = 'doc-1'): Chunk {
  return { id, docId, text: `Text for ${id}`, embedding };
}

// ---------------------------------------------------------------------------
// cosineSimilarity
// ---------------------------------------------------------------------------

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical unit vectors', () => {
    const v = axisVec(4, 0);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 6);
  });

  it('returns 0.0 for orthogonal vectors', () => {
    expect(cosineSimilarity(axisVec(4, 0), axisVec(4, 1))).toBeCloseTo(0.0, 6);
  });

  it('returns -1.0 for opposing unit vectors', () => {
    const a = [1, 0];
    const b = [-1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 6);
  });

  it('returns 0.0 when one vector has zero magnitude', () => {
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
  });

  it('computes correct similarity for non-unit vectors', () => {
    // [3, 4] and [6, 8] are parallel → cosine 1.0
    expect(cosineSimilarity([3, 4], [6, 8])).toBeCloseTo(1.0, 6);
  });
});

// ---------------------------------------------------------------------------
// InMemoryVectorStore
// ---------------------------------------------------------------------------

describe('InMemoryVectorStore', () => {
  let store: InMemoryVectorStore;

  beforeEach(() => {
    store = new InMemoryVectorStore();
  });

  it('returns [] when the store is empty', () => {
    expect(store.search(axisVec(4, 0), 5)).toEqual([]);
  });

  it('ranks 3 chunks correctly by cosine similarity', () => {
    // Three axis-aligned chunks in 4 dimensions
    const chunkA = makeChunk('a', axisVec(4, 0)); // cosine(query=[1,0,0,0]) = 1.0
    const chunkB = makeChunk('b', axisVec(4, 1)); // cosine = 0.0
    const chunkC = makeChunk('c', axisVec(4, 2)); // cosine = 0.0

    store.upsertChunk(chunkA);
    store.upsertChunk(chunkB);
    store.upsertChunk(chunkC);

    const query = axisVec(4, 0); // aligned with chunkA
    const results = store.search(query, 3);

    expect(results[0].id).toBe('a');
    expect(results[0].score).toBeCloseTo(1.0, 6);
    // B and C have score 0.0 — both present (order between them doesn't matter)
    expect(results.map((r) => r.id)).toContain('b');
    expect(results.map((r) => r.id)).toContain('c');
  });

  it('respects the k limit', () => {
    for (let i = 0; i < 10; i++) {
      store.upsertChunk(makeChunk(`chunk-${i}`, axisVec(10, i)));
    }
    expect(store.search(axisVec(10, 0), 3)).toHaveLength(3);
  });

  it('upsert overwrites an existing chunk with the same id', () => {
    store.upsertChunk(makeChunk('x', axisVec(4, 0)));
    // Overwrite with a different embedding
    store.upsertChunk({ id: 'x', docId: 'doc-2', text: 'Updated text', embedding: axisVec(4, 1) });

    const results = store.search(axisVec(4, 1), 1);
    expect(results[0].id).toBe('x');
    expect(results[0].docId).toBe('doc-2');
    expect(results[0].text).toBe('Updated text');
    expect(results[0].score).toBeCloseTo(1.0, 6);
  });

  it('returns scored chunks with all expected fields', () => {
    store.upsertChunk({ id: 'z', docId: 'my-doc', text: 'Hello world', embedding: axisVec(4, 0) });
    const [result] = store.search(axisVec(4, 0), 1);

    expect(result).toMatchObject({
      id: 'z',
      docId: 'my-doc',
      text: 'Hello world',
    });
    expect(typeof result.score).toBe('number');
  });

  it('correctly ranks a chunk with a diagonal query vector', () => {
    // Diagonal query [1,1,0,0] is closer to a=axisVec(4,0) and b=axisVec(4,1)
    // than c=axisVec(4,2) (orthogonal)
    store.upsertChunk(makeChunk('a', axisVec(4, 0)));
    store.upsertChunk(makeChunk('b', axisVec(4, 1)));
    store.upsertChunk(makeChunk('c', axisVec(4, 2)));

    const diagonal = [1 / Math.SQRT2, 1 / Math.SQRT2, 0, 0];
    const results = store.search(diagonal, 3);

    // a and b should both score ~0.707, c should score 0
    expect(results[0].score).toBeCloseTo(1 / Math.SQRT2, 4);
    expect(results[1].score).toBeCloseTo(1 / Math.SQRT2, 4);
    expect(results[2].score).toBeCloseTo(0, 6);
    expect(results[2].id).toBe('c');
  });

  it('deleteChunksByDocId removes only chunks for the targeted docId', () => {
    store.upsertChunk(makeChunk('a', axisVec(4, 0), 'doc-target'));
    store.upsertChunk(makeChunk('b', axisVec(4, 1), 'doc-target'));
    store.upsertChunk(makeChunk('c', axisVec(4, 2), 'doc-other'));

    store.deleteChunksByDocId('doc-target');

    // doc-target chunks are gone
    const allResults = store.search([1, 1, 1, 0], 10);
    expect(allResults.some((r) => r.docId === 'doc-target')).toBe(false);

    // doc-other chunk remains
    expect(allResults.some((r) => r.id === 'c')).toBe(true);
  });

  it('deleteChunksByDocId is a no-op when the docId has no chunks', () => {
    store.upsertChunk(makeChunk('a', axisVec(4, 0), 'doc-present'));
    // Should not throw for a docId that doesn't exist
    expect(() => store.deleteChunksByDocId('doc-absent')).not.toThrow();
    // doc-present is unaffected
    const results = store.search(axisVec(4, 0), 5);
    expect(results).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// SqliteVectorStore.deleteChunksByDocId (mock-backed)
// ---------------------------------------------------------------------------

/**
 * Minimal in-memory mock of BetterSqliteDatabase.
 * Stores rows in a JS array so SqliteVectorStore.deleteChunksByDocId can be
 * verified without a native better-sqlite3 dependency.
 */
function makeMockDb() {
  // Each row mirrors the SQLite schema: id, doc_id, text, embedding (Buffer), created_at
  const rows: Array<{ id: string; doc_id: string; text: string; embedding: Buffer; created_at: number }> = [];

  return {
    exec: () => { /* CREATE TABLE — no-op in mock */ },
    prepare: (sql: string) => ({
      run: (...args: unknown[]) => {
        const s = sql.trim().toUpperCase();
        if (s.startsWith('INSERT')) {
          const [id, doc_id, text, embedding, created_at] = args as [string, string, string, Buffer, number];
          const existing = rows.findIndex((r) => r.id === id);
          if (existing !== -1) {
            rows[existing] = { id, doc_id, text, embedding, created_at };
          } else {
            rows.push({ id, doc_id, text, embedding, created_at });
          }
        } else if (s.startsWith('DELETE')) {
          // DELETE FROM chunks WHERE doc_id = ?
          const docId = args[0] as string;
          let i = rows.length;
          while (i--) {
            if (rows[i].doc_id === docId) rows.splice(i, 1);
          }
        }
      },
      get: () => undefined,
      all: () => [...rows],
    }),
  };
}

describe('SqliteVectorStore.deleteChunksByDocId', () => {
  it('removes only chunks for the targeted docId; others remain', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new SqliteVectorStore(makeMockDb() as any);

    store.upsertChunk({ id: 'a', docId: 'doc-target', text: 'A', embedding: axisVec(4, 0) });
    store.upsertChunk({ id: 'b', docId: 'doc-target', text: 'B', embedding: axisVec(4, 1) });
    store.upsertChunk({ id: 'c', docId: 'doc-other', text: 'C', embedding: axisVec(4, 2) });

    store.deleteChunksByDocId('doc-target');

    const results = store.search([1, 1, 1, 0], 10);
    expect(results.some((r) => r.docId === 'doc-target')).toBe(false);
    expect(results.some((r) => r.id === 'c')).toBe(true);
  });

  it('is a no-op when the docId has no chunks', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new SqliteVectorStore(makeMockDb() as any);

    store.upsertChunk({ id: 'a', docId: 'doc-present', text: 'A', embedding: axisVec(4, 0) });
    expect(() => store.deleteChunksByDocId('doc-absent')).not.toThrow();

    const results = store.search(axisVec(4, 0), 5);
    expect(results).toHaveLength(1);
  });
});
