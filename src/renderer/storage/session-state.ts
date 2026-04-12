/**
 * Session State Storage (Renderer Process)
 *
 * Responsibility:
 * - Typed wrapper around browser sessionStorage for ephemeral state
 * - State that should NOT survive window close or crash
 *
 * Boundaries:
 * - Owns: active modal state, multi-step form progress, temporary search/filter values,
 *   unsaved draft content
 * - Does NOT own: anything that must survive a crash or window close
 *   (use ui-state for persistent UI state, settings/db via IPC for business data)
 *
 * Capacity: ~5-10 MB (browser limit)
 * Process: Renderer only — no IPC needed
 *
 * Warning: sessionStorage is wiped on window close. Never rely on it for data integrity.
 */

const PREFIX = 'heliox:session:';

// ─── Typed API ─────────────────────────────────────────────────────────────────

/**
 * Read a session state value. Returns the default if the key doesn't exist
 * or if parsing fails (corrupt state is silently replaced).
 */
export function sessionStateGet<T>(key: string, defaultValue: T): T {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (raw === null) return defaultValue;
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * Write a session state value. Values are JSON-serialized.
 * Passing undefined removes the key.
 */
export function sessionStateSet<T>(key: string, value: T): void {
  try {
    if (value === undefined) {
      sessionStorage.removeItem(PREFIX + key);
    } else {
      sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
    }
  } catch {
    // Silently ignore quota errors — session state is ephemeral
  }
}

/**
 * Remove a session state key.
 */
export function sessionStateRemove(key: string): void {
  sessionStorage.removeItem(PREFIX + key);
}

/**
 * Clear all heliox session state.
 * Does NOT affect other sessionStorage keys.
 */
export function sessionStateClear(): void {
  const keysToRemove: string[] = [];
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    if (key?.startsWith(PREFIX)) keysToRemove.push(key);
  }
  keysToRemove.forEach(k => sessionStorage.removeItem(k));
}
