/**
 * retriever.ts — Query the local vector store for semantically similar chunks
 *
 * Design:
 * - `EmbedFn` is injectable so callers (tests) can supply a deterministic
 *   synchronous embedding function without hitting a real model endpoint.
 * - The default `embedFn` is a lightweight stub that hashes the query string
 *   into a fixed-dimension unit vector; it is offline-capable and deterministic.
 *   Production callers should inject a real embedding provider (Ollama-compatible,
 *   OpenAI-compatible, or AI SDK `embed`) via `setDefaultEmbedFn` at startup.
 * - `retrieve` never throws on an empty store — returns `{ chunks: [] }`.
 *
 * Integration:
 * - executor.ts calls `retrieve(step.prompt, k)` for `type === 'retriever'` steps.
 * - The returned `RetrievedChunk[]` is passed to `buildStepContext` as
 *   `injectedChunks`, surfaced in the user prompt under <retrieved_context>.
 */

import type { ScoredChunk, VectorStore } from './knowledge/vector-store';
import { getVectorStore } from './knowledge/vector-store';

// ---------------------------------------------------------------------------
// Embedding function interface
// ---------------------------------------------------------------------------

/** Embed a string query into a numeric vector. May be async. */
export type EmbedFn = (text: string) => number[] | Promise<number[]>;

// ---------------------------------------------------------------------------
// Default offline-capable embed function
// ---------------------------------------------------------------------------

/**
 * Deterministic default embedder — produces a normalised 128-dim vector by
 * hashing the input string using a simple polynomial rolling hash spread over
 * 128 buckets. Produces zero vectors for empty strings.
 *
 * Accuracy: sufficient to distinguish different strings (different hashes →
 * different vectors → low cosine); identical strings → cosine 1.0. Not
 * semantically meaningful — inject a real model for production use.
 */
export function defaultEmbedFn(text: string): number[] {
  const DIM = 128;
  const vec = new Array<number>(DIM).fill(0);
  if (text.length === 0) return vec;

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // Polynomial rolling hash: bucket index cycles through dims
    const bucket = (i * 31 + code * 17) % DIM;
    vec[bucket] += code;
  }

  // Normalise to unit length
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (mag === 0) return vec;
  return vec.map((v) => v / mag);
}

// ---------------------------------------------------------------------------
// Module-level embed function (swappable at startup)
// ---------------------------------------------------------------------------

let activeEmbedFn: EmbedFn = defaultEmbedFn;

/**
 * Replace the embedding function used by `retrieve`.
 *
 * Inject a real provider (Ollama, OpenAI-compatible, AI SDK `embed`) at
 * app startup. In tests supply a deterministic fn for reproducible results.
 *
 * @example — AI SDK with Ollama-compatible local model:
 *   import { embed } from 'ai';
 *   import { createOpenAI } from '@ai-sdk/openai';
 *   const ollama = createOpenAI({ baseURL: 'http://localhost:11434/v1', apiKey: 'ollama' });
 *   setDefaultEmbedFn((text) =>
 *     embed({ model: ollama.embedding('nomic-embed-text'), value: text })
 *       .then((r) => Array.from(r.embedding))
 *   );
 */
export function setDefaultEmbedFn(fn: EmbedFn): void {
  activeEmbedFn = fn;
}

// ---------------------------------------------------------------------------
// Public result type
// ---------------------------------------------------------------------------

export interface RetrievedChunk {
  text: string;
  score: number;
  docId: string;
}

export interface RetrieveResult {
  chunks: RetrievedChunk[];
}

// ---------------------------------------------------------------------------
// retrieve
// ---------------------------------------------------------------------------

/**
 * Embed `query` and return the top-k most similar chunks from the vector store.
 *
 * @param query  The natural-language query string (e.g. `step.prompt`).
 * @param k      Maximum number of chunks to return (default: 5).
 * @param store  Injectable store — defaults to the module-level active store
 *               so tests can supply an isolated instance without global state.
 * @param embedFn Injectable embedding function — defaults to `activeEmbedFn`.
 *
 * @returns `{ chunks: [] }` when the store is empty (never throws).
 */
export async function retrieve(
  query: string,
  k = 5,
  store: VectorStore = getVectorStore(),
  embedFn: EmbedFn = activeEmbedFn,
): Promise<RetrieveResult> {
  try {
    const embedding = await embedFn(query);
    const scored: ScoredChunk[] = store.search(embedding, k);

    return {
      chunks: scored.map((c) => ({
        text: c.text,
        score: c.score,
        docId: c.docId,
      })),
    };
  } catch {
    // Degrade gracefully — an empty store or embedding error must not crash the flow.
    return { chunks: [] };
  }
}
