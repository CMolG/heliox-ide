/**
 * trigger-types.ts — Shared descriptor types for Heliox flow triggers.
 *
 * A TriggerDef is a small, JSON-serialisable value object that the trigger
 * registry persists to disk and hands to the appropriate trigger handler at
 * boot time (or on demand).
 */

// ---------------------------------------------------------------------------
// Webhook config
// ---------------------------------------------------------------------------

export interface WebhookTriggerConfig {
  /**
   * HTTP path at which the webhook listens.
   * Must start with '/'. Example: '/triggers/my-flow'
   */
  path: string;

  /**
   * Shared secret for HMAC-free bearer validation.
   * Requests missing the matching value in X-Heliox-Secret (or ?secret=) are
   * rejected with 401.
   */
  secret: string;

  /**
   * Execution mode:
   *   'async' — respond 202 { runId } immediately; run continues in background.
   *   'sync'  — await full execution then respond 200 { output, runId }.
   */
  mode: 'async' | 'sync';
}

// ---------------------------------------------------------------------------
// Cron / schedule config (ARCH-071)
// ---------------------------------------------------------------------------

/**
 * CronTriggerConfig supports two mutually-exclusive schedule forms:
 *
 *   { everyMs: number }  — fire every N milliseconds (simple interval).
 *   { cron: string }     — basic 5-field POSIX cron expression
 *                          (minute hour day month dow; supports *, ranges, steps).
 *
 * Exactly one of `everyMs` or `cron` must be provided.
 */
export type CronTriggerConfig =
  | {
      /**
       * Simple interval in milliseconds. The scheduler fires the bound flow
       * approximately every `everyMs` ms using `setInterval`.
       * Example: 300_000 → every 5 minutes.
       */
      everyMs: number;
      cron?: never;
      /** Legacy — kept for backwards compat; ignored when everyMs is set. */
      expression?: string;
    }
  | {
      /**
       * Standard 5-field cron expression: minute hour day month dow.
       * Supports * (wildcard), ranges (1-5), steps (*\/15).
       * Example: '0 * * * *' → top of every hour.
       */
      cron: string;
      everyMs?: never;
      /** Legacy — kept for backwards compat; ignored when cron is set. */
      expression?: string;
    }
  | {
      /**
       * Legacy string form from the ARCH-070 placeholder.
       * Kept so existing serialised defs are not broken; the scheduler maps
       * numeric strings to everyMs and anything else to cron.
       */
      expression: string;
      everyMs?: never;
      cron?: never;
    };

// ---------------------------------------------------------------------------
// Discriminated union
// ---------------------------------------------------------------------------

export type TriggerConfig = WebhookTriggerConfig | CronTriggerConfig;

// ---------------------------------------------------------------------------
// TriggerDef
// ---------------------------------------------------------------------------

export interface TriggerDef {
  /** Unique trigger identifier (caller-supplied or auto-generated UUID). */
  id: string;

  /**
   * Absolute path to the HelioxFlowExport JSON file that this trigger is
   * bound to. The registry loads and validates this file at start time.
   */
  flowPath: string;

  /** Discriminant that selects the handler implementation. */
  type: 'webhook' | 'cron';

  /** Handler-specific configuration — shape depends on `type`. */
  config: TriggerConfig;

  /**
   * Whether the trigger should be started automatically when the registry
   * boots (i.e. when the serve process starts).
   */
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Runtime state helpers
// ---------------------------------------------------------------------------

export type TriggerStatus = 'stopped' | 'running' | 'error';

export interface TriggerRuntimeEntry {
  def: TriggerDef;
  status: TriggerStatus;
  /** Present when status is 'error'. */
  error?: string;
}
