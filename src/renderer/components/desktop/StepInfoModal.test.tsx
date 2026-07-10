/**
 * StepInfoModal.test.tsx — Component tests for the read-only "Run evidence" panel
 *
 * Phase 8 surgery: StepConfigCore (the Instructions/Role/Mod/Execution
 * editing surface) moved out of this modal into the right-side Inspector
 * (`components/inspector/StepInspector.tsx`), which now owns that coverage —
 * see InspectorPanel.test.tsx. This file keeps only what StepInfoModal still
 * renders: the panel chrome (dialog semantics, focus trap, Escape) + the
 * StatusBadge + StepRunEvidence's "Why this model"/Connections/Loop cards.
 * The Instructions/Role/Mod/Execution-control/Model-override test bodies
 * below were TRANSPLANTED — not deleted — into InspectorPanel.test.tsx,
 * which renders `<InspectorPanel/>` with a step selected and exercises the
 * exact same testids (StepConfigCore is embedded there unchanged).
 *
 * Strategy:
 * - Mount <StepInfoModal /> against the REAL `desktop-store` (it is pure
 *   client-side state, no IPC), seeded via `addStepNode` so `stepData`
 *   passed in matches what StepInspector would actually hand down.
 * - `harness-store` IS mocked (hoisted fixture for `stepIterations`/
 *   `stepModels`, both read by StepRunEvidence) since the real
 *   implementation dispatches through IPC/`window.fluxorAPI`, which isn't
 *   available in this environment.
 *
 * Scenarios covered:
 *   1. Dialog semantics + testids (heading now reads "Run evidence").
 *   2. Execution status badge.
 *   3. Keyboard: Escape closes; focus is trapped on the close button (the
 *      panel's only focusable element now that StepConfigCore is gone).
 *   4. Loop connections (loopOut/loopIn/live iteration) cards.
 *   5. "Why this model" routing-evidence card (WS2 smart routing).
 */
import React from 'react';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDesktopStore } from '../../store/desktop-store';
import { StepInfoModal } from './StepInfoModal';
import type { StepNodeData } from '@/types/desktop';
import type { RoutedModelEvidence } from '@/types/ipc-events';

// ── Mock harness-store (execution is out of scope for this file) ───────────

const mockHarness = vi.hoisted(() => ({
  stepIterations: {} as Record<string, { iteration: number; total: number; loopId: string }>,
  stepModels: {} as Record<string, { modelId: string; evidence?: RoutedModelEvidence }>,
}));

vi.mock('../../store/harness-store', () => ({
  useHarnessStore: (selector: (s: typeof mockHarness) => unknown) => selector(mockHarness),
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

function seedStep(overrides?: Partial<{ prompt: string; description: string }>) {
  const stepId = useDesktopStore.getState().addStepNode({
    position: { x: 0, y: 0 },
    title: 'Test Step',
    description: overrides?.description,
    prompt: overrides?.prompt,
  });
  const stepData = (useDesktopStore.getState().mentalNodes.find((n) => n.id === stepId) as { data: StepNodeData }).data;
  return { stepId, stepData };
}

/**
 * Seeds a Step nested inside a Frame (via `parentId`), optionally setting the
 * Frame's `contextMode`. Only the Context-mode badge suite below needs an
 * owning Frame — every other suite in this file uses the frame-less
 * `seedStep()` above, which doubles as this feature's "no owning frame ⇒ no
 * badge" case.
 */
function seedStepInFrame(contextMode?: 'blind' | 'feedback') {
  const frameId = useDesktopStore.getState().addFrameNode({
    position: { x: 0, y: 0 },
    width: 400,
    height: 300,
    title: 'Test Flow',
  });
  const stepId = useDesktopStore.getState().addStepNode({
    position: { x: 0, y: 0 },
    title: 'Test Step',
    parentId: frameId,
  });
  if (contextMode !== undefined) {
    useDesktopStore.getState().updateFrameData(frameId, { contextMode });
  }
  const stepData = (useDesktopStore.getState().mentalNodes.find((n) => n.id === stepId) as { data: StepNodeData }).data;
  return { stepId, stepData, frameId };
}

function renderModal(stepId: string, stepData: StepNodeData, opts?: {
  status?: string;
  onClose?: () => void;
  connections?: {
    incoming?: string[];
    outgoing?: string[];
    loopOut?: { toTitle: string; maxIterations: number };
    loopIn?: { fromTitle: string; maxIterations: number };
  };
}) {
  return render(
    <StepInfoModal
      stepId={stepId}
      stepData={stepData}
      connections={{ incoming: [], outgoing: [], ...opts?.connections }}
      status={opts?.status as never}
      onClose={opts?.onClose ?? vi.fn()}
    />,
  );
}

beforeEach(() => {
  useDesktopStore.setState(useDesktopStore.getInitialState(), true);
  mockHarness.stepIterations = {};
  mockHarness.stepModels = {};
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Dialog semantics ─────────────────────────────────────────────────────────

describe('StepInfoModal — dialog semantics', () => {
  it('renders with the expected testid, role, and accessible name', () => {
    const { stepId, stepData } = seedStep();
    renderModal(stepId, stepData);

    const dialog = screen.getByTestId('step-info-modal');
    expect(dialog).toHaveAttribute('role', 'dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-label', 'Run evidence: Test Step');
    expect(screen.getByTestId('step-info-modal-close')).toBeInTheDocument();
    // Phase 8: the heading is now a static "Run evidence" label — the step's
    // own title moved to the small kicker line below it (still visible here
    // too, and it's the primary identity shown in the Inspector this popup
    // is opened from).
    expect(screen.getByRole('heading', { name: 'Run evidence' })).toBeInTheDocument();
  });

  it('focuses the close button on mount', () => {
    const { stepId, stepData } = seedStep();
    renderModal(stepId, stepData);
    expect(screen.getByTestId('step-info-modal-close')).toHaveFocus();
  });
});

// ── Execution status badge ───────────────────────────────────────────────────

describe('StepInfoModal — status badge', () => {
  it('shows the execution status badge', () => {
    const { stepId, stepData } = seedStep();
    renderModal(stepId, stepData, { status: 'completed' });
    expect(screen.getByTestId('step-info-status')).toHaveTextContent('completed');
  });

  it('defaults to "idle" when no status is given', () => {
    const { stepId, stepData } = seedStep();
    renderModal(stepId, stepData);
    expect(screen.getByTestId('step-info-status')).toHaveTextContent('idle');
  });
});

// ── Keyboard behavior ─────────────────────────────────────────────────────────

describe('StepInfoModal — keyboard behavior', () => {
  it('calls onClose on Escape', () => {
    const { stepId, stepData } = seedStep();
    const onClose = vi.fn();
    renderModal(stepId, stepData, { onClose });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // With StepConfigCore removed (Phase 8 — its Instructions/Role/Mod/
  // Execution controls moved to the Inspector), the ONLY focusable element
  // left inside this trimmed evidence-only panel is the close button itself
  // — StepRunEvidence is read-only (no buttons/inputs/selects). The trap
  // still engages correctly on a single-element focus set: `first` and
  // `last` both resolve to the close button, so Tab/Shift+Tab simply keep
  // focus there instead of "wrapping" anywhere else.
  it('traps focus on the close button — the panel\'s only focusable element', () => {
    const { stepId, stepData } = seedStep();
    renderModal(stepId, stepData);

    const closeButton = screen.getByTestId('step-info-modal-close');
    expect(closeButton).toHaveFocus(); // focused on mount

    fireEvent.keyDown(document, { key: 'Tab' });
    expect(closeButton).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(closeButton).toHaveFocus();
  });
});

// ── Loop connections ─────────────────────────────────────────────────────────

describe('StepInfoModal — loop connections', () => {
  it('renders no loop card when neither loopOut nor loopIn is present', () => {
    const { stepId, stepData } = seedStep();
    renderModal(stepId, stepData);
    expect(screen.queryByTestId('step-info-loop-card')).not.toBeInTheDocument();
  });

  it('renders the loop card when this step is the loop source (loopOut)', () => {
    const { stepId, stepData } = seedStep();
    renderModal(stepId, stepData, { connections: { loopOut: { toTitle: 'Gather Requirements', maxIterations: 4 } } });

    const card = screen.getByTestId('step-info-loop-card');
    expect(card).toBeInTheDocument();
    expect(screen.getByTestId('step-info-loop-out')).toHaveTextContent('×4');
    expect(screen.getByTestId('step-info-loop-out')).toHaveTextContent('Gather Requirements');
    expect(screen.queryByTestId('step-info-loop-in')).not.toBeInTheDocument();
  });

  it('renders the loop card when this step is the loop target (loopIn)', () => {
    const { stepId, stepData } = seedStep();
    renderModal(stepId, stepData, { connections: { loopIn: { fromTitle: 'Review Draft', maxIterations: 5 } } });

    expect(screen.getByTestId('step-info-loop-card')).toBeInTheDocument();
    expect(screen.getByTestId('step-info-loop-in')).toHaveTextContent('×5');
    expect(screen.getByTestId('step-info-loop-in')).toHaveTextContent('Review Draft');
    expect(screen.queryByTestId('step-info-loop-out')).not.toBeInTheDocument();
  });

  it('shows the live iteration when running and stepIterations has an entry for this step', () => {
    const { stepId, stepData } = seedStep();
    mockHarness.stepIterations = { [stepId]: { iteration: 2, total: 4, loopId: 'loop-1' } };
    renderModal(stepId, stepData, {
      status: 'running',
      connections: { loopOut: { toTitle: 'Gather Requirements', maxIterations: 4 } },
    });

    expect(screen.getByTestId('step-info-loop-live')).toHaveTextContent('2');
    expect(screen.getByTestId('step-info-loop-live')).toHaveTextContent('4');
  });

  it('does not show a live iteration line when idle, even if stepIterations has stale data', () => {
    const { stepId, stepData } = seedStep();
    mockHarness.stepIterations = { [stepId]: { iteration: 4, total: 4, loopId: 'loop-1' } };
    renderModal(stepId, stepData, { connections: { loopOut: { toTitle: 'Gather Requirements', maxIterations: 4 } } });

    expect(screen.queryByTestId('step-info-loop-live')).not.toBeInTheDocument();
  });
});

// ── "Why this model" card (Phase 3b — WS2 routing evidence) ─────────────────

describe('StepInfoModal — "Why this model" card', () => {
  it('is absent when no run has produced routing evidence for this step', () => {
    const { stepId, stepData } = seedStep();
    renderModal(stepId, stepData);
    expect(screen.queryByTestId('step-info-why-model')).not.toBeInTheDocument();
  });

  it('renders modelId, reason, and numeric evidence when present', () => {
    const { stepId, stepData } = seedStep();
    mockHarness.stepModels = {
      [stepId]: {
        modelId: 'anthropic/claude-opus-4.6',
        evidence: {
          source: 'arena-leaderboard',
          reason: 'best-value winner: score 82 at $0.004/run',
          strategy: 'best-value',
          score: 82,
          costPerRun: 0.004,
          latencyMs: 1200,
          sealed: true,
        },
      },
    };
    renderModal(stepId, stepData);

    const card = screen.getByTestId('step-info-why-model');
    expect(card).toHaveTextContent('anthropic/claude-opus-4.6');
    expect(card).toHaveTextContent('best-value winner: score 82 at $0.004/run');
    expect(card).toHaveTextContent('Score 82');
    expect(card).toHaveTextContent('arena-leaderboard');
  });

  it('shows the "Benchmarked" pill (never "verified") when evidence.sealed is true', () => {
    const { stepId, stepData } = seedStep();
    mockHarness.stepModels = {
      [stepId]: {
        modelId: 'anthropic/claude-opus-4.6',
        evidence: { source: 'arena-leaderboard', reason: 'Top Arena score for this flow.', sealed: true },
      },
    };
    renderModal(stepId, stepData);

    expect(screen.getByTestId('step-info-benchmarked-pill')).toHaveTextContent('Benchmarked');
    expect(screen.queryByText(/verified/i)).not.toBeInTheDocument();
  });

  it('shows no Benchmarked pill — and an "External" note — for an unsealed external-router pick', () => {
    const { stepId, stepData } = seedStep();
    mockHarness.stepModels = {
      [stepId]: {
        modelId: 'openrouter/auto',
        evidence: {
          source: 'external-router',
          reason: 'OpenRouter auto-router served openrouter/auto',
          sealed: false,
        },
      },
    };
    renderModal(stepId, stepData);

    expect(screen.queryByTestId('step-info-benchmarked-pill')).not.toBeInTheDocument();
    expect(screen.getByTestId('step-info-why-model')).toHaveTextContent('External');
    expect(screen.queryByText(/verified/i)).not.toBeInTheDocument();
  });

  it('shows no Benchmarked pill — and an "Unbenchmarked" note — for an unsealed fallback pick', () => {
    const { stepId, stepData } = seedStep();
    mockHarness.stepModels = {
      [stepId]: {
        modelId: 'opencode/claude-sonnet-4-6',
        evidence: {
          source: 'fallback',
          reason: 'No completed Arena entries yet; used the flow default.',
          sealed: false,
        },
      },
    };
    renderModal(stepId, stepData);

    expect(screen.queryByTestId('step-info-benchmarked-pill')).not.toBeInTheDocument();
    expect(screen.getByTestId('step-info-why-model')).toHaveTextContent('Unbenchmarked');
  });

  it('renders the bare modelId with no pill when the routed event carried no evidence at all', () => {
    const { stepId, stepData } = seedStep();
    mockHarness.stepModels = { [stepId]: { modelId: 'opencode/claude-sonnet-4-6' } };
    renderModal(stepId, stepData);

    const card = screen.getByTestId('step-info-why-model');
    expect(card).toHaveTextContent('opencode/claude-sonnet-4-6');
    expect(screen.queryByTestId('step-info-benchmarked-pill')).not.toBeInTheDocument();
  });
});

// ── Context-mode badge (Task U — Rosetta feedback mode) ─────────────────────
//
// Full data-chain proof at the UI-consumption end: FrameNodeData.contextMode
// (set here via the REAL desktop-store's `updateFrameData`, exactly like
// FrameNode.tsx's toggle does) -> StepRunEvidence's `findOwningFrame` lookup
// -> this badge. No harness-store mocking needed — contextMode is read
// straight off desktop-store, never off `activeFlow`, so it's visible before
// any compile/run.

describe('StepInfoModal — Context mode badge (Rosetta feedback mode)', () => {
  it('is absent for a step with no owning frame (every other suite in this file uses this frame-less fixture)', () => {
    const { stepId, stepData } = seedStep();
    renderModal(stepId, stepData);
    expect(screen.queryByTestId('step-info-context-mode-card')).not.toBeInTheDocument();
  });

  it('is absent when the owning frame has no contextMode set (default/unset)', () => {
    const { stepId, stepData } = seedStepInFrame();
    renderModal(stepId, stepData);
    expect(screen.queryByTestId('step-info-context-mode-card')).not.toBeInTheDocument();
  });

  it('is absent when the owning frame is explicitly "blind"', () => {
    const { stepId, stepData } = seedStepInFrame('blind');
    renderModal(stepId, stepData);
    expect(screen.queryByTestId('step-info-context-mode-card')).not.toBeInTheDocument();
  });

  it('shows the "Feedback mode" badge when the owning frame is "feedback"', () => {
    const { stepId, stepData } = seedStepInFrame('feedback');
    renderModal(stepId, stepData);
    expect(screen.getByTestId('step-info-context-mode-card')).toBeInTheDocument();
    expect(screen.getByTestId('step-info-context-mode-badge')).toHaveTextContent('Feedback mode');
  });

  it('re-derives live off the store — flipping the owning frame from blind to feedback shows the badge with no remount', () => {
    const { stepId, stepData, frameId } = seedStepInFrame('blind');
    renderModal(stepId, stepData);
    expect(screen.queryByTestId('step-info-context-mode-card')).not.toBeInTheDocument();

    act(() => {
      useDesktopStore.getState().updateFrameData(frameId, { contextMode: 'feedback' });
    });

    expect(screen.getByTestId('step-info-context-mode-card')).toBeInTheDocument();
  });
});
