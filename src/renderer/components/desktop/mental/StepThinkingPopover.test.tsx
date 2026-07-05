/**
 * StepThinkingPopover.test.tsx — Cursor-follow positioning tests
 *
 * Strategy:
 * - Mock harness-store with the vi.hoisted pattern (mirrors StepNode.test.tsx)
 *   — the component reads `stepThinkings[stepId]` and `stepStatuses[stepId]`.
 * - jsdom has no layout engine, so offsetWidth/offsetHeight are stubbed to
 *   fixed values that mimic real measured content — narrower/shorter than
 *   the CSS max-size constants (320/320). That gap between the "measured"
 *   and "hardcoded fallback" sizes is exactly what the regression is about.
 * - ResizeObserver isn't polyfilled in src/test-setup.ts, so this file
 *   installs a minimal mock as a global before each test and restores the
 *   original afterward.
 *
 * Scenarios:
 *   1. Mid-screen anchor — no flip, popover renders below/right of cursor.
 *   2. Anchor near the bottom edge, but the measured (short) height still
 *      fits — regression test: the old code compared against the hardcoded
 *      320px constant and flipped ~334px above the cursor here.
 *   3. Anchor close enough to the bottom edge that even the real height
 *      doesn't fit — flips flush above the cursor.
 *   4. Extreme viewport where even the flipped position overflows — both
 *      axes clamp to VIEWPORT_MARGIN.
 *   5. ResizeObserver — content growing while thinking deltas stream in
 *      re-triggers applyPosition without any cursor movement.
 */
import React from 'react';
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Module mocks ─────────────────────────────────────────────────────────────

const mockHarness = vi.hoisted(() => ({
  stepThinkings: {} as Record<string, { kind: 'reasoning' | 'text' | 'tool'; text: string }[]>,
  stepStatuses: {} as Record<string, string>,
}));

vi.mock('../../../store/harness-store', () => ({
  useHarnessStore: (selector: (s: typeof mockHarness) => unknown) => selector(mockHarness),
}));

// ── Import after mocks ───────────────────────────────────────────────────────

import { StepThinkingPopover } from './StepThinkingPopover';
import type { StepNodeData } from '@/types/desktop';

// ── ResizeObserver mock (not polyfilled in src/test-setup.ts) ───────────────

class MockResizeObserver {
  static instances: MockResizeObserver[] = [];
  callback: ResizeObserverCallback;
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    MockResizeObserver.instances.push(this);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

let mockOffsetHeight = 120;
let mockOffsetWidth = 320;

function makeStepData(overrides: Partial<StepNodeData> = {}): StepNodeData {
  return {
    title: 'Fetch data',
    description: '',
    mods: [],
    roles: [],
    ...overrides,
  };
}

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
}

function renderPopover(anchor: { x: number; y: number }) {
  render(
    <StepThinkingPopover stepId="step-1" stepData={makeStepData()} initialAnchor={anchor} />,
  );
  return document.querySelector('.step-thinking-popover') as HTMLDivElement;
}

// ── Fixture save/restore ─────────────────────────────────────────────────────

const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
const originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
const originalInnerWidth = window.innerWidth;
const originalInnerHeight = window.innerHeight;
const originalResizeObserver = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;

beforeEach(() => {
  // Reset BEFORE each test (not after) — matches the convention in
  // FrameNode.test.tsx / LoopEdge.test.tsx. Doing this in afterEach would
  // race against React Testing Library's own automatic unmount cleanup and
  // throw when it tries to remove the (already-destroyed) portal node.
  document.body.innerHTML = '';
  mockHarness.stepThinkings = {};
  mockHarness.stepStatuses = {};
  mockOffsetHeight = 120;
  mockOffsetWidth = 320;

  // jsdom performs no layout — stub the measured size the fix relies on.
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => mockOffsetHeight,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => mockOffsetWidth,
  });

  MockResizeObserver.instances = [];
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = MockResizeObserver;
});

afterEach(() => {
  if (originalOffsetHeight) {
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight);
  }
  if (originalOffsetWidth) {
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalOffsetWidth);
  }
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight });

  if (originalResizeObserver) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = originalResizeObserver;
  } else {
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  }
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('StepThinkingPopover — cursor-follow positioning', () => {
  it('anchors below/right of the cursor mid-screen (no flip needed)', () => {
    setViewport(1024, 800);
    const el = renderPopover({ x: 500, y: 400 });

    expect(el.style.top).toBe('414px'); // y + POPOVER_OFFSET_Y
    expect(el.style.left).toBe('518px'); // x + POPOVER_OFFSET_X
  });

  it('regression: stays BELOW the cursor near the bottom edge when the real (short) height still fits', () => {
    setViewport(1024, 800);
    // vh - 200 = 600. With the real ~120px height this comfortably fits
    // below the cursor. The old code compared against the hardcoded 320px
    // constant instead and flipped here, jumping ~334px above the cursor.
    const el = renderPopover({ x: 500, y: 600 });

    expect(el.style.top).toBe('614px'); // y + POPOVER_OFFSET_Y, unflipped
  });

  it('flips flush above the cursor once the real height no longer fits', () => {
    setViewport(1024, 800);
    // vh - 100 = 700; 700 + 14 + 120 + 12 = 846 > 800 → must flip.
    const el = renderPopover({ x: 500, y: 700 });

    expect(el.style.top).toBe('566px'); // y - h - POPOVER_OFFSET_Y = 700 - 120 - 14
  });

  it('clamps both axes to VIEWPORT_MARGIN when even the flipped position overflows', () => {
    // Narrow viewport where the 320x120 popover doesn't fit on either side
    // of a cursor at (200, 120).
    setViewport(500, 250);
    const el = renderPopover({ x: 200, y: 120 });

    expect(el.style.left).toBe('12px');
    expect(el.style.top).toBe('12px');
  });
});

describe('StepThinkingPopover — ResizeObserver reflow', () => {
  it('re-applies position when the observed element resizes (content streams in)', () => {
    setViewport(1024, 800);
    // Starts near the bottom edge, but the stubbed 120px height still fits.
    const el = renderPopover({ x: 500, y: 600 });
    expect(el.style.top).toBe('614px');

    expect(MockResizeObserver.instances).toHaveLength(1);
    const observer = MockResizeObserver.instances[0];
    expect(observer.observe).toHaveBeenCalledWith(el);

    // Content grows while thinking deltas stream in — simulate the resize.
    mockOffsetHeight = 300;
    observer.callback([] as unknown as ResizeObserverEntry[], observer as unknown as ResizeObserver);

    // 600 + 14 + 300 + 12 = 926 > 800 → now must flip.
    expect(el.style.top).toBe('286px'); // y - h - POPOVER_OFFSET_Y = 600 - 300 - 14
  });
});
