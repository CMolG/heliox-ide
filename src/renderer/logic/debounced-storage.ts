/**
 * debounced-storage.ts — Renderer UI
 *
 * Architecture note:
 * This file follows the explanatory style used across the codebase:
 * explicit intent, clear boundaries, and behavior-preserving structure.
 */
// src/renderer/logic/debounced-storage.ts — Debounced StateStorage wrapper for zustand persist
//
// WHY THIS EXISTS:
// zustand's `persist` middleware calls the configured storage's `setItem`
// SYNCHRONOUSLY on every single `set()` that touches persisted state: it
// JSON.stringifies the entire `partialize`d snapshot and writes it straight to
// the underlying storage (localStorage by default) before `set()` returns.
// desktop-store's partialize now includes `boards[]` — the full mental graph
// of EVERY board, not just the one on screen — so that payload scales with
// the whole session, not just what's visible. Combined with high-frequency
// callers (per-frame drag via updateMentalNode, canvas pan/zoom ticks), this
// turns routine mouse movement into a stringify + synchronous localStorage
// write of a growing multi-board blob on every tick.
//
// This wrapper sits between zustand's `createJSONStorage` and the real
// storage: it debounces `setItem` per key with a trailing timer (default
// ~500ms) so a burst of writes collapses into exactly one write to the
// underlying storage. `getItem` stays read-your-writes consistent — it
// returns a still-pending value immediately instead of the stale
// already-flushed one. Pending writes are flushed synchronously on
// `beforeunload` and on `visibilitychange` -> 'hidden' so closing the
// app/tab never drops the last ~500ms of changes, and `flush()` is exposed
// as an escape hatch for deterministic tests.
import type { StateStorage } from 'zustand/middleware';

export class DebouncedStorage implements StateStorage {
  private readonly storage: StateStorage;
  private readonly delay: number;
  /** Most recent NOT-YET-FLUSHED value per key — lets getItem stay read-your-writes consistent. */
  private readonly pending = new Map<string, string>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(storage: StateStorage, delay: number = 500) {
    this.storage = storage;
    this.delay = delay;

    // Flush any in-flight debounced writes before the page/app can unload or
    // go to the background — otherwise the trailing timer never fires and
    // the last ~500ms of state changes are silently lost. Registered once,
    // here, per instance (never re-registered on individual setItem calls).
    // Guarded for non-browser contexts (SSR-ish setups, non-DOM test runs).
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => this.flush());
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.flush();
      });
    }
  }

  getItem(name: string): string | null | Promise<string | null> {
    // Read-your-writes: a still-pending value always wins over whatever is
    // currently sitting in the underlying storage.
    const pendingValue = this.pending.get(name);
    if (pendingValue !== undefined) return pendingValue;
    return this.storage.getItem(name);
  }

  setItem(name: string, value: string): void {
    this.pending.set(name, value);
    const existingTimer = this.timers.get(name);
    if (existingTimer !== undefined) clearTimeout(existingTimer);
    const timer = setTimeout(() => this.flushKey(name), this.delay);
    this.timers.set(name, timer);
  }

  removeItem(name: string): void {
    // Cancel any pending debounced write for this key — otherwise it would
    // resurrect the just-removed entry a moment later when the timer fires.
    const existingTimer = this.timers.get(name);
    if (existingTimer !== undefined) clearTimeout(existingTimer);
    this.timers.delete(name);
    this.pending.delete(name);
    this.storage.removeItem(name);
  }

  /** Writes a single key's pending value (if any) to the underlying storage immediately. */
  private flushKey(name: string): void {
    const timer = this.timers.get(name);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(name);
    const value = this.pending.get(name);
    this.pending.delete(name);
    if (value !== undefined) this.storage.setItem(name, value);
  }

  /** Immediately flushes ALL pending debounced writes. Used on unload/hide above, and by tests for deterministic assertions. */
  flush(): void {
    for (const name of [...this.pending.keys()]) this.flushKey(name);
  }
}

// ─── Ready-to-use singleton for desktop-store's persist `storage` option ──────

/** Resolves the real browser localStorage, or a no-op stub outside a browser context (SSR-ish setups, non-DOM test runs). */
function resolveBaseStorage(): StateStorage {
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
}

/**
 * Debounced wrapper around `window.localStorage`, meant to be passed to
 * zustand's `createJSONStorage(() => debouncedLocalStorage)` as a drop-in
 * `storage` option (see desktop-store.ts's persist config).
 */
export const debouncedLocalStorage: DebouncedStorage = new DebouncedStorage(resolveBaseStorage());
