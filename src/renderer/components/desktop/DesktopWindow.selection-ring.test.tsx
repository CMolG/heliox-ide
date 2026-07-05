/**
 * DesktopWindow.selection-ring.test.tsx — Task 7 (2026-07-05 canvas/inspector
 * plan, Phase 2): the blue selection ring used to be an `outline` on the
 * INNER `.desktop-window`, a sibling of role/mod/flow attachments (both are
 * children of the OUTER `.desktop-window-shell`) — the attachments visually
 * overlapped/cut the ring. The fix mirrors the selection data-attrs (and
 * `--role-color`) onto the shell and retargets the `outline-color` CSS rules
 * there instead, since the shell's own box is geometrically identical to the
 * inner window's (100% width/height, no padding on the shell — see
 * index.css's `.desktop-window-shell`/`.desktop-window` rules) — an outline
 * on the shell traces the exact same rect, just from an ancestor of the
 * attachments instead of a sibling.
 *
 * No DesktopWindow test existed before this file (verified via repo search).
 * This is a focused structural test: it asserts the mirrored data-attrs land
 * on `.desktop-window-shell`. jsdom doesn't paint, so it cannot assert the
 * ring is visually uncut — see the implementer's report for the manual
 * visual check.
 *
 * Strategy:
 * - Render against the REAL desktop-store (pure client state, no IPC),
 *   seeded via `addWindow` — mirrors StepInfoModal.test.tsx's approach.
 * - Mock @dnd-kit/core's `useDroppable` (requires a DndContext otherwise) —
 *   the same mock StepNode.test.tsx and
 *   MentalGraphCanvas.forkIndicator.test.tsx use.
 */
import React from 'react';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { useDesktopStore } from '../../store/desktop-store';
import { DesktopWindow } from './DesktopWindow';

vi.mock('@dnd-kit/core', () => ({
  useDroppable: () => ({ isOver: false, setNodeRef: vi.fn() }),
}));

beforeEach(() => {
  useDesktopStore.setState(useDesktopStore.getInitialState(), true);
});

function renderWindow(windowId: string) {
  return render(
    <DesktopWindow windowId={windowId}>
      <div>content</div>
    </DesktopWindow>,
  );
}

describe('DesktopWindow — selection ring carrier (.desktop-window-shell)', () => {
  it('mirrors data-active="true" onto the shell for the active window', () => {
    // addWindow() makes the newly-created window the active one.
    const id = useDesktopStore.getState().addWindow('chat');
    const { container } = renderWindow(id);

    const shell = container.querySelector('.desktop-window-shell');
    expect(shell).toHaveAttribute('data-active', 'true');
    // The inner window keeps carrying it too (role-color propagation rules
    // still key off it) — both must agree.
    expect(container.querySelector(`[data-testid="desktop-window-${id}"]`))
      .toHaveAttribute('data-active', 'true');
  });

  it('mirrors data-active="false" once a DIFFERENT window becomes active', () => {
    const id = useDesktopStore.getState().addWindow('chat');
    useDesktopStore.getState().addWindow('chat'); // this one becomes active instead
    const { container } = renderWindow(id);

    expect(container.querySelector('.desktop-window-shell')).toHaveAttribute('data-active', 'false');
  });

  it('mirrors data-highlighted from hoveredWindowId', () => {
    const id = useDesktopStore.getState().addWindow('chat');
    useDesktopStore.setState({ hoveredWindowId: id });
    const { container } = renderWindow(id);

    expect(container.querySelector('.desktop-window-shell')).toHaveAttribute('data-highlighted', 'true');
  });

  it('mirrors data-highlighted="false" when a different window is hovered', () => {
    const id = useDesktopStore.getState().addWindow('chat');
    useDesktopStore.setState({ hoveredWindowId: 'some-other-window' });
    const { container } = renderWindow(id);

    expect(container.querySelector('.desktop-window-shell')).toHaveAttribute('data-highlighted', 'false');
  });

  it('mirrors data-selected from selectedWindowIds', () => {
    const id = useDesktopStore.getState().addWindow('chat');
    useDesktopStore.setState({ selectedWindowIds: [id] });
    const { container } = renderWindow(id);

    expect(container.querySelector('.desktop-window-shell')).toHaveAttribute('data-selected', 'true');
  });

  it('mirrors data-has-role and --role-color onto the shell (role attachments render as shell children)', () => {
    useDesktopStore.setState({
      marketInventory: {
        flows: [],
        mods: [],
        roles: [
          { name: 'frontend-engineer', icon: 'User', iconLibrary: 'lucide', description: '', tags: [], color: '#E87040' },
        ],
      },
    });
    const id = useDesktopStore.getState().addWindow('chat', { roleId: 'frontend-engineer' });
    const { container } = renderWindow(id);

    const shell = container.querySelector('.desktop-window-shell') as HTMLElement;
    expect(shell).toHaveAttribute('data-has-role', 'true');
    expect(shell.style.getPropertyValue('--role-color')).toBe('#E87040');
  });

  it('shell has no role/selection state for a plain, unselected, inactive window', () => {
    const id = useDesktopStore.getState().addWindow('chat');
    useDesktopStore.getState().addWindow('chat'); // steals "active"
    const { container } = renderWindow(id);

    const shell = container.querySelector('.desktop-window-shell');
    expect(shell).toHaveAttribute('data-active', 'false');
    expect(shell).toHaveAttribute('data-highlighted', 'false');
    expect(shell).toHaveAttribute('data-selected', 'false');
    expect(shell).toHaveAttribute('data-has-role', 'false');
  });
});
