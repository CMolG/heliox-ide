/**
 * StepRunEvidence.test.tsx — Wiring + regression tests for the evidence surface
 *
 * Focus: the NEW transcript wiring (Task T) — that StepRunEvidence selects
 * `stepThinkings[stepId]` from harness-store and renders the transcript
 * section conditionally — WITHOUT regressing the pre-existing read-only
 * evidence cards (Connections, "Why this model", loop). The exhaustive
 * coverage of those cards lives in StepInfoModal.test.tsx (which renders this
 * component through the modal); this file guards the transcript seam and its
 * coexistence with them.
 *
 * Strategy mirrors StepInfoModal.test.tsx: `harness-store` is mocked (hoisted
 * fixture for the four slices this surface reads); `desktop-store` is the REAL
 * store (pure client state — supplies `findOwningFrame` + `addWindow`).
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDesktopStore } from '../../../store/desktop-store';
import { StepRunEvidence } from './StepRunEvidence';
import type { StepNodeData } from '@/types/desktop';
import type { RoutedModelEvidence } from '@/types/ipc-events';

type TranscriptEntry = { kind: 'reasoning' | 'text' | 'tool'; text: string };

const mockHarness = vi.hoisted(() => ({
  stepIterations: {} as Record<string, { iteration: number; total: number; loopId: string }>,
  stepModels: {} as Record<string, { modelId: string; evidence?: RoutedModelEvidence }>,
  stepThinkings: {} as Record<string, TranscriptEntry[]>,
}));

vi.mock('../../../store/harness-store', () => ({
  useHarnessStore: (selector: (s: typeof mockHarness) => unknown) => selector(mockHarness),
}));

const STEP_ID = 'step-1';
const STEP_DATA = { title: 'Test Step', mods: [], roles: [] } as StepNodeData;

function renderEvidence(opts?: { status?: string }) {
  return render(
    <StepRunEvidence
      stepId={STEP_ID}
      stepData={STEP_DATA}
      connections={{ incoming: [], outgoing: [] }}
      status={opts?.status as never}
    />,
  );
}

beforeEach(() => {
  useDesktopStore.setState(useDesktopStore.getInitialState(), true);
  mockHarness.stepIterations = {};
  mockHarness.stepModels = {};
  mockHarness.stepThinkings = {};
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('StepRunEvidence — transcript wiring', () => {
  it('is absent when the step has streamed no deltas and is idle', () => {
    renderEvidence();
    expect(screen.queryByTestId('step-info-transcript-section')).not.toBeInTheDocument();
    expect(screen.queryByRole('log')).not.toBeInTheDocument();
  });

  it('renders the transcript when the step has streamed deltas', () => {
    mockHarness.stepThinkings = {
      [STEP_ID]: [
        { kind: 'reasoning', text: 'planning the edit' },
        { kind: 'tool', text: 'write_file({"path":"a.ts"})' },
        { kind: 'text', text: '## Result\n\nAll **done**.' },
      ],
    };
    renderEvidence({ status: 'completed' });

    expect(screen.getByTestId('step-info-transcript-section')).toBeInTheDocument();
    // markdown text entry rendered as real Markdown
    expect(screen.getByRole('heading', { level: 2, name: 'Result' })).toBeInTheDocument();
    // tool + reasoning entries rendered as their dedicated surfaces
    expect(screen.getByTestId('step-transcript-tool-card')).toHaveTextContent('write_file');
    expect(screen.getByTestId('step-transcript-reasoning-toggle')).toBeInTheDocument();
  });

  it('shows the transcript (with a running indicator) mid-run even before any delta', () => {
    renderEvidence({ status: 'running' });
    expect(screen.getByTestId('step-info-transcript-section')).toBeInTheDocument();
    expect(screen.getByTestId('step-transcript-running')).toBeInTheDocument();
  });

  it('scopes the transcript to THIS step (a sibling step\'s deltas do not leak in)', () => {
    mockHarness.stepThinkings = { 'other-step': [{ kind: 'text', text: 'not mine' }] };
    renderEvidence();
    expect(screen.queryByTestId('step-info-transcript-section')).not.toBeInTheDocument();
  });

  it('never renders the file-change section today (no harness file-change source — graceful degradation)', () => {
    mockHarness.stepThinkings = { [STEP_ID]: [{ kind: 'text', text: 'done' }] };
    renderEvidence({ status: 'completed' });
    expect(screen.queryByTestId('step-info-files-section')).not.toBeInTheDocument();
    expect(screen.queryByTestId('step-transcript-file-chips')).not.toBeInTheDocument();
  });
});

describe('StepRunEvidence — regression: existing evidence cards coexist', () => {
  it('still renders the Connections cards alongside a transcript', () => {
    mockHarness.stepThinkings = { [STEP_ID]: [{ kind: 'text', text: 'hi' }] };
    renderEvidence({ status: 'completed' });

    // The transcript did not displace the read-only Connections summary.
    expect(screen.getByTestId('step-info-transcript-section')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Connections' })).toBeInTheDocument();
    expect(screen.getByText('None (root)')).toBeInTheDocument();
  });

  it('still renders the "Why this model" card when routing evidence exists', () => {
    mockHarness.stepModels = {
      [STEP_ID]: {
        modelId: 'anthropic/claude-opus-4.6',
        evidence: { source: 'arena-leaderboard', reason: 'best value', sealed: true },
      },
    };
    renderEvidence();
    expect(screen.getByTestId('step-info-why-model')).toHaveTextContent('anthropic/claude-opus-4.6');
    expect(screen.getByTestId('step-info-benchmarked-pill')).toBeInTheDocument();
  });

  it('the transcript can expand a reasoning row without affecting the rest of the panel', () => {
    mockHarness.stepThinkings = { [STEP_ID]: [{ kind: 'reasoning', text: 'secret plan' }] };
    renderEvidence({ status: 'completed' });

    expect(screen.queryByTestId('step-transcript-reasoning-body')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('step-transcript-reasoning-toggle'));
    expect(screen.getByTestId('step-transcript-reasoning-body')).toHaveTextContent('secret plan');
    // Connections still there after the interaction.
    expect(screen.getByRole('heading', { name: 'Connections' })).toBeInTheDocument();
  });
});
