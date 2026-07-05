/**
 * NodeTree.flows.test.tsx — "Flows" group in the Components panel (Phase 9)
 *
 * Strategy:
 * - Mount <NodeTree /> (and, for the SideBar header-count regression, <SideBar />)
 *   against the REAL desktop-store — flows are just FrameGraphNode/StepGraphNode
 *   entries in `mentalNodes`, pure client-side state with no IPC involved, so
 *   there's nothing to fake. Reset via `useDesktopStore.setState(getInitialState(), true)`,
 *   the same pattern desktop-store.test.ts / StepInfoModal.test.tsx use.
 * - Mock harness-store (hoisted spy object) for `stepStatuses` only — the real
 *   store's execution actions dispatch through IPC/`window.helioxAPI`, which
 *   isn't available here and isn't what this file exercises.
 *
 * Fixture: 1 FrameGraphNode ("My Flow", 2 childIds) + 2 StepGraphNodes
 * (parentId = the frame's id) + 1 plain MentalGraphNode, seeded to prove the
 * Flows group only ever picks up frames (not mental cards).
 *
 * Phase 5 addition: `seedOrphanStep()` layers in a StepGraphNode that is NOT
 * referenced by any frame's `childIds` — the "orphan step" case. Before this
 * phase such a step rendered nowhere at all; it also used to leak into the
 * "Mental Cards" section (which mapped ALL mentalNodes, steps and frames
 * included) as a spurious "Untitled card" row. Both bugs are covered below.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgenticExecutionStatus } from '@/types/harness';

// ── Mock harness-store (execution status is out of scope for this file) ────

const mockHarness = vi.hoisted(() => ({
  stepStatuses: {} as Record<string, AgenticExecutionStatus>,
}));

vi.mock('@/renderer/store/harness-store', () => ({
  useHarnessStore: (selector: (s: typeof mockHarness) => unknown) => selector(mockHarness),
}));

// ── Import after mocks (real desktop-store) ─────────────────────────────────

import { useDesktopStore } from '@/renderer/store/desktop-store';
import { NodeTree } from './NodeTree';
import { SideBar } from './SideBar';

// ── Fixture ──────────────────────────────────────────────────────────────────

const FRAME_ID = 'frame-1';
const STEP_A_ID = 'step-a';
const STEP_B_ID = 'step-b';
const MENTAL_ID = 'mental-1';
const ORPHAN_STEP_ID = 'step-orphan';

const FRAME_POS = { x: 100, y: 100 };
const FRAME_SIZE = { width: 300, height: 200 };
const STEP_A_POS = { x: 120, y: 140 };
const STEP_A_SIZE = { width: 220, height: 120 };
const ORPHAN_STEP_POS = { x: 700, y: 500 };
const ORPHAN_STEP_SIZE = { width: 200, height: 100 };

function seedFlowFixture() {
  useDesktopStore.getState().addFrameNode({
    id: FRAME_ID,
    position: FRAME_POS,
    width: FRAME_SIZE.width,
    height: FRAME_SIZE.height,
    title: 'My Flow',
    childIds: [STEP_A_ID, STEP_B_ID],
  });
  useDesktopStore.getState().addStepNode({
    id: STEP_A_ID,
    parentId: FRAME_ID,
    position: STEP_A_POS,
    width: STEP_A_SIZE.width,
    height: STEP_A_SIZE.height,
    title: 'Step A',
  });
  useDesktopStore.getState().addStepNode({
    id: STEP_B_ID,
    parentId: FRAME_ID,
    position: { x: 120, y: 280 },
    width: 220,
    height: 120,
    title: 'Step B',
  });
  // Contrast fixture — a plain mental card must never surface in the Flows group.
  useDesktopStore.getState().addMentalNode({
    id: MENTAL_ID,
    position: { x: 600, y: 600 },
    width: 160,
    height: 80,
    text: 'A plain mental card',
    color: '#EDE9FE',
    shape: 'square',
  });
}

/**
 * A step that exists on the canvas but is deliberately NOT added to any
 * frame's `childIds` — e.g. it was dragged out of its frame, or created
 * directly on the canvas. Note: no `parentId` either, since orphan-ness is
 * defined purely by frame `childIds` membership (matching NodeTree's own
 * `orphanSteps` derivation), not by this compatibility field.
 */
function seedOrphanStep() {
  useDesktopStore.getState().addStepNode({
    id: ORPHAN_STEP_ID,
    position: ORPHAN_STEP_POS,
    width: ORPHAN_STEP_SIZE.width,
    height: ORPHAN_STEP_SIZE.height,
    title: 'Orphan Step',
  });
}

/** Mirrors NodeTree's navigateToMentalNode centering formula. */
function expectedPan(pos: { x: number; y: number }, size: { width: number; height: number }) {
  const zoom = useDesktopStore.getState().canvasZoom;
  const viewportW = window.innerWidth - 280;
  const viewportH = window.innerHeight - 60;
  return {
    x: -(pos.x * zoom) + viewportW / 2 - (size.width * zoom) / 2,
    y: -(pos.y * zoom) + viewportH / 2 - (size.height * zoom) / 2,
  };
}

beforeEach(() => {
  useDesktopStore.setState(useDesktopStore.getInitialState(), true);
  mockHarness.stepStatuses = {};
});

// ── Flows group — presence, counts, empty-state gate ────────────────────────

describe('NodeTree — Flows group', () => {
  it('renders a "Flows (1)" group with the flow title and a childIds-count badge', () => {
    seedFlowFixture();
    render(<NodeTree />);

    expect(screen.getByText('Flows (1)')).toBeInTheDocument();
    const row = screen.getByTestId(`nav-flow-${FRAME_ID}`);
    expect(within(row).getByText('My Flow')).toBeInTheDocument();
    expect(within(row).getByText('2')).toBeInTheDocument();
  });

  it('does not surface a plain mental card as a flow (contrast fixture)', () => {
    seedFlowFixture();
    render(<NodeTree />);

    expect(screen.queryByTestId(`nav-flow-${MENTAL_ID}`)).not.toBeInTheDocument();
    // Still listed under Mental Cards — just never counted as a Flow.
    expect(screen.getByTestId(`nav-mental-node-${MENTAL_ID}`)).toBeInTheDocument();
  });

  it('does not show the empty state when the canvas holds only a flow', () => {
    seedFlowFixture();
    render(<NodeTree />);
    expect(screen.queryByText('No components open')).not.toBeInTheDocument();
  });

  it('shows the empty state when there is truly nothing on the canvas', () => {
    render(<NodeTree />);
    expect(screen.getByText('No components open')).toBeInTheDocument();
  });
});

// ── Flow row — click to select + center ─────────────────────────────────────

describe('NodeTree — Flow row navigation', () => {
  it('clicking the flow row selects it and centers the canvas on the frame', () => {
    seedFlowFixture();
    render(<NodeTree />);

    fireEvent.click(screen.getByTestId(`nav-flow-${FRAME_ID}`));

    const state = useDesktopStore.getState();
    expect(state.selectedMentalNodeIds).toEqual([FRAME_ID]);
    const expected = expectedPan(FRAME_POS, FRAME_SIZE);
    expect(state.canvasPan.x).toBeCloseTo(expected.x);
    expect(state.canvasPan.y).toBeCloseTo(expected.y);
  });
});

// ── Aggregate status dot — worst-of child step statuses ─────────────────────

describe('NodeTree — Flow aggregate status dot', () => {
  it('reflects the worst-of status across child steps (error beats completed)', () => {
    seedFlowFixture();
    mockHarness.stepStatuses = { [STEP_A_ID]: 'completed', [STEP_B_ID]: 'error' };
    render(<NodeTree />);

    const dot = screen.getByTestId(`nav-flow-status-${FRAME_ID}`);
    expect(dot).toHaveAttribute('aria-label', 'status: error');
  });

  it('reads as idle when no child step has run yet', () => {
    seedFlowFixture();
    render(<NodeTree />);
    expect(screen.getByTestId(`nav-flow-status-${FRAME_ID}`)).toHaveAttribute('aria-label', 'status: idle');
  });

  it('running outranks paused and completed (severity ordering)', () => {
    seedFlowFixture();
    mockHarness.stepStatuses = { [STEP_A_ID]: 'completed', [STEP_B_ID]: 'running' };
    render(<NodeTree />);
    expect(screen.getByTestId(`nav-flow-status-${FRAME_ID}`)).toHaveAttribute('aria-label', 'status: running');
  });
});

// ── Delete — cascades to child steps ─────────────────────────────────────────

describe('NodeTree — Flow delete', () => {
  it("removes the frame and its child steps from the store (but not unrelated nodes)", () => {
    seedFlowFixture();
    render(<NodeTree />);

    fireEvent.click(screen.getByTestId(`nav-flow-close-${FRAME_ID}`));

    const ids = useDesktopStore.getState().mentalNodes.map(n => n.id);
    expect(ids).not.toContain(FRAME_ID);
    expect(ids).not.toContain(STEP_A_ID);
    expect(ids).not.toContain(STEP_B_ID);
    expect(ids).toContain(MENTAL_ID);
  });
});

// ── Step child rows — presence + navigation ─────────────────────────────────

describe('NodeTree — Flow step children', () => {
  it('renders one child row per step, titled from node.data.title', () => {
    seedFlowFixture();
    render(<NodeTree />);
    expect(screen.getByTestId(`nav-flow-child-${STEP_A_ID}`)).toHaveTextContent('Step A');
    expect(screen.getByTestId(`nav-flow-child-${STEP_B_ID}`)).toHaveTextContent('Step B');
  });

  it('clicking a step child row selects it and centers the canvas on that step', () => {
    seedFlowFixture();
    render(<NodeTree />);

    fireEvent.click(screen.getByTestId(`nav-flow-child-${STEP_A_ID}`));

    const state = useDesktopStore.getState();
    expect(state.selectedMentalNodeIds).toEqual([STEP_A_ID]);
    const expected = expectedPan(STEP_A_POS, STEP_A_SIZE);
    expect(state.canvasPan.x).toBeCloseTo(expected.x);
    expect(state.canvasPan.y).toBeCloseTo(expected.y);
  });

  it("a step child's own status dot reflects stepStatuses[stepId] independently of its sibling", () => {
    seedFlowFixture();
    mockHarness.stepStatuses = { [STEP_A_ID]: 'completed', [STEP_B_ID]: 'error' };
    render(<NodeTree />);
    expect(screen.getByTestId(`nav-flow-child-status-${STEP_A_ID}`)).toHaveAttribute('aria-label', 'status: completed');
    expect(screen.getByTestId(`nav-flow-child-status-${STEP_B_ID}`)).toHaveAttribute('aria-label', 'status: error');
  });
});

// ── Steps group — orphan steps (outside any frame) get a home ──────────────
//
// A step can exist on the canvas without being referenced by any frame's
// `childIds` (dragged out of its frame, or created directly outside one).
// Before this fix such a step rendered NOWHERE on purpose-built UI — its only
// appearance was the accidental "Untitled card" leak in Mental Cards (see the
// describe block below). Orphan steps now get a "Steps" group inside the
// same section as Flows, with the same navigate/select-on-click row the
// frame-child steps already use (StepRow, shared by both call sites).

describe('NodeTree — Steps group (orphan steps)', () => {
  it('renders a "Steps (1)" group inside the Flows section, listing the orphan step', () => {
    seedFlowFixture();
    seedOrphanStep();
    render(<NodeTree />);

    expect(screen.getByText('Steps (1)')).toBeInTheDocument();
    expect(screen.getByTestId(`nav-step-${ORPHAN_STEP_ID}`)).toHaveTextContent('Orphan Step');
  });

  it('renames the header "Flows" → "Flows / Steps", counting frames + orphan steps, once an orphan exists', () => {
    seedFlowFixture(); // 1 frame
    seedOrphanStep();  // + 1 orphan step = 2
    render(<NodeTree />);

    expect(screen.getByText('Flows / Steps (2)')).toBeInTheDocument();
    expect(screen.queryByText('Flows (1)')).not.toBeInTheDocument();
  });

  it('keeps the plain "Flows (N)" header when there are no orphan steps', () => {
    seedFlowFixture();
    render(<NodeTree />);

    expect(screen.getByText('Flows (1)')).toBeInTheDocument();
    expect(screen.queryByText(/Flows \/ Steps/)).not.toBeInTheDocument();
  });

  it('does not also list the orphan step as a frame child', () => {
    seedFlowFixture();
    seedOrphanStep();
    render(<NodeTree />);

    expect(screen.queryByTestId(`nav-flow-child-${ORPHAN_STEP_ID}`)).not.toBeInTheDocument();
  });

  it('surfaces the Steps group even when the canvas has no frames at all', () => {
    seedOrphanStep();
    render(<NodeTree />);

    expect(screen.getByText('Flows / Steps (1)')).toBeInTheDocument();
    expect(screen.getByText('Steps (1)')).toBeInTheDocument();
    expect(screen.getByTestId(`nav-step-${ORPHAN_STEP_ID}`)).toBeInTheDocument();
  });

  it('does not show the empty state when the canvas holds only an orphan step', () => {
    seedOrphanStep();
    render(<NodeTree />);
    expect(screen.queryByText('No components open')).not.toBeInTheDocument();
  });

  it('clicking the orphan step row selects it and centers the canvas on it, exactly like a frame-child row', () => {
    seedFlowFixture();
    seedOrphanStep();
    render(<NodeTree />);

    fireEvent.click(screen.getByTestId(`nav-step-${ORPHAN_STEP_ID}`));

    const state = useDesktopStore.getState();
    expect(state.selectedMentalNodeIds).toEqual([ORPHAN_STEP_ID]);
    const expected = expectedPan(ORPHAN_STEP_POS, ORPHAN_STEP_SIZE);
    expect(state.canvasPan.x).toBeCloseTo(expected.x);
    expect(state.canvasPan.y).toBeCloseTo(expected.y);
  });

  it("the orphan step's status dot reflects stepStatuses[stepId], same convention as frame-child rows", () => {
    seedFlowFixture();
    seedOrphanStep();
    mockHarness.stepStatuses = { [ORPHAN_STEP_ID]: 'error' };
    render(<NodeTree />);
    expect(screen.getByTestId(`nav-step-status-${ORPHAN_STEP_ID}`)).toHaveAttribute('aria-label', 'status: error');
  });
});

// ── Mental Cards section — lists ONLY type: 'mental' nodes ──────────────────
//
// Regression coverage for the bug this phase fixes: the section used to map
// ALL mentalNodes (frames + steps + cards), so a frame-child step or an
// orphan step would render here too, mislabeled "Untitled card" (frames/steps
// don't carry the free-form `text` the label falls back to the way authors
// intend for plain mental cards). Now it must count/render only plain
// MentalGraphNodes (`type === 'mental'`).

describe('NodeTree — Mental Cards section lists only mental cards', () => {
  it('counts only the plain mental card — not the frame, its steps, or the orphan step', () => {
    seedFlowFixture(); // 1 frame + 2 child steps + 1 mental card
    seedOrphanStep();  // + 1 orphan step — 5 mentalNodes total, only 1 is type "mental"
    render(<NodeTree />);

    expect(screen.getByText('Mental Cards (1)')).toBeInTheDocument();
  });

  it('does not render a frame-child step as a Mental Cards row', () => {
    seedFlowFixture();
    render(<NodeTree />);
    expect(screen.queryByTestId(`nav-mental-node-${STEP_A_ID}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`nav-mental-node-${STEP_B_ID}`)).not.toBeInTheDocument();
  });

  it('does not render the orphan step as a Mental Cards row', () => {
    seedOrphanStep();
    render(<NodeTree />);
    expect(screen.queryByTestId(`nav-mental-node-${ORPHAN_STEP_ID}`)).not.toBeInTheDocument();
  });

  it('still renders the plain mental card row', () => {
    seedFlowFixture();
    render(<NodeTree />);
    expect(screen.getByTestId(`nav-mental-node-${MENTAL_ID}`)).toBeInTheDocument();
  });
});

// ── Locate (context menu) — parity with row-click on the same node ─────────
//
// NodeTree.tsx used to hold four copies of the viewport-centering formula:
// navigateToWindow, navigateToGrid, navigateToMentalNode, and an inline copy
// in the 'locate' context-menu case for `target.kind === 'mental'`. The
// inline copy never called setSelectedMentalNodeIds, so right-click → Locate
// on a mental/step/flow node only re-centered the canvas, while clicking the
// node's own row (via navigateToMentalNode) both selected and centered it.
// The fix routes 'locate' through navigateToMentalNode, so both paths now
// agree on selection AND land on the exact same pan.
//
// Phase 5 note: these two cases used to right-click `nav-mental-node-<id>`
// for STEP_A — that row only existed because the (buggy) Mental Cards
// section mapped every mentalNodes entry, steps included. Now that Mental
// Cards is restricted to `type === 'mental'` (see below), STEP_A's only row
// is its Flows-group `StepRow` (`nav-flow-child-<id>`) — so context-menu
// Locate parity is asserted against THAT row instead. StepRow carries the
// same onContextMenu wiring the old leaked row had, so the capability isn't
// lost, just relocated to the row that's actually supposed to represent it.

describe('NodeTree — Locate (context menu) parity with row-click', () => {
  it("'locate' on a step node selects it and centers the canvas (new consistency)", () => {
    seedFlowFixture();
    render(<NodeTree />);

    fireEvent.contextMenu(screen.getByTestId(`nav-flow-child-${STEP_A_ID}`));
    fireEvent.click(screen.getByTestId('nodetree-ctx-locate'));

    const state = useDesktopStore.getState();
    expect(state.selectedMentalNodeIds).toEqual([STEP_A_ID]);
    const expected = expectedPan(STEP_A_POS, STEP_A_SIZE);
    expect(state.canvasPan.x).toBeCloseTo(expected.x);
    expect(state.canvasPan.y).toBeCloseTo(expected.y);
  });

  it("'locate' centers on the exact same pan as clicking the step's row in the Flows group", () => {
    seedFlowFixture();
    render(<NodeTree />);

    fireEvent.contextMenu(screen.getByTestId(`nav-flow-child-${STEP_A_ID}`));
    fireEvent.click(screen.getByTestId('nodetree-ctx-locate'));
    const viaLocate = useDesktopStore.getState().canvasPan;

    // Clear pan/selection so the next assertion can't pass by coincidence.
    useDesktopStore.setState({ canvasPan: { x: 0, y: 0 }, selectedMentalNodeIds: [] });

    fireEvent.click(screen.getByTestId(`nav-flow-child-${STEP_A_ID}`));
    const state = useDesktopStore.getState();

    expect(state.selectedMentalNodeIds).toEqual([STEP_A_ID]);
    expect(state.canvasPan.x).toBeCloseTo(viaLocate.x);
    expect(state.canvasPan.y).toBeCloseTo(viaLocate.y);
  });
});

// ── SideBar header count — includes flows alongside windows ─────────────────

describe('SideBar — Components header count', () => {
  it('adds the flow count on top of the window count (not just windows.length)', () => {
    seedFlowFixture(); // 1 frame + 2 steps + 1 mental card
    useDesktopStore.getState().addWindow('chat');
    useDesktopStore.getState().addWindow('chat');
    render(<SideBar />);

    // 2 windows + 1 flow = 3 — proves frames are added on top of windows.length,
    // not swallowed by it (the pre-Phase-9 header only ever showed windows.length).
    expect(within(screen.getByTestId('window-navigator')).getByText('3')).toBeInTheDocument();
  });
});
