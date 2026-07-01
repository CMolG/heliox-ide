/**
 * StepNode.test.tsx — Run-wiring tests for the StepNode xyflow node
 *
 * Strategy (mirrors MentalGraphCanvas.forkIndicator.test.tsx):
 * - Mock @dnd-kit/core and @xyflow/react — StepNode only needs `useDroppable`
 *   and a couple of type re-exports, not a real flow/DnD context.
 * - Mock desktop-store and harness-store with hoisted spies so we can assert
 *   exactly which action was called with which stepId, without touching real
 *   IPC-backed execution.
 * - Mock StepThinkingPopover and StepInfoModal — not under test here; the
 *   panel's own behavior (including its Run buttons) is covered by
 *   StepInfoModal.test.tsx.
 *
 * Scenarios:
 *   1. The header's inline Run button calls `runStep(id)` and does not let
 *      the click bubble to the node (so it can't also trigger drag/select).
 *   2. The Run button is disabled while the step is running.
 *   3. The context menu's "Run from here" item calls `runFromStep(id)`.
 *   4. The node is programmatically focusable (tabIndex=-1) — the mechanism
 *      StepNode uses to restore focus when the Step Config panel closes.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@dnd-kit/core', () => ({
  useDroppable: () => ({ isOver: false, setNodeRef: vi.fn() }),
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@xyflow/react', () => ({
  useReactFlow: () => ({ screenToFlowPosition: vi.fn() }),
  ReactFlow: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Background: () => null,
  ConnectionMode: { Loose: 'loose' },
  Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
  MarkerType: { ArrowClosed: 'arrowclosed' },
}));

const mockDesktop = vi.hoisted(() => ({
  mentalEdges: [] as unknown[],
  removeModFromStep: vi.fn(),
  removeRoleFromStep: vi.fn(),
  removeMentalNode: vi.fn(),
  bringMentalToFront: vi.fn(),
}));

vi.mock('../../../store/desktop-store', () => ({
  useDesktopStore: (selector: (s: typeof mockDesktop) => unknown) => selector(mockDesktop),
}));

const mockHarness = vi.hoisted(() => ({
  stepStatuses: {} as Record<string, string>,
  runStep: vi.fn(),
  runFromStep: vi.fn(),
}));

vi.mock('../../../store/harness-store', () => ({
  useHarnessStore: (selector: (s: typeof mockHarness) => unknown) => selector(mockHarness),
}));

vi.mock('./StepThinkingPopover', () => ({
  StepThinkingPopover: () => null,
}));
vi.mock('../StepInfoModal', () => ({
  StepInfoModal: () => null,
}));

// ── Import after mocks ───────────────────────────────────────────────────────

import { StepNode } from './StepNode';
import type { NodeProps } from '@xyflow/react';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeNodeProps(id: string, dataOverrides: Record<string, unknown> = {}): NodeProps {
  return {
    id,
    type: 'step',
    selected: false,
    zIndex: 2,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    dragging: false,
    data: {
      title: `Step ${id}`,
      description: '',
      mods: [],
      roles: [],
      ...dataOverrides,
    },
  } as unknown as NodeProps;
}

beforeEach(() => {
  document.body.innerHTML = '';
  mockDesktop.mentalEdges = [];
  mockHarness.stepStatuses = {};
  mockHarness.runStep.mockClear();
  mockHarness.runFromStep.mockClear();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('StepNode — inline Run button', () => {
  it('calls runStep with the node id and does not bubble to the node', () => {
    const outerClick = vi.fn();
    render(
      <div onClick={outerClick}>
        <StepNode {...makeNodeProps('step-run')} />
      </div>,
    );

    fireEvent.click(screen.getByTestId('step-node-run-step-run'));

    expect(mockHarness.runStep).toHaveBeenCalledWith('step-run');
    expect(outerClick).not.toHaveBeenCalled();
  });

  it('has an accessible name derived from the step title', () => {
    render(<StepNode {...makeNodeProps('step-a11y', { title: 'Fetch data' })} />);
    expect(screen.getByRole('button', { name: 'Run step Fetch data' })).toBeInTheDocument();
  });

  it('is disabled while the step is running', () => {
    mockHarness.stepStatuses = { 'step-busy': 'running' };
    render(<StepNode {...makeNodeProps('step-busy')} />);
    expect(screen.getByTestId('step-node-run-step-busy')).toBeDisabled();
  });

  it('is enabled when idle', () => {
    render(<StepNode {...makeNodeProps('step-idle')} />);
    expect(screen.getByTestId('step-node-run-step-idle')).not.toBeDisabled();
  });
});

describe('StepNode — context menu "Run from here"', () => {
  it('calls runFromStep with the node id', () => {
    render(<StepNode {...makeNodeProps('step-ctx')} />);

    fireEvent.contextMenu(screen.getByTestId('step-node-step-ctx'));
    fireEvent.click(screen.getByTestId('step-node-ctx-run-from'));

    expect(mockHarness.runFromStep).toHaveBeenCalledWith('step-ctx');
  });

  it('is disabled while the step is running', () => {
    mockHarness.stepStatuses = { 'step-ctx-busy': 'running' };
    render(<StepNode {...makeNodeProps('step-ctx-busy')} />);

    fireEvent.contextMenu(screen.getByTestId('step-node-step-ctx-busy'));
    expect(screen.getByTestId('step-node-ctx-run-from')).toBeDisabled();
  });

  it('still offers "Ver Step" and "Eliminar paso" alongside the new item', () => {
    render(<StepNode {...makeNodeProps('step-menu')} />);
    fireEvent.contextMenu(screen.getByTestId('step-node-step-menu'));

    expect(screen.getByTestId('step-node-ctx-view')).toBeInTheDocument();
    expect(screen.getByTestId('step-node-ctx-delete')).toBeInTheDocument();
  });
});

describe('StepNode — focus-return target', () => {
  it('the node article is programmatically focusable (tabIndex=-1)', () => {
    render(<StepNode {...makeNodeProps('step-focus')} />);
    expect(screen.getByTestId('step-node-step-focus')).toHaveAttribute('tabindex', '-1');
  });
});
