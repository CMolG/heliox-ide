/**
 * scorecard-panel.test.tsx — Component test for ScorecardPanel
 *
 * Verifies that all three sections of the scorecard render correctly with a
 * mocked IPC result: ground-truth verifiers, CI/judge, and cost/latency.
 * IPC is mocked at the window.helioxAPI boundary so no Electron context is needed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { ScorecardPanel } from '../components/desktop/harness/ScorecardPanel';
import { useHarnessStore } from '../store/harness-store';
import type { ScorecardResult } from '@/types/ipc-events';

// ── Shared mock result (mirrors ScorecardResult exactly) ──────────────────────

const MOCK_RESULT: ScorecardResult = {
  runId: 'pf-test-run-001',
  caseId: 'arch-seed-1',
  suite: 'architecture',
  modelUnderTest: 'test-model/v1',
  verdict: 'pass',
  finalScore: 82,
  semanticScore: 74,
  semanticMaxScore: 90,
  telemetryScore: 8.0,
  judgeError: false,
  groundTruth: {
    tests: {
      ran: true,
      passed: 12,
      failed: 0,
      total: 12,
    },
    a11y: {
      ran: true,
      violations: 1,
      critical: ['color-contrast'],
      passes: 24,
    },
    api: {
      booted: true,
      checks: [
        { name: 'GET /health', ok: true, status: 200, detail: 'ok' },
        { name: 'GET /api/users', ok: false, status: 500, detail: 'Internal Server Error' },
      ],
    },
  },
  telemetry: {
    inputTokens: 12_500,
    outputTokens: 3_200,
    reasoningTokens: 800,
    cacheReadTokens: 4_000,
    cacheWriteTokens: 1_200,
    totalTokens: 21_700,
    latencyMs: 15_400,
    stepCount: 4,
    mcpSyntaxPrecision: 0.96,
  },
  criticalFailures: [],
  bench: {
    n: 5,
    mean: 81.2,
    stdDev: 3.4,
    ci95: { lower: 76.9, upper: 85.5 },
    min: 77,
    max: 86,
  },
};

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  // Reset store to initial state
  useHarnessStore.setState(useHarnessStore.getInitialState(), true);
  // Clean window.helioxAPI
  delete (window as any).helioxAPI;
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ScorecardPanel — empty state', () => {
  it('renders the empty CTA when scorecard is idle', () => {
    render(<ScorecardPanel />);
    // Both the toolbar and empty-state buttons use aria-label "Run Performance Frontier scorecard"
    const btns = screen.getAllByRole('button', { name: /run performance frontier scorecard/i });
    expect(btns.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/no scorecard yet/i)).toBeInTheDocument();
  });

  it('shows the toolbar "Run" button', () => {
    render(<ScorecardPanel />);
    // Both toolbar and empty-state CTA share the same aria-label in idle state
    const btns = screen.getAllByRole('button', { name: /run performance frontier scorecard/i });
    expect(btns.length).toBeGreaterThanOrEqual(1);
  });
});

describe('ScorecardPanel — result rendering', () => {
  beforeEach(() => {
    // Inject a completed scorecard into the store directly
    useHarnessStore.setState({
      scorecard: {
        status: 'done',
        result: MOCK_RESULT,
        error: null,
        progressMessages: [],
        scorecardProgressUnsubscribe: null,
      },
    });
  });

  it('renders the ground-truth verifiers section', () => {
    render(<ScorecardPanel />);
    expect(screen.getByRole('region', { name: /ground truth verifiers/i })).toBeInTheDocument();
  });

  it('renders tests ground-truth sub-section', () => {
    render(<ScorecardPanel />);
    expect(screen.getByRole('region', { name: /ground truth.*tests/i })).toBeInTheDocument();
  });

  it('shows tests passed/total correctly', () => {
    render(<ScorecardPanel />);
    // MetricTile label is "Passed", value is "12/12"
    expect(screen.getByText('12/12')).toBeInTheDocument();
  });

  it('shows ALL PASS status for tests', () => {
    render(<ScorecardPanel />);
    expect(screen.getByText('ALL PASS')).toBeInTheDocument();
  });

  it('renders the a11y section with violation count', () => {
    render(<ScorecardPanel />);
    expect(screen.getByRole('region', { name: /accessibility/i })).toBeInTheDocument();
    // 1 violation badge
    expect(screen.getByText(/1 violation/i)).toBeInTheDocument();
  });

  it('shows critical a11y rules', () => {
    render(<ScorecardPanel />);
    expect(screen.getByText(/color-contrast/i)).toBeInTheDocument();
  });

  it('renders the API verification section', () => {
    render(<ScorecardPanel />);
    expect(screen.getByRole('region', { name: /api verification/i })).toBeInTheDocument();
  });

  it('shows individual HTTP check results', () => {
    render(<ScorecardPanel />);
    expect(screen.getByText('GET /health')).toBeInTheDocument();
    expect(screen.getByText('GET /api/users')).toBeInTheDocument();
  });

  it('renders the judge evaluation section DISTINCTLY from ground truth', () => {
    render(<ScorecardPanel />);
    // Judge section present
    expect(screen.getByRole('region', { name: /judge evaluation/i })).toBeInTheDocument();
    // Ground truth section also present
    expect(screen.getByRole('region', { name: /ground truth verifiers/i })).toBeInTheDocument();
    // Visual divider label separating them
    expect(screen.getByText(/judge evaluation/i)).toBeInTheDocument();
  });

  it('shows the final score prominently', () => {
    render(<ScorecardPanel />);
    expect(screen.getByLabelText(/final score.*82/i)).toBeInTheDocument();
  });

  it('shows verdict badge', () => {
    render(<ScorecardPanel />);
    expect(screen.getByText('PASS')).toBeInTheDocument();
  });

  it('renders the 95% CI from bench statistics', () => {
    render(<ScorecardPanel />);
    expect(screen.getByLabelText(/bench confidence interval/i)).toBeInTheDocument();
    expect(screen.getByText(/95% CI/i)).toBeInTheDocument();
  });

  it('renders the cost and latency telemetry section', () => {
    render(<ScorecardPanel />);
    expect(screen.getByRole('region', { name: /cost.*latency/i })).toBeInTheDocument();
    // latency: 15400ms → 15.40 s
    expect(screen.getByText('15.40 s')).toBeInTheDocument();
  });

  it('shows total token count', () => {
    render(<ScorecardPanel />);
    // 21700 → 21.7k
    expect(screen.getByText('21.7k')).toBeInTheDocument();
  });

  it('shows MCP precision', () => {
    render(<ScorecardPanel />);
    expect(screen.getByText('96.0%')).toBeInTheDocument();
  });
});

describe('ScorecardPanel — loading state', () => {
  it('shows loading indicator and disables run button while running', () => {
    useHarnessStore.setState({
      scorecard: {
        status: 'running',
        result: null,
        error: null,
        progressMessages: [
          { phase: 'running', message: 'Running suite "architecture" (seed=1)…', elapsedMs: 1200 },
        ],
        scorecardProgressUnsubscribe: null,
      },
    });

    render(<ScorecardPanel />);

    const btn = screen.getByRole('button', { name: /scorecard run in progress/i });
    expect(btn).toBeDisabled();
    expect(screen.getByText(/running performance frontier/i)).toBeInTheDocument();
    // The progress message appears in both the phase label and the log list — use getAllByText
    const progressTexts = screen.getAllByText('Running suite "architecture" (seed=1)…');
    expect(progressTexts.length).toBeGreaterThanOrEqual(1);
  });
});

describe('ScorecardPanel — error state', () => {
  it('shows error message and retry button', () => {
    useHarnessStore.setState({
      scorecard: {
        status: 'error',
        result: null,
        error: 'pf:run-scorecard IPC handler is not registered in the preload bridge.',
        progressMessages: [],
        scorecardProgressUnsubscribe: null,
      },
    });

    render(<ScorecardPanel />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/scorecard run failed/i)).toBeInTheDocument();
    expect(screen.getByText(/not registered in the preload/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});

describe('ScorecardPanel — runScorecard action', () => {
  it('calls the IPC bridge when run button clicked', async () => {
    const runScorecard = vi.fn().mockResolvedValue({ success: true, data: MOCK_RESULT });
    (window as any).helioxAPI = { runScorecard };

    render(<ScorecardPanel />);

    // In idle state both toolbar and empty-state CTA share the same aria-label; click the first
    const [runBtn] = screen.getAllByRole('button', { name: /run performance frontier scorecard/i });
    fireEvent.click(runBtn!);

    await waitFor(() => {
      expect(runScorecard).toHaveBeenCalled();
    });
  });

  it('shows error state when IPC bridge is missing', async () => {
    // window.helioxAPI is already deleted in beforeEach
    render(<ScorecardPanel />);

    // Directly call the store action
    await useHarnessStore.getState().runScorecard({});

    expect(useHarnessStore.getState().scorecard.status).toBe('error');
    expect(useHarnessStore.getState().scorecard.error).toMatch(/IPC bridge/i);
  });
});
