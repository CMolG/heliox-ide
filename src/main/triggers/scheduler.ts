/**
 * scheduler.ts — Cron/interval scheduler for Heliox flow triggers (ARCH-071).
 *
 * Supports two schedule forms:
 *   { everyMs }  — fires every N milliseconds via setInterval.
 *   { cron }     — basic 5-field cron (minute/hour/day/month/dow);
 *                  checked each minute via a tick loop.
 *
 * Design decisions:
 *   - Zero external dependencies: minimal cron evaluator hand-rolled here.
 *   - Injectable clock (Date.now/setInterval/clearInterval/setTimeout/
 *     clearTimeout) so tests run with a fake clock and never touch real time.
 *   - Overlap guard: if a flow run is still active when the next fire would
 *     occur, that fire is skipped and a warning is emitted.
 *   - stop() clears all timers — no orphaned intervals survive.
 */

import { randomUUID } from 'node:crypto';
import type { AgenticFlow } from '../../types/harness';
import type { ExecuteAgenticFlowOptions } from '../harness-engine/executor';
import { executeAgenticFlow } from '../harness-engine/executor';
import { importFlow, type HelioxFlowExport } from '../flow-export/heliox-flow';
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Clock abstraction (injectable for tests)
// ---------------------------------------------------------------------------

export interface SchedulerClock {
  now(): number;
  setInterval(fn: () => void, ms: number): ReturnType<typeof setInterval>;
  clearInterval(id: ReturnType<typeof setInterval>): void;
  setTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(id: ReturnType<typeof setTimeout>): void;
}

export const realClock: SchedulerClock = {
  now: () => Date.now(),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
};

// ---------------------------------------------------------------------------
// Minimal cron expression evaluator
// ---------------------------------------------------------------------------

/**
 * Parse a single cron field (e.g. "star" | "0-5" | "star/15" | "30") against
 * the numeric value `v` within [min, max].
 *
 * Supported syntax:
 *   star       — always matches
 *   n          — matches exactly n
 *   n-m        — range (inclusive)
 *   star/step  — every `step` from min
 *   n-m/step   — range with step
 */
function matchField(field: string, v: number, min: number, max: number): boolean {
  if (field === '*') return true;

  const parts = field.split(',');
  for (const part of parts) {
    const slashIdx = part.indexOf('/');
    if (slashIdx !== -1) {
      // Step syntax: base/step  where base is * or range
      const base = part.slice(0, slashIdx);
      const step = parseInt(part.slice(slashIdx + 1), 10);
      if (isNaN(step) || step <= 0) continue;

      const [rangeMin, rangeMax] =
        base === '*'
          ? [min, max]
          : base
              .split('-')
              .map(Number)
              .concat([NaN]) // ensure two elements
              .slice(0, 2) as [number, number];

      const lo = isNaN(rangeMin) ? min : rangeMin;
      const hi = isNaN(rangeMax) ? lo : rangeMax;

      if (v >= lo && v <= hi && (v - lo) % step === 0) return true;
    } else if (part.includes('-')) {
      // Plain range: n-m
      const [lo, hi] = part.split('-').map(Number) as [number, number];
      if (!isNaN(lo) && !isNaN(hi) && v >= lo && v <= hi) return true;
    } else {
      // Exact value
      const n = parseInt(part, 10);
      if (!isNaN(n) && v === n) return true;
    }
  }
  return false;
}

/**
 * Evaluate whether a Date matches a 5-field cron expression.
 * Fields: minute hour day-of-month month day-of-week
 * dow: 0 = Sunday … 6 = Saturday.
 */
export function matchesCron(expr: string, date: Date): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`scheduler: invalid cron expression "${expr}" — expected 5 fields`);
  }

  const [fMin, fHour, fDom, fMon, fDow] = fields as [
    string,
    string,
    string,
    string,
    string,
  ];

  const minute = date.getMinutes();
  const hour = date.getHours();
  const dom = date.getDate();
  const month = date.getMonth() + 1; // cron months are 1-12
  const dow = date.getDay(); // 0=Sunday

  return (
    matchField(fMin, minute, 0, 59) &&
    matchField(fHour, hour, 0, 23) &&
    matchField(fDom, dom, 1, 31) &&
    matchField(fMon, month, 1, 12) &&
    matchField(fDow, dow, 0, 6)
  );
}

// ---------------------------------------------------------------------------
// Schedule resolution
// ---------------------------------------------------------------------------

import type { CronTriggerConfig } from './trigger-types';

/** Resolved schedule — one of two forms. */
type ResolvedSchedule =
  | { kind: 'everyMs'; ms: number }
  | { kind: 'cron'; expr: string };

/**
 * Resolve a CronTriggerConfig (which may use the legacy `expression` field) to
 * a canonical ResolvedSchedule.
 */
export function resolveSchedule(config: CronTriggerConfig): ResolvedSchedule {
  if ('everyMs' in config && config.everyMs != null) {
    return { kind: 'everyMs', ms: config.everyMs };
  }
  if ('cron' in config && config.cron != null) {
    return { kind: 'cron', expr: config.cron };
  }
  // Legacy `expression` field
  if ('expression' in config && config.expression != null) {
    const expr = config.expression.trim();
    // If it looks like a plain number (milliseconds) treat as everyMs
    if (/^\d+$/.test(expr)) {
      return { kind: 'everyMs', ms: parseInt(expr, 10) };
    }
    return { kind: 'cron', expr };
  }
  throw new Error('scheduler: CronTriggerConfig must specify everyMs, cron, or expression');
}

// ---------------------------------------------------------------------------
// Flow loader (injectable for tests)
// ---------------------------------------------------------------------------

export type FlowLoader = (flowPath: string) => AgenticFlow;

function defaultFlowLoader(flowPath: string): AgenticFlow {
  const raw = readFileSync(flowPath, 'utf-8');
  const exported: HelioxFlowExport = JSON.parse(raw) as HelioxFlowExport;
  return importFlow(exported);
}

// ---------------------------------------------------------------------------
// Execution abstraction (injectable for tests)
// ---------------------------------------------------------------------------

export type ExecuteFn = (
  flow: AgenticFlow,
  options: ExecuteAgenticFlowOptions,
) => Promise<void>;

// ---------------------------------------------------------------------------
// CronScheduler
// ---------------------------------------------------------------------------

/**
 * Options for constructing a CronScheduler.
 */
export interface CronSchedulerOptions {
  /** Override the system clock — primarily for tests. */
  clock?: SchedulerClock;
  /**
   * Injectable execution function; defaults to `executeAgenticFlow`.
   * Override in tests to avoid LLM calls.
   */
  execute?: ExecuteFn;
  /**
   * Injectable flow loader; defaults to reading from disk.
   * Override in tests to supply an in-memory flow.
   */
  loadFlow?: FlowLoader;
  /** Suppress console.warn in tests when desired. */
  warn?: (msg: string) => void;
}

interface SchedulerEntry {
  triggerId: string;
  flowPath: string;
  schedule: ResolvedSchedule;
  /** Interval or timeout handle depending on schedule kind. */
  handle: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout> | null;
  /** True while a flow execution is in progress. */
  running: boolean;
}

/**
 * CronScheduler — manages time-based flow triggers.
 *
 * Usage:
 *   const scheduler = new CronScheduler();
 *   scheduler.start(triggerId, flowPath, cronConfig);
 *   // … later …
 *   scheduler.stop(triggerId);
 */
export class CronScheduler {
  private readonly clock: SchedulerClock;
  private readonly execute: ExecuteFn;
  private readonly loadFlow: FlowLoader;
  private readonly warn: (msg: string) => void;

  /** Active scheduler entries keyed by trigger id. */
  private entries: Map<string, SchedulerEntry> = new Map();

  constructor(options: CronSchedulerOptions = {}) {
    this.clock = options.clock ?? realClock;
    this.execute = options.execute ?? executeAgenticFlow;
    this.loadFlow = options.loadFlow ?? defaultFlowLoader;
    this.warn = options.warn ?? ((msg) => console.warn(`[CronScheduler] ${msg}`));
  }

  /**
   * Start scheduling a trigger.
   * Idempotent — calling start on an already-scheduled trigger is a no-op.
   */
  start(triggerId: string, flowPath: string, config: CronTriggerConfig): void {
    if (this.entries.has(triggerId)) return; // idempotent

    const schedule = resolveSchedule(config);

    const entry: SchedulerEntry = {
      triggerId,
      flowPath,
      schedule,
      handle: null,
      running: false,
    };

    if (schedule.kind === 'everyMs') {
      entry.handle = this.clock.setInterval(() => {
        void this.fire(triggerId);
      }, schedule.ms);
    } else {
      // Cron: align to the next minute boundary, then tick every minute.
      this.scheduleCronTick(entry);
    }

    this.entries.set(triggerId, entry);
  }

  /**
   * Stop a scheduled trigger and clear its timer(s).
   * Idempotent — safe to call when not running.
   */
  stop(triggerId: string): void {
    const entry = this.entries.get(triggerId);
    if (!entry) return;

    if (entry.handle !== null) {
      if (entry.schedule.kind === 'everyMs') {
        this.clock.clearInterval(entry.handle as ReturnType<typeof setInterval>);
      } else {
        this.clock.clearTimeout(entry.handle as ReturnType<typeof setTimeout>);
      }
      entry.handle = null;
    }

    this.entries.delete(triggerId);
  }

  /**
   * Stop all scheduled triggers.
   */
  stopAll(): void {
    for (const id of [...this.entries.keys()]) {
      this.stop(id);
    }
  }

  /** Returns the set of active trigger ids (useful for tests). */
  activeIds(): string[] {
    return [...this.entries.keys()];
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  /**
   * Schedule the next cron tick.
   * Uses setTimeout to fire at (approximately) the start of the next minute,
   * then checks if the cron expression matches.
   */
  private scheduleCronTick(entry: SchedulerEntry): void {
    // Calculate ms until the start of the next minute.
    const now = this.clock.now();
    const msIntoCurrentMinute = now % 60_000;
    const msUntilNextMinute = msIntoCurrentMinute === 0 ? 0 : 60_000 - msIntoCurrentMinute;
    // Add a small jitter (50ms) to ensure we're safely past the minute boundary.
    const delay = msUntilNextMinute + 50;

    entry.handle = this.clock.setTimeout(() => {
      if (!this.entries.has(entry.triggerId)) return; // was stopped

      const cronExpr = (entry.schedule as { kind: 'cron'; expr: string }).expr;
      const now = new Date(this.clock.now());

      if (matchesCron(cronExpr, now)) {
        void this.fire(entry.triggerId);
      }

      // Reschedule the next tick — refresh the entry reference in case it
      // was mutated, but only if still registered.
      const current = this.entries.get(entry.triggerId);
      if (current) {
        this.scheduleCronTick(current);
      }
    }, delay);
  }

  /**
   * Fire a single execution of the bound flow.
   * Overlap guard: if a prior run is still active, skip and warn.
   */
  private async fire(triggerId: string): Promise<void> {
    const entry = this.entries.get(triggerId);
    if (!entry) return;

    if (entry.running) {
      this.warn(
        `trigger "${triggerId}": previous run is still active — skipping this fire (overlap guard)`,
      );
      return;
    }

    let flow: AgenticFlow;
    try {
      flow = this.loadFlow(entry.flowPath);
    } catch (err) {
      this.warn(`trigger "${triggerId}": could not load flow from "${entry.flowPath}": ${String(err)}`);
      return;
    }

    entry.running = true;
    const runId = randomUUID();

    try {
      await this.execute(flow, { runId });
    } catch (err) {
      this.warn(`trigger "${triggerId}": execution error: ${String(err)}`);
    } finally {
      // Re-fetch entry — it might have been stopped while we were running.
      const current = this.entries.get(triggerId);
      if (current) {
        current.running = false;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton (convenience for the registry)
// ---------------------------------------------------------------------------

let _singleton: CronScheduler | null = null;

/**
 * Get (or lazily create) the module-level CronScheduler singleton.
 * The registry uses this; tests use `new CronScheduler(options)` directly.
 */
export function getCronScheduler(): CronScheduler {
  if (!_singleton) {
    _singleton = new CronScheduler();
  }
  return _singleton;
}
