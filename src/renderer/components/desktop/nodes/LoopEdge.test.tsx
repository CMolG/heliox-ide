/**
 * LoopEdge.test.tsx — Component tests for the loop-back edge visual + affordances
 *
 * Strategy (mirrors StepNode.test.tsx / MentalGraphCanvas.forkIndicator.test.tsx):
 * - Mock @xyflow/react's `BaseEdge`, `EdgeLabelRenderer`, and `getBezierPath` —
 *   the real versions require a full `<ReactFlowProvider>` + store context that
 *   isn't needed to test this component's own rendering/interaction logic.
 * - Mock desktop-store and harness-store with hoisted spies so assertions can
 *   check exactly which store action was called with which args, without a
 *   real store or IPC-backed execution.
 *
 * Scenarios:
 *   1. Renders `×3` from `data.maxIterations` when idle.
 *   2. A single click on the badge does NOT open the stepper (it merely stops
 *      propagation, e.g. so it doesn't fall through to a pane click). Only a
 *      double-click opens it; `+`/`-` then call `updateMentalEdgeData` with a
 *      clamped `maxIterations`, keyed by `data.loopEdgeId`.
 *   3. The stepper's `+`/`-` buttons disable at the [1, 50] boundary.
 *   4. Right-click opens the context menu; "Delete edge" calls `removeMentalEdge`.
 *   5. Right-click → "Change color" opens the color editor; edits call `updateMentalEdgeColor`.
 *   6. Live `2/3` replaces the static `×N` label while running with matching `stepIterations`.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@xyflow/react', () => ({
  BaseEdge: ({ id, path, style, className, markerEnd }: {
    id?: string; path: string; style?: React.CSSProperties; className?: string; markerEnd?: string;
  }) => <path data-testid={id} d={path} style={style} className={className} data-marker-end={markerEnd} />,
  EdgeLabelRenderer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  getBezierPath: () => ['M0,0 L100,100', 50, 40, 0, 0],
}));

const mockDesktop = vi.hoisted(() => ({
  removeMentalEdge: vi.fn(),
  updateMentalEdgeColor: vi.fn(),
  updateMentalEdgeData: vi.fn(),
  invertMentalEdge: vi.fn(),
}));

vi.mock('../../../store/desktop-store', () => ({
  useDesktopStore: (selector: (s: typeof mockDesktop) => unknown) => selector(mockDesktop),
}));

const mockHarness = vi.hoisted(() => ({
  stepStatuses: {} as Record<string, string>,
  stepIterations: {} as Record<string, { iteration: number; total: number; loopId: string }>,
}));

vi.mock('../../../store/harness-store', () => ({
  useHarnessStore: (selector: (s: typeof mockHarness) => unknown) => selector(mockHarness),
}));

// ── Import after mocks ───────────────────────────────────────────────────────

import { LoopEdge } from './LoopEdge';
import type { EdgeProps } from '@xyflow/react';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEdgeProps(overrides: Record<string, unknown> = {}): EdgeProps {
  return {
    id: 'loop-1',
    source: 'step-a',
    target: 'step-b',
    sourceX: 0,
    sourceY: 0,
    targetX: 100,
    targetY: 100,
    sourcePosition: 'right',
    targetPosition: 'left',
    selected: false,
    markerEnd: 'url(#marker)',
    data: { edgeColor: '#F59E0B', maxIterations: 3, loopEdgeId: 'loop-1' },
    ...overrides,
  } as unknown as EdgeProps;
}

beforeEach(() => {
  document.body.innerHTML = '';
  mockDesktop.removeMentalEdge.mockClear();
  mockDesktop.updateMentalEdgeColor.mockClear();
  mockDesktop.updateMentalEdgeData.mockClear();
  mockDesktop.invertMentalEdge.mockClear();
  mockHarness.stepStatuses = {};
  mockHarness.stepIterations = {};
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('LoopEdge — iteration badge', () => {
  it('renders ×3 from data.maxIterations when idle', () => {
    render(<LoopEdge {...makeEdgeProps()} />);
    expect(screen.getByTestId('loop-edge-label-loop-1')).toHaveTextContent('×3');
  });

  it('defaults to LOOP_DEFAULT_MAX_ITERATIONS when data.maxIterations is absent', () => {
    render(<LoopEdge {...makeEdgeProps({ data: { loopEdgeId: 'loop-1' } })} />);
    expect(screen.getByTestId('loop-edge-label-loop-1')).toHaveTextContent('×3');
  });

  it('shows the live iteration (2/3) instead of the static cap while running with matching stepIterations', () => {
    mockHarness.stepStatuses = { 'step-a': 'running' };
    mockHarness.stepIterations = { 'step-a': { iteration: 2, total: 3, loopId: 'loop-1' } };
    render(<LoopEdge {...makeEdgeProps()} />);
    expect(screen.getByTestId('loop-edge-label-loop-1')).toHaveTextContent('2/3');
  });

  it('falls back to the target step for live iteration when the source has none', () => {
    mockHarness.stepStatuses = { 'step-b': 'running' };
    mockHarness.stepIterations = { 'step-b': { iteration: 1, total: 5, loopId: 'loop-1' } };
    render(<LoopEdge {...makeEdgeProps()} />);
    expect(screen.getByTestId('loop-edge-label-loop-1')).toHaveTextContent('1/5');
  });

  it('shows the static cap (not live data) once the step stops running', () => {
    // stepIterations still holds the last-known value, but status is no longer running.
    mockHarness.stepStatuses = { 'step-a': 'completed' };
    mockHarness.stepIterations = { 'step-a': { iteration: 3, total: 3, loopId: 'loop-1' } };
    render(<LoopEdge {...makeEdgeProps()} />);
    expect(screen.getByTestId('loop-edge-label-loop-1')).toHaveTextContent('×3');
  });
});

describe('LoopEdge — stepper', () => {
  it('a single click on the badge does NOT open the stepper', () => {
    render(<LoopEdge {...makeEdgeProps()} />);
    fireEvent.click(screen.getByTestId('loop-edge-label-loop-1'));

    expect(screen.queryByTestId('loop-edge-stepper-loop-1')).not.toBeInTheDocument();
  });

  it('opens on badge double-click and calls updateMentalEdgeData with an incremented, clamped value on +', () => {
    render(<LoopEdge {...makeEdgeProps()} />);
    fireEvent.doubleClick(screen.getByTestId('loop-edge-label-loop-1'));

    expect(screen.getByTestId('loop-edge-stepper-loop-1')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('loop-edge-stepper-inc-loop-1'));

    expect(mockDesktop.updateMentalEdgeData).toHaveBeenCalledWith('loop-1', { maxIterations: 4 });
  });

  it('calls updateMentalEdgeData with a decremented, clamped value on -', () => {
    render(<LoopEdge {...makeEdgeProps()} />);
    fireEvent.doubleClick(screen.getByTestId('loop-edge-label-loop-1'));
    fireEvent.click(screen.getByTestId('loop-edge-stepper-dec-loop-1'));

    expect(mockDesktop.updateMentalEdgeData).toHaveBeenCalledWith('loop-1', { maxIterations: 2 });
  });

  it('disables the − button at the lower bound (1) and does not call updateMentalEdgeData', () => {
    render(<LoopEdge {...makeEdgeProps({ data: { maxIterations: 1, loopEdgeId: 'loop-1' } })} />);
    fireEvent.doubleClick(screen.getByTestId('loop-edge-label-loop-1'));

    const dec = screen.getByTestId('loop-edge-stepper-dec-loop-1');
    expect(dec).toBeDisabled();
    fireEvent.click(dec);
    expect(mockDesktop.updateMentalEdgeData).not.toHaveBeenCalled();
  });

  it('disables the + button at the upper bound (50) and does not call updateMentalEdgeData', () => {
    render(<LoopEdge {...makeEdgeProps({ data: { maxIterations: 50, loopEdgeId: 'loop-1' } })} />);
    fireEvent.doubleClick(screen.getByTestId('loop-edge-label-loop-1'));

    const inc = screen.getByTestId('loop-edge-stepper-inc-loop-1');
    expect(inc).toBeDisabled();
    fireEvent.click(inc);
    expect(mockDesktop.updateMentalEdgeData).not.toHaveBeenCalled();
  });

  it('double-clicking the badge again closes the stepper', () => {
    render(<LoopEdge {...makeEdgeProps()} />);
    const badge = screen.getByTestId('loop-edge-label-loop-1');
    fireEvent.doubleClick(badge);
    expect(screen.getByTestId('loop-edge-stepper-loop-1')).toBeInTheDocument();
    fireEvent.doubleClick(badge);
    expect(screen.queryByTestId('loop-edge-stepper-loop-1')).not.toBeInTheDocument();
  });
});

describe('LoopEdge — context menu', () => {
  it('right-click on the hit-area opens the context menu', () => {
    render(<LoopEdge {...makeEdgeProps()} />);
    fireEvent.contextMenu(screen.getByTestId('loop-edge-hit-loop-1'));
    expect(screen.getByTestId('loop-edge-ctx-menu-loop-1')).toBeInTheDocument();
  });

  it('"Delete edge" calls removeMentalEdge with the domain loopEdgeId', () => {
    render(<LoopEdge {...makeEdgeProps({ id: 'rf-edge-id', data: { maxIterations: 3, loopEdgeId: 'domain-loop-9' } })} />);
    fireEvent.contextMenu(screen.getByTestId('loop-edge-hit-rf-edge-id'));
    fireEvent.click(screen.getByTestId('loop-edge-ctx-delete-rf-edge-id'));

    expect(mockDesktop.removeMentalEdge).toHaveBeenCalledWith('domain-loop-9');
  });

  it('"Set iterations…" opens the stepper', () => {
    render(<LoopEdge {...makeEdgeProps()} />);
    fireEvent.contextMenu(screen.getByTestId('loop-edge-hit-loop-1'));
    fireEvent.click(screen.getByTestId('loop-edge-ctx-iterations-loop-1'));

    expect(screen.getByTestId('loop-edge-stepper-loop-1')).toBeInTheDocument();
  });

  it('context menu contains "Invert order", which calls invertMentalEdge with the domain loopEdgeId', () => {
    render(<LoopEdge {...makeEdgeProps({ id: 'rf-edge-id', data: { maxIterations: 3, loopEdgeId: 'domain-loop-9' } })} />);
    fireEvent.contextMenu(screen.getByTestId('loop-edge-hit-rf-edge-id'));

    expect(screen.getByTestId('loop-edge-ctx-invert-rf-edge-id')).toHaveTextContent('Invert order');
    fireEvent.click(screen.getByTestId('loop-edge-ctx-invert-rf-edge-id'));

    expect(mockDesktop.invertMentalEdge).toHaveBeenCalledWith('domain-loop-9');
  });

  it('"Change color" opens the color editor, and edits call updateMentalEdgeColor', () => {
    render(<LoopEdge {...makeEdgeProps()} />);
    fireEvent.contextMenu(screen.getByTestId('loop-edge-hit-loop-1'));
    fireEvent.click(screen.getByTestId('loop-edge-ctx-color-loop-1'));

    const input = document.querySelector('.mental-line-color-input') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '#00FF00' } });

    expect(mockDesktop.updateMentalEdgeColor).toHaveBeenCalledWith('loop-1', '#00ff00');
  });
});
