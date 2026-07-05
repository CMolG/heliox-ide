/**
 * TimeTravelPanel.test.tsx — Component tests for the ARCH-073 time-travel UI
 *
 * Strategy:
 * - Mount <TimeTravelPanel /> with a mocked `window.helioxAPI` + zustand store reset
 *   before each test.
 * - The mocked `listCheckpoints` returns a deterministic list of 3 checkpoints.
 * - The mocked `harnessReplayFrom` resolves immediately with a synthetic forkRunId.
 * - Assertions target ARIA roles and `data-testid` attributes rather than CSS
 *   class names to keep the test resilient to styling changes.
 *
 * Scenarios covered:
 *   1. Renders loading state while checkpoints are being fetched.
 *   2. Renders the correct number of checkpoint badges after load.
 *   3. Clicking a badge updates the active index and the ARIA slider value.
 *   4. ArrowRight key on the slider advances the active index.
 *   5. Editing the output textarea and clicking "Fork from here" calls
 *      `harnessReplayFrom` with the edited text and shows the fork banner.
 *   6. "No checkpoints" message when the mocked API returns an empty list.
 *   7. Error state when the mocked API returns an error.
 */
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useHarnessStore } from '../../../store/harness-store';
import { TimeTravelPanel } from './TimeTravelPanel';
import type { CheckpointRecord, ListCheckpointsResponse, ReplayFromResponse } from '@/types/ipc-events';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_CHECKPOINTS: CheckpointRecord[] = [
  {
    id: 'ckpt_run1_root_1000',
    runId: 'run1',
    stepId: 'root',
    inputContext: 'System prompt for root',
    output: 'Root output text',
    completedStepIds: ['root'],
    modelId: 'claude-sonnet',
    timestamp: 1_700_000_000_000,
  },
  {
    id: 'ckpt_run1_step-2_2000',
    runId: 'run1',
    stepId: 'step-2',
    inputContext: 'Context for step-2',
    output: 'Step-2 output text',
    completedStepIds: ['root', 'step-2'],
    modelId: 'claude-sonnet',
    timestamp: 1_700_000_001_000,
  },
  {
    id: 'ckpt_run1_step-3_3000',
    runId: 'run1',
    stepId: 'step-3',
    inputContext: 'Context for step-3',
    output: 'Step-3 output text',
    completedStepIds: ['root', 'step-2', 'step-3'],
    modelId: 'claude-sonnet',
    timestamp: 1_700_000_002_000,
  },
];

// Two checkpoints for the SAME real stepId ("b1"), as a loop body pass would
// produce — regression fixture for the "3 identical badges" bug (a loop-back
// step keys every pass's checkpoint under the same stepId; `iteration` is
// what lets the panel tell pass 1 apart from pass 2).
const LOOP_CHECKPOINTS: CheckpointRecord[] = [
  {
    id: 'ckpt_run2_b1_1000',
    runId: 'run2',
    stepId: 'b1',
    iteration: 1,
    inputContext: 'Context for b1 pass 1',
    output: 'b1 output pass 1',
    completedStepIds: ['root', 'b1'],
    modelId: 'claude-sonnet',
    timestamp: 1_700_100_000_000,
  },
  {
    id: 'ckpt_run2_b1_2000',
    runId: 'run2',
    stepId: 'b1',
    iteration: 2,
    inputContext: 'Context for b1 pass 2',
    output: 'b1 output pass 2',
    completedStepIds: ['root', 'b1', 'b1'],
    modelId: 'claude-sonnet',
    timestamp: 1_700_100_001_000,
  },
];

const MOCK_FLOW = {
  id: 'flow-test',
  name: 'Test flow',
  rootStepId: 'root',
  stepsRecord: {
    root: {
      id: 'root', type: 'llm_call' as const, prompt: '', tools: [],
      prevStepIds: [], nextStepIds: ['step-2'], mods: [], roles: [], mentalContext: [],
    },
    'step-2': {
      id: 'step-2', type: 'llm_call' as const, prompt: '', tools: [],
      prevStepIds: ['root'], nextStepIds: ['step-3'], mods: [], roles: [], mentalContext: [],
    },
    'step-3': {
      id: 'step-3', type: 'llm_call' as const, prompt: '', tools: [],
      prevStepIds: ['step-2'], nextStepIds: [], mods: [], roles: [], mentalContext: [],
    },
  },
};

// ── Mock `window.helioxAPI` ───────────────────────────────────────────────────

function setupMockAPI(overrides?: {
  listCheckpoints?: (runId: string) => Promise<ListCheckpointsResponse>;
  harnessReplayFrom?: () => Promise<ReplayFromResponse>;
}) {
  const listCheckpoints = overrides?.listCheckpoints ??
    vi.fn((_runId: string): Promise<ListCheckpointsResponse> =>
      Promise.resolve({ success: true, data: MOCK_CHECKPOINTS })
    );

  const harnessReplayFrom = overrides?.harnessReplayFrom ??
    vi.fn((): Promise<ReplayFromResponse> =>
      Promise.resolve({
        success: true,
        data: {
          forkRunId: 'run1_fork_9999',
          seededStepIds: ['root', 'step-2'],
          isDeterministicReplay: false,
        },
      })
    );

  Object.defineProperty(window, 'helioxAPI', {
    value: { listCheckpoints, harnessReplayFrom },
    writable: true,
    configurable: true,
  });

  return { listCheckpoints, harnessReplayFrom };
}

// ── Store reset helper ────────────────────────────────────────────────────────

function resetStore() {
  useHarnessStore.setState((s) => ({
    ...s,
    checkpointState: {
      status: 'idle',
      checkpoints: [],
      activeIndex: -1,
      highlightedStepId: null,
      editedOutput: null,
      error: null,
      lastForkRunId: null,
    },
  }));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetStore();
});

describe('TimeTravelPanel — loading state', () => {
  it('shows a loading indicator while checkpoints are being fetched', async () => {
    // Delay the API response so we can observe the loading state
    let resolveApi!: (v: ListCheckpointsResponse) => void;
    const pendingApi = new Promise<ListCheckpointsResponse>((res) => { resolveApi = res; });
    setupMockAPI({ listCheckpoints: vi.fn(() => pendingApi) });

    render(<TimeTravelPanel runId="run1" flow={MOCK_FLOW} />);

    // The loading indicator should be visible immediately
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/loading checkpoints/i)).toBeInTheDocument();

    // Resolve and clean up
    await act(async () => { resolveApi({ success: true, data: [] }); });
  });
});

describe('TimeTravelPanel — checkpoint list', () => {
  it('renders one badge per checkpoint after loading', async () => {
    setupMockAPI();
    render(<TimeTravelPanel runId="run1" flow={MOCK_FLOW} />);

    // Wait for async loadCheckpoints to complete
    await waitFor(() => {
      // slider should now be in the DOM
      expect(screen.getByRole('slider')).toBeInTheDocument();
    });

    // 3 checkpoint badges labelled by stepId
    // Note: stepId "root" appears both in the badge row and the inspector meta row —
    // use getAllByText and assert at least one matches each stepId.
    expect(screen.getAllByText('root').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('step-2').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('step-3').length).toBeGreaterThanOrEqual(1);
  });

  it('shows ARIA slider valuenow=1 for the first checkpoint', async () => {
    setupMockAPI();
    render(<TimeTravelPanel runId="run1" flow={MOCK_FLOW} />);

    await waitFor(() => expect(screen.getByRole('slider')).toBeInTheDocument());

    const slider = screen.getByRole('slider');
    expect(slider).toHaveAttribute('aria-valuenow', '1');
    expect(slider).toHaveAttribute('aria-valuemax', '3');
  });
});

describe('TimeTravelPanel — keyboard navigation', () => {
  it('ArrowRight on the slider advances to the next checkpoint', async () => {
    setupMockAPI();
    render(<TimeTravelPanel runId="run1" flow={MOCK_FLOW} />);

    await waitFor(() => expect(screen.getByRole('slider')).toBeInTheDocument());

    const slider = screen.getByRole('slider');
    slider.focus();

    // Start at index 0 (valuenow=1), press ArrowRight → index 1 (valuenow=2)
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(slider).toHaveAttribute('aria-valuenow', '2');
  });

  it('ArrowLeft on the slider does not go below 0', async () => {
    setupMockAPI();
    render(<TimeTravelPanel runId="run1" flow={MOCK_FLOW} />);

    await waitFor(() => expect(screen.getByRole('slider')).toBeInTheDocument());

    const slider = screen.getByRole('slider');
    slider.focus();
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    // Already at index 0, should stay at 1
    expect(slider).toHaveAttribute('aria-valuenow', '1');
  });

  it('End key jumps to the last checkpoint', async () => {
    setupMockAPI();
    render(<TimeTravelPanel runId="run1" flow={MOCK_FLOW} />);

    await waitFor(() => expect(screen.getByRole('slider')).toBeInTheDocument());

    const slider = screen.getByRole('slider');
    slider.focus();
    fireEvent.keyDown(slider, { key: 'End' });
    expect(slider).toHaveAttribute('aria-valuenow', '3');
  });

  it('Home key jumps back to the first checkpoint', async () => {
    setupMockAPI();
    render(<TimeTravelPanel runId="run1" flow={MOCK_FLOW} />);

    await waitFor(() => expect(screen.getByRole('slider')).toBeInTheDocument());

    const slider = screen.getByRole('slider');
    slider.focus();
    // Jump to end first
    fireEvent.keyDown(slider, { key: 'End' });
    expect(slider).toHaveAttribute('aria-valuenow', '3');
    // Now jump back to Home
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(slider).toHaveAttribute('aria-valuenow', '1');
  });
});

describe('TimeTravelPanel — fork action', () => {
  it('calls harnessReplayFrom with the edited output and shows the fork banner', async () => {
    const { harnessReplayFrom } = setupMockAPI();

    render(<TimeTravelPanel runId="run1" flow={MOCK_FLOW} />);

    await waitFor(() => expect(screen.getByRole('slider')).toBeInTheDocument());

    // The textarea is pre-filled with the first checkpoint's output
    const textarea = screen.getByRole('textbox', { name: /edit step output/i });
    expect(textarea).toBeInTheDocument();

    // Fire a change event with a new value
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'EDITED OUTPUT TEXT' } });
    });

    // Click "Fork from here" — matches the aria-label "Fork from here (step root)"
    const forkBtn = screen.getByRole('button', { name: /fork from here/i });
    await act(async () => {
      fireEvent.click(forkBtn);
    });

    // API called with the edited output
    await waitFor(() => {
      expect(harnessReplayFrom).toHaveBeenCalledWith(
        MOCK_FLOW,
        MOCK_CHECKPOINTS[0].id,
        'EDITED OUTPUT TEXT',
      );
    });

    // Fork banner appears with the new runId
    await waitFor(() => {
      expect(screen.getByTestId('fork-banner')).toBeInTheDocument();
    });
    expect(screen.getByText(/fork created/i)).toBeInTheDocument();
  });
});

describe('TimeTravelPanel — empty and error states', () => {
  it('shows "no checkpoints" message when API returns an empty list', async () => {
    setupMockAPI({
      listCheckpoints: vi.fn(() =>
        Promise.resolve({ success: true, data: [] })
      ),
    });
    render(<TimeTravelPanel runId="run1" flow={MOCK_FLOW} />);

    await waitFor(() => {
      expect(screen.getByText(/no checkpoints for this run yet/i)).toBeInTheDocument();
    });
  });

  it('shows an error message when the API returns a failure', async () => {
    setupMockAPI({
      listCheckpoints: vi.fn(() =>
        Promise.resolve({ success: false, error: 'Database unavailable' })
      ),
    });
    render(<TimeTravelPanel runId="run1" flow={MOCK_FLOW} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText(/database unavailable/i)).toBeInTheDocument();
    });
  });

  it('shows "start a run" message when runId is null', () => {
    setupMockAPI();
    render(<TimeTravelPanel runId={null} flow={null} />);
    expect(screen.getByText(/start a run to enable time travel/i)).toBeInTheDocument();
  });
});

describe('TimeTravelPanel — loop iteration badges', () => {
  it('gives two same-stepId checkpoints distinguishable badge labels via their pass number', async () => {
    setupMockAPI({
      listCheckpoints: vi.fn((_runId: string) =>
        Promise.resolve({ success: true, data: LOOP_CHECKPOINTS })
      ),
    });

    render(<TimeTravelPanel runId="run2" flow={MOCK_FLOW} />);

    await waitFor(() => expect(screen.getByRole('slider')).toBeInTheDocument());

    // Both badges are labelled "b1" but must remain distinguishable — the
    // pass number in the accessible name is what makes badge 1 and badge 2
    // tell apart instead of reading as two identical "step b1" entries.
    // `hidden: true` because the badge row sits under an `aria-hidden`
    // wrapper (the slider track is the real, reachable a11y control — see
    // the "ARIA slider value text" test below); this only asserts the
    // per-badge aria-label text itself is correct.
    expect(
      screen.getByRole('button', { name: /checkpoint 1: step b1, pass 1,/i, hidden: true }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /checkpoint 2: step b1, pass 2,/i, hidden: true }),
    ).toBeInTheDocument();
  });

  it('reflects the active checkpoint\'s pass number in the ARIA slider value text', async () => {
    setupMockAPI({
      listCheckpoints: vi.fn((_runId: string) =>
        Promise.resolve({ success: true, data: LOOP_CHECKPOINTS })
      ),
    });

    render(<TimeTravelPanel runId="run2" flow={MOCK_FLOW} />);

    await waitFor(() => expect(screen.getByRole('slider')).toBeInTheDocument());

    const slider = screen.getByRole('slider');
    expect(slider).toHaveAttribute('aria-valuetext', expect.stringContaining('pass 1'));

    slider.focus();
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(slider).toHaveAttribute('aria-valuetext', expect.stringContaining('pass 2'));
  });

  it('shows an "Iteration N" row in the state inspector and updates it as the active checkpoint changes', async () => {
    setupMockAPI({
      listCheckpoints: vi.fn((_runId: string) =>
        Promise.resolve({ success: true, data: LOOP_CHECKPOINTS })
      ),
    });

    render(<TimeTravelPanel runId="run2" flow={MOCK_FLOW} />);

    await waitFor(() => expect(screen.getByRole('slider')).toBeInTheDocument());

    // Pass 1 is active by default (first checkpoint loaded).
    expect(screen.getByText('Iteration 1')).toBeInTheDocument();

    const slider = screen.getByRole('slider');
    slider.focus();
    fireEvent.keyDown(slider, { key: 'ArrowRight' });

    expect(screen.getByText('Iteration 2')).toBeInTheDocument();
  });

  it('does not render an Iteration row for checkpoints with no iteration field (non-loop steps)', async () => {
    // MOCK_CHECKPOINTS (top of file) has no `iteration` field on any entry —
    // the panel must not fabricate an iteration row for plain, single-pass steps.
    setupMockAPI();
    render(<TimeTravelPanel runId="run1" flow={MOCK_FLOW} />);

    await waitFor(() => expect(screen.getByRole('slider')).toBeInTheDocument());

    expect(screen.queryByText(/^Iteration \d+$/)).not.toBeInTheDocument();
  });
});
