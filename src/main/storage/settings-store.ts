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
    aiAdapter: 'opencode';
    /** Provider id matching the key in opencode's auth.json. */
    selectedProvider: string;
    /** Full provider/model string for `opencode run --model`. */
    selectedModel: string;
    autoCommit: boolean;
    runE2E: boolean;
    sendOnEnter: boolean;
    onboardingDone: boolean;
    effort: string;
    stupidityMode: boolean;
  };
  recentProjects: string[];
  lastOpenedProject: string | null;
  /**
   * Stdio MCP server commands the user has explicitly approved (audit 1.4).
   * A command not covered by the curated `mcp-directory` must appear here
   * (exact command + args match) before the spawn boundary in mcp-adapter.ts
   * will allow it. See mcp-command-policy.ts for the enforcement logic.
   */
  approvedMcpCommands: Array<{ command: string; args: string[]; approvedAt: string }>;
  /**
   * Whether the packaged app should check update.electronjs.org for new
   * releases (audit 1.2). Checked before every `updateElectronApp()` call in
   * src/main/index.ts — inert today regardless of this flag, since that
   * service requires the repo to be public with at least one published
   * release (neither is true yet; see docs/RELEASE_CHECKLIST.md).
   */
  autoUpdateEnabled: boolean;
  /**
   * Anonymous install/launch telemetry opt-in (audit 1.8). Defaults to
   * false — the ping in telemetry-ping.ts never fires unless the user has
   * explicitly turned this on *and* an endpoint is configured.
   */
  telemetryOptIn: boolean;
  /**
   * Stable random id used only to de-duplicate pings server-side. Generated
   * once, lazily, the first time a ping would actually be sent — never
   * derived from any hardware/account identifier. See telemetry-ping.ts.
   */
  telemetryAnonymousId: string | null;
  /**
   * Optional settings-based override for the telemetry ping endpoint, used
   * when the FLUXOR_TELEMETRY_ENDPOINT env var isn't set. Null means "no
   * endpoint configured" — the ping stays a no-op either way.
   */
  telemetryEndpoint: string | null;
}

const DEFAULTS: SettingsSchema = {
  windowState: { width: 1440, height: 900 },
  modelsCache: { models: [], fetchedAt: 0 },
  appConfig: {
    aiAdapter: 'opencode',
    selectedProvider: 'opencode',
    selectedModel: 'opencode/claude-sonnet-4-6',
    autoCommit: false,
    runE2E: true,
    sendOnEnter: true,
    onboardingDone: false,
    effort: 'high',
    stupidityMode: true,
  },
  recentProjects: [],
  lastOpenedProject: null,
  approvedMcpCommands: [],
  autoUpdateEnabled: true,
  telemetryOptIn: false,
  telemetryAnonymousId: null,
  telemetryEndpoint: null,
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
