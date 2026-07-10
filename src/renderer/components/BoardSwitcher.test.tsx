/**
 * BoardSwitcher.test.tsx — TopBar board switcher (Phase 12)
 *
 * Strategy:
 * - Mount <BoardSwitcher /> against the REAL desktop-store — boards are pure
 *   client-side state (Phase 10: createBoard/switchBoard/renameBoard/
 *   deleteBoard/duplicateBoard, already exhaustively covered in
 *   desktop-store.test.ts), reset via `setState(getInitialState(), true)`,
 *   same pattern as NodeTree.flows.test.tsx.
 * - Mock harness-store (hoisted fixture) for `executionStatus` +
 *   `stopExecution` — the real store's execution actions dispatch through
 *   IPC/`window.fluxorAPI`, which isn't available here and isn't what this
 *   file exercises. `useHarnessStore.getState` is stubbed too (StepNode.dnd
 *   .test.tsx precedent) since BoardSwitcher calls it directly whenever the
 *   active board actually changes — switch, new board, or deleting the
 *   active board (all three funnel through resetHarnessAfterBoardChange).
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgenticExecutionStatus } from '@/types/harness';

// ── Mock harness-store (execution is out of scope for this file) ───────────

const mockHarness = vi.hoisted(() => ({
  executionStatus: 'idle' as AgenticExecutionStatus,
  stopExecution: vi.fn(),
}));

vi.mock('@/renderer/store/harness-store', () => {
  const useHarnessStore = (selector: (s: typeof mockHarness) => unknown) => selector(mockHarness);
  useHarnessStore.getState = () => mockHarness;
  return { useHarnessStore };
});

// ── Import after mocks (real desktop-store) ─────────────────────────────────

import { useDesktopStore } from '@/renderer/store/desktop-store';
import { BoardSwitcher } from './BoardSwitcher';

beforeEach(() => {
  useDesktopStore.setState(useDesktopStore.getInitialState(), true);
  mockHarness.executionStatus = 'idle';
  mockHarness.stopExecution.mockClear();
});

function openMenu() {
  fireEvent.click(screen.getByTestId('board-switcher-trigger'));
}

// ── Listing + active highlight ──────────────────────────────────────────────

describe('BoardSwitcher — listing + active highlight', () => {
  it('lists every board and highlights the active one with a check icon', () => {
    const store = useDesktopStore.getState();
    const board2Id = store.createBoard('Board 2'); // createBoard auto-switches into it

    render(<BoardSwitcher />);
    openMenu();

    const menu = screen.getByTestId('board-switcher-menu');
    expect(within(menu).getByText('Board 1')).toBeInTheDocument();
    expect(within(menu).getByText('Board 2')).toBeInTheDocument();

    expect(screen.getByTestId(`board-switcher-row-${board2Id}`)).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('board-switcher-row-board-1')).toHaveAttribute('data-active', 'false');
  });

  it('shows the active board name on the trigger pill', () => {
    render(<BoardSwitcher />);
    expect(screen.getByTestId('board-switcher-trigger')).toHaveTextContent('Board 1');
  });
});

// ── Switching ────────────────────────────────────────────────────────────────

describe('BoardSwitcher — switching', () => {
  it('clicking another board calls switchBoard and stopExecution, then closes the menu', () => {
    const store = useDesktopStore.getState();
    const board2Id = store.createBoard('Board 2'); // active is now board2
    useDesktopStore.getState().switchBoard('board-1'); // back to board-1; board2 is "other"

    render(<BoardSwitcher />);
    openMenu();

    fireEvent.click(screen.getByTestId(`board-switcher-switch-${board2Id}`));

    expect(useDesktopStore.getState().activeBoardId).toBe(board2Id);
    expect(mockHarness.stopExecution).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('board-switcher-menu')).not.toBeInTheDocument();
  });

  it('clicking the already-active board does not call stopExecution or close the menu', () => {
    render(<BoardSwitcher />);
    openMenu();

    fireEvent.click(screen.getByTestId('board-switcher-switch-board-1'));

    expect(mockHarness.stopExecution).not.toHaveBeenCalled();
    expect(screen.getByTestId('board-switcher-menu')).toBeInTheDocument();
  });
});

// ── Busy gating ──────────────────────────────────────────────────────────────

describe('BoardSwitcher — busy gating', () => {
  it("disables switching, delete, and new board (with the 'Finish or stop...' title) while busy, but rename/duplicate stay enabled", () => {
    const store = useDesktopStore.getState();
    const board2Id = store.createBoard('Board 2');
    useDesktopStore.getState().switchBoard('board-1');
    mockHarness.executionStatus = 'running';

    render(<BoardSwitcher />);
    openMenu();

    const otherSwitchBtn = screen.getByTestId(`board-switcher-switch-${board2Id}`);
    expect(otherSwitchBtn).toBeDisabled();
    expect(otherSwitchBtn).toHaveAttribute('title', 'Finish or stop the running flow first');

    const deleteBtn = screen.getByTestId('board-switcher-delete-board-1');
    expect(deleteBtn).toBeDisabled();
    expect(deleteBtn).toHaveAttribute('title', 'Finish or stop the running flow first');

    // "+ New board" must gate too: createBoard() always switches into the
    // new board, so leaving it enabled would silently swap the canvas away
    // from a running/compiling flow with no way back (switch is busy-gated).
    const newBoardBtn = screen.getByTestId('board-switcher-new-board');
    expect(newBoardBtn).toBeDisabled();
    expect(newBoardBtn).toHaveAttribute('title', 'Finish or stop the running flow first');

    expect(screen.getByTestId('board-switcher-rename-board-1')).toBeEnabled();
    expect(screen.getByTestId(`board-switcher-duplicate-${board2Id}`)).toBeEnabled();
  });

  it('compiling counts as busy too', () => {
    mockHarness.executionStatus = 'compiling';
    useDesktopStore.getState().createBoard('Board 2');
    render(<BoardSwitcher />);
    openMenu();

    expect(screen.getByTestId('board-switcher-delete-board-1')).toBeDisabled();
    expect(screen.getByTestId('board-switcher-new-board')).toBeDisabled();
  });

  it('"+ New board" is a no-op while busy — no createBoard, no stopExecution, menu stays open', () => {
    mockHarness.executionStatus = 'running';
    render(<BoardSwitcher />);
    openMenu();

    fireEvent.click(screen.getByTestId('board-switcher-new-board'));

    expect(useDesktopStore.getState().boards.length).toBe(1);
    expect(mockHarness.stopExecution).not.toHaveBeenCalled();
    expect(screen.getByTestId('board-switcher-menu')).toBeInTheDocument();
  });
});

// ── Rename ───────────────────────────────────────────────────────────────────

describe('BoardSwitcher — rename', () => {
  it('pencil opens a prefilled input; Enter commits the trimmed value via renameBoard', () => {
    render(<BoardSwitcher />);
    openMenu();

    fireEvent.click(screen.getByTestId('board-switcher-rename-board-1'));
    const input = screen.getByTestId('board-switcher-rename-input-board-1') as HTMLInputElement;
    expect(input.value).toBe('Board 1');

    fireEvent.change(input, { target: { value: '  Renamed Board  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(useDesktopStore.getState().boards.find(b => b.id === 'board-1')?.name).toBe('Renamed Board');
    // The input is gone — reverted to display mode.
    expect(screen.queryByTestId('board-switcher-rename-input-board-1')).not.toBeInTheDocument();
  });

  it('Escape cancels without renaming (and leaves the rest of the menu open)', () => {
    render(<BoardSwitcher />);
    openMenu();

    fireEvent.click(screen.getByTestId('board-switcher-rename-board-1'));
    const input = screen.getByTestId('board-switcher-rename-input-board-1');
    fireEvent.change(input, { target: { value: 'Should not stick' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(useDesktopStore.getState().boards.find(b => b.id === 'board-1')?.name).toBe('Board 1');
    expect(screen.queryByTestId('board-switcher-rename-input-board-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('board-switcher-menu')).toBeInTheDocument();
  });
});

// ── Delete (two-step inline confirm) ─────────────────────────────────────────

describe('BoardSwitcher — delete', () => {
  it('first click shows a "Delete?" confirm state; second click calls deleteBoard — deleting an INACTIVE board does not touch harness state', () => {
    useDesktopStore.getState().createBoard('Board 2'); // auto-switches into Board 2; board-1 is now inactive
    render(<BoardSwitcher />);
    openMenu();

    const deleteBtn = screen.getByTestId('board-switcher-delete-board-1');
    fireEvent.click(deleteBtn);
    expect(screen.getByText('Delete?')).toBeInTheDocument();
    expect(useDesktopStore.getState().boards.some(b => b.id === 'board-1')).toBe(true);

    fireEvent.click(screen.getByTestId('board-switcher-delete-board-1'));
    expect(useDesktopStore.getState().boards.some(b => b.id === 'board-1')).toBe(false);
    // board-1 was inactive (Board 2 is active) — nothing on screen switched,
    // so the harness must NOT be reset.
    expect(mockHarness.stopExecution).not.toHaveBeenCalled();
  });

  it('deleting the ACTIVE board calls deleteBoard and stopExecution (deleteBoard implicitly switches to a neighbor)', () => {
    const store = useDesktopStore.getState();
    const board2Id = store.createBoard('Board 2'); // auto-switches into Board 2 — now active
    expect(useDesktopStore.getState().activeBoardId).toBe(board2Id);

    render(<BoardSwitcher />);
    openMenu();

    const deleteBtn = screen.getByTestId(`board-switcher-delete-${board2Id}`);
    fireEvent.click(deleteBtn);
    fireEvent.click(screen.getByTestId(`board-switcher-delete-${board2Id}`));

    expect(useDesktopStore.getState().boards.some(b => b.id === board2Id)).toBe(false);
    expect(useDesktopStore.getState().activeBoardId).toBe('board-1'); // deleteBoard's neighbor fallback
    expect(mockHarness.stopExecution).toHaveBeenCalledTimes(1);
  });

  it('is disabled when only one board remains, and a (guarded) click never reaches deleteBoard or stopExecution', () => {
    render(<BoardSwitcher />);
    openMenu();

    const deleteBtn = screen.getByTestId('board-switcher-delete-board-1');
    expect(deleteBtn).toBeDisabled();

    fireEvent.click(deleteBtn);
    expect(useDesktopStore.getState().boards.length).toBe(1);
    expect(mockHarness.stopExecution).not.toHaveBeenCalled();
  });
});

// ── New board ────────────────────────────────────────────────────────────────

describe('BoardSwitcher — new board', () => {
  it('"+ New board" calls createBoard and stopExecution, then closes the menu', () => {
    render(<BoardSwitcher />);
    openMenu();

    fireEvent.click(screen.getByTestId('board-switcher-new-board'));

    expect(useDesktopStore.getState().boards.length).toBe(2);
    // createBoard() always switches into the freshly created board, so the
    // harness reset must fire unconditionally — mirrors handleSwitch.
    expect(mockHarness.stopExecution).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('board-switcher-menu')).not.toBeInTheDocument();
  });
});

// ── Backdrop + Escape ────────────────────────────────────────────────────────

describe('BoardSwitcher — closing the menu', () => {
  it('clicking the backdrop closes the menu', () => {
    render(<BoardSwitcher />);
    openMenu();
    fireEvent.click(screen.getByTestId('board-switcher-backdrop'));
    expect(screen.queryByTestId('board-switcher-menu')).not.toBeInTheDocument();
  });

  it('Escape closes the menu', () => {
    render(<BoardSwitcher />);
    openMenu();
    fireEvent.keyDown(screen.getByTestId('board-switcher-menu'), { key: 'Escape' });
    expect(screen.queryByTestId('board-switcher-menu')).not.toBeInTheDocument();
  });
});

// ── Accessibility ────────────────────────────────────────────────────────────

describe('BoardSwitcher — accessibility', () => {
  it('trigger exposes aria-haspopup and aria-expanded', () => {
    render(<BoardSwitcher />);
    const trigger = screen.getByTestId('board-switcher-trigger');
    expect(trigger).toHaveAttribute('aria-haspopup');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    openMenu();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });
});
