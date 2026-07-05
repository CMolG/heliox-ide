/**
 * StepQuickAddPopover.test.tsx — search/filter/attach behavior for the
 * one-click Role/Mod quick-add popover.
 *
 * Strategy (mirrors StepNode.test.tsx): mock desktop-store with a hoisted
 * spy object so we can assert exactly which action was called with which
 * arguments, and control `addRoleToStep`/`addModToStep`'s return value to
 * exercise both the success and the rejection paths.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockDesktop = vi.hoisted(() => ({
  addRoleToStep: vi.fn(() => true),
  addModToStep: vi.fn(() => true),
  marketInventory: {
    flows: [],
    roles: [
      { name: 'frontend-engineer', icon: 'User', iconLibrary: 'lucide', description: '', tags: [] },
      { name: 'backend-engineer', icon: 'User', iconLibrary: 'lucide', description: '', tags: [] },
    ],
    mods: [
      {
        name: 'strict-linting', icon: 'Wrench', iconLibrary: 'lucide', description: '', tags: [],
        incompatibleWith: ['loose-linting'],
      },
      { name: 'loose-linting', icon: 'Wrench', iconLibrary: 'lucide', description: '', tags: [] },
      { name: 'dry-run', icon: 'Wrench', iconLibrary: 'lucide', description: '', tags: [] },
    ],
    steps: [],
  },
}));

vi.mock('../../../store/desktop-store', () => ({
  useDesktopStore: (selector: (s: typeof mockDesktop) => unknown) => selector(mockDesktop),
}));

// ── Import after mocks ───────────────────────────────────────────────────────

import { StepQuickAddPopover } from './StepQuickAddPopover';
import type { StepNodeData } from '@/types/desktop';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeStepData(overrides: Partial<StepNodeData> = {}): StepNodeData {
  return { title: 'Step', description: '', mods: [], roles: [], ...overrides };
}

const noop = () => {};

beforeEach(() => {
  document.body.innerHTML = '';
  mockDesktop.addRoleToStep.mockClear();
  mockDesktop.addModToStep.mockClear();
  mockDesktop.addRoleToStep.mockReturnValue(true);
  mockDesktop.addModToStep.mockReturnValue(true);
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('StepQuickAddPopover — listing', () => {
  it('lists every eligible role and mod with no search query', () => {
    render(
      <StepQuickAddPopover stepId="s1" stepData={makeStepData()} anchor={{ x: 0, y: 0, topY: -6 }} onClose={noop} />,
    );
    expect(screen.getByTestId('step-quick-add-role-frontend-engineer')).toBeInTheDocument();
    expect(screen.getByTestId('step-quick-add-role-backend-engineer')).toBeInTheDocument();
    expect(screen.getByTestId('step-quick-add-mod-strict-linting')).toBeInTheDocument();
    expect(screen.getByTestId('step-quick-add-mod-loose-linting')).toBeInTheDocument();
    expect(screen.getByTestId('step-quick-add-mod-dry-run')).toBeInTheDocument();
  });

  it('is anchored via fixed positioning at the given point', () => {
    render(
      <StepQuickAddPopover stepId="s1" stepData={makeStepData()} anchor={{ x: 42, y: 88, topY: 76 }} onClose={noop} />,
    );
    const panel = screen.getByTestId('step-quick-add-popover');
    expect(panel).toHaveStyle({ left: '42px', top: '88px' });
  });

  it('flips to anchor its bottom edge above the trigger when it would overflow the viewport bottom', () => {
    // Simulates a real trigger button rect (24px tall, bottom edge at 694):
    // StepNode's openQuickAdd would build `y: rect.bottom + 6` and
    // `topY: rect.top - 6`. innerHeight defaults to 768 in jsdom; anchor.y +
    // 320 (POPOVER_MAX_HEIGHT) must exceed it to trigger the flip branch.
    const anchor = { x: 42, y: 700, topY: 664 };
    render(
      <StepQuickAddPopover stepId="s1" stepData={makeStepData()} anchor={anchor} onClose={noop} />,
    );
    const panel = screen.getByTestId('step-quick-add-popover');
    // Panel's bottom edge lands at `anchor.topY` (6px above the trigger's
    // top) — never at the old, overlapping `window.innerHeight - anchor.y + 6`,
    // which would sit at the trigger's own bottom edge and cover it.
    expect(panel).toHaveStyle({ left: '42px', bottom: `${window.innerHeight - anchor.topY}px` });
    expect(panel).not.toHaveStyle({ bottom: `${window.innerHeight - anchor.y + 6}px` });
  });
});

describe('StepQuickAddPopover — search filtering', () => {
  it('filters both lists by a case-insensitive name substring', () => {
    render(
      <StepQuickAddPopover stepId="s1" stepData={makeStepData()} anchor={{ x: 0, y: 0, topY: -6 }} onClose={noop} />,
    );
    fireEvent.change(screen.getByTestId('step-quick-add-search'), { target: { value: 'FRONT' } });

    expect(screen.getByTestId('step-quick-add-role-frontend-engineer')).toBeInTheDocument();
    expect(screen.queryByTestId('step-quick-add-role-backend-engineer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('step-quick-add-mod-strict-linting')).not.toBeInTheDocument();
    expect(screen.queryByTestId('step-quick-add-mod-loose-linting')).not.toBeInTheDocument();
    expect(screen.queryByTestId('step-quick-add-mod-dry-run')).not.toBeInTheDocument();
  });

  it('shows the empty-results message when nothing matches', () => {
    render(
      <StepQuickAddPopover stepId="s1" stepData={makeStepData()} anchor={{ x: 0, y: 0, topY: -6 }} onClose={noop} />,
    );
    fireEvent.change(screen.getByTestId('step-quick-add-search'), { target: { value: 'zzz-no-match' } });
    expect(screen.getAllByText(/No (roles|mods) found\./)).toHaveLength(2);
  });
});

describe('StepQuickAddPopover — eligibility filters (mirror StepConfigCore)', () => {
  it('excludes the already-assigned role from the Roles list', () => {
    render(
      <StepQuickAddPopover
        stepId="s1"
        stepData={makeStepData({
          roles: [{ name: 'frontend-engineer', icon: 'User', iconLibrary: 'lucide', description: '', tags: [] }],
        })}
        anchor={{ x: 0, y: 0, topY: -6 }}
        onClose={noop}
      />,
    );
    expect(screen.queryByTestId('step-quick-add-role-frontend-engineer')).not.toBeInTheDocument();
    expect(screen.getByTestId('step-quick-add-role-backend-engineer')).toBeInTheDocument();
  });

  it('excludes a mod incompatible with an already-assigned mod', () => {
    render(
      <StepQuickAddPopover
        stepId="s1"
        stepData={makeStepData({
          mods: [{
            name: 'strict-linting', icon: 'Wrench', iconLibrary: 'lucide', description: '', tags: [],
            incompatibleWith: ['loose-linting'],
          }],
        })}
        anchor={{ x: 0, y: 0, topY: -6 }}
        onClose={noop}
      />,
    );
    // The assigned mod itself is also excluded (already attached).
    expect(screen.queryByTestId('step-quick-add-mod-strict-linting')).not.toBeInTheDocument();
    expect(screen.queryByTestId('step-quick-add-mod-loose-linting')).not.toBeInTheDocument();
    expect(screen.getByTestId('step-quick-add-mod-dry-run')).toBeInTheDocument();
  });
});

describe('StepQuickAddPopover — attach outcomes', () => {
  it('addModToStep returning false shows a role="status" error and keeps the popover mounted', () => {
    mockDesktop.addModToStep.mockReturnValue(false);
    render(
      <StepQuickAddPopover stepId="s1" stepData={makeStepData()} anchor={{ x: 0, y: 0, topY: -6 }} onClose={noop} />,
    );
    fireEvent.click(screen.getByTestId('step-quick-add-mod-strict-linting'));

    expect(mockDesktop.addModToStep).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ name: 'strict-linting' }),
    );
    const error = screen.getByTestId('step-quick-add-mod-error');
    expect(error).toHaveAttribute('role', 'status');
    expect(screen.getByTestId('step-quick-add-popover')).toBeInTheDocument();
  });

  it('addRoleToStep returning false shows a role="status" error', () => {
    mockDesktop.addRoleToStep.mockReturnValue(false);
    render(
      <StepQuickAddPopover stepId="s1" stepData={makeStepData()} anchor={{ x: 0, y: 0, topY: -6 }} onClose={noop} />,
    );
    fireEvent.click(screen.getByTestId('step-quick-add-role-frontend-engineer'));

    const error = screen.getByTestId('step-quick-add-role-error');
    expect(error).toHaveAttribute('role', 'status');
  });

  it('a successful attach keeps the popover mounted (mods are stackable)', () => {
    render(
      <StepQuickAddPopover stepId="s1" stepData={makeStepData()} anchor={{ x: 0, y: 0, topY: -6 }} onClose={noop} />,
    );
    fireEvent.click(screen.getByTestId('step-quick-add-mod-dry-run'));

    expect(mockDesktop.addModToStep).toHaveBeenCalledWith('s1', expect.objectContaining({ name: 'dry-run' }));
    expect(screen.getByTestId('step-quick-add-popover')).toBeInTheDocument();
    expect(screen.queryByTestId('step-quick-add-mod-error')).not.toBeInTheDocument();
  });
});

describe('StepQuickAddPopover — keyboard', () => {
  it('Escape calls onClose', () => {
    const onClose = vi.fn();
    render(
      <StepQuickAddPopover stepId="s1" stepData={makeStepData()} anchor={{ x: 0, y: 0, topY: -6 }} onClose={onClose} />,
    );
    fireEvent.keyDown(screen.getByTestId('step-quick-add-popover'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
