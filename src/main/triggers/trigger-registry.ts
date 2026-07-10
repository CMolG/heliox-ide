/**
 * trigger-registry.ts — Lifecycle manager for Fluxor flow triggers.
 *
 * Responsibilities:
 *   - Persist TriggerDef[] as JSON to a configurable directory.
 *   - Register / unregister / list triggers.
 *   - start(id) — activate a trigger (webhook or cron).
 *   - stop(id)  — deactivate a running trigger.
 *   - startAll() — called at serve boot to activate all enabled triggers.
 *
 * The registry is designed to be instantiated once per serve process and
 * injected with its dependencies (routeRegistrar, dataDir) so it is fully
 * testable without a real file system or HTTP server.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TriggerDef, TriggerRuntimeEntry, TriggerStatus, CronTriggerConfig } from './trigger-types';
import type { RouteRegistrar, WebhookTriggerOptions, WebhookRouteHandle } from './webhook-trigger';
import { registerWebhookTrigger } from './webhook-trigger';
import { CronScheduler, type CronSchedulerOptions } from './scheduler';

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const DEFS_FILE = 'trigger-defs.json';

function loadDefs(dataDir: string): TriggerDef[] {
  const filePath = join(dataDir, DEFS_FILE);
  if (!existsSync(filePath)) return [];
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as TriggerDef[];
    return [];
  } catch {
    return [];
  }
}

function saveDefs(dataDir: string, defs: TriggerDef[]): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, DEFS_FILE), JSON.stringify(defs, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// TriggerRegistry
// ---------------------------------------------------------------------------

export interface TriggerRegistryOptions {
  /**
   * Directory where trigger definitions are persisted.
   * Defaults to the OS temp dir + '/fluxor-triggers' — override in tests.
   */
  dataDir?: string;
  /**
   * Route registrar from the shared HTTP server.
   * Required to start webhook triggers.
   */
  routeRegistrar?: RouteRegistrar;
  /**
   * Injectable runStep for webhook triggers — allows tests to script
   * execution without a real LLM.
   */
  webhookRunStep?: WebhookTriggerOptions['runStep'];
  /**
   * Injectable CronScheduler options (clock, execute fn, loadFlow fn).
   * Allows tests to control scheduling without real timers or LLM calls.
   */
  cronSchedulerOptions?: CronSchedulerOptions;
}

export class TriggerRegistry {
  private readonly dataDir: string;
  private readonly routeRegistrar: RouteRegistrar | undefined;
  private readonly webhookRunStep: WebhookTriggerOptions['runStep'];
  private readonly cronScheduler: CronScheduler;

  /** Persisted definitions (source of truth for disk state). */
  private defs: Map<string, TriggerDef> = new Map();

  /** Runtime state for active triggers. */
  private runtime: Map<string, TriggerRuntimeEntry> = new Map();

  /** Unregistration callbacks for active webhook routes. */
  private routeHandles: Map<string, WebhookRouteHandle> = new Map();

  constructor(options: TriggerRegistryOptions = {}) {
    this.dataDir = options.dataDir ?? join(
      // Use OS temp in production; tests always supply dataDir.
      process.env['TMPDIR'] ?? '/tmp',
      'fluxor-triggers',
    );
    this.routeRegistrar = options.routeRegistrar;
    this.webhookRunStep = options.webhookRunStep;
    this.cronScheduler = new CronScheduler(options.cronSchedulerOptions ?? {});

    // Load persisted definitions.
    const persisted = loadDefs(this.dataDir);
    for (const def of persisted) {
      this.defs.set(def.id, def);
    }
  }

  // -------------------------------------------------------------------------
  // CRUD
  // -------------------------------------------------------------------------

  /**
   * Register a new trigger definition.  If no `id` is present on the def,
   * one is generated.  The definition is persisted immediately.
   */
  register(def: Omit<TriggerDef, 'id'> & { id?: string }): TriggerDef {
    const full: TriggerDef = {
      ...def,
      id: def.id ?? randomUUID(),
    };
    this.defs.set(full.id, full);
    this.persist();
    return full;
  }

  /**
   * Remove a trigger.  Stops it first if running.
   */
  unregister(id: string): boolean {
    const def = this.defs.get(id);
    if (!def) return false;
    this.stop(id);
    this.defs.delete(id);
    this.runtime.delete(id);
    this.persist();
    return true;
  }

  /**
   * Return all registered TriggerDef objects.
   */
  list(): TriggerDef[] {
    return [...this.defs.values()];
  }

  /**
   * Return the runtime entry for a trigger, or undefined if not tracked.
   */
  status(id: string): TriggerRuntimeEntry | undefined {
    return this.runtime.get(id);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Start a specific trigger by id.
   * Idempotent — calling start on an already-running trigger is a no-op.
   */
  start(id: string): void {
    const def = this.defs.get(id);
    if (!def) throw new Error(`TriggerRegistry: unknown trigger "${id}"`);

    const existing = this.runtime.get(id);
    if (existing?.status === 'running') return; // already running

    if (def.type === 'webhook') {
      if (!this.routeRegistrar) {
        throw new Error(
          `TriggerRegistry: cannot start webhook trigger "${id}" — no routeRegistrar provided`,
        );
      }
      try {
        const handle = registerWebhookTrigger(def, this.routeRegistrar, {
          runStep: this.webhookRunStep,
        });
        this.routeHandles.set(id, handle);
        this.runtime.set(id, { def, status: 'running' });
      } catch (err) {
        this.runtime.set(id, {
          def,
          status: 'error',
          error: String(err),
        });
        throw err;
      }
      return;
    }

    // Cron trigger — delegate to the CronScheduler.
    if (def.type === 'cron') {
      try {
        this.cronScheduler.start(id, def.flowPath, def.config as CronTriggerConfig);
        this.runtime.set(id, { def, status: 'running' });
      } catch (err) {
        this.runtime.set(id, {
          def,
          status: 'error',
          error: String(err),
        });
        throw err;
      }
      return;
    }

    // Unknown trigger type — guard for future extensibility.
    this.runtime.set(id, {
      def,
      status: 'error',
      error: `Unknown trigger type "${(def as TriggerDef).type}"`,
    });
    throw new Error(`TriggerRegistry: unknown trigger type "${(def as TriggerDef).type}"`);
  }

  /**
   * Stop a running trigger.  Idempotent.
   */
  stop(id: string): void {
    // Webhook handle cleanup
    const handle = this.routeHandles.get(id);
    if (handle) {
      handle.unregister();
      this.routeHandles.delete(id);
    }

    // Cron scheduler cleanup
    this.cronScheduler.stop(id);

    const entry = this.runtime.get(id);
    if (entry) {
      this.runtime.set(id, { ...entry, status: 'stopped' });
    }
  }

  /**
   * Start all enabled triggers.  Called at serve-boot.
   * Errors from individual triggers are caught and stored in runtime state so
   * one broken trigger doesn't prevent others from starting.
   */
  startAll(): void {
    for (const def of this.defs.values()) {
      if (!def.enabled) continue;
      try {
        this.start(def.id);
      } catch {
        // Already recorded in runtime state by start().
      }
    }
  }

  /**
   * Stop all running triggers (webhook and cron).
   */
  stopAll(): void {
    // Collect all ids that are currently running (webhooks + cron).
    const ids = new Set<string>([
      ...this.routeHandles.keys(),
      ...this.cronScheduler.activeIds(),
    ]);
    for (const id of ids) {
      this.stop(id);
    }
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private persist(): void {
    saveDefs(this.dataDir, [...this.defs.values()]);
  }
}
