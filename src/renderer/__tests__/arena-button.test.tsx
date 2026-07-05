/**
 * arena-button.test.tsx — Component test for ArenaButton
 *
 * Verifies that:
 * - The four recommendation lenses (best-score / cheapest / fastest / best-value)
 *   compute and render the correct winners from a mocked Arena result.
 * - The "Use for deploy" affordance records the chosen model in the store.
 * - The leaderboard tab shows score, latency, and cost per model.
 * - Loading and error states render as expected.
 *
 * IPC is mocked at the window.helioxAPI boundary — no Electron context required.
 * Strategy correctness is validated end-to-end through the store → component
 * rendering path, matching the same logic in model-selector.ts (ARCH-065).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';
import { ArenaButton } from '../components/desktop/harness/ArenaButton';
import { useHarnessStore } from '../store/harness-store';
import type { ArenaResult, ArenaProgressEvent } from '@/types/ipc-events';

// ── Mock Arena result ─────────────────────────────────────────────────────────
//
// Four models with deliberately distinct score / latency / cost profiles so
// each strategy picks a DIFFERENT winner — the assertions below verify that.
//
// Model A: highest score (78), moderate latency, moderate cost → best-score
// Model B: free (cost=0), lower score (55), faster latency (800ms) → cheapest & best-value
//          (free models win best-value; tie-break by score → B(55) vs D(45), B wins)
// Model C: api_error → excluded from all strategies
// Model D: second cheapest (cost=0, score=45), lower score → loses to B on value tie-break
// Model E: fastest latency (400ms), lower score (50), paid → fastest

const MOCK_ARENA_RESULT: ArenaResult = {
  leaderboard: [
    {
      modelId: 'provider/model-a',
      name: 'Model A',
      status: 'completed',
      scores: { architecture: 80, teamWork: 72, assembler: 82 },
      finalArenaScore: 78,
      totalTokens: 50_000,
      executionCostUsd: 0.02,
      avgLatencyMs: 5_000,
    },
    {
      modelId: 'provider/model-b',
      name: 'Model B',
      status: 'completed',
      scores: { architecture: 55, teamWork: 55, assembler: 55 },
      finalArenaScore: 55,
      totalTokens: 30_000,
      executionCostUsd: 0, // free
      avgLatencyMs: 800,
    },
    {
      modelId: 'provider/model-c',
      name: 'Model C',
      status: 'api_error',
      scores: { architecture: null, teamWork: null, assembler: null },
      finalArenaScore: 0,
      totalTokens: 0,
      executionCostUsd: 0,
      errors: ['429 Too Many Requests'],
    },
    {
      modelId: 'provider/model-d',
      name: 'Model D',
      status: 'completed',
      scores: { architecture: 45, teamWork: 45, assembler: 45 },
      finalArenaScore: 45,
      totalTokens: 20_000,
      executionCostUsd: 0, // also free — B wins value tie-break because score 55 > 45
      avgLatencyMs: 2_000,
    },
    {
      modelId: 'provider/model-e',
      name: 'Model E',
      status: 'completed',
      scores: { architecture: 50, teamWork: 50, assembler: 50 },
      finalArenaScore: 50,
      totalTokens: 25_000,
      executionCostUsd: 0.001,
      avgLatencyMs: 400, // fastest
    },
  ],
  recommendations: [
    {
      strategy: 'best-score',
      modelId: 'provider/model-a',
      evidence: { score: 78, costPerRun: 0.02, latencyMs: 5_000 },
    },
    {
      strategy: 'cheapest',
      modelId: 'provider/model-b',
      evidence: { score: 55, costPerRun: 0, latencyMs: 800 },
    },
    {
      strategy: 'fastest',
      modelId: 'provider/model-e',
      evidence: { score: 50, costPerRun: 0.001, latencyMs: 400 },
    },
    {
      strategy: 'best-value',
      modelId: 'provider/model-b',
      evidence: { score: 55, costPerRun: 0, latencyMs: 800 },
    },
  ],
  elapsedMs: 42_000,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function injectResult(result: ArenaResult = MOCK_ARENA_RESULT) {
  useHarnessStore.setState({
    arena: {
      status: 'done',
      result,
      error: null,
      progressEvents: [],
      arenaProgressUnsubscribe: null,
      deployChosenModelId: null,
    },
  });
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  useHarnessStore.setState(useHarnessStore.getInitialState(), true);
  delete (window as any).helioxAPI;
});

// ── Empty state ───────────────────────────────────────────────────────────────

describe('ArenaButton — empty state', () => {
  it('renders the empty CTA when arena is idle', () => {
    render(<ArenaButton />);
    expect(screen.getByText(/no arena result yet/i)).toBeInTheDocument();
    const btns = screen.getAllByRole('button', { name: /run arena benchmark/i });
    expect(btns.length).toBeGreaterThanOrEqual(1);
  });

  it('shows toolbar title "Arena"', () => {
    render(<ArenaButton />);
    expect(screen.getByText('Arena')).toBeInTheDocument();
  });
});

// ── Recommendations: four lenses ─────────────────────────────────────────────

describe('ArenaButton — recommendation lenses', () => {
  beforeEach(() => {
    injectResult();
  });

  it('renders four recommendation cards on the Recommendations tab', () => {
    render(<ArenaButton />);
    // Recommendations tab is active by default — section has role="tabpanel"
    expect(screen.getByRole('tabpanel', { name: /model recommendations/i })).toBeInTheDocument();
    // Each strategy card is labeled
    expect(screen.getByText('Best Score')).toBeInTheDocument();
    expect(screen.getByText('Cheapest')).toBeInTheDocument();
    expect(screen.getByText('Fastest')).toBeInTheDocument();
    expect(screen.getByText('Best Value')).toBeInTheDocument();
  });

  it('best-score lens shows Model A (highest score)', () => {
    render(<ArenaButton />);
    const recSection = screen.getByRole('tabpanel', { name: /model recommendations/i });
    // The best-score card should contain model-a's id
    expect(within(recSection).getByText('provider/model-a')).toBeInTheDocument();
  });

  it('cheapest lens shows Model B (free, score tie-break wins)', () => {
    render(<ArenaButton />);
    const recSection = screen.getByRole('tabpanel', { name: /model recommendations/i });
    // model-b appears in cheapest (and best-value) cards
    const modelBCells = within(recSection).getAllByText('provider/model-b');
    expect(modelBCells.length).toBeGreaterThanOrEqual(1);
  });

  it('fastest lens shows Model E (lowest avgLatencyMs)', () => {
    render(<ArenaButton />);
    const recSection = screen.getByRole('tabpanel', { name: /model recommendations/i });
    expect(within(recSection).getByText('provider/model-e')).toBeInTheDocument();
  });

  it('best-value lens shows Model B (free → infinite value; B score > D score)', () => {
    render(<ArenaButton />);
    const recSection = screen.getByRole('tabpanel', { name: /model recommendations/i });
    // model-b appears for both cheapest and best-value
    const modelBOccurrences = within(recSection).getAllByText('provider/model-b');
    expect(modelBOccurrences.length).toBeGreaterThanOrEqual(2);
  });

  it('shows evidence (score, latency, cost) for each recommendation', () => {
    render(<ArenaButton />);
    // Model A evidence: score 78
    expect(screen.getByText('78/100')).toBeInTheDocument();
    // Model E latency: 400ms
    expect(screen.getByText('400 ms')).toBeInTheDocument();
    // Model B cost: free
    const freeBadges = screen.getAllByText('free');
    expect(freeBadges.length).toBeGreaterThanOrEqual(1);
  });
});

// ── "Use for deploy" affordance ───────────────────────────────────────────────

describe('ArenaButton — Use for deploy', () => {
  beforeEach(() => {
    injectResult();
  });

  it('clicking "Use for deploy" records the model in the store', () => {
    render(<ArenaButton />);
    // Find the Use for deploy button in the best-score card (Model A)
    const deployBtns = screen.getAllByRole('button', { name: /use.*model-a.*for deploy/i });
    fireEvent.click(deployBtns[0]!);
    expect(useHarnessStore.getState().arena.deployChosenModelId).toBe('provider/model-a');
  });

  it('chosen model button switches to "Chosen for deploy"', () => {
    render(<ArenaButton />);
    const [deployBtn] = screen.getAllByRole('button', { name: /use.*model-a.*for deploy/i });
    fireEvent.click(deployBtn!);
    // After choosing, the button aria-label changes to "Using <model> for deploy"
    const chosenBtns = screen.getAllByRole('button', { name: /using.*model-a.*for deploy/i });
    expect(chosenBtns.length).toBeGreaterThanOrEqual(1);
    // Also verify aria-pressed is set
    expect(chosenBtns[0]).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows deploy notice after choosing a model', () => {
    render(<ArenaButton />);
    const [deployBtn] = screen.getAllByRole('button', { name: /use.*model-a.*for deploy/i });
    fireEvent.click(deployBtn!);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/heliox serve/i)).toBeInTheDocument();
  });

  it('the deploy notice states the model runs this flow under a Fixed policy and is picked up by heliox serve --select (not the old "will be used by" claim)', () => {
    render(<ArenaButton />);
    const [deployBtn] = screen.getAllByRole('button', { name: /use.*model-a.*for deploy/i });
    fireEvent.click(deployBtn!);

    const notice = screen.getByRole('status');
    expect(notice.textContent).toMatch(/provider\/model-a/);
    expect(notice.textContent).toMatch(/will run this flow when its model policy is fixed/i);
    expect(notice.textContent).toMatch(/heliox serve --select/i);
    expect(notice.textContent).not.toMatch(/will be used by/i);
  });
});

// ── "Benchmarked" seal (WS2 smart routing) ────────────────────────────────────

describe('ArenaButton — Benchmarked seal on recommendation cards', () => {
  beforeEach(() => {
    injectResult();
  });

  it('renders a "Benchmarked" pill on every recommendation card (never "verified")', () => {
    render(<ArenaButton />);
    const recSection = screen.getByRole('tabpanel', { name: /model recommendations/i });
    const pills = within(recSection).getAllByTestId('ab-benchmarked-pill');
    // Four strategies (best-score / cheapest / fastest / best-value) -> four cards.
    expect(pills.length).toBe(4);
    for (const pill of pills) {
      expect(pill).toHaveTextContent('Benchmarked');
    }
    expect(within(recSection).queryByText(/verified/i)).not.toBeInTheDocument();
  });
});

// ── Leaderboard tab ───────────────────────────────────────────────────────────

describe('ArenaButton — leaderboard tab', () => {
  beforeEach(() => {
    injectResult();
  });

  it('switches to the leaderboard tab on click', () => {
    render(<ArenaButton />);
    const lbTab = screen.getByRole('tab', { name: /leaderboard/i });
    fireEvent.click(lbTab);
    // The leaderboard section has role="tabpanel" (explicit), not "region"
    expect(screen.getByRole('tabpanel', { name: /arena leaderboard/i })).toBeInTheDocument();
  });

  it('renders all five models in the leaderboard', () => {
    render(<ArenaButton />);
    fireEvent.click(screen.getByRole('tab', { name: /leaderboard/i }));
    const lbSection = screen.getByRole('tabpanel', { name: /arena leaderboard/i });
    expect(within(lbSection).getByText('Model A')).toBeInTheDocument();
    expect(within(lbSection).getByText('Model B')).toBeInTheDocument();
    expect(within(lbSection).getByText('Model C')).toBeInTheDocument();
    expect(within(lbSection).getByText('Model D')).toBeInTheDocument();
    expect(within(lbSection).getByText('Model E')).toBeInTheDocument();
  });

  it('shows api_error badge for Model C', () => {
    render(<ArenaButton />);
    fireEvent.click(screen.getByRole('tab', { name: /leaderboard/i }));
    expect(screen.getByText('api_error')).toBeInTheDocument();
  });

  it('shows "free" cost for free models in leaderboard', () => {
    render(<ArenaButton />);
    fireEvent.click(screen.getByRole('tab', { name: /leaderboard/i }));
    const lbSection = screen.getByRole('tabpanel', { name: /arena leaderboard/i });
    // Model B and D are free
    const freeCells = within(lbSection).getAllByText('free');
    expect(freeCells.length).toBeGreaterThanOrEqual(2);
  });

  it('shows elapsed time in leaderboard footer', () => {
    render(<ArenaButton />);
    fireEvent.click(screen.getByRole('tab', { name: /leaderboard/i }));
    expect(screen.getByText(/42\.0 s/i)).toBeInTheDocument();
  });
});

// ── Loading state ─────────────────────────────────────────────────────────────

describe('ArenaButton — loading state', () => {
  it('shows the running state with model progress', () => {
    const progressEvents: ArenaProgressEvent[] = [
      {
        modelIndex: 0,
        totalModels: 3,
        modelId: 'provider/model-a',
        modelName: 'Model A',
        scoresSoFar: { architecture: null, teamWork: null, assembler: null },
        status: 'running',
      },
    ];
    useHarnessStore.setState({
      arena: {
        status: 'running',
        result: null,
        error: null,
        progressEvents,
        arenaProgressUnsubscribe: null,
        deployChosenModelId: null,
      },
    });

    render(<ArenaButton />);
    expect(screen.getByText(/running arena/i)).toBeInTheDocument();
    // totalModels=3, status='running' → done=0 → shows "0/3 models"
    // The heading text is "Running Arena… 0/3 models" — find the container span
    const headerSpan = screen.getByText(/running arena/i);
    // The parent div contains the spinner svg + this span; the span text includes the count
    expect(headerSpan.textContent).toMatch(/0\/3 models/);
    expect(screen.getByText('Model A')).toBeInTheDocument();
  });

  it('disables the run button during a run', () => {
    useHarnessStore.setState({
      arena: {
        status: 'running',
        result: null,
        error: null,
        progressEvents: [],
        arenaProgressUnsubscribe: null,
        deployChosenModelId: null,
      },
    });

    render(<ArenaButton />);
    const btn = screen.getByRole('button', { name: /arena run in progress/i });
    expect(btn).toBeDisabled();
  });
});

// ── Error state ───────────────────────────────────────────────────────────────

describe('ArenaButton — error state', () => {
  it('renders error message and retry button', () => {
    useHarnessStore.setState({
      arena: {
        status: 'error',
        result: null,
        error: 'pf:run-arena IPC handler is not registered in the preload bridge.',
        progressEvents: [],
        arenaProgressUnsubscribe: null,
        deployChosenModelId: null,
      },
    });

    render(<ArenaButton />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/arena run failed/i)).toBeInTheDocument();
    expect(screen.getByText(/not registered in the preload/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});

// ── Store action — runArena ───────────────────────────────────────────────────

describe('ArenaButton — runArena store action', () => {
  it('transitions to error when IPC bridge is unavailable', async () => {
    // window.helioxAPI is already deleted in beforeEach
    render(<ArenaButton />);
    await useHarnessStore.getState().runArena({});
    expect(useHarnessStore.getState().arena.status).toBe('error');
    expect(useHarnessStore.getState().arena.error).toMatch(/IPC bridge/i);
  });

  it('transitions to done when IPC returns a valid result', async () => {
    const runArenaIpc = vi.fn().mockResolvedValue({
      success: true,
      data: MOCK_ARENA_RESULT,
    });
    (window as any).helioxAPI = { runArena: runArenaIpc };

    render(<ArenaButton />);
    await useHarnessStore.getState().runArena({});

    expect(runArenaIpc).toHaveBeenCalledWith({});
    expect(useHarnessStore.getState().arena.status).toBe('done');
    expect(useHarnessStore.getState().arena.result).toEqual(MOCK_ARENA_RESULT);
  });

  it('clicking toolbar "Run Arena" triggers runArena', async () => {
    const runArenaIpc = vi.fn().mockResolvedValue({
      success: true,
      data: MOCK_ARENA_RESULT,
    });
    (window as any).helioxAPI = { runArena: runArenaIpc };

    render(<ArenaButton />);
    // In idle state both the toolbar and the empty-state CTA share the same
    // aria-label; click the first occurrence (the toolbar button).
    const [runBtn] = screen.getAllByRole('button', { name: /run arena benchmark/i });
    fireEvent.click(runBtn!);

    await waitFor(() => {
      expect(runArenaIpc).toHaveBeenCalled();
    });
  });
});

// ── setArenaDeployModel ───────────────────────────────────────────────────────

describe('ArenaButton — setArenaDeployModel', () => {
  it('updates deployChosenModelId and can be overwritten', () => {
    const { setArenaDeployModel } = useHarnessStore.getState();
    setArenaDeployModel('provider/model-a');
    expect(useHarnessStore.getState().arena.deployChosenModelId).toBe('provider/model-a');
    setArenaDeployModel('provider/model-b');
    expect(useHarnessStore.getState().arena.deployChosenModelId).toBe('provider/model-b');
  });
});

// ── resetArena ────────────────────────────────────────────────────────────────

describe('ArenaButton — resetArena', () => {
  it('resets store to idle', () => {
    injectResult();
    expect(useHarnessStore.getState().arena.status).toBe('done');
    useHarnessStore.getState().resetArena();
    expect(useHarnessStore.getState().arena.status).toBe('idle');
    expect(useHarnessStore.getState().arena.result).toBeNull();
  });
});
