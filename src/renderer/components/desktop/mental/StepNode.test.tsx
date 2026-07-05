/**
 * StepNode.test.tsx — Run-wiring tests for the StepNode xyflow node
 *
 * Strategy (mirrors MentalGraphCanvas.forkIndicator.test.tsx):
 * - Mock @dnd-kit/core and @xyflow/react — StepNode only needs `useDroppable`
 *   and a couple of type re-exports, not a real flow/DnD context.
 * - Mock desktop-store and harness-store with hoisted spies so we can assert
 *   exactly which action was called with which stepId, without touching real
 *   IPC-backed execution.
 * - Mock StepThinkingPopover — not under test here.
 *
 * Scenarios:
 *   1. The header's inline Run button calls `runStep(id)` and does not let
 *      the click bubble to the node (so it can't also trigger drag/select).
 *   2. The Run button is disabled while the step is running.
 *   3. The context menu's "Run from here" item calls `runFromStep(id)`.
 *   4. The context menu's "Inspect step" item selects this node and opens
 *      the Inspector — it no longer opens a StepInfoModal portal directly
 *      (Phase 8: see StepInfoModal.tsx's file header for the full move).
 *   5. The node is programmatically focusable (tabIndex=-1) — the mechanism
 *      StepNode uses to restore focus when the context menu closes.
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
  // Real @xyflow/react Handle throws when rendered outside a ReactFlowProvider
  // context — stand in with a plain div exposing id/type as data attributes
  // so tests can assert on handle count and id/type pairing without one.
  Handle: (p: { id: string; type: string }) => (
    <div data-testid={`step-handle-${p.id}`} data-handletype={p.type} />
  ),
}));

const mockDesktop = vi.hoisted(() => ({
  mentalEdges: [] as unknown[],
  mentalNodes: [] as unknown[],
  removeModFromStep: vi.fn(),
  removeRoleFromStep: vi.fn(),
  removeMentalNode: vi.fn(),
  bringMentalToFront: vi.fn(),
  setSelectedMentalNodeIds: vi.fn(),
  updateSettings: vi.fn(),
  addRoleToStep: vi.fn(() => true),
  addModToStep: vi.fn(() => true),
  // Fixture for the StepQuickAddPopover (rendered for real below — not
  // mocked) — 2 roles, 3 mods, mirroring the shape the market inventory
  // loader produces (see types/market.ts).
  marketInventory: {
    flows: [],
    roles: [
      { name: 'frontend-engineer', icon: 'User', iconLibrary: 'lucide', description: '', tags: [], color: '#E87040' },
      { name: 'backend-engineer', icon: 'User', iconLibrary: 'lucide', description: '', tags: [], color: '#4285F4' },
    ],
    mods: [
      { name: 'strict-linting', icon: 'Wrench', iconLibrary: 'lucide', description: '', tags: [] },
      { name: 'dry-run', icon: 'Wrench', iconLibrary: 'lucide', description: '', tags: [] },
      { name: 'test-driven', icon: 'Wrench', iconLibrary: 'lucide', description: '', tags: [] },
    ],
    steps: [],
  },
}));

vi.mock('../../../store/desktop-store', () => ({
  useDesktopStore: (selector: (s: typeof mockDesktop) => unknown) => selector(mockDesktop),
}));

const mockHarness = vi.hoisted(() => ({
  stepStatuses: {} as Record<string, string>,
  stepIterations: {} as Record<string, { iteration: number; total: number; loopId: string }>,
  runStep: vi.fn(),
  runFromStep: vi.fn(),
}));

vi.mock('../../../store/harness-store', () => ({
  useHarnessStore: (selector: (s: typeof mockHarness) => unknown) => selector(mockHarness),
}));

vi.mock('./StepThinkingPopover', () => ({
  StepThinkingPopover: () => null,
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
  mockDesktop.mentalNodes = [];
  mockHarness.stepStatuses = {};
  mockHarness.stepIterations = {};
  mockHarness.runStep.mockClear();
  mockHarness.runFromStep.mockClear();
  mockDesktop.addRoleToStep.mockClear();
  mockDesktop.addModToStep.mockClear();
  mockDesktop.addRoleToStep.mockReturnValue(true);
  mockDesktop.addModToStep.mockReturnValue(true);
  mockDesktop.setSelectedMentalNodeIds.mockClear();
  mockDesktop.updateSettings.mockClear();
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

  it('still offers "Inspect step" and "Eliminar paso" alongside the new item', () => {
    render(<StepNode {...makeNodeProps('step-menu')} />);
    fireEvent.contextMenu(screen.getByTestId('step-node-step-menu'));

    expect(screen.getByTestId('step-node-ctx-view')).toBeInTheDocument();
    expect(screen.getByTestId('step-node-ctx-delete')).toBeInTheDocument();
  });
});

describe('StepNode — context menu "Inspect step"', () => {
  // Phase 8: this item used to open a StepInfoModal portal directly
  // (asserted here previously via a mocked `../StepInfoModal`). It now
  // selects the node and force-opens the right-side Inspector instead —
  // StepNode doesn't render/import StepInfoModal at all anymore.
  it('selects this node and enables the inspector, without opening a modal', () => {
    render(<StepNode {...makeNodeProps('step-inspect')} />);

    fireEvent.contextMenu(screen.getByTestId('step-node-step-inspect'));
    fireEvent.click(screen.getByTestId('step-node-ctx-view'));

    expect(mockDesktop.setSelectedMentalNodeIds).toHaveBeenCalledWith(['step-inspect']);
    expect(mockDesktop.updateSettings).toHaveBeenCalledWith({ showInspector: true });
    expect(screen.queryByTestId('step-info-modal')).not.toBeInTheDocument();
  });

  it('shows the "Inspect step" label', () => {
    render(<StepNode {...makeNodeProps('step-label')} />);
    fireEvent.contextMenu(screen.getByTestId('step-node-step-label'));

    expect(screen.getByTestId('step-node-ctx-view')).toHaveTextContent('Inspect step');
  });
});

describe('StepNode — focus-return target', () => {
  it('the node article is programmatically focusable (tabIndex=-1)', () => {
    render(<StepNode {...makeNodeProps('step-focus')} />);
    expect(screen.getByTestId('step-node-step-focus')).toHaveAttribute('tabindex', '-1');
  });
});

describe('StepNode — loop-iteration badge', () => {
  it('renders "2/3" when stepIterations[id] is present', () => {
    mockHarness.stepIterations = { 'step-loop': { iteration: 2, total: 3, loopId: 'loop-1' } };
    render(<StepNode {...makeNodeProps('step-loop')} />);

    const badge = screen.getByTestId('step-node-iteration-step-loop');
    expect(badge).toHaveTextContent('2/3');
  });

  it('is absent when stepIterations[id] is not present', () => {
    render(<StepNode {...makeNodeProps('step-no-loop')} />);
    expect(screen.queryByTestId('step-node-iteration-step-no-loop')).not.toBeInTheDocument();
  });

  it('is absent when a DIFFERENT step has iteration data (keyed strictly by id)', () => {
    mockHarness.stepIterations = { 'some-other-step': { iteration: 1, total: 4, loopId: 'loop-2' } };
    render(<StepNode {...makeNodeProps('step-unrelated')} />);
    expect(screen.queryByTestId('step-node-iteration-step-unrelated')).not.toBeInTheDocument();
  });
});

describe('StepNode — connection handles', () => {
  it('renders exactly 4 handles', () => {
    render(<StepNode {...makeNodeProps('step-handles')} />);
    expect(screen.getAllByTestId(/^step-handle-/)).toHaveLength(4);
  });

  it('renders top/target, right/source, bottom/source, left/target — matching buildHandles() in MentalGraphCanvas.tsx', () => {
    render(<StepNode {...makeNodeProps('step-handle-types')} />);
    expect(screen.getByTestId('step-handle-top')).toHaveAttribute('data-handletype', 'target');
    expect(screen.getByTestId('step-handle-right')).toHaveAttribute('data-handletype', 'source');
    expect(screen.getByTestId('step-handle-bottom')).toHaveAttribute('data-handletype', 'source');
    expect(screen.getByTestId('step-handle-left')).toHaveAttribute('data-handletype', 'target');
  });
});

// Task 6 (2026-07-05 canvas/inspector plan, Phase 2): handles used to render
// as semicircles because `.step-node-shell` clipped its own overflow. The
// fix moves content clipping one layer down to `.step-node-clip`, so the
// shell can stay `overflow: visible` and the handles — direct children of
// the shell, siblings of the clip wrapper — escape it uncut.
describe('StepNode — handle clipping fix (.step-node-clip wrapper)', () => {
  it('does not nest the connector handles inside the clip wrapper', () => {
    const { container } = render(<StepNode {...makeNodeProps('step-clip')} />);
    const clip = container.querySelector('.step-node-clip');
    expect(clip).not.toBeNull();
    expect(clip?.querySelector('[data-testid^="step-handle-"]')).toBeNull();
    // All 4 handles still render somewhere (as direct/escaped shell children).
    expect(container.querySelectorAll('[data-testid^="step-handle-"]')).toHaveLength(4);
  });

  it('keeps the header and drop-zone content inside the clip wrapper', () => {
    const { container } = render(<StepNode {...makeNodeProps('step-clip-content')} />);
    const clip = container.querySelector('.step-node-clip');
    expect(clip?.querySelector('.step-node-drag-handle')).not.toBeNull();
    expect(clip?.querySelector('.step-node-drop-zone')).not.toBeNull();
  });
});

// StepQuickAddPopover is intentionally NOT mocked below — these tests exercise
// the real popover (search/list/attach) through StepNode's own trigger buttons.
describe('StepNode — quick-add popover', () => {
  it('renders an interactive quick-add button (real <button>) when the step has no atoms', () => {
    render(<StepNode {...makeNodeProps('step-empty')} />);
    const btn = screen.getByTestId('step-node-quick-add-step-empty');
    expect(btn.tagName).toBe('BUTTON');
    expect(btn).toHaveTextContent('Add atoms');
  });

  it('renders the compact "+" quick-add button once the step has atoms', () => {
    render(<StepNode {...makeNodeProps('step-full', {
      roles: [{ name: 'frontend-engineer', icon: 'User', iconLibrary: 'lucide', description: '', tags: [] }],
    })} />);
    const btn = screen.getByTestId('step-node-quick-add-step-full');
    expect(btn.tagName).toBe('BUTTON');
    expect(btn).toHaveAttribute('aria-label', 'Add atoms');
  });

  it('opens the popover on click, without bubbling the click to the canvas', () => {
    const outerClick = vi.fn();
    render(
      <div onClick={outerClick}>
        <StepNode {...makeNodeProps('step-open')} />
      </div>,
    );
    fireEvent.click(screen.getByTestId('step-node-quick-add-step-open'));
    expect(screen.getByTestId('step-quick-add-popover')).toBeInTheDocument();
    expect(outerClick).not.toHaveBeenCalled();
  });

  it('selecting a role calls addRoleToStep with the role object', () => {
    render(<StepNode {...makeNodeProps('step-pick')} />);
    fireEvent.click(screen.getByTestId('step-node-quick-add-step-pick'));
    fireEvent.click(screen.getByTestId('step-quick-add-role-frontend-engineer'));

    expect(mockDesktop.addRoleToStep).toHaveBeenCalledWith(
      'step-pick',
      expect.objectContaining({ name: 'frontend-engineer' }),
    );
  });

  it('Escape closes the popover', () => {
    render(<StepNode {...makeNodeProps('step-esc')} />);
    fireEvent.click(screen.getByTestId('step-node-quick-add-step-esc'));
    expect(screen.getByTestId('step-quick-add-popover')).toBeInTheDocument();

    fireEvent.keyDown(screen.getByTestId('step-quick-add-popover'), { key: 'Escape' });
    expect(screen.queryByTestId('step-quick-add-popover')).not.toBeInTheDocument();
  });
});
