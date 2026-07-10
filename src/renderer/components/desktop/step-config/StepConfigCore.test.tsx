/**
 * StepConfigCore.test.tsx — component tests for the Step config surface's
 * chats→steps additions (Task H, ola B1): the Single-Persona role helm, the
 * execution-authority doctrine note, and the chat-like composer (mono-step
 * focus hookup + recycled @file attachments).
 *
 * The pre-existing Instructions/Role/Mod/Execution/model-override coverage
 * lives in InspectorPanel.test.tsx (StepConfigCore rendered via the Inspector)
 * and is deliberately NOT duplicated here — this file targets only the new
 * behaviors, rendering StepConfigCore directly.
 *
 * Strategy (mirrors StepInfoModal.test.tsx / InspectorPanel.test.tsx):
 * - REAL desktop-store + REAL fluxor store (both pure client-side state), reset
 *   to initial per test; seed a step via `addStepNode`.
 * - harness-store IS mocked (runStep/runFromStep dispatch through IPC).
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDesktopStore } from '../../../store/desktop-store';
import { useFluxorStore } from '../../../store';
import { StepConfigCore } from './StepConfigCore';
import type { StepNodeData } from '@/types/desktop';
import type { MarketRole } from '@/types/market';

// ── Mock harness-store (execution is out of scope here) ─────────────────────
const mockHarness = vi.hoisted(() => ({
  runStep: vi.fn(),
  runFromStep: vi.fn(),
}));
vi.mock('../../../store/harness-store', () => ({
  useHarnessStore: (selector: (s: typeof mockHarness) => unknown) => selector(mockHarness),
}));

// ── Fixtures ────────────────────────────────────────────────────────────────
const ROLE_A: MarketRole = { name: 'frontend-engineer', icon: 'User', iconLibrary: 'lucide', description: 'Builds UI', tags: ['frontend'], color: '#E87040' };

function seedStep(overrides?: Partial<{ prompt: string; description: string }>) {
  const stepId = useDesktopStore.getState().addStepNode({
    position: { x: 0, y: 0 },
    title: 'Test Step',
    description: overrides?.description,
    prompt: overrides?.prompt,
  });
  return stepId;
}

function freshStepData(stepId: string): StepNodeData {
  return (useDesktopStore.getState().mentalNodes.find((n) => n.id === stepId) as { data: StepNodeData }).data;
}

function renderConfig(stepId: string) {
  return render(<StepConfigCore stepId={stepId} stepData={freshStepData(stepId)} />);
}

beforeEach(() => {
  useDesktopStore.setState(useDesktopStore.getInitialState(), true);
  useFluxorStore.setState(useFluxorStore.getInitialState(), true);
  mockHarness.runStep.mockClear();
  mockHarness.runFromStep.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── H1: role helm (aria-selected) ─────────────────────────────────────────
describe('StepConfigCore — role helm (Single Persona)', () => {
  it('renders the assigned role as an aria-selected option inside a listbox', () => {
    const stepId = seedStep();
    useDesktopStore.getState().addRoleToStep(stepId, ROLE_A);
    renderConfig(stepId);

    // The roles container is a single-select listbox.
    const listbox = screen.getByRole('listbox', { name: 'Role' });
    expect(listbox).toBeInTheDocument();

    const option = screen.getByTestId(`step-info-role-helm-${ROLE_A.name}`);
    expect(option).toHaveAttribute('role', 'option');
    expect(option).toHaveAttribute('aria-selected', 'true');
    expect(option).toHaveAttribute('tabindex', '0');
    expect(option).toHaveTextContent('Frontend Engineer');
  });

  it('keeps the remove control OUTSIDE the option (ARIA APG: no focusable descendants)', () => {
    const stepId = seedStep();
    useDesktopStore.getState().addRoleToStep(stepId, ROLE_A);
    renderConfig(stepId);

    const option = screen.getByTestId(`step-info-role-helm-${ROLE_A.name}`);
    expect(option.querySelector('button')).toBeNull();
    // …but the remove button is still present as a sibling and works.
    fireEvent.click(screen.getByTestId(`step-info-role-remove-${ROLE_A.name}`));
    expect(freshStepData(stepId).roles).toEqual([]);
  });

  it('shows the empty state when no persona is assigned', () => {
    const stepId = seedStep();
    renderConfig(stepId);
    expect(screen.getByText('No role assigned yet.')).toBeInTheDocument();
    expect(screen.queryByRole('listbox', { name: 'Role' })).not.toBeInTheDocument();
  });
});

// ── H1: execution-authority doctrine (validateStepAtoms veto visible) ──────
describe('StepConfigCore — execution-authority doctrine', () => {
  it('always surfaces a note that compatibility is finally enforced at run time, shown in Run evidence', () => {
    const stepId = seedStep();
    renderConfig(stepId);

    const note = screen.getByTestId('step-config-execution-authority');
    expect(note).toHaveAttribute('role', 'note');
    expect(note).toHaveTextContent(/verified when the step runs/i);
    expect(note).toHaveTextContent(/Run evidence/i);
  });
});

// ── H2: mono-step gesture focus hookup (pendingStepFocusId) ────────────────
describe('StepConfigCore — mono-step focus hookup', () => {
  it('focuses the prompt textarea and clears pendingStepFocusId when the gesture names this step', () => {
    const stepId = seedStep();
    // The double-click gesture sets this the moment the Inspector opens.
    useDesktopStore.getState().setPendingStepFocusId(stepId);
    renderConfig(stepId);

    expect(screen.getByTestId('step-info-prompt')).toHaveFocus();
    // One-shot: the signal is consumed so it never re-fires.
    expect(useDesktopStore.getState().pendingStepFocusId).toBeNull();
  });

  it('does NOT steal focus when the gesture names a different step', () => {
    const stepId = seedStep();
    useDesktopStore.getState().setPendingStepFocusId('some-other-step');
    renderConfig(stepId);

    expect(screen.getByTestId('step-info-prompt')).not.toHaveFocus();
    expect(useDesktopStore.getState().pendingStepFocusId).toBe('some-other-step');
  });
});

// ── H2: chat-like composer — @file attachments (recycled FileContextBuilder) ─
describe('StepConfigCore — @file attachments', () => {
  it('opens the file autocomplete listing workspace files when the caret follows an "@"', () => {
    useFluxorStore.setState({ projectFiles: ['src/a.ts', 'src/b.ts'] });
    const stepId = seedStep();
    renderConfig(stepId);

    fireEvent.change(screen.getByTestId('step-info-prompt'), { target: { value: '@', selectionStart: 1 } });

    expect(screen.getByRole('listbox', { name: 'File suggestions' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'src/a.ts' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'src/b.ts' })).toBeInTheDocument();
  });

  it('marks the textarea as a combobox expanded over the file listbox while open', () => {
    useFluxorStore.setState({ projectFiles: ['src/a.ts'] });
    const stepId = seedStep();
    renderConfig(stepId);

    const ta = screen.getByTestId('step-info-prompt');
    expect(ta).toHaveAttribute('role', 'combobox');
    expect(ta).toHaveAttribute('aria-expanded', 'false');

    fireEvent.change(ta, { target: { value: '@', selectionStart: 1 } });
    expect(ta).toHaveAttribute('aria-expanded', 'true');
    expect(ta).toHaveAttribute('aria-controls', 'file-autocomplete-listbox');
  });

  it('renders an attached-file chip for each @mention already in the prompt', () => {
    const stepId = seedStep({ prompt: '@src/utils.ts refactor the helpers' });
    renderConfig(stepId);

    expect(screen.getByText('src/utils.ts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove src/utils.ts' })).toBeInTheDocument();
  });

  it('removing a file chip edits the @mention back out of the prompt (writes to prompt via updateStepData)', () => {
    const stepId = seedStep({ prompt: '@src/utils.ts refactor' });
    renderConfig(stepId);

    fireEvent.click(screen.getByRole('button', { name: 'Remove src/utils.ts' }));

    expect(freshStepData(stepId).prompt).toBe('refactor');
  });

  it('typed text still lands in the step prompt (text → prompt via updateStepData)', () => {
    const stepId = seedStep();
    renderConfig(stepId);

    fireEvent.change(screen.getByTestId('step-info-prompt'), {
      target: { value: 'Summarize the README in three bullets.' },
    });

    expect(freshStepData(stepId).prompt).toBe('Summarize the README in three bullets.');
  });
});
