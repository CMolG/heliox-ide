/**
 * HudWidgetLayer.test.tsx — HUD widget containment + resize tests (Phase 3)
 *
 * Strategy (mirrors StepNode.test.tsx):
 * - Mock desktop-store with a hoisted state object so widget visibility,
 *   position, size and the move/resize actions are fully controlled.
 * - Mock WidgetWrapper and the three widget bodies shallowly — their own
 *   behaviour is covered by dedicated tests elsewhere, and they pull in
 *   useHelioxStore/IPC-backed deps this file doesn't want to bring along.
 *
 * Bug under test: the widget container used to set only `width` (no
 * `height`), so WidgetWrapper's `height:100%` + inner `flex:1; overflow:auto`
 * collapsed to content height instead of containing it — widgets grew
 * infinitely with content. This file asserts the container now carries an
 * explicit inline height (default or persisted) and can be user-resized.
 *
 * Scenarios:
 *   1. The widget container gets inline width/height equal to WIDGET_META's
 *      defaults when no persisted size exists.
 *   2. A persisted `size` on the HudWidget overrides the default width/height.
 *   3. The layer renders nothing when no widget is visible (unchanged guard).
 *   4. The SE resize handle is present in the DOM.
 *   5. Mousedown on the handle + a document mousemove + mouseup calls
 *      `resizeHudWidget` with the type and a grid-snapped size.
 *   6. A non-left-button mousedown never arms the resize interaction.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// Real (unmocked) hud-grid — Phase 4 tests assert against the actual
// SAFE_ZONE/rectsOverlap so they don't silently pass if the wiring below
// stops calling the real resolver.
import { SAFE_ZONE, rectsOverlap } from '../../../logic/hud-grid';

// ── Module mocks ─────────────────────────────────────────────────────────────

const mockDesktop = vi.hoisted(() => ({
  hudWidgets: [] as Array<{
    type: string;
    visible: boolean;
    position: { x: number; y: number };
    size?: { width: number; height: number };
  }>,
  setHudWidgetVisible: vi.fn(),
  moveHudWidget: vi.fn(),
  resizeHudWidget: vi.fn(),
}));

vi.mock('../../../store/desktop-store', () => ({
  useDesktopStore: (selector: (s: typeof mockDesktop) => unknown) => selector(mockDesktop),
}));

vi.mock('../../atoms/WidgetWrapper', () => ({
  WidgetWrapper: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mock-widget-wrapper">{children}</div>
  ),
}));

vi.mock('../../atoms/widgets/AgentSessionsWidget', () => ({
  AgentSessionsWidget: () => <div data-testid="mock-agent-sessions" />,
}));
vi.mock('../../atoms/widgets/TextToFlowWidget', () => ({
  TextToFlowWidget: () => <div data-testid="mock-text-to-flow" />,
}));
vi.mock('../../atoms/widgets/NotificationsWidget', () => ({
  NotificationsWidget: () => <div data-testid="mock-notifications" />,
}));

// ── Import after mocks ───────────────────────────────────────────────────────

import { HudWidgetLayer } from './HudWidgetLayer';

// ── Helpers ──────────────────────────────────────────────────────────────────

function setWidgets(widgets: typeof mockDesktop.hudWidgets) {
  mockDesktop.hudWidgets = widgets;
}

beforeEach(() => {
  document.body.innerHTML = '';
  setWidgets([{ type: 'agent-sessions', visible: true, position: { x: 900, y: 80 } }]);
  mockDesktop.setHudWidgetVisible.mockClear();
  mockDesktop.moveHudWidget.mockClear();
  mockDesktop.resizeHudWidget.mockClear();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('HudWidgetLayer — containment', () => {
  it('applies the WIDGET_META default width/height inline when no size is stored', () => {
    render(<HudWidgetLayer />);
    const widget = screen.getByTestId('hud-widget-agent-sessions');
    expect(widget.style.width).toBe('340px');
    expect(widget.style.height).toBe('240px');
  });

  it('applies a persisted size over the default', () => {
    setWidgets([
      { type: 'agent-sessions', visible: true, position: { x: 900, y: 80 }, size: { width: 400, height: 320 } },
    ]);
    render(<HudWidgetLayer />);
    const widget = screen.getByTestId('hud-widget-agent-sessions');
    expect(widget.style.width).toBe('400px');
    expect(widget.style.height).toBe('320px');
  });

  it('renders nothing when no widget is visible', () => {
    setWidgets([{ type: 'agent-sessions', visible: false, position: { x: 900, y: 80 } }]);
    const { container } = render(<HudWidgetLayer />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('HudWidgetLayer — SE resize handle', () => {
  it('renders an SE resize handle inside the widget container', () => {
    render(<HudWidgetLayer />);
    const widget = screen.getByTestId('hud-widget-agent-sessions');
    const handle = widget.querySelector('.resize-handle[data-dir="se"]');
    expect(handle).not.toBeNull();
  });

  it('calls resizeHudWidget with the type and a grid-snapped size on drag-resize', () => {
    render(<HudWidgetLayer />);
    const widget = screen.getByTestId('hud-widget-agent-sessions');
    const handle = widget.querySelector('.resize-handle[data-dir="se"]') as HTMLElement;
    expect(handle).not.toBeNull();

    // Default agent-sessions size is 340x240. Move (+20, +48) so both deltas
    // land exactly on HUD_GRID (24px) multiples: 360x288 — no rounding ambiguity.
    fireEvent.mouseDown(handle, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(document, { clientX: 120, clientY: 148 });
    fireEvent.mouseUp(document, { clientX: 120, clientY: 148 });

    expect(mockDesktop.resizeHudWidget).toHaveBeenCalledTimes(1);
    expect(mockDesktop.resizeHudWidget).toHaveBeenCalledWith('agent-sessions', { width: 360, height: 288 });
  });

  it('does not arm the resize interaction on a non-left-button mousedown', () => {
    render(<HudWidgetLayer />);
    const widget = screen.getByTestId('hud-widget-agent-sessions');
    const handle = widget.querySelector('.resize-handle[data-dir="se"]') as HTMLElement;

    fireEvent.mouseDown(handle, { button: 2, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(document, { clientX: 200, clientY: 200 });
    fireEvent.mouseUp(document, { clientX: 200, clientY: 200 });

    expect(mockDesktop.resizeHudWidget).not.toHaveBeenCalled();
  });
});

// ─── Phase 4: safe zone + collision-free placement ─────────────────────────
//
// Scenarios (all against the real jsdom viewport, 1024x768 — see
// window.innerWidth/innerHeight usage below rather than hardcoded numbers):
//   1. Spawn: a widget mounting inside the SAFE_ZONE gets relocated.
//   2. Spawn: a widget mounting somewhere free is left untouched.
//   3. Spawn: a widget mounting on top of an ALREADY-visible widget dodges it.
//   4. Resize-release: growing a widget into a neighbour re-resolves position.
//   5. Drag-release: dropping onto another widget resolves off it.
//   6. Drag-release: dropping into the SAFE_ZONE resolves off it.

describe('HudWidgetLayer — Phase 4 safe zone + collision resolution', () => {
  const viewport = { width: window.innerWidth, height: window.innerHeight };

  it('spawn: relocates a widget whose position lands inside the SAFE_ZONE on mount', () => {
    const zone = SAFE_ZONE(viewport);
    setWidgets([
      { type: 'agent-sessions', visible: true, position: { x: zone.x + 4, y: 4 }, size: { width: 48, height: 48 } },
    ]);
    render(<HudWidgetLayer />);

    expect(mockDesktop.moveHudWidget).toHaveBeenCalledTimes(1);
    const [type, resolved] = mockDesktop.moveHudWidget.mock.calls[0];
    expect(type).toBe('agent-sessions');
    expect(rectsOverlap({ ...resolved, width: 48, height: 48 }, zone)).toBe(false);
  });

  it('spawn: does not move a widget whose position is already clear of the SAFE_ZONE and any neighbour', () => {
    // Grid-aligned (48 = 2 * HUD_GRID) so the resolver's unconditional
    // snap step is also a no-op — isolates "no collision" from "not on grid".
    setWidgets([
      { type: 'agent-sessions', visible: true, position: { x: 48, y: 48 }, size: { width: 48, height: 48 } },
    ]);
    render(<HudWidgetLayer />);

    expect(mockDesktop.moveHudWidget).not.toHaveBeenCalled();
  });

  it('spawn: a newly-visible widget dodges an already-visible widget occupying the same rect', () => {
    // text-to-flow is already on screen and settled at (40,40) before agent-sessions appears.
    setWidgets([
      { type: 'text-to-flow', visible: true, position: { x: 40, y: 40 }, size: { width: 48, height: 48 } },
    ]);
    const { rerender } = render(<HudWidgetLayer />);
    mockDesktop.moveHudWidget.mockClear(); // drop text-to-flow's own (no-op) mount resolution

    // agent-sessions "spawns" directly on top of it.
    setWidgets([
      { type: 'text-to-flow', visible: true, position: { x: 40, y: 40 }, size: { width: 48, height: 48 } },
      { type: 'agent-sessions', visible: true, position: { x: 40, y: 40 }, size: { width: 48, height: 48 } },
    ]);
    rerender(<HudWidgetLayer />);

    expect(mockDesktop.moveHudWidget).toHaveBeenCalledTimes(1);
    const [type, resolved] = mockDesktop.moveHudWidget.mock.calls[0];
    expect(type).toBe('agent-sessions');
    expect(rectsOverlap({ ...resolved, width: 48, height: 48 }, { x: 40, y: 40, width: 48, height: 48 })).toBe(false);
  });

  it('resize-release: re-resolves position when growing the widget makes it overlap a neighbour', () => {
    // agent-sessions (340x240 default) starts well clear of text-to-flow, 120px gap.
    setWidgets([
      { type: 'agent-sessions', visible: true, position: { x: 40, y: 40 } },
      { type: 'text-to-flow', visible: true, position: { x: 500, y: 40 } },
    ]);
    render(<HudWidgetLayer />);
    mockDesktop.moveHudWidget.mockClear();
    mockDesktop.resizeHudWidget.mockClear();

    const widget = screen.getByTestId('hud-widget-agent-sessions');
    const handle = widget.querySelector('.resize-handle[data-dir="se"]') as HTMLElement;

    // Grow width from 340 to 504 (+164, lands on a grid multiple) — its
    // right edge (40+504=544) now reaches past text-to-flow's left edge (500).
    fireEvent.mouseDown(handle, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(document, { clientX: 264, clientY: 100 });
    fireEvent.mouseUp(document, { clientX: 264, clientY: 100 });

    expect(mockDesktop.resizeHudWidget).toHaveBeenCalledTimes(1);
    expect(mockDesktop.resizeHudWidget).toHaveBeenCalledWith('agent-sessions', { width: 504, height: 240 });

    expect(mockDesktop.moveHudWidget).toHaveBeenCalledTimes(1);
    const [type, resolved] = mockDesktop.moveHudWidget.mock.calls[0];
    expect(type).toBe('agent-sessions');
    const resolvedRect = { ...resolved, width: 504, height: 240 };
    expect(rectsOverlap(resolvedRect, { x: 500, y: 40, width: 320, height: 220 })).toBe(false);
  });

  it('drag-release: dropping onto another widget resolves to a non-overlapping position', () => {
    setWidgets([
      { type: 'text-to-flow', visible: true, position: { x: 500, y: 40 }, size: { width: 48, height: 48 } },
      { type: 'agent-sessions', visible: true, position: { x: 40, y: 40 }, size: { width: 48, height: 48 } },
    ]);
    render(<HudWidgetLayer />);
    mockDesktop.moveHudWidget.mockClear();

    const dragHandle = screen.getByTestId('hud-widget-drag-agent-sessions');
    // Drag agent-sessions (40,40) by (+460, 0) so it lands exactly on
    // text-to-flow's rect (500,40)-(548,88).
    fireEvent.mouseDown(dragHandle, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(document, { clientX: 460, clientY: 0 });
    fireEvent.mouseUp(document, { clientX: 460, clientY: 0 });

    expect(mockDesktop.moveHudWidget).toHaveBeenCalledTimes(1);
    const [type, resolved] = mockDesktop.moveHudWidget.mock.calls[0];
    expect(type).toBe('agent-sessions');
    expect(rectsOverlap({ ...resolved, width: 48, height: 48 }, { x: 500, y: 40, width: 48, height: 48 })).toBe(false);
  });

  it('drag-release: dropping into the SAFE_ZONE resolves to a position outside it', () => {
    setWidgets([
      { type: 'agent-sessions', visible: true, position: { x: 40, y: 40 }, size: { width: 48, height: 48 } },
    ]);
    render(<HudWidgetLayer />);
    mockDesktop.moveHudWidget.mockClear();

    const zone = SAFE_ZONE(viewport);
    const dragHandle = screen.getByTestId('hud-widget-drag-agent-sessions');
    // Drag from (40,40) to deep inside the safe zone.
    const targetX = zone.x + 4;
    const targetY = 20;
    fireEvent.mouseDown(dragHandle, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(document, { clientX: targetX - 40, clientY: targetY - 40 });
    fireEvent.mouseUp(document, { clientX: targetX - 40, clientY: targetY - 40 });

    expect(mockDesktop.moveHudWidget).toHaveBeenCalledTimes(1);
    const [type, resolved] = mockDesktop.moveHudWidget.mock.calls[0];
    expect(type).toBe('agent-sessions');
    expect(rectsOverlap({ ...resolved, width: 48, height: 48 }, zone)).toBe(false);
  });
});
