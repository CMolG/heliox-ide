/**
 * NodeTree.nestedRowIsolation.test.tsx — Task 13 (adoption plan #20), Fase 2
 *
 * `ComponentsPanel`'s row div owns onClick=locate()/onContextMenu=
 * onContextMenuRequest — decorative content nested INSIDE a `renderRow`
 * (a frame's child StepRows, a grid's child-window rows, a window's
 * attached-item chips) is now a DESCENDANT of that row (it used to be a
 * SIBLING in the pre-Task-13 shell, so clicking it never bubbled into
 * anything). This file pins down the orchestrator-required regression test:
 * interacting with nested content must resolve to ITS OWN domain action
 * (or none, for read-only chips/child-window rows that never had one) and
 * must NOT also fire the PARENT row's locate()/context-menu.
 *
 * Strategy: same as NodeTree.flows.test.tsx — mount <NodeTree/> against the
 * real desktop-store, harness-store mocked for stepStatuses only.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgenticExecutionStatus } from '@/types/harness';

const mockHarness = vi.hoisted(() => ({
  stepStatuses: {} as Record<string, AgenticExecutionStatus>,
}));

vi.mock('@/renderer/store/harness-store', () => ({
  useHarnessStore: (selector: (s: typeof mockHarness) => unknown) => selector(mockHarness),
}));

import { useDesktopStore } from '@/renderer/store/desktop-store';
import { NodeTree } from './NodeTree';

beforeEach(() => {
  useDesktopStore.setState(useDesktopStore.getInitialState(), true);
  mockHarness.stepStatuses = {};
});

describe('NodeTree — nested row click/contextmenu isolation', () => {
  it('clicking a frame-child StepRow selects the STEP, not the parent flow, and does not pan to the flow\'s rect', () => {
    const store = useDesktopStore.getState();
    const stepId = store.addStepNode({ position: { x: 500, y: 500 }, width: 220, height: 120, title: 'Child Step' });
    const frameId = store.addFrameNode({ position: { x: 0, y: 0 }, width: 300, height: 200, title: 'Parent Flow', childIds: [stepId] });
    render(<NodeTree />);

    fireEvent.click(screen.getByTestId(`nav-flow-child-${stepId}`));

    const state = useDesktopStore.getState();
    // If the click had leaked to the parent flow row (no stopPropagation),
    // the flow's own locate()+onLocate would have run AFTER this one
    // (event bubbling fires the descendant's handler first), overwriting
    // the selection back to [frameId] — asserting it's still exactly the
    // step proves that never happened.
    expect(state.selectedMentalNodeIds).toEqual([stepId]);
    expect(state.selectedMentalNodeIds).not.toEqual([frameId]);
  });

  it('right-clicking a frame-child StepRow opens the STEP\'s own context menu (Locate + Delete, no Rename)', () => {
    const store = useDesktopStore.getState();
    const stepId = store.addStepNode({ position: { x: 0, y: 0 }, title: 'Child Step' });
    store.addFrameNode({ position: { x: 0, y: 0 }, width: 300, height: 200, title: 'Parent Flow', childIds: [stepId] });
    render(<NodeTree />);

    fireEvent.contextMenu(screen.getByTestId(`nav-flow-child-${stepId}`));

    expect(screen.getByTestId('nodetree-context-menu')).toBeInTheDocument();
    expect(screen.getByTestId('nodetree-ctx-locate')).toBeInTheDocument();
    expect(screen.getByTestId('nodetree-ctx-delete')).toBeInTheDocument();
    // Steps never support rename (task13-decisiones.md Q3) — confirms this
    // opened the STEP's provider, not some other kind's.
    expect(screen.queryByTestId('nodetree-ctx-rename')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('nodetree-ctx-delete'));
    const ids = useDesktopStore.getState().mentalNodes.map((n) => n.id);
    expect(ids).not.toContain(stepId); // deleted the STEP, not the flow.
  });

  it('clicking a grid\'s child-window row does not pan/focus the parent grid (that row never had its own click behavior)', () => {
    const store = useDesktopStore.getState();
    const winId = store.addWindow('file-explorer', { position: { x: 10, y: 10 } });
    const gridId = store.addGrid({ position: { x: 400, y: 400 }, columns: 2, rows: 2 });
    store.assignWindowToCell(gridId, 0, winId);
    useDesktopStore.setState({ canvasPan: { x: 0, y: 0 } });
    render(<NodeTree />);

    fireEvent.click(screen.getByTestId(`nav-grid-child-${winId}`));

    // A real grid locate() would have moved canvasPan off {0,0} to center on
    // the grid's rect at (400,400) — staying put proves the click never
    // reached the grid row's own onClick.
    expect(useDesktopStore.getState().canvasPan).toEqual({ x: 0, y: 0 });
  });

  it('clicking an attached-item chip does not focus/pan to the parent window', () => {
    const store = useDesktopStore.getState();
    const activeId = store.addWindow('file-explorer', { position: { x: 0, y: 0 } });
    const chipWinId = store.addWindow('backlog', { position: { x: 900, y: 900 }, roleId: 'frontend-engineer' });
    store.focusWindow(activeId); // activeId is the one focused; chipWinId is not.
    useDesktopStore.setState({ canvasPan: { x: 0, y: 0 } });
    render(<NodeTree />);

    fireEvent.click(screen.getByTestId('nav-child-role-frontend-engineer'));

    const state = useDesktopStore.getState();
    // A real window locate() would have focusWindow(chipWinId) (stealing
    // active-window status) and panned off {0,0} — neither happened.
    expect(state.activeWindowId).toBe(activeId);
    expect(state.canvasPan).toEqual({ x: 0, y: 0 });
  });
});
