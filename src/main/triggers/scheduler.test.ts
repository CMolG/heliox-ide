/**
 * scheduler.test.ts — Tests for ARCH-071 (CronScheduler).
 *
 * Uses a fake clock so no real timers are created and tests remain
 * deterministic and offline (no LLM calls, no disk I/O).
 *
 * Coverage:
 *   - everyMs fires the bound flow N times
 *   - cron every-15-min matches the right minutes
 *   - matchesCron evaluator: *, ranges, steps
 *   - overlap guard skips when a prior run is active
 *   - stop() clears timers (no orphaned intervals)
 *   - stopAll() removes all entries
 *   - TriggerRegistry wires CronScheduler correctly
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  CronScheduler,
  matchesCron,
  resolveSchedule,
  type SchedulerClock,
  type ExecuteFn,
  type FlowLoader,
} from './scheduler';
import { TriggerRegistry } from './trigger-registry';
import type { AgenticFlow } from '../../types/harness';

// ---------------------------------------------------------------------------
// Fake clock
// ---------------------------------------------------------------------------

/**
 * A deterministic fake clock driven by manual `tick(ms)` calls.
 * Timers are stored in a sorted list and fired when time advances past them.
 */
class FakeClock implements SchedulerClock {
  private _time: number;
  private _timers: Array<{
    id: number;
    at: number;
    fn: () => void;
    repeat: number | null; // null = setTimeout; >0 = setInterval ms
  }> = [];
  private _nextId = 1;

  constructor(startMs = 0) {
    this._time = startMs;
  }

  now(): number {
    return this._time;
  }

  setInterval(fn: () => void, ms: number): ReturnType<typeof setInterval> {
    const id = this._nextId++;
    this._timers.push({ id, at: this._time + ms, fn, repeat: ms });
    return id as unknown as ReturnType<typeof setInterval>;
  }

  clearInterval(id: ReturnType<typeof setInterval>): void {
    const numId = id as unknown as number;
    this._timers = this._timers.filter((t) => t.id !== numId);
  }

  setTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    const id = this._nextId++;
    this._timers.push({ id, at: this._time + ms, fn, repeat: null });
    return id as unknown as ReturnType<typeof setTimeout>;
  }

  clearTimeout(id: ReturnType<typeof setTimeout>): void {
    const numId = id as unknown as number;
    this._timers = this._timers.filter((t) => t.id !== numId);
  }

  /**
   * Advance time by `ms` milliseconds, firing any timers that fall in range.
   * Repeating timers (intervals) are rescheduled automatically.
   */
  tick(ms: number): void {
    const target = this._time + ms;
    // Fire timers in chronological order; re-check after each fire because
    // callbacks may schedule new timers.
    while (true) {
      const due = this._timers
        .filter((t) => t.at <= target)
        .sort((a, b) => a.at - b.at);
      if (due.length === 0) break;

      const timer = due[0]!;
      // Advance time to when this timer fires.
      this._time = timer.at;

      if (timer.repeat !== null) {
        // Reschedule the interval BEFORE firing so callback sees updated list.
        timer.at = this._time + timer.repeat;
      } else {
        // Remove one-shot timer.
        this._timers = this._timers.filter((t) => t.id !== timer.id);
      }

      timer.fn();
    }
    // Advance to the target time (in case no timers fired in the tail).
    this._time = target;
  }

  /** Return the number of pending timers (for leak-detection assertions). */
  pendingCount(): number {
    return this._timers.length;
  }
}

// ---------------------------------------------------------------------------
// Stub helpers
// ---------------------------------------------------------------------------

/** A minimal AgenticFlow stub with a single no-op step. */
function makeStubFlow(id = 'stub-flow'): AgenticFlow {
  return {
    id,
    name: 'Stub Flow',
    rootStepId: 'step-1',
    stepsRecord: {
      'step-1': {
        id: 'step-1',
        type: 'llm_call',
        prompt: 'do something',
        prevStepIds: [],
        nextStepIds: [],
        mods: [],
        tools: [],
      },
    },
  } as unknown as AgenticFlow;
}

/** Make a FlowLoader that always returns the same stub flow. */
function makeStubLoader(flow?: AgenticFlow): FlowLoader {
  const f = flow ?? makeStubFlow();
  return (_path: string) => f;
}

/** Minimal flow fixture on disk (needed only for TriggerRegistry tests). */
function makeFlowFixture(dir: string): string {
  const p = join(dir, `flow-${randomUUID()}.json`);
  writeFileSync(
    p,
    JSON.stringify({
      version: '1',
      id: 'cron-test-flow',
      name: 'Cron Test Flow',
      rootStepId: 's1',
      steps: [{ id: 's1', type: 'llm_call', prompt: 'go', dependsOn: [], tools: [] }],
    }),
    'utf-8',
  );
  return p;
}

// ---------------------------------------------------------------------------
// matchesCron — unit tests for the evaluator
// ---------------------------------------------------------------------------

describe('matchesCron', () => {
  it('* * * * * matches any date', () => {
    expect(matchesCron('* * * * *', new Date('2024-01-15T14:37:00'))).toBe(true);
  });

  it('0 * * * * matches top of every hour', () => {
    expect(matchesCron('0 * * * *', new Date('2024-01-15T14:00:00'))).toBe(true);
    expect(matchesCron('0 * * * *', new Date('2024-01-15T14:01:00'))).toBe(false);
  });

  it('*/15 * * * * matches 0, 15, 30, 45 minutes', () => {
    for (const min of [0, 15, 30, 45]) {
      const d = new Date(`2024-01-15T10:${String(min).padStart(2, '0')}:00`);
      expect(matchesCron('*/15 * * * *', d)).toBe(true);
    }
    // Non-matching minutes
    for (const min of [1, 14, 16, 29, 31, 44, 46, 59]) {
      const d = new Date(`2024-01-15T10:${String(min).padStart(2, '0')}:00`);
      expect(matchesCron('*/15 * * * *', d)).toBe(false);
    }
  });

  it('range 1-5 * * * * matches minutes 1 through 5', () => {
    expect(matchesCron('1-5 * * * *', new Date('2024-01-15T10:03:00'))).toBe(true);
    expect(matchesCron('1-5 * * * *', new Date('2024-01-15T10:06:00'))).toBe(false);
  });

  it('0 9 * * 1-5 matches 09:00 on weekdays only', () => {
    // Monday
    expect(matchesCron('0 9 * * 1-5', new Date('2024-01-15T09:00:00'))).toBe(true);
    // Saturday
    expect(matchesCron('0 9 * * 1-5', new Date('2024-01-13T09:00:00'))).toBe(false);
    // Monday but wrong hour
    expect(matchesCron('0 9 * * 1-5', new Date('2024-01-15T10:00:00'))).toBe(false);
  });

  it('0 0 1 * * matches midnight on the 1st of every month', () => {
    expect(matchesCron('0 0 1 * *', new Date('2024-02-01T00:00:00'))).toBe(true);
    expect(matchesCron('0 0 1 * *', new Date('2024-02-02T00:00:00'))).toBe(false);
  });

  it('throws on invalid field count', () => {
    expect(() => matchesCron('* * * *', new Date())).toThrow(/5 fields/);
  });
});

// ---------------------------------------------------------------------------
// resolveSchedule
// ---------------------------------------------------------------------------

describe('resolveSchedule', () => {
  it('resolves everyMs form', () => {
    const r = resolveSchedule({ everyMs: 60_000 });
    expect(r).toEqual({ kind: 'everyMs', ms: 60_000 });
  });

  it('resolves cron form', () => {
    const r = resolveSchedule({ cron: '*/15 * * * *' });
    expect(r).toEqual({ kind: 'cron', expr: '*/15 * * * *' });
  });

  it('resolves legacy expression — numeric string → everyMs', () => {
    const r = resolveSchedule({ expression: '30000' });
    expect(r).toEqual({ kind: 'everyMs', ms: 30_000 });
  });

  it('resolves legacy expression — cron string → cron', () => {
    const r = resolveSchedule({ expression: '0 * * * *' });
    expect(r).toEqual({ kind: 'cron', expr: '0 * * * *' });
  });

  it('throws when no field is set', () => {
    // @ts-expect-error intentionally broken
    expect(() => resolveSchedule({})).toThrow();
  });
});

// ---------------------------------------------------------------------------
// CronScheduler — everyMs
// ---------------------------------------------------------------------------

describe('CronScheduler — everyMs', () => {
  it('fires the bound flow N times over N intervals', async () => {
    const clock = new FakeClock(0);
    const fires: string[] = [];

    const execute = vi.fn(async (flow: AgenticFlow) => {
      fires.push(flow.id);
    }) as unknown as ExecuteFn;

    const scheduler = new CronScheduler({
      clock,
      execute,
      loadFlow: makeStubLoader(),
    });

    scheduler.start('t1', '/fake/flow.json', { everyMs: 1_000 });

    // Advance one interval at a time, draining async queue between each,
    // so the overlap guard never triggers.
    clock.tick(1_000);
    await new Promise<void>((r) => setTimeout(r, 0));

    clock.tick(1_000);
    await new Promise<void>((r) => setTimeout(r, 0));

    clock.tick(1_000);
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(fires).toHaveLength(3);
    scheduler.stop('t1');
  });

  it('does not fire before the first interval elapses', async () => {
    const clock = new FakeClock(0);
    const execute = vi.fn(async () => undefined) as unknown as ExecuteFn;

    const scheduler = new CronScheduler({
      clock,
      execute,
      loadFlow: makeStubLoader(),
    });

    scheduler.start('t2', '/fake/flow.json', { everyMs: 5_000 });
    clock.tick(4_999);
    await Promise.resolve();

    expect(execute).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// CronScheduler — cron expression
// ---------------------------------------------------------------------------

describe('CronScheduler — cron', () => {
  /**
   * Build a clock pre-set to a time that is msUntilNextMinute ms before
   * minute boundary, so we can tick into cron-check territory.
   *
   * We set time to exactly at a minute boundary (ms = 0 within minute) so the
   * first tick fires immediately (delay = 50ms).
   */
  it('fires on */15 * * * * at the right minutes', async () => {
    // Start exactly at 10:00:00 (minute 0 → matches */15)
    const startMs = new Date('2024-01-15T10:00:00Z').getTime();
    const clock = new FakeClock(startMs);

    const firedAt: number[] = [];
    const execute = vi.fn(async () => {
      firedAt.push(clock.now());
    }) as unknown as ExecuteFn;

    const scheduler = new CronScheduler({
      clock,
      execute,
      loadFlow: makeStubLoader(),
    });

    // cron fires at minutes 0, 15, 30, 45
    scheduler.start('t3', '/fake/flow.json', { cron: '*/15 * * * *' });

    // Advance minute by minute, draining async between each, so each cron
    // check's fire() completes before the next minute tick evaluates the guard.
    for (let m = 0; m < 61; m++) {
      clock.tick(60_000);
      await new Promise<void>((r) => setTimeout(r, 0));
    }

    scheduler.stop('t3');

    // Should have fired at minutes 0, 15, 30, 45
    expect(firedAt.length).toBeGreaterThanOrEqual(4);

    const firedMinutes = firedAt.map((t) => new Date(t).getUTCMinutes());
    // All fires should land on multiples of 15
    for (const min of firedMinutes.slice(0, 4)) {
      expect(min % 15).toBe(0);
    }
  });

  it('does not fire when the cron expression does not match', async () => {
    // Start at 10:01 — not a match for */15
    const startMs = new Date('2024-01-15T10:01:00Z').getTime();
    const clock = new FakeClock(startMs);

    const execute = vi.fn(async () => undefined) as unknown as ExecuteFn;

    const scheduler = new CronScheduler({
      clock,
      execute,
      loadFlow: makeStubLoader(),
    });

    scheduler.start('t4', '/fake/flow.json', { cron: '*/15 * * * *' });

    // Tick 60 seconds (just one minute tick at :01 — no match)
    clock.tick(60_000);
    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(execute).not.toHaveBeenCalled();
    scheduler.stop('t4');
  });
});

// ---------------------------------------------------------------------------
// Overlap guard
// ---------------------------------------------------------------------------

describe('overlap guard', () => {
  it('skips a fire when the prior run is still active', async () => {
    const clock = new FakeClock(0);
    const warnings: string[] = [];

    // A slow execute that only resolves after we manually advance
    let resolveRun!: () => void;
    let runCount = 0;
    const execute = vi.fn(async () => {
      runCount++;
      await new Promise<void>((r) => {
        resolveRun = r;
      });
    }) as unknown as ExecuteFn;

    const scheduler = new CronScheduler({
      clock,
      execute,
      loadFlow: makeStubLoader(),
      warn: (msg) => warnings.push(msg),
    });

    scheduler.start('t5', '/fake/flow.json', { everyMs: 1_000 });

    // Fire #1 — starts, does not finish
    clock.tick(1_000);
    await Promise.resolve(); // let fire() begin

    // Fire #2 while #1 is still running — should be skipped
    clock.tick(1_000);
    await Promise.resolve();

    expect(runCount).toBe(1);
    expect(warnings.some((w) => w.includes('overlap guard'))).toBe(true);

    // Finish run #1, then fire #3 — should proceed
    resolveRun();
    await new Promise<void>((r) => setTimeout(r, 0)); // drain
    clock.tick(1_000);
    await Promise.resolve();

    expect(runCount).toBe(2);

    scheduler.stop('t5');
  });
});

// ---------------------------------------------------------------------------
// stop() clears timers
// ---------------------------------------------------------------------------

describe('stop()', () => {
  it('clears the interval and produces no more fires after stop()', async () => {
    const clock = new FakeClock(0);
    let fireCount = 0;
    const execute = vi.fn(async () => {
      fireCount++;
    }) as unknown as ExecuteFn;

    const scheduler = new CronScheduler({
      clock,
      execute,
      loadFlow: makeStubLoader(),
    });

    scheduler.start('t6', '/fake/flow.json', { everyMs: 500 });

    // Advance two intervals separately so overlap guard never triggers.
    clock.tick(500);
    await new Promise<void>((r) => setTimeout(r, 0));
    clock.tick(500);
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(fireCount).toBe(2);

    scheduler.stop('t6');

    // No more fires after stop
    clock.tick(2_000);
    await Promise.resolve();
    expect(fireCount).toBe(2);

    // No pending timers left
    expect(clock.pendingCount()).toBe(0);
  });

  it('stop() is idempotent — calling twice does not throw', () => {
    const clock = new FakeClock(0);
    const scheduler = new CronScheduler({
      clock,
      execute: vi.fn(async () => undefined) as unknown as ExecuteFn,
      loadFlow: makeStubLoader(),
    });

    scheduler.start('t7', '/fake/flow.json', { everyMs: 1_000 });
    scheduler.stop('t7');
    expect(() => scheduler.stop('t7')).not.toThrow();
  });

  it('stopAll() clears all entries', async () => {
    const clock = new FakeClock(0);
    const execute = vi.fn(async () => undefined) as unknown as ExecuteFn;

    const scheduler = new CronScheduler({
      clock,
      execute,
      loadFlow: makeStubLoader(),
    });

    scheduler.start('a', '/fake/a.json', { everyMs: 500 });
    scheduler.start('b', '/fake/b.json', { everyMs: 1_000 });

    expect(scheduler.activeIds()).toHaveLength(2);

    scheduler.stopAll();

    expect(scheduler.activeIds()).toHaveLength(0);
    expect(clock.pendingCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// TriggerRegistry — cron wiring
// ---------------------------------------------------------------------------

describe('TriggerRegistry — cron wiring', () => {
  let tmpDir: string;
  let flowPath: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `fluxor-sched-test-${randomUUID()}`);
    mkdirSync(tmpDir, { recursive: true });
    flowPath = makeFlowFixture(tmpDir);
  });

  it('start() registers a cron trigger as running', () => {
    const clock = new FakeClock(0);
    const execute = vi.fn(async () => undefined) as unknown as ExecuteFn;

    const registry = new TriggerRegistry({
      dataDir: tmpDir,
      cronSchedulerOptions: {
        clock,
        execute,
        loadFlow: makeStubLoader(),
      },
    });

    const def = registry.register({
      flowPath,
      type: 'cron',
      enabled: true,
      config: { everyMs: 1_000 },
    });

    registry.start(def.id);
    expect(registry.status(def.id)?.status).toBe('running');
  });

  it('stop() transitions a cron trigger to stopped and clears timers', async () => {
    const clock = new FakeClock(0);
    let fireCount = 0;
    const execute = vi.fn(async () => {
      fireCount++;
    }) as unknown as ExecuteFn;

    const registry = new TriggerRegistry({
      dataDir: tmpDir,
      cronSchedulerOptions: {
        clock,
        execute,
        loadFlow: makeStubLoader(),
      },
    });

    const def = registry.register({
      flowPath,
      type: 'cron',
      enabled: true,
      config: { everyMs: 500 },
    });

    registry.start(def.id);

    // Advance two intervals separately so overlap guard never triggers.
    clock.tick(500);
    await new Promise<void>((r) => setTimeout(r, 0));
    clock.tick(500);
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(fireCount).toBe(2);

    registry.stop(def.id);
    expect(registry.status(def.id)?.status).toBe('stopped');

    clock.tick(2_000); // no more fires
    await Promise.resolve();
    expect(fireCount).toBe(2);

    expect(clock.pendingCount()).toBe(0);
  });

  it('startAll() activates enabled cron triggers', async () => {
    const clock = new FakeClock(0);
    let fireCount = 0;
    const execute = vi.fn(async () => {
      fireCount++;
    }) as unknown as ExecuteFn;

    const registry = new TriggerRegistry({
      dataDir: tmpDir,
      cronSchedulerOptions: {
        clock,
        execute,
        loadFlow: makeStubLoader(),
      },
    });

    registry.register({
      flowPath,
      type: 'cron',
      enabled: true,
      config: { everyMs: 500 },
    });

    registry.startAll();

    // Advance two intervals separately so overlap guard never triggers.
    clock.tick(500);
    await new Promise<void>((r) => setTimeout(r, 0));
    clock.tick(500);
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(fireCount).toBe(2);

    registry.stopAll();
  });

  it('startAll() skips disabled cron triggers', async () => {
    const clock = new FakeClock(0);
    const execute = vi.fn(async () => undefined) as unknown as ExecuteFn;

    const registry = new TriggerRegistry({
      dataDir: tmpDir,
      cronSchedulerOptions: {
        clock,
        execute,
        loadFlow: makeStubLoader(),
      },
    });

    registry.register({
      flowPath,
      type: 'cron',
      enabled: false,
      config: { everyMs: 500 },
    });

    registry.startAll();

    clock.tick(2_000);
    await Promise.resolve();
    expect(execute).not.toHaveBeenCalled();
  });
});
