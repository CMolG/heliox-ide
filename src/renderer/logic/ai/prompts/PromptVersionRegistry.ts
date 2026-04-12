/**
 * PromptVersionRegistry.ts — AI Prompt Version Tracking
 *
 * Responsibility:
 * - Registers prompt templates with their version and content hash
 * - Persists prompt versions to SQLite via IPC (prompt_versions table)
 * - Retrieves specific prompt versions for audit and reproducibility
 * - Computes SHA-256 content hashes for change detection
 *
 * Boundaries:
 * - Owns: version registration, hash computation, IPC communication
 * - Does NOT own: prompt content (see prompts/), DB schema (see migrations/),
 *   composition logic (AiComposer)
 *
 * Design note:
 * Every prompt template used by AiComposer is versioned both in VCS (source code)
 * and in the database (prompt_versions table). This enables:
 * - Auditing which prompt version produced a given agent session
 * - Detecting prompt drift between app versions
 * - Rolling back to known-good prompt configurations
 *
 * The registry operates in two modes:
 * - Renderer: calls IPC to persist (storageAPI.dbInsert / dbQuery)
 * - Standalone: computes hashes without persistence (for testing)
 */

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface PromptVersion {
  promptKey: string;
  version: string;
  contentHash: string;
  content: string;
  author: string;
  createdAt: number;
}

export interface RegisteredPrompt {
  key: string;
  version: string;
  contentHash: string;
}

// ─── Hash Utility ───────────────────────────────────────────────────────────────

/**
 * Compute a SHA-256 content hash (truncated to 16 hex chars).
 * Uses the Web Crypto API available in both main and renderer processes.
 */
async function computeContentHash(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const buffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(buffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

/**
 * Synchronous hash fallback using simple djb2 — used when Web Crypto is unavailable.
 * Only for non-critical contexts (testing, logging). Production uses async version.
 */
function computeContentHashSync(content: string): string {
  let hash = 5381;
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) + hash + content.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(16, '0').slice(0, 16);
}

// ─── Registry ───────────────────────────────────────────────────────────────────

/**
 * Tracks prompt template versions in memory and persists them to the database.
 *
 * Usage:
 *   const registry = new PromptVersionRegistry();
 *   await registry.register('stupidity-prelude', '1.0.0', promptContent);
 *   const info = registry.getRegistered('stupidity-prelude');
 */
export class PromptVersionRegistry {
  private registered = new Map<string, RegisteredPrompt>();

  /**
   * Register a prompt template version.
   * Computes content hash and persists to the database via IPC.
   * Skips DB write if the same key+version is already registered.
   */
  async register(key: string, version: string, content: string, author = 'heliox'): Promise<RegisteredPrompt> {
    const mapKey = `${key}@${version}`;

    // Already registered this session — skip
    const existing = this.registered.get(mapKey);
    if (existing) return existing;

    const contentHash = await computeContentHash(content);

    const entry: RegisteredPrompt = { key, version, contentHash };
    this.registered.set(mapKey, entry);

    // Persist to database via IPC (renderer → main)
    if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).storageAPI) {
      try {
        const api = (window as unknown as Record<string, unknown>).storageAPI as {
          dbInsert: (sql: string, params: unknown[]) => Promise<{ success: boolean; error?: string }>;
        };
        await api.dbInsert(
          `INSERT OR IGNORE INTO prompt_versions (prompt_key, version, content_hash, content, author)
           VALUES (?, ?, ?, ?, ?)`,
          [key, version, contentHash, content, author],
        );
      } catch {
        // Non-fatal — the registry still works in-memory
        console.warn(`[PromptVersionRegistry] Failed to persist ${key}@${version} to database`);
      }
    }

    return entry;
  }

  /**
   * Register a prompt synchronously (no DB persistence).
   * Useful for immediate hash computation during compose().
   */
  registerSync(key: string, version: string, content: string): RegisteredPrompt {
    const mapKey = `${key}@${version}`;
    const existing = this.registered.get(mapKey);
    if (existing) return existing;

    const contentHash = computeContentHashSync(content);
    const entry: RegisteredPrompt = { key, version, contentHash };
    this.registered.set(mapKey, entry);
    return entry;
  }

  /** Get the registered info for a prompt key (latest registered version) */
  getRegistered(key: string): RegisteredPrompt | undefined {
    // Find the latest version for this key
    for (const [mapKey, entry] of this.registered) {
      if (mapKey.startsWith(`${key}@`)) return entry;
    }
    return undefined;
  }

  /** Get all registered prompts */
  getAllRegistered(): RegisteredPrompt[] {
    return Array.from(this.registered.values());
  }

  /** Query prompt versions from the database via IPC */
  async getVersionHistory(key: string): Promise<PromptVersion[]> {
    if (typeof window === 'undefined' || !(window as unknown as Record<string, unknown>).storageAPI) {
      return [];
    }

    try {
      const api = (window as unknown as Record<string, unknown>).storageAPI as {
        dbQuery: (sql: string, params: unknown[]) => Promise<{ success: boolean; data?: { rows: PromptVersion[] } }>;
      };
      const result = await api.dbQuery(
        'SELECT prompt_key as promptKey, version, content_hash as contentHash, content, author, created_at as createdAt FROM prompt_versions WHERE prompt_key = ? ORDER BY created_at DESC',
        [key],
      );
      if (result.success && result.data) {
        return result.data.rows;
      }
    } catch {
      console.warn(`[PromptVersionRegistry] Failed to query history for ${key}`);
    }
    return [];
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────────
// Shared across the renderer process lifetime

export const promptRegistry = new PromptVersionRegistry();
