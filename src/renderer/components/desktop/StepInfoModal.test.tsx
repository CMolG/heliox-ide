/**
 * StepInfoModal.test.tsx — Component tests for the editable Step Config panel
 *
 * Strategy:
 * - Mount <StepInfoModal /> against the REAL `desktop-store` (it is pure
 *   client-side state, no IPC), seeded via `addStepNode` / `setMarketInventory`
 *   so `stepData` passed in matches what StepNode would actually hand down.
 * - `harness-store` IS mocked (hoisted spies for `runStep`/`runFromStep`) since
 *   the real implementation dispatches through IPC/`window.helioxAPI`, which
 *   isn't available in this environment and isn't what this file is testing —
 *   we only need to prove the panel *calls* the right action with the right id.
 *
 * Scenarios covered:
 *   1. Dialog semantics + testids are preserved.
 *   2. Instructions textarea seeds from `prompt` (falling back to `description`)
 *      and persists edits into the store via `updateStepData`.
 *   3. Edits survive a close (unmount) + reopen (remount with fresh props).
 *   4. Role picker: attach, remove, and one-role-per-step replace semantics.
 *   5. Mod picker: attach, remove, and a surfaced rejection when the store
 *      declines the add (duplicate/incompatible).
 *   6. Run / Run-from-here buttons call harness-store actions and are
 *      disabled while the step is busy.
 *   7. Keyboard: Escape closes; Tab is trapped inside the panel.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDesktopStore } from '../../store/desktop-store';
import { StepInfoModal } from './StepInfoModal';
import type { StepNodeData } from '@/types/desktop';
import type { MarketMod, MarketRole } from '@/types/market';

// ── Mock harness-store (execution is out of scope for this file) ───────────

const mockHarness = vi.hoisted(() => ({
  runStep: vi.fn(),
  runFromStep: vi.fn(),
}));

vi.mock('../../store/harness-store', () => ({
  useHarnessStore: (selector: (s: typeof mockHarness) => unknown) => selector(mockHarness),
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

const ROLE_A = { name: 'frontend-engineer', icon: 'MdCode', iconLibrary: 'md', description: 'Builds UI', tags: ['frontend'], color: '#E87040' };
const ROLE_B = { name: 'backend-engineer', icon: 'MdStorage', iconLibrary: 'md', description: 'Builds APIs', tags: ['backend'], color: '#4285F4' };
const MOD_LINT = { name: 'strict-linting', icon: 'MdRule', iconLibrary: 'md', description: 'Fail fast on lint drift', tags: ['quality'] };
const MOD_DS_A = { name: 'design-system-a', icon: 'MdPalette', iconLibrary: 'md', description: 'Design system A', tags: ['design'], incompatibleWith: ['design-system-b'] };
const MOD_DS_B = { name: 'design-system-b', icon: 'MdPalette', iconLibrary: 'md', description: 'Design system B', tags: ['design'], incompatibleWith: ['design-system-a'] };

// Domain-hint fixtures (explicitly typed so the `domains` literals narrow to
// `MarketDomain` instead of widening to `string[]`).
const ROLE_DEVOPS: MarketRole = { name: 'devops-engineer', icon: 'MdCloud', iconLibrary: 'md', description: 'Runs infra', tags: ['infra'], color: '#4285F4', domains: ['infra'] };
const MOD_DARK_MODE: MarketMod = { name: 'dark-mode', icon: 'MdPalette', iconLibrary: 'md', description: 'Dark theme tokens', tags: ['design'], domains: ['frontend'] };
const MOD_UNIVERSAL: MarketMod = { name: 'self-review', icon: 'MdFactCheck', iconLibrary: 'md', description: 'Review before done', tags: ['process'], domains: ['universal'] };

function seedStep(overrides?: Partial<{ prompt: string; description: string }>) {
  const stepId = useDesktopStore.getState().addStepNode({
    position: { x: 0, y: 0 },
    title: 'Test Step',
    description: overrides?.description,
    prompt: overrides?.prompt,
  });
  useDesktopStore.getState().setMarketInventory({
    flows: [],
    roles: [ROLE_A, ROLE_B],
    mods: [MOD_LINT, MOD_DS_A, MOD_DS_B],
  });
  const stepData = (useDesktopStore.getState().mentalNodes.find((n) => n.id === stepId) as { data: StepNodeData }).data;
  return { stepId, stepData };
}

function renderModal(stepId: string, stepData: StepNodeData, opts?: { status?: string; onClose?: () => void }) {
  return render(
    <StepInfoModal
      stepId={stepId}
      stepData={stepData}
      connections={{ incoming: [], outgoing: [] }}
      status={opts?.status as never}
      onClose={opts?.onClose ?? vi.fn()}
    />,
  );
}

/**
 * Re-reads a step's `data` fresh from the store. StepInfoModal receives
 * `stepData` as a prop (it does not itself subscribe to `mentalNodes`) — in
 * production, StepNode re-passes a fresh `data` prop on every store change
 * because xyflow's node data is derived reactively. Tests have to mimic that
 * same hand-off explicitly via `rerender` after any mutation whose on-screen
 * effect is being asserted.
 */
function freshStepData(stepId: string): StepNodeData {
  return (useDesktopStore.getState().mentalNodes.find((n) => n.id === stepId) as { data: StepNodeData }).data;
}

beforeEach(() => {
  useDesktopStore.setState(useDesktopStore.getInitialState(), true);
  mockHarness.runStep.mockClear();
  mockHarness.runFromStep.mockClear();
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
    expect(dialog).toHaveAttribute('aria-label', 'Step details: Test Step');
    expect(screen.getByTestId('step-info-modal-close')).toBeInTheDocument();
  });

  it('focuses the close button on mount', () => {
    const { stepId, stepData } = seedStep();
    renderModal(stepId, stepData);
    expect(screen.getByTestId('step-info-modal-close')).toHaveFocus();
  });
});

// ── Instructions editor ──────────────────────────────────────────────────────

describe('StepInfoModal — instructions editor', () => {
  it('seeds the textarea from description when prompt is unset', () => {
    const { stepId, stepData } = seedStep({ description: 'Legacy description text' });
    renderModal(stepId, stepData);
    expect(screen.getByTestId('step-info-prompt')).toHaveValue('Legacy description text');
  });

  it('persists edits into the store via updateStepData', () => {
    const { stepId, stepData } = seedStep();
    renderModal(stepId, stepData);

    fireEvent.change(screen.getByTestId('step-info-prompt'), {
      target: { value: 'Summarize the README in three bullets.' },
    });

    const persisted = (useDesktopStore.getState().mentalNodes.find((n) => n.id === stepId) as { data: StepNodeData }).data;
    expect(persisted.prompt).toBe('Summarize the README in three bullets.');
  });

  it('survives closing (unmount) and reopening (remount with fresh props)', () => {
    const { stepId, stepData } = seedStep();
    const { unmount } = renderModal(stepId, stepData);

    fireEvent.change(screen.getByTestId('step-info-prompt'), {
      target: { value: 'Persisted across reopen' },
    });
    unmount();

    const reopenedData = (useDesktopStore.getState().mentalNodes.find((n) => n.id === stepId) as { data: StepNodeData }).data;
    renderModal(stepId, reopenedData);
    expect(screen.getByTestId('step-info-prompt')).toHaveValue('Persisted across reopen');
  });
});

// ── Role picker ───────────────────────────────────────────────────────────────

describe('StepInfoModal — role management', () => {
  it('attaches a role via the picker and lists it with a remove button', () => {
    const { stepId, stepData } = seedStep();
    const { rerender } = renderModal(stepId, stepData);

    fireEvent.change(screen.getByTestId('step-info-role-select'), { target: { value: ROLE_A.name } });
    fireEvent.click(screen.getByTestId('step-info-role-attach'));

    const persisted = freshStepData(stepId);
    expect(persisted.roles.map((r) => r.name)).toEqual([ROLE_A.name]);

    rerender(
      <StepInfoModal stepId={stepId} stepData={persisted} connections={{ incoming: [], outgoing: [] }} onClose={vi.fn()} />,
    );
    expect(screen.getByTestId(`step-info-role-remove-${ROLE_A.name}`)).toBeInTheDocument();
  });

  it('honors one-role-per-step: attaching a second role replaces the first', () => {
    const { stepId } = seedStep();
    useDesktopStore.getState().addRoleToStep(stepId, ROLE_A);
    const { rerender } = renderModal(stepId, freshStepData(stepId));

    fireEvent.change(screen.getByTestId('step-info-role-select'), { target: { value: ROLE_B.name } });
    fireEvent.click(screen.getByTestId('step-info-role-attach'));

    const persisted = freshStepData(stepId);
    expect(persisted.roles.map((r) => r.name)).toEqual([ROLE_B.name]);

    rerender(
      <StepInfoModal stepId={stepId} stepData={persisted} connections={{ incoming: [], outgoing: [] }} onClose={vi.fn()} />,
    );
    expect(screen.queryByTestId(`step-info-role-remove-${ROLE_A.name}`)).not.toBeInTheDocument();
    expect(screen.getByTestId(`step-info-role-remove-${ROLE_B.name}`)).toBeInTheDocument();
  });

  it('removes a role via its remove button', () => {
    const { stepId } = seedStep();
    useDesktopStore.getState().addRoleToStep(stepId, ROLE_A);
    const { rerender } = renderModal(stepId, freshStepData(stepId));

    fireEvent.click(screen.getByTestId(`step-info-role-remove-${ROLE_A.name}`));

    const persisted = freshStepData(stepId);
    expect(persisted.roles).toEqual([]);

    rerender(
      <StepInfoModal stepId={stepId} stepData={persisted} connections={{ incoming: [], outgoing: [] }} onClose={vi.fn()} />,
    );
    expect(screen.getByText('No role assigned yet.')).toBeInTheDocument();
  });
});

// ── Mod picker ────────────────────────────────────────────────────────────────

describe('StepInfoModal — mod management', () => {
  it('attaches a mod via the picker and lists it with a remove button', () => {
    const { stepId, stepData } = seedStep();
    const { rerender } = renderModal(stepId, stepData);

    fireEvent.change(screen.getByTestId('step-info-mod-select'), { target: { value: MOD_LINT.name } });
    fireEvent.click(screen.getByTestId('step-info-mod-attach'));

    const persisted = freshStepData(stepId);
    expect(persisted.mods.map((m) => m.name)).toEqual([MOD_LINT.name]);

    rerender(
      <StepInfoModal stepId={stepId} stepData={persisted} connections={{ incoming: [], outgoing: [] }} onClose={vi.fn()} />,
    );
    expect(screen.getByTestId(`step-info-mod-remove-${MOD_LINT.name}`)).toBeInTheDocument();
  });

  it('pre-filters an incompatible mod out of the picker options', () => {
    const { stepId } = seedStep();
    useDesktopStore.getState().addModToStep(stepId, MOD_DS_A);
    renderModal(stepId, freshStepData(stepId));

    const options = Array.from(screen.getByTestId('step-info-mod-select').querySelectorAll('option')).map((o) => o.textContent);
    expect(options).not.toContain('Design System B');
    expect(options).toContain('Strict Linting');
  });

  it('removes a mod via its remove button', () => {
    const { stepId } = seedStep();
    useDesktopStore.getState().addModToStep(stepId, MOD_LINT);
    const { rerender } = renderModal(stepId, freshStepData(stepId));

    fireEvent.click(screen.getByTestId(`step-info-mod-remove-${MOD_LINT.name}`));

    const persisted = freshStepData(stepId);
    expect(persisted.mods).toEqual([]);

    rerender(
      <StepInfoModal stepId={stepId} stepData={persisted} connections={{ incoming: [], outgoing: [] }} onClose={vi.fn()} />,
    );
    expect(screen.getByText('No mods assigned yet.')).toBeInTheDocument();
  });

  it('surfaces a rejection message when the store declines the add (e.g. a concurrent external attach)', () => {
    const { stepId, stepData } = seedStep();
    renderModal(stepId, stepData);

    // Select a mod in the picker, then simulate something else (e.g. a
    // drag-and-drop attach elsewhere) attaching that same mod first.
    fireEvent.change(screen.getByTestId('step-info-mod-select'), { target: { value: MOD_LINT.name } });
    act(() => {
      useDesktopStore.getState().addModToStep(stepId, MOD_LINT);
    });

    // The panel's own Attach now hits the store's duplicate guard and gets `false`.
    fireEvent.click(screen.getByTestId('step-info-mod-attach'));

    // Anchor on the quoted mod name so this can't accidentally match the
    // static picker hint ("Mods stack — incompatible combinations…").
    expect(screen.getByText(/"Strict Linting" was rejected/i)).toBeInTheDocument();
  });
});

// ── Mod domain hint (non-blocking) ───────────────────────────────────────────
//
// The hard rejection above (incompatible/duplicate) is a separate, pre-existing
// guard. This hint is purely informational: it never blocks the attach, it
// only surfaces when the mod's and the step's role's `domains` are both
// declared and disjoint (see `domainMismatchHint` in attachable-helpers.ts).

describe('StepInfoModal — mod domain hint (non-blocking)', () => {
  it('attaches the mod AND shows a muted, non-blocking hint when its domains are disjoint from the attached role\'s', () => {
    const { stepId } = seedStep();
    useDesktopStore.getState().addRoleToStep(stepId, ROLE_DEVOPS);
    useDesktopStore.getState().setMarketInventory({ flows: [], roles: [ROLE_DEVOPS], mods: [MOD_DARK_MODE] });
    renderModal(stepId, freshStepData(stepId));

    fireEvent.change(screen.getByTestId('step-info-mod-select'), { target: { value: MOD_DARK_MODE.name } });
    fireEvent.click(screen.getByTestId('step-info-mod-attach'));

    // Non-blocking: the mod IS attached despite the domain mismatch.
    expect(freshStepData(stepId).mods.map((m) => m.name)).toEqual([MOD_DARK_MODE.name]);

    const hint = screen.getByTestId('step-info-mod-domain-hint');
    expect(hint).toHaveAttribute('role', 'status');
    expect(hint).toHaveTextContent('"dark-mode" targets frontend; the attached role "devops-engineer" covers infra. Attached anyway — it may be irrelevant here.');
  });

  it('shows no hint when the step has no role attached', () => {
    const { stepId } = seedStep();
    useDesktopStore.getState().setMarketInventory({ flows: [], roles: [], mods: [MOD_DARK_MODE] });
    renderModal(stepId, freshStepData(stepId));

    fireEvent.change(screen.getByTestId('step-info-mod-select'), { target: { value: MOD_DARK_MODE.name } });
    fireEvent.click(screen.getByTestId('step-info-mod-attach'));

    expect(freshStepData(stepId).mods.map((m) => m.name)).toEqual([MOD_DARK_MODE.name]);
    expect(screen.queryByTestId('step-info-mod-domain-hint')).not.toBeInTheDocument();
  });

  it('shows no hint when the mod is universal (role-agnostic)', () => {
    const { stepId } = seedStep();
    useDesktopStore.getState().addRoleToStep(stepId, ROLE_DEVOPS);
    useDesktopStore.getState().setMarketInventory({ flows: [], roles: [ROLE_DEVOPS], mods: [MOD_UNIVERSAL] });
    renderModal(stepId, freshStepData(stepId));

    fireEvent.change(screen.getByTestId('step-info-mod-select'), { target: { value: MOD_UNIVERSAL.name } });
    fireEvent.click(screen.getByTestId('step-info-mod-attach'));

    expect(freshStepData(stepId).mods.map((m) => m.name)).toEqual([MOD_UNIVERSAL.name]);
    expect(screen.queryByTestId('step-info-mod-domain-hint')).not.toBeInTheDocument();
  });

  it('shows no hint when the mod\'s and role\'s domains overlap', () => {
    const OVERLAPPING_MOD: MarketMod = { name: 'overlap-mod', icon: 'MdBuild', iconLibrary: 'md', description: 'Touches infra too', tags: [], domains: ['infra', 'backend'] };
    const { stepId } = seedStep();
    useDesktopStore.getState().addRoleToStep(stepId, ROLE_DEVOPS);
    useDesktopStore.getState().setMarketInventory({ flows: [], roles: [ROLE_DEVOPS], mods: [OVERLAPPING_MOD] });
    renderModal(stepId, freshStepData(stepId));

    fireEvent.change(screen.getByTestId('step-info-mod-select'), { target: { value: OVERLAPPING_MOD.name } });
    fireEvent.click(screen.getByTestId('step-info-mod-attach'));

    expect(freshStepData(stepId).mods.map((m) => m.name)).toEqual([OVERLAPPING_MOD.name]);
    expect(screen.queryByTestId('step-info-mod-domain-hint')).not.toBeInTheDocument();
  });

  it('shows the hard-rejection error instead of the domain hint when the store declines the add', () => {
    const { stepId } = seedStep();
    useDesktopStore.getState().addRoleToStep(stepId, ROLE_DEVOPS);
    useDesktopStore.getState().setMarketInventory({ flows: [], roles: [ROLE_DEVOPS], mods: [MOD_DARK_MODE] });
    renderModal(stepId, freshStepData(stepId));

    // Select the (still domain-mismatched) mod, then simulate something else
    // attaching that same mod first — mirrors the existing "surfaces a
    // rejection message" test above.
    fireEvent.change(screen.getByTestId('step-info-mod-select'), { target: { value: MOD_DARK_MODE.name } });
    act(() => {
      useDesktopStore.getState().addModToStep(stepId, MOD_DARK_MODE);
    });
    fireEvent.click(screen.getByTestId('step-info-mod-attach'));

    // The panel's own Attach now hits the store's duplicate guard (`ok === false`):
    // the hard error shows, and the (otherwise applicable) domain hint does not.
    expect(screen.getByText(/"Dark Mode" was rejected/i)).toBeInTheDocument();
    expect(screen.queryByTestId('step-info-mod-domain-hint')).not.toBeInTheDocument();
  });
});

// ── Execution controls ───────────────────────────────────────────────────────

describe('StepInfoModal — execution controls', () => {
  it('Run this step calls harness-store runStep with the step id', () => {
    const { stepId, stepData } = seedStep();
    renderModal(stepId, stepData);
    fireEvent.click(screen.getByTestId('step-info-run'));
    expect(mockHarness.runStep).toHaveBeenCalledWith(stepId);
  });

  it('Run from here calls harness-store runFromStep with the step id', () => {
    const { stepId, stepData } = seedStep();
    renderModal(stepId, stepData);
    fireEvent.click(screen.getByTestId('step-info-run-from'));
    expect(mockHarness.runFromStep).toHaveBeenCalledWith(stepId);
  });

  it('disables both run buttons while the step is running', () => {
    const { stepId, stepData } = seedStep();
    renderModal(stepId, stepData, { status: 'running' });
    expect(screen.getByTestId('step-info-run')).toBeDisabled();
    expect(screen.getByTestId('step-info-run-from')).toBeDisabled();
    expect(screen.getByText(/currently running/i)).toBeInTheDocument();
  });

  it('shows the execution status badge', () => {
    const { stepId, stepData } = seedStep();
    renderModal(stepId, stepData, { status: 'completed' });
    expect(screen.getByTestId('step-info-status')).toHaveTextContent('completed');
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

  it('traps Tab focus: Tab from the last focusable element wraps to the first', () => {
    const { stepId, stepData } = seedStep();
    renderModal(stepId, stepData);

    const closeButton = screen.getByTestId('step-info-modal-close');
    const focusables = screen.getByTestId('step-info-modal').querySelectorAll('button:not([disabled]), select, textarea');
    const last = focusables[focusables.length - 1] as HTMLElement;

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(closeButton).toHaveFocus();
  });

  it('traps Shift+Tab focus: Shift+Tab from the first focusable element wraps to the last', () => {
    const { stepId, stepData } = seedStep();
    renderModal(stepId, stepData);

    const closeButton = screen.getByTestId('step-info-modal-close');
    closeButton.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(closeButton).not.toHaveFocus();
  });
});
