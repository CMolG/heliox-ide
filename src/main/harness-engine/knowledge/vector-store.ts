/**
 * vector-store.ts — SQLite-backed vector store with injectable storage backend
 *
 * Design:
 * - `VectorStore` is a pure interface so tests and production use different backends.
 * - `InMemoryVectorStore` is the default — zero native deps, fast in tests.
 * - `SqliteVectorStore` accepts a `better-sqlite3` Database instance injected by
 *   the caller (keeps Electron native-module concerns out of this module).
 * - Cosine similarity is computed in JS over stored Float32 vectors (v1 — fine up
 *   to thousands of chunks; flag ARCH-070 if scale becomes a concern).
 *
 * Schema: chunks(id TEXT PK, doc_id TEXT, text TEXT, embedding BLOB, created_at INTEGER)
 */

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export interface Chunk {
  id: string;
  docId: string;
  text: string;
  embedding: number[];
}

export interface ScoredChunk {
  id: string;
  docId: string;
  text: string;
  score: number;
}

// ---------------------------------------------------------------------------
// Vector math
// ---------------------------------------------------------------------------

/**
 * Cosine similarity between two equal-length vectors.
 * Returns 0 when either vector has zero magnitude (avoids division by zero).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

/** Injectable vector store backend. */
export interface VectorStore {
  /** Insert or update a chunk. */
  upsertChunk(chunk: Chunk): void;
  /**
   * Return the top-k chunks most similar to `queryEmbedding` by cosine
   * similarity, sorted descending. Returns an empty array when the store is
   * empty.
   */
  search(queryEmbedding: number[], k: number): ScoredChunk[];
  /** Delete all chunks belonging to `docId`. No-op if none exist. */
  deleteChunksByDocId(docId: string): void;
}

// ---------------------------------------------------------------------------
// In-memory store (default — zero deps, deterministic in tests)
// ---------------------------------------------------------------------------

export class InMemoryVectorStore implements VectorStore {
  private readonly chunks = new Map<string, Chunk>();

  upsertChunk(chunk: Chunk): void {
    this.chunks.set(chunk.id, { ...chunk });
  }

  search(queryEmbedding: number[], k: number): ScoredChunk[] {
    const results: ScoredChunk[] = [];

    for (const chunk of this.chunks.values()) {
      const score = cosineSimilarity(queryEmbedding, chunk.embedding);
      results.push({
        id: chunk.id,
        docId: chunk.docId,
        text: chunk.text,
        score,
      });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, k);
  }

  deleteChunksByDocId(docId: string): void {
    for (const [id, chunk] of this.chunks) {
      if (chunk.docId === docId) {
        this.chunks.delete(id);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// SQLite-backed store (production — requires better-sqlite3 native module)
// ---------------------------------------------------------------------------

interface BetterSqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...args: unknown[]): unknown;
    get(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown[];
  };
}

/** Serialise a Float32 embedding as a raw BLOB (little-endian IEEE 754). */
function embeddingToBlob(embedding: number[]): Buffer {
  const buf = Buffer.allocUnsafe(embedding.length * 4);
  for (let i = 0; i < embedding.length; i++) {
    buf.writeFloatLE(embedding[i], i * 4);
  }
  return buf;
}

/** Deserialise a BLOB back to a number array. */
function blobToEmbedding(blob: Buffer): number[] {
  const result: number[] = [];
  for (let i = 0; i < blob.length; i += 4) {
    result.push(blob.readFloatLE(i));
  }
  return result;
}

/**
 * SQLite-backed vector store.
 *
 * Pass a `better-sqlite3` Database instance from the caller; the module never
 * imports `better-sqlite3` itself so it stays side-effect-free in tests.
 *
 * @example
 *   import Database from 'better-sqlite3';
 *   const db = new Database('heliox.db');
 *   const store = new SqliteVectorStore(db);
 */
export class SqliteVectorStore implements VectorStore {
  private readonly db: BetterSqliteDatabase;

  constructor(db: BetterSqliteDatabase) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id         TEXT PRIMARY KEY,
        doc_id     TEXT NOT NULL,
        text       TEXT NOT NULL,
        embedding  BLOB NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  }

  upsertChunk(chunk: Chunk): void {
    this.db.prepare(`
      INSERT INTO chunks (id, doc_id, text, embedding, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        doc_id     = excluded.doc_id,
        text       = excluded.text,
        embedding  = excluded.embedding,
        created_at = excluded.created_at
    `).run(
      chunk.id,
      chunk.docId,
      chunk.text,
      embeddingToBlob(chunk.embedding),
      Date.now(),
    );
  }

  search(queryEmbedding: number[], k: number): ScoredChunk[] {
    const rows = this.db.prepare(
      'SELECT id, doc_id, text, embedding FROM chunks',
    ).all() as Array<{ id: string; doc_id: string; text: string; embedding: Buffer }>;

    const scored: ScoredChunk[] = rows.map((row) => ({
      id: row.id,
      docId: row.doc_id,
      text: row.text,
      score: cosineSimilarity(queryEmbedding, blobToEmbedding(row.embedding)),
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }

  deleteChunksByDocId(docId: string): void {
    this.db.prepare('DELETE FROM chunks WHERE doc_id = ?').run(docId);
  }
}

// ---------------------------------------------------------------------------
// Module-level store (defaults to in-memory; swap at startup for production)
// ---------------------------------------------------------------------------

let activeStore: VectorStore = new InMemoryVectorStore();

/**
 * Replace the active vector store.
 *
 * Call this once during app startup to switch from the default in-memory store
 * to a SQLite-backed store (or any other VectorStore implementation).
 *
 * @example
 *   import Database from 'better-sqlite3';
 *   import { SqliteVectorStore, setVectorStore } from './knowledge/vector-store';
 *   setVectorStore(new SqliteVectorStore(new Database('heliox.db')));
 */
export function setVectorStore(store: VectorStore): void {
  activeStore = store;
}

/** Return the currently active store (useful for direct access in retriever). */
export function getVectorStore(): VectorStore {
  return activeStore;
}

/** Convenience wrappers delegating to the active store. */
export function upsertChunk(chunk: Chunk): void {
  activeStore.upsertChunk(chunk);
}

export function searchChunks(queryEmbedding: number[], k: number): ScoredChunk[] {
  return activeStore.search(queryEmbedding, k);
}

export function deleteChunksByDocId(docId: string): void {
  activeStore.deleteChunksByDocId(docId);
}
