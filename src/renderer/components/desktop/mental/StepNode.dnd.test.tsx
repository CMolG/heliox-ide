/**
 * StepNode.dnd.test.tsx — real dnd-kit collision regression test
 *
 * Drives an actual PointerSensor drag gesture (pointerdown/move/up) through a
 * real (unmocked) @dnd-kit/core DndContext, with real StepNode + DesktopAttachable
 * components — no mocked dnd-kit — to prove that dropping a Mod/Role card onto a
 * StepNode correctly attaches it. @xyflow/react IS mocked (Handle/Position only):
 * StepNode renders real `<Handle>` connection points, and the genuine xyflow
 * Handle throws when rendered outside a <ReactFlowProvider>, which this file
 * intentionally doesn't set up (dnd-kit collision math is the thing under test).
 *
 * jsdom has no layout engine, so `getBoundingClientRect` is stubbed with concrete
 * rects (keyed by the same data-testids StepNode/DesktopAttachable already
 * render) — that's the only stand-in; the collision math itself is 100% real.
 *
 * Root cause covered: SeamlessCanvas.tsx's <DndContext> previously had no
 * `collisionDetection` override, so dnd-kit fell back to its default,
 * `rectIntersection` (@dnd-kit/core/dist/core.esm.js:2864). That algorithm ranks
 * droppables by raw overlap AREA between the *dragged card's* bounding box and
 * each droppable's rect — not by where the pointer actually is. Pipeline steps
 * routinely sit adjacent to each other, and a user rarely grabs a card from its
 * exact center; when the grab point is off-center, the card's translated rect can
 * overlap a NEIGHBORING step more than the one the cursor is actually over, so
 * `rectIntersection` attaches to the wrong step (or none of the intended one) —
 * which reads to the user as "I dropped it on the step and nothing attached."
 * `pointerWithin` fixes this by requiring the pointer's own coordinate to fall
 * inside the target's rect, matching what the user visually did.
 */
import React, { useState } from 'react';
import { render as rtlRender, fireEvent, screen } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  DndContext, DragOverlay, PointerSensor, pointerWithin, useSensor, useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent, CollisionDetection } from '@dnd-kit/core';
import { EngineProvider, createEngineStore } from '@javadaba/daba-engine';

// Task 13 (adoption plan #20), Fase 2: StepNode now reads
// `engine.hoveredItemId` (unified highlight) via the motor's
// `useHoveredItem()`, which throws outside an `<EngineProvider>` — see
// FrameNode.test.tsx's identical wrapper for the full rationale (a fresh
// throwaway engine store per render; this file never asserts on engine/
// hover state, only real dnd-kit collision math).
function render(ui: React.ReactElement) {
  return rtlRender(<EngineProvider store={createEngineStore()}>{ui}</EngineProvider>);
}

// ── Module mocks (store + heavy leaf components only — dnd-kit stays real) ───

const mockDesktop = vi.hoisted(() => ({
  removeAttachable: vi.fn(),
  marketInventory: {
    mods: [{ name: 'strict-linting', icon: 'Wrench', iconLibrary: 'lucide', description: '', tags: [] }],
    roles: [{ name: 'frontend-engineer', icon: 'User', iconLibrary: 'lucide', description: '', tags: [], color: '#E87040' }],
    flows: [],
    steps: [],
  },
  mentalEdges: [] as unknown[],
  removeModFromStep: vi.fn(),
  removeRoleFromStep: vi.fn(),
  removeMentalNode: vi.fn(),
  bringMentalToFront: vi.fn(),
}));

vi.mock('../../../store/desktop-store', () => {
  const useDesktopStore = (selector: (s: typeof mockDesktop) => unknown) => selector(mockDesktop);
  useDesktopStore.getState = () => mockDesktop;
  return { useDesktopStore };
});

const mockHarness = vi.hoisted(() => ({
  stepStatuses: {} as Record<string, string>,
  runStep: vi.fn(),
  runFromStep: vi.fn(),
}));
vi.mock('../../../store/harness-store', () => ({
  useHarnessStore: (selector: (s: typeof mockHarness) => unknown) => selector(mockHarness),
}));

vi.mock('./StepThinkingPopover', () => ({ StepThinkingPopover: () => null }));
vi.mock('../StepInfoModal', () => ({ StepInfoModal: () => null }));

// Minimal @xyflow/react stand-in — only Handle/Position are used by StepNode
// (ReactFlow/ReactFlowProvider aren't needed since this file never renders a
// real flow instance). See the file-header comment for why this is required.
vi.mock('@xyflow/react', () => ({
  Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
  Handle: (p: { id: string; type: string }) => (
    <div data-testid={`step-handle-${p.id}`} data-handletype={p.type} />
  ),
}));

// ── Import after mocks ───────────────────────────────────────────────────────

import { StepNode } from './StepNode';
import { DesktopAttachable } from '../DesktopAttachable';
import type { NodeProps } from '@xyflow/react';
import type { DesktopAttachable as AttachableT } from '@/types/desktop';

function makeNodeProps(id: string, dataOverrides: Record<string, unknown> = {}): NodeProps {
  return {
    id, type: 'step', selected: false, zIndex: 2, isConnectable: true,
    positionAbsoluteX: 0, positionAbsoluteY: 0, dragging: false,
    data: { title: `Step ${id}`, description: '', mods: [], roles: [], ...dataOverrides },
  } as unknown as NodeProps;
}

const MOD_ATTACHABLE: AttachableT = {
  id: 'att-mod-strict-linting-1', type: 'mod', name: 'strict-linting',
  position: { x: 0, y: 0 }, zIndex: 5,
};
const ROLE_ATTACHABLE: AttachableT = {
  id: 'att-role-frontend-engineer-1', type: 'role', name: 'frontend-engineer',
  position: { x: 0, y: 0 }, zIndex: 5,
};

// ── Rects: give the real dnd-kit collision math real geometry ──────────────
// jsdom's getBoundingClientRect always returns zeros; rects are keyed by the
// data-testid StepNode/DesktopAttachable already render. Anything unregistered
// (the portaled DragOverlay content, body, html, scroll containers, ...) falls
// back to a deliberately tiny rect so nothing passes "by accident."
let RECTS: Record<string, { top: number; left: number; right: number; bottom: number; width: number; height: number }> = {};
const DEFAULT_RECT = { left: 0, top: 0, right: 2, bottom: 2, width: 2, height: 2 };

function stubRects() {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const testId = (this as HTMLElement).dataset?.testid;
    const r = (testId && RECTS[testId]) || DEFAULT_RECT;
    return { ...r, x: r.left, y: r.top, toJSON: () => r } as DOMRect;
  });
}

// ── Harness mirroring SeamlessCanvas's real DnD wiring: same PointerSensor +
// activationConstraint, and a handleDragEnd whose resolution rules match
// SeamlessCanvas.tsx's isStepNodeDropTarget/resolveDraggedMod/resolveDraggedRole
// (step-id membership, then mod/role lookup by the attachable's `name`) ─────

function Harness({ collisionDetection, stepIds, onDrop, children }: {
  collisionDetection?: CollisionDetection;
  stepIds: string[];
  onDrop: (stepId: string, kind: 'mod' | 'role', name: string) => void;
  children: React.ReactNode;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const stepIdSet = new Set(stepIds);

  const handleDragEnd = (event: DragEndEvent) => {
    setDragging(null);
    const { active, over } = event;
    if (!over || !stepIdSet.has(String(over.id))) return;
    const data = (active.data.current ?? {}) as { type?: string; name?: string };
    if (data.type === 'mod' && data.name) {
      const mod = mockDesktop.marketInventory.mods.find((m) => m.name === data.name);
      if (mod) onDrop(String(over.id), 'mod', mod.name);
    } else if (data.type === 'role' && data.name) {
      const role = mockDesktop.marketInventory.roles.find((r) => r.name === data.name);
      if (role) onDrop(String(over.id), 'role', role.name);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={(e) => setDragging(String(e.active.id))}
      onDragEnd={handleDragEnd}
    >
      {children}
      {stepIds.map((id) => <StepNode key={id} {...makeNodeProps(id)} />)}
      <DragOverlay dropAnimation={null}>
        {dragging ? <div data-testid="drag-overlay-card" style={{ width: 220, height: 100 }}>dragging</div> : null}
      </DragOverlay>
    </DndContext>
  );
}

function drag(cardTestId: string, from: { x: number; y: number }, to: { x: number; y: number }) {
  const card = screen.getByTestId(cardTestId);
  fireEvent.pointerDown(card, { pointerId: 1, isPrimary: true, button: 0, clientX: from.x, clientY: from.y, bubbles: true });
  // Clears the 5px activation constraint before the "real" move.
  fireEvent.pointerMove(document, { pointerId: 1, clientX: from.x + 12, clientY: from.y + 12, bubbles: true });
  fireEvent.pointerMove(document, { pointerId: 1, clientX: to.x, clientY: to.y, bubbles: true });
  fireEvent.pointerUp(document, { pointerId: 1, clientX: to.x, clientY: to.y, bubbles: true });
}

beforeEach(() => {
  document.body.innerHTML = '';
  mockDesktop.mentalEdges = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('real dnd-kit: dragging a Mod/Role card onto a StepNode', () => {
  it('attaches a mod to a single step (collisionDetection=pointerWithin, the fixed config)', () => {
    RECTS = {
      'desktop-attachable-mod-strict-linting': { left: 20, top: 20, right: 240, bottom: 120, width: 220, height: 100 },
      'step-node-step-1': { left: 400, top: 300, right: 600, bottom: 420, width: 200, height: 120 },
      'drag-overlay-card': { left: 0, top: 0, right: 220, bottom: 100, width: 220, height: 100 },
    };
    stubRects();
    const onDrop = vi.fn();
    render(
      <Harness collisionDetection={pointerWithin} stepIds={['step-1']} onDrop={onDrop}>
        <DesktopAttachable attachable={MOD_ATTACHABLE} />
      </Harness>
    );

    drag('desktop-attachable-mod-strict-linting', { x: 60, y: 60 }, { x: 500, y: 360 });

    expect(onDrop).toHaveBeenCalledWith('step-1', 'mod', 'strict-linting');
  });

  it('attaches a role to a single step (collisionDetection=pointerWithin, the fixed config)', () => {
    RECTS = {
      'desktop-attachable-role-frontend-engineer': { left: 20, top: 20, right: 240, bottom: 120, width: 220, height: 100 },
      'step-node-step-1': { left: 400, top: 300, right: 600, bottom: 420, width: 200, height: 120 },
      'drag-overlay-card': { left: 0, top: 0, right: 220, bottom: 100, width: 220, height: 100 },
    };
    stubRects();
    const onDrop = vi.fn();
    render(
      <Harness collisionDetection={pointerWithin} stepIds={['step-1']} onDrop={onDrop}>
        <DesktopAttachable attachable={ROLE_ATTACHABLE} />
      </Harness>
    );

    drag('desktop-attachable-role-frontend-engineer', { x: 60, y: 60 }, { x: 500, y: 360 });

    expect(onDrop).toHaveBeenCalledWith('step-1', 'role', 'frontend-engineer');
  });

  describe('precision regression: adjacent steps + an off-center grab', () => {
    // step-1 (400-600, 300-420) sits directly next to step-2 (600-750, 300-420) —
    // an ordinary layout for chained pipeline steps. The card is grabbed near its
    // RIGHT edge and dropped with the cursor squarely inside step-2 (620,360) and
    // OUTSIDE step-1 (620 > step-1's right edge of 600).
    const STEPS = ['step-1', 'step-2'];

    beforeEach(() => {
      RECTS = {
        'desktop-attachable-mod-strict-linting': { left: 20, top: 20, right: 240, bottom: 120, width: 220, height: 100 },
        'step-node-step-1': { left: 400, top: 300, right: 600, bottom: 420, width: 200, height: 120 },
        'step-node-step-2': { left: 600, top: 300, right: 750, bottom: 420, width: 150, height: 120 },
        'drag-overlay-card': { left: 0, top: 0, right: 220, bottom: 100, width: 220, height: 100 },
      };
      stubRects();
    });

    it('rectIntersection (dnd-kit\'s bare default) misattaches to the neighboring step', () => {
      const onDrop = vi.fn();
      render(
        // No collisionDetection override -> dnd-kit defaults to rectIntersection,
        // exactly like SeamlessCanvas.tsx's <DndContext> before the fix.
        <Harness stepIds={STEPS} onDrop={onDrop}>
          <DesktopAttachable attachable={MOD_ATTACHABLE} />
        </Harness>
      );

      // Grab near the card's right edge (220,70 abs) and land the cursor at
      // (620,360) — inside step-2, outside step-1.
      drag('desktop-attachable-mod-strict-linting', { x: 220, y: 70 }, { x: 620, y: 360 });

      // The bug, precisely: rectIntersection ranks by raw overlap area between
      // the *card's* translated rect and each step, so it hands the mod to
      // step-1 (200x120, larger overlap with the card) even though the pointer
      // is squarely over step-2 — not merely "fails silently," but confidently
      // wrong. This is what reads to a user as "I dropped it on the step and
      // nothing attached [to the step I meant]."
      expect(onDrop).toHaveBeenCalledWith('step-1', 'mod', 'strict-linting');
      expect(onDrop).not.toHaveBeenCalledWith('step-2', 'mod', 'strict-linting');
    });

    it('pointerWithin (the fix) attaches to the step the cursor is actually over', () => {
      const onDrop = vi.fn();
      render(
        <Harness collisionDetection={pointerWithin} stepIds={STEPS} onDrop={onDrop}>
          <DesktopAttachable attachable={MOD_ATTACHABLE} />
        </Harness>
      );

      drag('desktop-attachable-mod-strict-linting', { x: 220, y: 70 }, { x: 620, y: 360 });

      expect(onDrop).toHaveBeenCalledWith('step-2', 'mod', 'strict-linting');
    });
  });
});
