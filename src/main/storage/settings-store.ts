/**
 * Settings Store (Main Process)
 *
 * Responsibility:
 * - Typed key-value persistence for user preferences and app configuration
 * - Backed by electron-store ({userData}/config.json)
 *
 * Boundaries:
 * - Owns: user preferences, window geometry, cached data (models), app flags
 * - Does NOT own: relational data (use database), file exports (use fs-storage),
 *   or ephemeral UI state (use renderer localStorage/sessionStorage)
 *
 * Capacity: ~5-10 MB practical limit (JSON file)
 * Process: Main only — renderer accesses via IPC (settings:get/set/delete/reset)
 */
import Store from 'electron-store';

// ─── Schema ────────────────────────────────────────────────────────────────────
// Describes every persisted key, its type, and default value.
// electron-store validates against this on read/write.

export interface SettingsSchema {
  windowState: {
    x?: number;
    y?: number;
    width: number;
    height: number;
    isMaximized?: boolean;
  };
  modelsCache: {
    models: string[];
    fetchedAt: number;
  };
  appConfig: {
    aiAdapter: string;
    customCliPath: string;
    autoCommit: boolean;
    runE2E: boolean;
    sendOnEnter: boolean;
    onboardingDone: boolean;
    effort: string;
    stupidityMode: boolean;
  };
  recentProjects: string[];
  lastOpenedProject: string | null;
}

const DEFAULTS: SettingsSchema = {
  windowState: { width: 1440, height: 900 },
  modelsCache: { models: [], fetchedAt: 0 },
  appConfig: {
    aiAdapter: 'copilot',
    customCliPath: '',
    autoCommit: false,
    runE2E: true,
    sendOnEnter: true,
    onboardingDone: false,
    effort: 'high',
    stupidityMode: true,
  },
  recentProjects: [],
  lastOpenedProject: null,
};

// ─── Singleton ─────────────────────────────────────────────────────────────────

let store: Store<SettingsSchema> | null = null;

/**
 * Initialize the settings store. Must be called during app startup
 * (Phase 2 of storage initialization — after SQLite migrations).
 *
 * Safe to call multiple times — returns existing instance on subsequent calls.
 */
export function initSettingsStore(): Store<SettingsSchema> {
  if (store) return store;

  store = new Store<SettingsSchema>({
    name: 'config',
    defaults: DEFAULTS,
    // electron-store handles serialization, atomic writes, and corruption recovery
  });

  return store;
}

/**
 * Get the initialized store instance.
 * Throws if called before initSettingsStore() — a programming error.
 */
export function getSettingsStore(): Store<SettingsSchema> {
  if (!store) {
    throw new Error('[settings-store] Store not initialized. Call initSettingsStore() first.');
  }
  return store;
}

// ─── Typed Accessors ───────────────────────────────────────────────────────────
// Convenience methods that wrap electron-store's dot-notation API
// with explicit typing for downstream consumers.

export function settingsGet<K extends keyof SettingsSchema>(key: K): SettingsSchema[K] {
  return getSettingsStore().get(key);
}

export function settingsSet<K extends keyof SettingsSchema>(
  key: K,
  value: SettingsSchema[K],
): void {
  getSettingsStore().set(key, value);
}

export function settingsDelete<K extends keyof SettingsSchema>(key: K): void {
  getSettingsStore().delete(key);
}

/**
 * Reset all settings to defaults.
 * Use with caution — this wipes user preferences.
 */
export function settingsReset(): void {
  getSettingsStore().clear();
}
