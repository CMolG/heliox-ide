/**
 * FlowEdge.test.tsx — Component tests for the directed step-to-step edge's chrome
 *
 * Strategy (mirrors LoopEdge.test.tsx):
 * - Mock @xyflow/react's `BaseEdge`, `EdgeLabelRenderer`, and `getSmoothStepPath` —
 *   the real versions require a full `<ReactFlowProvider>` + store context that
 *   isn't needed to test this component's own rendering/interaction logic.
 * - Mock desktop-store and harness-store with hoisted spies so assertions can
 *   check exactly which store action was called with which args, without a
 *   real store or IPC-backed execution.
 *
 * Scenarios:
 *   1. Right-click on the hit-area opens the context menu with "Invert order",
 *      "Change color", "Delete edge".
 *   2. "Invert order" calls invertMentalEdge with the domain flowEdgeId.
 *   3. "Delete edge" calls removeMentalEdge with the domain flowEdgeId.
 *   4. "Change color" opens the color editor; edits call updateMentalEdgeColor.
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
  getSmoothStepPath: () => ['M0,0 L100,100', 50, 40, 0, 0],
}));

const mockDesktop = vi.hoisted(() => ({
  removeMentalEdge: vi.fn(),
  updateMentalEdgeColor: vi.fn(),
  invertMentalEdge: vi.fn(),
}));

vi.mock('../../../store/desktop-store', () => ({
  useDesktopStore: (selector: (s: typeof mockDesktop) => unknown) => selector(mockDesktop),
}));

const mockHarness = vi.hoisted(() => ({
  stepStatuses: {} as Record<string, string>,
}));

vi.mock('../../../store/harness-store', () => ({
  useHarnessStore: (selector: (s: typeof mockHarness) => unknown) => selector(mockHarness),
}));

// ── Import after mocks ───────────────────────────────────────────────────────

import { FlowEdge } from './FlowEdge';
import type { EdgeProps } from '@xyflow/react';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEdgeProps(overrides: Record<string, unknown> = {}): EdgeProps {
  return {
    id: 'flow-1',
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
    data: { edgeColor: '#4DA8FF', edgeType: 'link', flowEdgeId: 'flow-1' },
    ...overrides,
  } as unknown as EdgeProps;
}

beforeEach(() => {
  document.body.innerHTML = '';
  mockDesktop.removeMentalEdge.mockClear();
  mockDesktop.updateMentalEdgeColor.mockClear();
  mockDesktop.invertMentalEdge.mockClear();
  mockHarness.stepStatuses = {};
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('FlowEdge — context menu', () => {
  it('right-click on the hit-area opens a menu with Invert order, Change color, Delete edge', () => {
    render(<FlowEdge {...makeEdgeProps()} />);
    fireEvent.contextMenu(screen.getByTestId('flow-edge-hit-flow-1'));

    expect(screen.getByTestId('flow-edge-ctx-menu-flow-1')).toBeInTheDocument();
    expect(screen.getByTestId('flow-edge-ctx-invert-flow-1')).toHaveTextContent('Invert order');
    expect(screen.getByTestId('flow-edge-ctx-color-flow-1')).toBeInTheDocument();
    expect(screen.getByTestId('flow-edge-ctx-delete-flow-1')).toBeInTheDocument();
  });

  it('"Invert order" calls invertMentalEdge with the domain flowEdgeId', () => {
    render(<FlowEdge {...makeEdgeProps({ id: 'rf-edge-id', data: { edgeColor: '#4DA8FF', edgeType: 'link', flowEdgeId: 'domain-flow-9' } })} />);
    fireEvent.contextMenu(screen.getByTestId('flow-edge-hit-rf-edge-id'));
    fireEvent.click(screen.getByTestId('flow-edge-ctx-invert-rf-edge-id'));

    expect(mockDesktop.invertMentalEdge).toHaveBeenCalledWith('domain-flow-9');
  });

  it('"Delete edge" calls removeMentalEdge with the domain flowEdgeId', () => {
    render(<FlowEdge {...makeEdgeProps({ id: 'rf-edge-id', data: { edgeColor: '#4DA8FF', edgeType: 'link', flowEdgeId: 'domain-flow-9' } })} />);
    fireEvent.contextMenu(screen.getByTestId('flow-edge-hit-rf-edge-id'));
    fireEvent.click(screen.getByTestId('flow-edge-ctx-delete-rf-edge-id'));

    expect(mockDesktop.removeMentalEdge).toHaveBeenCalledWith('domain-flow-9');
  });

  it('"Change color" opens the color editor, and edits call updateMentalEdgeColor', () => {
    render(<FlowEdge {...makeEdgeProps()} />);
    fireEvent.contextMenu(screen.getByTestId('flow-edge-hit-flow-1'));
    fireEvent.click(screen.getByTestId('flow-edge-ctx-color-flow-1'));

    const input = document.querySelector('.mental-line-color-input') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '#00FF00' } });

    expect(mockDesktop.updateMentalEdgeColor).toHaveBeenCalledWith('flow-1', '#00ff00');
  });
});
