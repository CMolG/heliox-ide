/**
 * App.test.tsx — harness executionStatus 'error' surfaces via the existing
 * toast system
 *
 * Bug (docs/competitive-analysis/experiment/ux-run/06-states-polish.md §1,
 * §4): harness-store.ts's executeFlow appends every failure — missing IPC
 * bridge, a start failure, a thrown exception — to `executionLogs`, but
 * nothing ever read it: no toast, no red state, nothing. This suite renders
 * the real <App/> (in its lightweight "no project open" branch — TopBar +
 * ProjectExplorer + ToastContainer + closed modals, no canvas/IPC needed)
 * and drives the shared harness-store singleton directly, the same way a
 * real flow failure would, to confirm the wiring actually reaches the DOM
 * via ToastContainer/addToast rather than a reimplemented notification path.
 *
 * Rendered in the "no project" branch deliberately: the new effect is not
 * gated on `projectPath` (harness-store is a project-agnostic singleton),
 * and ToastContainer is present in both branches, so this is the lightest
 * real render that still exercises the actual wiring end-to-end.
 */
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { useFluxorStore } from './store';
import { useDesktopStore } from './store/desktop-store';
import { useHarnessStore } from './store/harness-store';

beforeEach(() => {
  useFluxorStore.setState(useFluxorStore.getInitialState(), true);
  useDesktopStore.setState(useDesktopStore.getInitialState(), true);
  useHarnessStore.setState(useHarnessStore.getInitialState(), true);
  delete window.fluxorAPI;
});

describe('App — flow-error toast wiring', () => {
  it('raises exactly one error toast, with the store\'s own message, when executionStatus transitions to error', async () => {
    render(<App />);

    act(() => {
      useHarnessStore.setState({
        executionStatus: 'error',
        executionLogs: ['2026-01-01T00:00:00.000Z Harness failed to start: no bridge'],
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Flow execution failed: Harness failed to start: no bridge')).toBeInTheDocument();
    });
    expect(screen.getAllByText(/Flow execution failed/)).toHaveLength(1);
  });

  it('falls back to a generic message when there is no log line to read', async () => {
    render(<App />);

    act(() => {
      useHarnessStore.setState({ executionStatus: 'error', executionLogs: [] });
    });

    await waitFor(() => {
      expect(screen.getByText('Flow execution failed.')).toBeInTheDocument();
    });
  });

  it('does not raise a second toast while executionStatus remains error (e.g. a second failing step in the same run)', async () => {
    render(<App />);

    act(() => {
      useHarnessStore.setState({ executionStatus: 'error', executionLogs: ['first failure'] });
    });
    await waitFor(() => expect(screen.getAllByText(/Flow execution failed/)).toHaveLength(1));

    // A second StepStatusChanged 'error' event within the same failed run
    // appends another log line but the store's `executionStatus` string
    // stays 'error' the whole time — must not produce a second toast.
    act(() => {
      useHarnessStore.setState({ executionLogs: ['first failure', 'second error log, same run'] });
    });

    expect(screen.getAllByText(/Flow execution failed/)).toHaveLength(1);
  });

  it('raises a new toast for a second, independent failure after returning to a non-error status', async () => {
    render(<App />);

    act(() => {
      useHarnessStore.setState({ executionStatus: 'error', executionLogs: ['first failure'] });
    });
    await waitFor(() => expect(screen.getAllByText(/Flow execution failed/)).toHaveLength(1));

    // Back to idle (a fresh compileCurrentCanvas), then a second, unrelated failure.
    act(() => { useHarnessStore.setState({ executionStatus: 'idle' }); });
    act(() => {
      useHarnessStore.setState({ executionStatus: 'error', executionLogs: ['first failure', 'second failure'] });
    });

    await waitFor(() => {
      expect(screen.getAllByText(/Flow execution failed/)).toHaveLength(2);
    });
  });

  it('does not toast anywhere along the clean compiling → running → completed happy path', async () => {
    render(<App />);

    act(() => { useHarnessStore.setState({ executionStatus: 'compiling' }); });
    act(() => { useHarnessStore.setState({ executionStatus: 'running' }); });
    act(() => { useHarnessStore.setState({ executionStatus: 'completed' }); });

    expect(screen.queryByText(/Flow execution failed/)).not.toBeInTheDocument();
  });
});

// Note: the onboarding-toast copy fix (dropping the "Flows tab"/"Roles tab"
// lines) is a static-string change verified by inspection rather than a
// runtime test here — exercising it would require mounting App's
// `projectPath`-set branch (full SeamlessCanvas/react-flow canvas), which is
// a lot of unrelated surface area to mock just to assert on an array
// literal. The error-toast wiring above is the behavior that actually
// needed runtime coverage.
