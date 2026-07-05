/**
 * ingest.ts — Document ingestion: chunk + embed + persist to the vector store
 *
 * Design:
 * - `ingestDocument` is the core primitive: given a raw text document and a
 *   stable `docId`, it deletes any previously stored chunks for that docId,
 *   splits the text into overlapping chunks (~500–800 token windows with
 *   ~10–15% overlap), embeds each chunk using the shared embed helper from
 *   `retriever.ts`, and upserts them into the vector store using a stable id
 *   `${docId}#${index}`. Re-ingesting a document cleanly replaces its prior
 *   chunks with no duplicates or stale entries.
 * - `ingestFiles` reads text-like files (md/txt/code) and delegates to
 *   `ingestDocument`; binary files are detected heuristically and skipped.
 * - All dependencies (store, embedFn) are injectable for deterministic tests.
 *
 * Chunking strategy (v1 — heuristic, local-first):
 * - Approximate token count via `text.length / 4` (good enough for English).
 * - Target window: 600 tokens → ~2400 chars; overlap: 12.5% → ~300 chars.
 * - Paragraph-boundary-aware: prefer to split at double-newlines, then
 *   single-newlines, then word boundaries — falling back to hard splits only
 *   when a single "paragraph" is larger than the window.
 */

import { promises as fs } from 'fs';
import path from 'path';
import type { VectorStore } from './vector-store';
import { getVectorStore, upsertChunk } from './vector-store';
import type { EmbedFn } from '../retriever';
import { defaultEmbedFn } from '../retriever';

// ---------------------------------------------------------------------------
// Constants (all sizes in characters; 1 token ≈ 4 chars for English)
// ---------------------------------------------------------------------------

/** Target chunk size in characters (≈600 tokens). */
const CHUNK_TARGET_CHARS = 2400;

/** Overlap in characters (≈75 tokens, ~12.5% of target). */
const CHUNK_OVERLAP_CHARS = 300;

/** Max chunk size in characters — a paragraph this large is split hard. */
const CHUNK_MAX_CHARS = 3200;

// ---------------------------------------------------------------------------
// Text-like file extensions (anything else → skip)
// ---------------------------------------------------------------------------

const TEXT_EXTENSIONS = new Set([
  '.md', '.txt', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.yaml', '.yml', '.toml', '.ini', '.env',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.cpp', '.h',
  '.sh', '.bash', '.zsh', '.fish',
  '.html', '.htm', '.css', '.scss', '.sass', '.less',
  '.sql', '.graphql', '.proto',
  '.xml', '.csv',
  '.tf', '.hcl',
]);

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

/**
 * Split `text` into overlapping chunks that respect paragraph boundaries.
 *
 * Strategy:
 * 1. Split the document on paragraph breaks (double newlines).
 * 2. Accumulate paragraphs into a window until the window would exceed
 *    CHUNK_TARGET_CHARS.
 * 3. When flushing a window, retain CHUNK_OVERLAP_CHARS of trailing content
 *    as the start of the next window.
 * 4. A single paragraph larger than CHUNK_MAX_CHARS is hard-split at word
 *    boundaries, with the same overlap applied.
 *
 * Returns at least one chunk even for empty input (a single empty-string chunk).
 */
export function chunkText(text: string): string[] {
  if (text.trim().length === 0) {
    return [text];
  }

  // Split on paragraph boundaries (one or more blank lines)
  const paragraphs = text.split(/\n{2,}/);

  const chunks: string[] = [];
  let buffer = '';

  const flush = () => {
    const trimmed = buffer.trim();
    if (trimmed.length > 0) {
      chunks.push(trimmed);
    }
    // Carry over the tail of the buffer as the overlap for the next window
    if (buffer.length > CHUNK_OVERLAP_CHARS) {
      buffer = buffer.slice(buffer.length - CHUNK_OVERLAP_CHARS);
    }
    // (if buffer is already shorter than overlap, keep it all)
  };

  for (const paragraph of paragraphs) {
    const para = paragraph.trim();
    if (para.length === 0) continue;

    // If this single paragraph exceeds the max, hard-split it at word boundaries
    const subParts = para.length > CHUNK_MAX_CHARS
      ? hardSplit(para, CHUNK_TARGET_CHARS, CHUNK_OVERLAP_CHARS)
      : [para];

    for (const part of subParts) {
      const candidate = buffer.length > 0 ? `${buffer}\n\n${part}` : part;

      if (candidate.length > CHUNK_TARGET_CHARS && buffer.length > 0) {
        // Current buffer is large enough — flush before adding this part
        flush();
        buffer = part;
      } else {
        buffer = candidate;
      }

      // If even after flushing this part is still too large, keep going
      // (it will flush on the next iteration or at the end)
    }
  }

  // Flush any remaining content
  if (buffer.trim().length > 0) {
    chunks.push(buffer.trim());
  }

  return chunks.length > 0 ? chunks : [text.trim()];
}

/**
 * Hard-split a long string at word boundaries into segments of at most
 * `maxChars` characters, with `overlapChars` of overlap between segments.
 */
function hardSplit(text: string, maxChars: number, overlapChars: number): string[] {
  const words = text.split(/\s+/);
  const segments: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current.length > 0 ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current.length > 0) {
      segments.push(current.trim());
      // Overlap: find the boundary at overlapChars from the end of current
      const tail = current.length > overlapChars
        ? current.slice(current.length - overlapChars)
        : current;
      // Find the first word boundary in the tail
      const boundary = tail.indexOf(' ');
      current = boundary !== -1 ? `${tail.slice(boundary + 1)} ${word}` : word;
    } else {
      current = candidate;
    }
  }
  if (current.trim().length > 0) {
    segments.push(current.trim());
  }
  return segments.length > 0 ? segments : [text];
}

// ---------------------------------------------------------------------------
// ingestDocument
// ---------------------------------------------------------------------------

export interface IngestDocumentOptions {
  docId: string;
  text: string;
  source?: string;
}

/**
 * Chunk `text`, embed each chunk, and persist them into `store`.
 *
 * Re-ingesting the same `docId` cleanly deletes all prior chunks for that
 * docId before upserting the new set — no duplicates, no stale entries.
 *
 * @param opts     Document to ingest.
 * @param store    Injectable store (defaults to the module-level active store).
 * @param embedFn  Injectable embed function (defaults to the active embedFn from retriever).
 */
export async function ingestDocument(
  opts: IngestDocumentOptions,
  store: VectorStore = getVectorStore(),
  embedFn: EmbedFn = defaultEmbedFn,
): Promise<void> {
  const { docId, text, source } = opts;

  // 1. Delete any prior chunks for this docId (clean replace, no tombstones)
  store.deleteChunksByDocId(docId);

  // 2. Chunk
  const rawChunks = chunkText(text);

  // 3. Embed & upsert new chunks
  for (let i = 0; i < rawChunks.length; i++) {
    const chunkText_ = rawChunks[i];
    const embedding = await embedFn(chunkText_);

    store.upsertChunk({
      id: `${docId}#${i}`,
      docId,
      text: source ? `[source: ${source}]\n${chunkText_}` : chunkText_,
      embedding,
    });
  }
}

// ---------------------------------------------------------------------------
// ingestFiles
// ---------------------------------------------------------------------------

/**
 * Read text-like files (md/txt/code) and ingest each via `ingestDocument`.
 * Binaries and unrecognised extensions are skipped gracefully (no throw).
 *
 * @param paths    Absolute or relative file paths to ingest.
 * @param store    Injectable store (defaults to the module-level active store).
 * @param embedFn  Injectable embed function (defaults to the active embedFn from retriever).
 */
export async function ingestFiles(
  paths: string[],
  store: VectorStore = getVectorStore(),
  embedFn: EmbedFn = defaultEmbedFn,
): Promise<void> {
  for (const filePath of paths) {
    const ext = path.extname(filePath).toLowerCase();

    if (!TEXT_EXTENSIONS.has(ext)) {
      // Unknown extension — skip silently
      continue;
    }

    let text: string;
    try {
      text = await fs.readFile(filePath, 'utf-8');
    } catch {
      // File not readable (permission denied, not found, etc.) — skip
      continue;
    }

    // Heuristic binary detection: if the first 8 KB contains a NUL byte,
    // treat it as binary and skip.
    const sample = text.slice(0, 8192);
    if (sample.includes('\0')) {
      continue;
    }

    const docId = filePath; // Use the file path as the stable docId

    await ingestDocument({ docId, text, source: filePath }, store, embedFn);
  }
}
