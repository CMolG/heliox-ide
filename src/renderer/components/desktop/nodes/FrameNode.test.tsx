/**
 * FrameNode.test.tsx — Header run/status treatment across executionStatus
 *
 * Bug (docs/competitive-analysis/experiment/ux-run/06-states-polish.md §1):
 * FrameNode's header used to branch only on 'running'/'compiling' — 'idle',
 * 'paused', 'completed', and 'error' all rendered the identical plain "Run"
 * button ("a failed flow looks exactly like one that never ran"). These
 * tests pin down that each of the 6 AgenticExecutionStatus values gets its
 * own label/aria-label, that only compiling/running disable the button
 * (completed/error/paused must stay clickable so the user can rerun, retry,
 * or resume), that the run control is wrapped in an aria-live status region,
 * and that the existing compileCurrentCanvas + startExecution click path and
 * data-testid are unchanged for every status.
 *
 * Strategy mirrors StepNode.test.tsx: mock desktop-store/harness-store with
 * vi.hoisted spies so real IPC/canvas state never has to exist.
 * @xyflow/react is not mocked — FrameNode only takes a type-only `NodeProps`
 * import from it, so there's no runtime module to stand in for.
 */
import React from 'react';
import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EngineProvider, createEngineStore } from '@javadaba/daba-engine';
import type { AgenticExecutionStatus } from '@/types/harness';
import type { ModelPolicy } from '@/types/ipc-events';

// Task 13 (adoption plan #20), Fase 2: FrameNode now reads
// `engine.hoveredItemId` (unified highlight — see FrameNode.tsx's own
// doc-comment) via the motor's `useHoveredItem()`, which throws outside an
// `<EngineProvider>`. Shadowing testing-library's `render` with a thin
// wrapper (rather than touching every one of this file's ~16 `render(<...
// />)` call sites individually) gives every existing call site a fresh,
// throwaway engine store for free — this file only renders FrameNode in
// isolation and never asserts on engine/hover state, so a real
// `engine-bridge.ts` singleton (which needs a WORKING `useDesktopStore
// .getState()`, unlike this file's simplified selector-only mock) isn't
// needed here, just something that satisfies the Provider contract.
function render(ui: React.ReactElement) {
  return rtlRender(<EngineProvider store={createEngineStore()}>{ui}</EngineProvider>);
}

const mockDesktop = vi.hoisted(() => ({
  mentalNodes: [] as unknown[],
  bringMentalToFront: vi.fn(),
  settings: { modelPolicy: { mode: 'fixed' } as ModelPolicy },
  setModelPolicy: vi.fn(),
  updateFrameData: vi.fn(),
}));

vi.mock('../../../store/desktop-store', () => ({
  useDesktopStore: (selector: (s: typeof mockDesktop) => unknown) => selector(mockDesktop),
}));

const mockHarness = vi.hoisted(() => ({
  executionStatus: 'idle' as AgenticExecutionStatus,
  compileCurrentCanvas: vi.fn(),
  startExecution: vi.fn(),
}));

// `useHarnessStore` is mocked as a callable selector (matching every other
// spot in this file) PLUS a `getState()` static, because `logic/flow-actions.ts`
// (which `handleExport` now delegates to — Phase 11) is a plain async
// function, not a hook, so it reads the store via `useHarnessStore.getState()`
// the same way any zustand store exposes that method outside of React.
vi.mock('../../../store/harness-store', () => {
  const useHarnessStore = Object.assign(
    (selector: (s: typeof mockHarness) => unknown) => selector(mockHarness),
    { getState: () => mockHarness },
  );
  return { useHarnessStore };
});

// ── Import after mocks ───────────────────────────────────────────────────────

import { FrameNode, policyToValue, valueToPolicy, contextModeToValue } from './FrameNode';
import type { NodeProps } from '@xyflow/react';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeProps(id: string, dataOverrides: Record<string, unknown> = {}): NodeProps {
  return {
    id,
    type: 'frame',
    selected: false,
    zIndex: 1,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    dragging: false,
    data: {
      title: 'My Flow',
      childIds: [],
      ...dataOverrides,
    },
  } as unknown as NodeProps;
}

beforeEach(() => {
  document.body.innerHTML = '';
  mockDesktop.mentalNodes = [];
  mockDesktop.bringMentalToFront.mockClear();
  mockDesktop.settings = { modelPolicy: { mode: 'fixed' } };
  mockDesktop.setModelPolicy.mockClear();
  mockDesktop.updateFrameData.mockClear();
  mockHarness.executionStatus = 'idle';
  mockHarness.compileCurrentCanvas.mockClear();
  mockHarness.compileCurrentCanvas.mockReturnValue({ rootStepId: 'root' });
  mockHarness.startExecution.mockClear();
});

// ── window.fluxorAPI stub (Export button — real useFluxorStore, real IPC bridge) ──

function stubExportFlow(impl: (...args: unknown[]) => unknown) {
  Object.defineProperty(window, 'fluxorAPI', {
    value: { exportFlow: vi.fn(impl) },
    writable: true,
    configurable: true,
  });
  return (window.fluxorAPI as unknown as { exportFlow: ReturnType<typeof vi.fn> }).exportFlow;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('FrameNode — run/status treatment per executionStatus', () => {
  const cases: Array<{
    status: AgenticExecutionStatus;
    label: string;
    ariaLabel: string;
    disabled: boolean;
  }> = [
    { status: 'idle', label: 'Run', ariaLabel: 'Run pipeline', disabled: false },
    { status: 'compiling', label: 'Compiling', ariaLabel: 'Pipeline running', disabled: true },
    { status: 'running', label: 'Running', ariaLabel: 'Pipeline running', disabled: true },
    { status: 'completed', label: 'Completed', ariaLabel: 'Pipeline completed — run again', disabled: false },
    { status: 'error', label: 'Failed', ariaLabel: 'Pipeline failed — retry', disabled: false },
    { status: 'paused', label: 'Paused', ariaLabel: 'Pipeline paused — resume', disabled: false },
  ];

  for (const { status, label, ariaLabel, disabled } of cases) {
    it(`renders a distinct "${label}" button for status="${status}" (disabled=${disabled})`, () => {
      mockHarness.executionStatus = status;
      render(<FrameNode {...makeProps(`f-${status}`)} />);

      const button = screen.getByTestId(`pipeline-frame-run-f-${status}`);
      expect(button).toHaveTextContent(label);
      expect(button).toHaveAttribute('aria-label', ariaLabel);
      if (disabled) {
        expect(button).toBeDisabled();
      } else {
        expect(button).not.toBeDisabled();
      }
    });
  }

  it('never lets idle/completed/error/paused collapse onto the same label (the original bug)', () => {
    const labels = new Set<string>();
    for (const { status } of cases) {
      mockHarness.executionStatus = status;
      const { unmount } = render(<FrameNode {...makeProps(`u-${status}`)} />);
      labels.add(screen.getByTestId(`pipeline-frame-run-u-${status}`).textContent ?? '');
      unmount();
    }
    expect(labels.size).toBe(cases.length);
  });

  it('wraps the run control in a role="status" aria-live="polite" region (states-polish.md §6)', () => {
    render(<FrameNode {...makeProps('f-a11y')} />);
    const button = screen.getByTestId('pipeline-frame-run-f-a11y');
    const statusRegion = button.closest('[role="status"]');
    expect(statusRegion).not.toBeNull();
    expect(statusRegion).toHaveAttribute('aria-live', 'polite');
  });

  it('preserves the outer frame testid and aria-label (existing contract)', () => {
    render(<FrameNode {...makeProps('f-outer', { title: 'ETL Pipeline' })} />);
    const section = screen.getByTestId('pipeline-frame-f-outer');
    expect(section).toHaveAttribute('aria-label', 'Pipeline frame ETL Pipeline');
  });

  it('still compiles and starts the canvas on click for a non-idle status (re-run/retry/resume all funnel through the same path)', () => {
    mockHarness.executionStatus = 'completed';
    render(<FrameNode {...makeProps('f-rerun')} />);
    fireEvent.click(screen.getByTestId('pipeline-frame-run-f-rerun'));
    expect(mockHarness.compileCurrentCanvas).toHaveBeenCalledTimes(1);
    expect(mockHarness.startExecution).toHaveBeenCalledTimes(1);
  });

  it('does not call startExecution if compileCurrentCanvas returns null (e.g. an empty canvas)', () => {
    mockHarness.executionStatus = 'idle';
    mockHarness.compileCurrentCanvas.mockReturnValue(null);
    render(<FrameNode {...makeProps('f-empty')} />);
    fireEvent.click(screen.getByTestId('pipeline-frame-run-f-empty'));
    expect(mockHarness.compileCurrentCanvas).toHaveBeenCalledTimes(1);
    expect(mockHarness.startExecution).not.toHaveBeenCalled();
  });

  it('does not call the run handler while busy (compiling/running stay non-interactive, matching the disabled attribute)', () => {
    mockHarness.executionStatus = 'running';
    render(<FrameNode {...makeProps('f-busy')} />);
    fireEvent.click(screen.getByTestId('pipeline-frame-run-f-busy'));
    // A disabled native <button> does not fire onClick in jsdom either, but
    // this pins the behavior explicitly rather than relying on that default.
    expect(mockHarness.compileCurrentCanvas).not.toHaveBeenCalled();
    expect(mockHarness.startExecution).not.toHaveBeenCalled();
  });
});

// ── Export control (Phase 4a — canvas → portable fluxor-flow.json export) ──────

describe('FrameNode — Export control', () => {
  it('renders an Export button next to Run with a descriptive aria-label', () => {
    render(<FrameNode {...makeProps('f-export', { title: 'ETL Pipeline' })} />);
    const button = screen.getByTestId('pipeline-frame-export-f-export');
    expect(button).toHaveAttribute('aria-label', 'Export "ETL Pipeline" as a portable flow file');
  });

  it('compiles the canvas and calls window.fluxorAPI.exportFlow with the compiled flow on click', () => {
    const compiledFlow = { id: 'flow-1', name: 'My Flow', rootStepId: 'root', stepsRecord: {} };
    mockHarness.compileCurrentCanvas.mockReturnValue(compiledFlow);
    const exportFlow = stubExportFlow(() => Promise.resolve({ success: true, path: '/tmp/flow-1.flow.json' }));

    render(<FrameNode {...makeProps('f-export-click')} />);
    fireEvent.click(screen.getByTestId('pipeline-frame-export-f-export-click'));

    expect(mockHarness.compileCurrentCanvas).toHaveBeenCalledTimes(1);
    expect(exportFlow).toHaveBeenCalledWith(compiledFlow);
  });

  it('does not call window.fluxorAPI.exportFlow when compileCurrentCanvas returns null (e.g. an empty/invalid canvas)', () => {
    mockHarness.compileCurrentCanvas.mockReturnValue(null);
    const exportFlow = stubExportFlow(() => Promise.resolve({ success: true }));

    render(<FrameNode {...makeProps('f-export-empty')} />);
    fireEvent.click(screen.getByTestId('pipeline-frame-export-f-export-empty'));

    expect(mockHarness.compileCurrentCanvas).toHaveBeenCalledTimes(1);
    expect(exportFlow).not.toHaveBeenCalled();
  });

  it('does not start execution when Export is clicked (independent of the Run control)', () => {
    const compiledFlow = { id: 'flow-1', name: 'My Flow', rootStepId: 'root', stepsRecord: {} };
    mockHarness.compileCurrentCanvas.mockReturnValue(compiledFlow);
    stubExportFlow(() => Promise.resolve({ success: true }));

    render(<FrameNode {...makeProps('f-export-independent')} />);
    fireEvent.click(screen.getByTestId('pipeline-frame-export-f-export-independent'));

    expect(mockHarness.startExecution).not.toHaveBeenCalled();
  });
});

// ── Model-policy select (Phase 3b — WS2 smart-routing UI) ──────────────────

describe('FrameNode — model-policy select', () => {
  it('renders the current mode, defaulting to Fixed', () => {
    render(<FrameNode {...makeProps('f-policy-default')} />);
    const select = screen.getByTestId('pipeline-frame-policy-f-policy-default');
    expect(select).toHaveValue('fixed');
    expect(select).toHaveAttribute('aria-label', 'Model policy for this flow');
  });

  it('reflects a smart-local policy already in the store', () => {
    mockDesktop.settings = { modelPolicy: { mode: 'smart-local', strategy: 'fastest' } };
    render(<FrameNode {...makeProps('f-policy-smart')} />);
    expect(screen.getByTestId('pipeline-frame-policy-f-policy-smart')).toHaveValue('smart-local:fastest');
  });

  it('reflects a smart-external policy already in the store', () => {
    mockDesktop.settings = { modelPolicy: { mode: 'smart-external' } };
    render(<FrameNode {...makeProps('f-policy-external')} />);
    expect(screen.getByTestId('pipeline-frame-policy-f-policy-external')).toHaveValue('smart-external');
  });

  it('offers all six policy options in order', () => {
    render(<FrameNode {...makeProps('f-policy-options')} />);
    const select = screen.getByTestId('pipeline-frame-policy-f-policy-options');
    const labels = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(labels).toEqual([
      'Fixed',
      'Smart · best score',
      'Smart · cheapest',
      'Smart · fastest',
      'Smart · best value',
      'Smart · External (OpenRouter)',
    ]);
  });

  it('selecting "Smart · cheapest" calls setModelPolicy({mode:"smart-local",strategy:"cheapest"})', () => {
    render(<FrameNode {...makeProps('f-policy-cheapest')} />);
    fireEvent.change(screen.getByTestId('pipeline-frame-policy-f-policy-cheapest'), {
      target: { value: 'smart-local:cheapest' },
    });
    expect(mockDesktop.setModelPolicy).toHaveBeenCalledWith({ mode: 'smart-local', strategy: 'cheapest' });
  });

  it('selecting "Smart · External (OpenRouter)" calls setModelPolicy({mode:"smart-external"})', () => {
    render(<FrameNode {...makeProps('f-policy-ext-select')} />);
    fireEvent.change(screen.getByTestId('pipeline-frame-policy-f-policy-ext-select'), {
      target: { value: 'smart-external' },
    });
    expect(mockDesktop.setModelPolicy).toHaveBeenCalledWith({ mode: 'smart-external' });
  });

  it('selecting "Fixed" calls setModelPolicy({mode:"fixed"})', () => {
    mockDesktop.settings = { modelPolicy: { mode: 'smart-local', strategy: 'best-score' } };
    render(<FrameNode {...makeProps('f-policy-fixed')} />);
    fireEvent.change(screen.getByTestId('pipeline-frame-policy-f-policy-fixed'), {
      target: { value: 'fixed' },
    });
    expect(mockDesktop.setModelPolicy).toHaveBeenCalledWith({ mode: 'fixed' });
  });

  it('sits inside a "nodrag" zone like the sibling Export/Run controls, so opening it never drags the frame', () => {
    render(<FrameNode {...makeProps('f-policy-nodrag')} />);
    const select = screen.getByTestId('pipeline-frame-policy-f-policy-nodrag');
    // xyflow's drag-init check is `event.target.closest('.nodrag')` — this
    // holds whether the class sits on the select itself or an ancestor.
    expect(select.closest('.nodrag')).not.toBeNull();
  });

  it('does not throw when pointerdown/click are dispatched on the select (stopPropagation wiring present)', () => {
    render(<FrameNode {...makeProps('f-policy-events')} />);
    const select = screen.getByTestId('pipeline-frame-policy-f-policy-events');
    expect(() => {
      fireEvent.pointerDown(select);
      fireEvent.click(select);
    }).not.toThrow();
  });
});

// ── Context-mode select (Task U — Rosetta feedback-mode toggle) ────────────

describe('FrameNode — context-mode select', () => {
  it('renders the current mode, defaulting to "Blind (default)" when contextMode is unset', () => {
    render(<FrameNode {...makeProps('f-context-default')} />);
    const select = screen.getByTestId('pipeline-frame-context-mode-f-context-default');
    expect(select).toHaveValue('blind');
    expect(select).toHaveAttribute('aria-label', 'Context mode for this flow');
  });

  it('reflects contextMode:"feedback" already on the Frame data', () => {
    render(<FrameNode {...makeProps('f-context-feedback', { contextMode: 'feedback' })} />);
    expect(screen.getByTestId('pipeline-frame-context-mode-f-context-feedback')).toHaveValue('feedback');
  });

  it('reflects an explicit contextMode:"blind" the same as unset', () => {
    render(<FrameNode {...makeProps('f-context-blind', { contextMode: 'blind' })} />);
    expect(screen.getByTestId('pipeline-frame-context-mode-f-context-blind')).toHaveValue('blind');
  });

  it('offers exactly the two documented options, in order', () => {
    render(<FrameNode {...makeProps('f-context-options')} />);
    const select = screen.getByTestId('pipeline-frame-context-mode-f-context-options');
    const labels = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(labels).toEqual(['Blind (default)', 'Feedback']);
  });

  it('selecting "Feedback" calls updateFrameData(id, {contextMode:"feedback"})', () => {
    render(<FrameNode {...makeProps('f-context-select-feedback')} />);
    fireEvent.change(screen.getByTestId('pipeline-frame-context-mode-f-context-select-feedback'), {
      target: { value: 'feedback' },
    });
    expect(mockDesktop.updateFrameData).toHaveBeenCalledWith('f-context-select-feedback', { contextMode: 'feedback' });
  });

  it('selecting "Blind (default)" calls updateFrameData(id, {contextMode:"blind"})', () => {
    render(<FrameNode {...makeProps('f-context-select-blind', { contextMode: 'feedback' })} />);
    fireEvent.change(screen.getByTestId('pipeline-frame-context-mode-f-context-select-blind'), {
      target: { value: 'blind' },
    });
    expect(mockDesktop.updateFrameData).toHaveBeenCalledWith('f-context-select-blind', { contextMode: 'blind' });
  });

  it('does not call setModelPolicy or touch execution when the context mode changes (independent controls)', () => {
    render(<FrameNode {...makeProps('f-context-independent')} />);
    fireEvent.change(screen.getByTestId('pipeline-frame-context-mode-f-context-independent'), {
      target: { value: 'feedback' },
    });
    expect(mockDesktop.setModelPolicy).not.toHaveBeenCalled();
    expect(mockHarness.compileCurrentCanvas).not.toHaveBeenCalled();
    expect(mockHarness.startExecution).not.toHaveBeenCalled();
  });

  it('sits inside a "nodrag" zone like the sibling Model-policy/Export/Run controls', () => {
    render(<FrameNode {...makeProps('f-context-nodrag')} />);
    const select = screen.getByTestId('pipeline-frame-context-mode-f-context-nodrag');
    // xyflow's drag-init check is `event.target.closest('.nodrag')`.
    expect(select.closest('.nodrag')).not.toBeNull();
  });

  it('does not throw when pointerdown/click are dispatched on the select (stopPropagation wiring present)', () => {
    render(<FrameNode {...makeProps('f-context-events')} />);
    const select = screen.getByTestId('pipeline-frame-context-mode-f-context-events');
    expect(() => {
      fireEvent.pointerDown(select);
      fireEvent.click(select);
    }).not.toThrow();
  });
});

// ── Pure helpers: contextModeToValue ────────────────────────────────────────

describe('FrameNode — contextModeToValue (pure)', () => {
  it('maps undefined -> "blind" (absent ≡ blind default)', () => {
    expect(contextModeToValue(undefined)).toBe('blind');
  });

  it('maps "blind" -> "blind"', () => {
    expect(contextModeToValue('blind')).toBe('blind');
  });

  it('maps "feedback" -> "feedback"', () => {
    expect(contextModeToValue('feedback')).toBe('feedback');
  });
});

// ── Pure helpers: policyToValue / valueToPolicy ─────────────────────────────

describe('FrameNode — policyToValue / valueToPolicy (pure)', () => {
  it('policyToValue maps fixed -> "fixed"', () => {
    expect(policyToValue({ mode: 'fixed' })).toBe('fixed');
  });

  it('policyToValue maps smart-external -> "smart-external"', () => {
    expect(policyToValue({ mode: 'smart-external' })).toBe('smart-external');
  });

  it('policyToValue maps smart-local -> "smart-local:<strategy>"', () => {
    expect(policyToValue({ mode: 'smart-local', strategy: 'best-value' })).toBe('smart-local:best-value');
  });

  it('policyToValue defaults undefined -> "fixed"', () => {
    expect(policyToValue(undefined)).toBe('fixed');
  });

  it('valueToPolicy is the exact inverse of policyToValue for every option', () => {
    const policies: ModelPolicy[] = [
      { mode: 'fixed' },
      { mode: 'smart-local', strategy: 'best-score' },
      { mode: 'smart-local', strategy: 'cheapest' },
      { mode: 'smart-local', strategy: 'fastest' },
      { mode: 'smart-local', strategy: 'best-value' },
      { mode: 'smart-external' },
    ];
    for (const policy of policies) {
      expect(valueToPolicy(policyToValue(policy))).toEqual(policy);
    }
  });

  it('valueToPolicy falls back to fixed for an unrecognized value', () => {
    expect(valueToPolicy('nonsense')).toEqual({ mode: 'fixed' });
  });
});

// ── No connection handles (frame edges have no compile semantics) ──────────
//
// Regression guard for the intentional omission documented above the root
// JSX in FrameNode.tsx: unlike StepNode/MentalNode, a pipeline frame must
// never render an xyflow <Handle> — compileFlowFromCanvas only wires
// step↔step, so a frame-originated edge would just be a dashed "attachment"
// MentalEdge the compiler silently drops.
describe('FrameNode — no connection handles', () => {
  it('renders no element with a class or testid containing "handle"', () => {
    const { container } = render(<FrameNode {...makeProps('f-connections')} />);
    const elements = Array.from(container.querySelectorAll('*'));
    for (const el of elements) {
      expect(el.getAttribute('class') ?? '').not.toMatch(/handle/i);
      expect(el.getAttribute('data-testid') ?? '').not.toMatch(/handle/i);
    }
  });
});

// ── Task 13 (adoption plan #20), Fase 2: unified highlight ─────────────────
// Same mechanism as StepNode.tsx's identical wiring — see
// StepNode.test.tsx's "Task 13 unified highlight" describe block for the
// full rationale. Uses a direct EngineProvider mount (not this file's
// shared `render()` wrapper, which always creates a fresh, empty store) so
// `hoveredItemId` can be pre-set.

describe('FrameNode — Task 13 unified highlight', () => {
  it('sets data-daba-highlighted="true" when engine.hoveredItemId matches this frame', () => {
    const store = createEngineStore({ initialState: { hoveredItemId: 'flow:f-hl' } });
    rtlRender(
      <EngineProvider store={store}>
        <FrameNode {...makeProps('f-hl')} />
      </EngineProvider>,
    );
    expect(screen.getByTestId('pipeline-frame-f-hl')).toHaveAttribute('data-daba-highlighted', 'true');
  });

  it('omits the attribute when a DIFFERENT item is hovered', () => {
    const store = createEngineStore({ initialState: { hoveredItemId: 'step:some-step' } });
    rtlRender(
      <EngineProvider store={store}>
        <FrameNode {...makeProps('f-hl2')} />
      </EngineProvider>,
    );
    expect(screen.getByTestId('pipeline-frame-f-hl2')).not.toHaveAttribute('data-daba-highlighted');
  });
});
