/**
 * BoardSwitcher.tsx — Renderer Composite Component
 *
 * Responsibility:
 * - Compact pill trigger + portal menu for switching between the Figma-like
 *   independent canvases ("boards") introduced in desktop-store.ts (Phase 10):
 *   `boards`, `activeBoardId`, `createBoard`/`switchBoard`/`renameBoard`/
 *   `deleteBoard`/`duplicateBoard`.
 * - Guards board switches, deletes, and new-board creation while a flow is
 *   running or compiling (harness-store's `executionStatus`) so the user
 *   never loses execution state mid-flight, and clears stale per-step
 *   statuses left over from the previous board via `stopExecution()`
 *   whenever the active board actually changes — explicit switch, new
 *   board (createBoard always switches into it), or an implicit switch
 *   caused by deleting the active board.
 *
 * Boundaries:
 * - Owns: trigger/menu rendering, local rename/confirm-delete UI state.
 * - Does NOT own: board data/actions (desktop-store) or execution state
 *   (harness-store) — reads/dispatches only.
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/BoardSwitcher.tsx — TopBar board switcher (Figma-like canvases)
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDesktopStore } from '@/renderer/store/desktop-store';
import { useHarnessStore } from '@/renderer/store/harness-store';
import { LucideIcon } from './desktop/LucideIcon';

/**
 * Clears stale per-step statuses/activeFlow left over from the board we just
 * navigated away from. Call this after ANY action that changes
 * `activeBoardId` (explicit switch, new board, or deleting the active
 * board), never for actions that leave the active board untouched.
 *
 * Lives here, at the UI layer, DELIBERATELY: desktop-store cannot import
 * harness-store (harness-store already imports desktop-store, so the
 * reverse would be circular), and BoardSwitcher is today the sole caller of
 * the board actions that can change `activeBoardId` — so this is the one
 * choke point where the reset needs to happen.
 */
function resetHarnessAfterBoardChange() {
  useHarnessStore.getState().stopExecution();
}

export function BoardSwitcher() {
  const boards = useDesktopStore(s => s.boards);
  const activeBoardId = useDesktopStore(s => s.activeBoardId);
  const createBoard = useDesktopStore(s => s.createBoard);
  const switchBoard = useDesktopStore(s => s.switchBoard);
  const renameBoard = useDesktopStore(s => s.renameBoard);
  const deleteBoard = useDesktopStore(s => s.deleteBoard);
  const duplicateBoard = useDesktopStore(s => s.duplicateBoard);
  const executionStatus = useHarnessStore(s => s.executionStatus);
  const busy = executionStatus === 'running' || executionStatus === 'compiling';

  const [open, setOpen] = useState(false);
  const [menuCoords, setMenuCoords] = useState({ top: 0, left: 0 });
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const activeBoard = boards.find(b => b.id === activeBoardId);

  const closeMenu = useCallback(() => {
    setOpen(false);
    setRenamingId(null);
    setConfirmDeleteId(null);
    triggerRef.current?.focus();
  }, []);

  const toggleOpen = useCallback(() => {
    setOpen(prev => !prev);
  }, []);

  // Position the portalled menu directly under the trigger every time it opens.
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setMenuCoords({ top: rect.bottom + 6, left: rect.left });
  }, [open]);

  // Focus + select the rename input as soon as it appears (mirrors NodeTree).
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const handleSwitch = useCallback((boardId: string) => {
    if (busy || boardId === activeBoardId) return;
    switchBoard(boardId);
    // `busy` already gated out the running/compiling case above, so this is
    // always a real, successful switch — reset unconditionally.
    resetHarnessAfterBoardChange();
    closeMenu();
  }, [busy, activeBoardId, switchBoard, closeMenu]);

  const startRename = useCallback((boardId: string, currentName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDeleteId(null);
    setRenamingId(boardId);
    setRenameValue(currentName);
  }, []);

  const commitRename = useCallback(() => {
    if (renamingId && renameValue.trim()) {
      renameBoard(renamingId, renameValue.trim());
    }
    setRenamingId(null);
  }, [renamingId, renameValue, renameBoard]);

  const cancelRename = useCallback(() => {
    setRenamingId(null);
  }, []);

  const handleDuplicate = useCallback((boardId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    duplicateBoard(boardId);
  }, [duplicateBoard]);

  const handleDeleteClick = useCallback((boardId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDeleteId(prev => {
      if (prev === boardId) {
        // Deleting the ACTIVE board is an implicit switch to a neighbor
        // (see desktop-store's deleteBoard) — capture this BEFORE the call
        // since activeBoardId flips as a side effect of deleteBoard itself.
        const wasActive = boardId === activeBoardId;
        deleteBoard(boardId);
        // deleteBoard() no-ops when it's the last board (store-level guard,
        // mirrored here via `boards.length > 1`) — resetting in that case
        // would be harmless but wrong, since nothing actually switched.
        // Deleting an INACTIVE board changes nothing on screen either, so
        // only reset when the deleted board was active AND a neighbor
        // existed to switch into.
        if (wasActive && boards.length > 1) {
          resetHarnessAfterBoardChange();
        }
        return null;
      }
      return boardId;
    });
  }, [deleteBoard, activeBoardId, boards.length]);

  const handleNewBoard = useCallback(() => {
    if (busy) return;
    createBoard();
    // createBoard() always switches into the newly created (empty) board
    // (see desktop-store), so — unlike delete — this reset is unconditional.
    resetHarnessAfterBoardChange();
    closeMenu();
  }, [busy, createBoard, closeMenu]);

  return (
    <div
      style={{ position: 'relative', display: 'inline-flex' }}
      onKeyDown={(e) => {
        // Catches Escape whether focus is on the trigger (normal DOM bubbling)
        // or inside the portalled menu (React bubbles portals through the
        // component tree, not the DOM tree, so this still fires). The rename
        // input's own Escape handler stops propagation, so an in-progress
        // rename cancels itself first without also closing the whole menu.
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          closeMenu();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="board-switcher title-bar-no-drag"
        data-testid="board-switcher-trigger"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Board switcher, current board ${activeBoard?.name ?? 'Board'}`}
        onClick={toggleOpen}
      >
        <span className="board-switcher-label">{activeBoard?.name ?? 'Board'}</span>
        <span className="board-switcher-chevron">
          <LucideIcon name="ChevronDown" size={12} />
        </span>
      </button>

      {open && createPortal(
        <>
          <div
            data-testid="board-switcher-backdrop"
            style={{ position: 'fixed', inset: 0, zIndex: 209 }}
            onClick={closeMenu}
          />
          <div
            className="board-switcher-menu"
            data-testid="board-switcher-menu"
            aria-label="Boards"
            style={{ position: 'fixed', top: menuCoords.top, left: menuCoords.left, zIndex: 210 }}
          >
            {boards.map((board) => {
              const isActive = board.id === activeBoardId;
              const isRenaming = renamingId === board.id;
              const isConfirmingDelete = confirmDeleteId === board.id;
              const switchDisabled = busy || isActive;
              const switchTitle = busy
                ? 'Finish or stop the running flow first'
                : isActive
                  ? 'Active board'
                  : undefined;
              const isLastBoard = boards.length <= 1;
              const deleteDisabled = busy || isLastBoard;
              const deleteTitle = busy
                ? 'Finish or stop the running flow first'
                : isLastBoard
                  ? 'Cannot delete the last board'
                  : isConfirmingDelete
                    ? 'Click again to confirm'
                    : 'Delete';

              return (
                <div
                  key={board.id}
                  className="board-switcher-row"
                  data-testid={`board-switcher-row-${board.id}`}
                  data-active={isActive ? 'true' : 'false'}
                >
                  {isRenaming ? (
                    <input
                      ref={renameInputRef}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename();
                        if (e.key === 'Escape') { e.stopPropagation(); cancelRename(); }
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="board-switcher-rename-input"
                      aria-label={`Rename ${board.name}`}
                      data-testid={`board-switcher-rename-input-${board.id}`}
                    />
                  ) : (
                    <button
                      type="button"
                      className="board-switcher-switch"
                      data-testid={`board-switcher-switch-${board.id}`}
                      disabled={switchDisabled}
                      title={switchTitle}
                      aria-current={isActive ? 'true' : undefined}
                      onClick={() => handleSwitch(board.id)}
                    >
                      {isActive && (
                        <LucideIcon name="Check" size={12} className="board-switcher-check" />
                      )}
                      <span className="board-switcher-name">{board.name}</span>
                    </button>
                  )}

                  <div className="board-switcher-actions">
                    <button
                      type="button"
                      className="board-switcher-icon-btn"
                      title="Rename"
                      aria-label={`Rename ${board.name}`}
                      data-testid={`board-switcher-rename-${board.id}`}
                      onClick={(e) => startRename(board.id, board.name, e)}
                    >
                      <LucideIcon name="Pencil" size={12} />
                    </button>
                    <button
                      type="button"
                      className="board-switcher-icon-btn"
                      title="Duplicate"
                      aria-label={`Duplicate ${board.name}`}
                      data-testid={`board-switcher-duplicate-${board.id}`}
                      onClick={(e) => handleDuplicate(board.id, e)}
                    >
                      <LucideIcon name="Copy" size={12} />
                    </button>
                    <button
                      type="button"
                      className="board-switcher-icon-btn board-switcher-icon-btn--danger"
                      title={deleteTitle}
                      aria-label={isConfirmingDelete ? `Confirm delete ${board.name}` : `Delete ${board.name}`}
                      data-testid={`board-switcher-delete-${board.id}`}
                      disabled={deleteDisabled}
                      onClick={(e) => handleDeleteClick(board.id, e)}
                    >
                      {isConfirmingDelete
                        ? <span className="board-switcher-confirm">Delete?</span>
                        : <LucideIcon name="Trash2" size={12} />}
                    </button>
                  </div>
                </div>
              );
            })}

            <button
              type="button"
              className="board-switcher-footer"
              data-testid="board-switcher-new-board"
              disabled={busy}
              title={busy ? 'Finish or stop the running flow first' : undefined}
              onClick={handleNewBoard}
            >
              <LucideIcon name="Plus" size={12} />
              New board
            </button>
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
