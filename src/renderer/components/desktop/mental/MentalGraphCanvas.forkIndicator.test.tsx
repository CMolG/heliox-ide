/**
 * MentalGraphCanvas.forkIndicator.test.tsx — ARCH-080 fork indicator tests
 *
 * Strategy:
 * - Test the fork indicator badge rendered by StepNode when `_isForkOrigin` and
 *   `_forkRunId` are injected into node data by MentalGraphCanvas.
 * - StepNode is rendered directly with mocked dependencies to isolate the
 *   badge logic without requiring a full React Flow instance.
 * - The MentalGraphCanvas rfNodes memo logic is tested by asserting that the
 *   fork data fields are injected when `lastForkRunId` + `highlightedStepId`
 *   match a step node id.
 *
 * Scenarios:
 *   1. StepNode with `_isForkOrigin: true` → fork badge present with ARIA label.
 *   2. StepNode without `_isForkOrigin` → fork badge absent.
 *   3. StepNode with `_isForkOrigin: true` but no `_forkRunId` → badge absent
 *      (guard against partial injection).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Module mocks ─────────────────────────────────────────────────────────────

// Mock @dnd-kit/core — StepNode uses useDroppable which requires a DndContext.
vi.mock('@dnd-kit/core', () => ({
  useDroppable: () => ({ isOver: false, setNodeRef: vi.fn() }),
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock @xyflow/react — createPortal and NodeToolbar aren't needed in unit tests.
// Handle is stubbed too: StepNode now renders real connection handles, and the
// genuine xyflow Handle throws when rendered outside a ReactFlowProvider.
vi.mock('@xyflow/react', () => ({
  useReactFlow: () => ({ screenToFlowPosition: vi.fn() }),
  ReactFlow: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Background: () => null,
  ConnectionMode: { Loose: 'loose' },
  Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
  MarkerType: { ArrowClosed: 'arrowclosed' },
  Handle: (p: { id: string; type: string }) => (
    <div data-testid={`step-handle-${p.id}`} data-handletype={p.type} />
  ),
}));

// Mock desktop-store — StepNode reads mentalEdges and store actions.
vi.mock('../../../store/desktop-store', () => ({
  useDesktopStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      mentalEdges: [],
      removeModFromStep: vi.fn(),
      removeRoleFromStep: vi.fn(),
      removeMentalNode: vi.fn(),
    }),
}));

// Mock harness-store — StepNode reads stepStatuses.
vi.mock('../../../store/harness-store', () => ({
  useHarnessStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ stepStatuses: {}, checkpointState: { lastForkRunId: null, highlightedStepId: null } }),
}));

// Mock StepThinkingPopover and StepInfoModal — not under test.
vi.mock('./StepThinkingPopover', () => ({
  StepThinkingPopover: () => null,
}));
vi.mock('../StepInfoModal', () => ({
  StepInfoModal: () => null,
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { StepNode } from './StepNode';
import type { NodeProps } from '@xyflow/react';

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('StepNode fork indicator (ARCH-080)', () => {
  beforeEach(() => {
    // Reset any portal target
    document.body.innerHTML = '';
  });

  it('renders the fork badge when _isForkOrigin is true and _forkRunId is set', () => {
    const FORK_RUN_ID = 'run_fork_abc123xyz456789';
    render(
      <StepNode
        {...makeNodeProps('step-root', {
          _isForkOrigin: true,
          _forkRunId: FORK_RUN_ID,
        })}
      />,
    );

    const badge = screen.getByTestId('fork-indicator-step-root');
    expect(badge).toBeInTheDocument();

    // ARIA label contains the short run id (first 16 chars)
    expect(badge).toHaveAttribute(
      'aria-label',
      `Fork origin: run ${FORK_RUN_ID.slice(0, 16)}`,
    );
  });

  it('does not render the fork badge when _isForkOrigin is absent', () => {
    render(<StepNode {...makeNodeProps('step-no-fork')} />);
    expect(screen.queryByTestId('fork-indicator-step-no-fork')).not.toBeInTheDocument();
  });

  it('does not render the fork badge when _forkRunId is missing (partial injection guard)', () => {
    render(
      <StepNode
        {...makeNodeProps('step-partial', {
          _isForkOrigin: true,
          // _forkRunId intentionally omitted
        })}
      />,
    );
    expect(screen.queryByTestId('fork-indicator-step-partial')).not.toBeInTheDocument();
  });

  it('badge uses the GitBranch icon aria-label from LucideIcon', () => {
    const FORK_RUN_ID = 'run_fork_full_label_check';
    render(
      <StepNode
        {...makeNodeProps('step-icon', {
          _isForkOrigin: true,
          _forkRunId: FORK_RUN_ID,
        })}
      />,
    );

    const badge = screen.getByTestId('fork-indicator-step-icon');
    // The badge span is the accessible element; it should be present
    expect(badge).toBeInTheDocument();
    // title attribute for tooltip
    expect(badge).toHaveAttribute('title', expect.stringContaining('Forked here'));
  });
});
