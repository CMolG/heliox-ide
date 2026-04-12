/**
 * UI State Storage (Renderer Process)
 *
 * Responsibility:
 * - Typed wrapper around browser localStorage for non-critical UI state
 * - State that should survive app restarts but is NOT business-critical
 *
 * Boundaries:
 * - Owns: sidebar collapsed state, last active tab, layout preferences, non-critical flags
 * - Does NOT own: business data (use db via IPC), user preferences (use settings via IPC),
 *   or temporary form state (use session-state.ts)
 *
 * Capacity: ~5-10 MB (browser limit)
 * Process: Renderer only — no IPC needed
 *
 * Warning: localStorage can be cleared by the OS in low-storage scenarios.
 * Never store data here that the user cannot afford to lose.
 */

const PREFIX = 'heliox:ui:';

// ─── Typed API ─────────────────────────────────────────────────────────────────

/**
 * Read a UI state value from localStorage.
 * Returns the parsed value, or the provided default if the key doesn't exist
 * or parsing fails (corrupt data is silently replaced by the default).
 */
export function uiStateGet<T>(key: string, defaultValue: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return defaultValue;
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * Write a UI state value to localStorage.
 * Values are JSON-serialized. Passing undefined removes the key.
 */
export function uiStateSet<T>(key: string, value: T): void {
  try {
    if (value === undefined) {
      localStorage.removeItem(PREFIX + key);
    } else {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    }
  } catch {
    // Silently ignore quota errors — UI state is non-critical
  }
}

/**
 * Remove a UI state key from localStorage.
 */
export function uiStateRemove(key: string): void {
  localStorage.removeItem(PREFIX + key);
}

/**
 * Clear all heliox UI state from localStorage.
 * Does NOT affect other localStorage keys (Zustand stores, etc.).
 */
export function uiStateClear(): void {
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(PREFIX)) keysToRemove.push(key);
  }
  keysToRemove.forEach(k => localStorage.removeItem(k));
}
