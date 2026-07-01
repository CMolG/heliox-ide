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
import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgenticExecutionStatus } from '@/types/harness';

const mockDesktop = vi.hoisted(() => ({
  mentalNodes: [] as unknown[],
  bringMentalToFront: vi.fn(),
}));

vi.mock('../../../store/desktop-store', () => ({
  useDesktopStore: (selector: (s: typeof mockDesktop) => unknown) => selector(mockDesktop),
}));

const mockHarness = vi.hoisted(() => ({
  executionStatus: 'idle' as AgenticExecutionStatus,
  compileCurrentCanvas: vi.fn(),
  startExecution: vi.fn(),
}));

vi.mock('../../../store/harness-store', () => ({
  useHarnessStore: (selector: (s: typeof mockHarness) => unknown) => selector(mockHarness),
}));

// ── Import after mocks ───────────────────────────────────────────────────────

import { FrameNode } from './FrameNode';
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
  mockHarness.executionStatus = 'idle';
  mockHarness.compileCurrentCanvas.mockClear();
  mockHarness.compileCurrentCanvas.mockReturnValue({ rootStepId: 'root' });
  mockHarness.startExecution.mockClear();
});

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
