/**
 * AttachableFlow.test.tsx — FlowStatus reconciled with AgenticExecutionStatus
 *
 * Bug (docs/competitive-analysis/experiment/ux-run/06-states-polish.md §2):
 * AttachableFlow.tsx defined its own local FlowStatus ('idle' | 'running' |
 * 'paused' | 'completed') with a working Start button for 'paused' — but
 * harness-store.ts's canonical AgenticExecutionStatus never actually sets
 * status to 'paused', and has two values (`compiling`, `error`) the local
 * type didn't even have room for. "Two models of the same concept; one is
 * fiction." This suite pins down that the component now accepts the full
 * canonical enum without crashing, and renders sane, non-crashing controls
 * for the two values the old type couldn't represent.
 *
 * AttachableContent.tsx (this component's only call site) never passes a
 * `status` prop in production, so every case below is exercised through
 * explicit test props, not live harness data — reconciling the type was a
 * safe, isolated change for exactly that reason.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AttachableFlow } from './AttachableFlow';
import type { MarketFlow } from '@/types/market';
import type { AgenticExecutionStatus } from '@/types/harness';

function makeFlow(overrides: Partial<MarketFlow> = {}): MarketFlow {
  return {
    name: 'auto-optimizer',
    betterOn: 'Claude',
    icon: 'MdSpeed',
    iconLibrary: 'md',
    description: 'Optimizes things.',
    cost: 'medium',
    recommendedComplexity: 'medium',
    tags: ['perf'],
    ...overrides,
  };
}

const ALL_STATUSES: AgenticExecutionStatus[] = ['idle', 'compiling', 'running', 'paused', 'completed', 'error'];

describe('AttachableFlow — status control affordances', () => {
  it('shows no controls row when idle (the default)', () => {
    render(<AttachableFlow flow={makeFlow()} />);
    expect(screen.queryByTestId('flow-controls')).not.toBeInTheDocument();
  });

  it('accepts every canonical AgenticExecutionStatus value without crashing, and reflects it in the region label', () => {
    for (const status of ALL_STATUSES) {
      const { unmount } = render(<AttachableFlow flow={makeFlow()} status={status} />);
      const region = screen.getByTestId('attachable-flow-auto-optimizer');
      expect(region.getAttribute('aria-label')).toContain(`status: ${status}`);
      unmount();
    }
  });

  it('offers Start for paused/completed, and now also Restart for error (a failed flow must stay restartable)', () => {
    for (const status of ['paused', 'completed'] as const) {
      const { unmount } = render(<AttachableFlow flow={makeFlow()} status={status} onStart={vi.fn()} />);
      expect(screen.getByLabelText('Start flow')).toBeInTheDocument();
      unmount();
    }

    const { unmount } = render(<AttachableFlow flow={makeFlow()} status="error" onStart={vi.fn()} />);
    expect(screen.getByLabelText('Restart flow')).toBeInTheDocument();
    expect(screen.queryByLabelText('Start flow')).not.toBeInTheDocument();
    unmount();
  });

  it('offers Pause only while running', () => {
    const running = render(<AttachableFlow flow={makeFlow()} status="running" onPause={vi.fn()} />);
    expect(screen.getByLabelText('Pause flow')).toBeInTheDocument();
    running.unmount();

    render(<AttachableFlow flow={makeFlow()} status="completed" onPause={vi.fn()} />);
    expect(screen.queryByLabelText('Pause flow')).not.toBeInTheDocument();
  });

  it('shows only Stop while compiling — nothing to start, restart, or pause mid-compile', () => {
    render(<AttachableFlow flow={makeFlow()} status="compiling" />);
    expect(screen.queryByLabelText('Start flow')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Restart flow')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Pause flow')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Stop flow')).toBeInTheDocument();
  });

  it('always offers Stop for any non-idle status', () => {
    for (const status of ALL_STATUSES.filter((s) => s !== 'idle')) {
      const { unmount } = render(<AttachableFlow flow={makeFlow()} status={status} />);
      expect(screen.getByLabelText('Stop flow')).toBeInTheDocument();
      unmount();
    }
  });
});
