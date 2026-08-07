/**
 * HudWidgetLayer.tsx — Renderer Desktop Surface Component
 *
 * Responsibility:
 * - Fixed full-screen overlay that renders visible HUD widgets.
 * - Each widget is independently draggable and snap-to-grid positioned.
 * - Sits ABOVE the canvas but BELOW modals/marketplace (z-index 180).
 * - Resolves each widget's placement (drag-release, resize-release, and
 *   spawn/reopen) through resolveHudWidgetPlacement (logic/hud-widget-policy.ts)
 *   so a widget can never land in the top-right safe zone or overlap another
 *   widget — see the `others`/safe-zone handling in DraggableWidget below.
 *
 * Boundaries:
 * - Owns: drag behaviour, widget positioning, close actions
 * - Does NOT own: widget content, store state, or IPC
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
import React, { useRef, useCallback, useEffect } from 'react';
import { useDesktopStore } from '../../../store/desktop-store';
import type { HudWidgetType } from '../../../store/desktop-store';
import { WidgetWrapper } from '../../atoms/WidgetWrapper';
import { AgentSessionsWidget } from '../../atoms/widgets/AgentSessionsWidget';
import { HudAutoChatPanel } from './HudAutoChatPanel';
import { NotificationsWidget } from '../../atoms/widgets/NotificationsWidget';
import { LucideIcon } from '../LucideIcon';
// Generic HUD grid math (HUD_GRID/snap/clamp/placement) now lives in
// @cmolg/daba-engine's core/hud-grid (adoption plan #20, javadaba-web Core,
// Task 10). This file used to import its own copy from `logic/hud-grid.ts`
// (deleted) — the Fluxor-specific policy that used to live there (widget size
// mins, the reserved top-right safe zone) moved to `logic/hud-widget-policy.ts`,
// a thin adapter over the motor's primitives. See that file's docblock.
import {
  snapSizeToHudGrid, MIN_WIDGET_WIDTH, MIN_WIDGET_HEIGHT, resolveHudWidgetPlacement,
} from '../../../logic/hud-widget-policy';
import type { HudRect } from '../../../logic/hud-widget-policy';
import { theme } from '../../../logic/theme';

// ─── Widget metadata ─────────────────────────────────────────────

interface WidgetMeta {
  title: string;
  iconName: string;
  defaultWidth: number;
  defaultHeight: number;
}

const WIDGET_META: Record<HudWidgetType, WidgetMeta> = {
  'agent-sessions':   { title: 'Agent Sessions',   iconName: 'Bot',      defaultWidth: 340, defaultHeight: 240 },
  // Was 'text-to-flow' / TextToFlowWidget — renamed in place (chats→steps
  // re-architecture, F0 decision 2): this widget IS the single automation
  // chat now (HudAutoChatPanel adds an intent-history list on the same
  // one-shot assemblePipeline→insertPipelineAssembly seam). See the
  // HudWidgetType rename comment in desktop-store.ts.
  'auto-chat':        { title: 'Auto-Chat',        iconName: 'Workflow', defaultWidth: 320, defaultHeight: 220 },
  'notifications':    { title: 'Notifications',    iconName: 'Bell',     defaultWidth: 300, defaultHeight: 280 },
};

function renderWidgetBody(type: HudWidgetType) {
  switch (type) {
    case 'agent-sessions':   return <AgentSessionsWidget />;
    case 'auto-chat':        return <HudAutoChatPanel />;
    case 'notifications':    return <NotificationsWidget />;
  }
}

/** A widget's effective (rendered) size: user-resized (persisted) size wins
 *  over its WIDGET_META default. Shared by HudWidgetLayer (to build the
 *  `others` rects passed to every widget) and DraggableWidget (`w`/`h`) so
 *  the two never disagree about how big a widget actually is on screen. */
function effectiveWidgetSize(type: HudWidgetType, size?: { width: number; height: number }) {
  const meta = WIDGET_META[type];
  return { width: size?.width ?? meta.defaultWidth, height: size?.height ?? meta.defaultHeight };
}

// ─── DraggableWidget ─────────────────────────────────────────────

interface DraggableWidgetProps {
  type: HudWidgetType;
  position: { x: number; y: number };
  size?: { width: number; height: number };
  /** Rects of every OTHER currently-visible widget (never includes `type`
   *  itself), in the same absolute px space as `position`. Passed down by
   *  HudWidgetLayer so drag-release, resize-release, and spawn/reopen can
   *  all resolve this widget's placement against its actual neighbours —
   *  see resolveHudWidgetPlacement in logic/hud-widget-policy.ts. */
  others: HudRect[];
}

function DraggableWidget({ type, position, size, others }: DraggableWidgetProps) {
  const setHudWidgetVisible = useDesktopStore(s => s.setHudWidgetVisible);
  const moveHudWidget       = useDesktopStore(s => s.moveHudWidget);
  const resizeHudWidget     = useDesktopStore(s => s.resizeHudWidget);

  const meta = WIDGET_META[type];
  // Effective size: user-resized (persisted) size wins over the widget's default
  const { width: w, height: h } = effectiveWidgetSize(type, size);

  // Spawn/reopen leg of the placement resolver: the moment this widget
  // starts being displayed (initial mount for an already-visible widget, OR
  // freshly mounted because WidgetLauncher just toggled it visible — either
  // way HudWidgetLayer only renders visible widgets, so mount === "appeared"),
  // check whether its current position is still valid and relocate it if not.
  // Deliberately mount-only (empty deps): re-running this whenever a SIBLING
  // moves would fight the user's own drags every time another widget settles.
  useEffect(() => {
    const resolved = resolveHudWidgetPlacement({
      desired: position,
      size: { width: w, height: h },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      others,
    });
    if (resolved.x !== position.x || resolved.y !== position.y) {
      moveHudWidget(type, resolved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track live drag offset separately from stored position to avoid store churn
  const dragState = useRef<{
    startMouseX: number;
    startMouseY: number;
    startPosX: number;
    startPosY: number;
  } | null>(null);
  // Track live resize offset separately from stored size to avoid store churn
  const resizeState = useRef<{
    startMouseX: number;
    startMouseY: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);
  const widgetRef = useRef<HTMLDivElement>(null);

  const handleHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    // Only left button; do not steal from interactive children
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    dragState.current = {
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startPosX: position.x,
      startPosY: position.y,
    };

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragState.current || !widgetRef.current) return;
      const dx = ev.clientX - dragState.current.startMouseX;
      const dy = ev.clientY - dragState.current.startMouseY;
      const rawX = dragState.current.startPosX + dx;
      const rawY = dragState.current.startPosY + dy;
      // Apply live position via transform (no store writes during drag)
      widgetRef.current.style.transform = `translate(${rawX}px, ${rawY}px)`;
    };

    const onMouseUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      if (!dragState.current) return;
      const dx = ev.clientX - dragState.current.startMouseX;
      const dy = ev.clientY - dragState.current.startMouseY;
      const rawX = dragState.current.startPosX + dx;
      const rawY = dragState.current.startPosY + dy;
      // Snap + clamp (same feel as before), then nudge off the safe zone /
      // other widgets if the drop landed on either.
      const resolved = resolveHudWidgetPlacement({
        desired: { x: rawX, y: rawY },
        size: { width: w, height: h },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        others,
      });
      moveHudWidget(type, resolved);
      dragState.current = null;
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [position, type, moveHudWidget, w, h, others]);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    // Only left button; do not steal from interactive children
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    resizeState.current = {
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startWidth: w,
      startHeight: h,
    };

    const onMouseMove = (ev: MouseEvent) => {
      if (!resizeState.current || !widgetRef.current) return;
      const dx = ev.clientX - resizeState.current.startMouseX;
      const dy = ev.clientY - resizeState.current.startMouseY;
      const liveWidth = Math.max(MIN_WIDGET_WIDTH, resizeState.current.startWidth + dx);
      const liveHeight = Math.max(MIN_WIDGET_HEIGHT, resizeState.current.startHeight + dy);
      // Apply live size directly to the DOM (no store writes during drag)
      widgetRef.current.style.width = `${liveWidth}px`;
      widgetRef.current.style.height = `${liveHeight}px`;
    };

    const onMouseUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      if (!resizeState.current) return;
      const dx = ev.clientX - resizeState.current.startMouseX;
      const dy = ev.clientY - resizeState.current.startMouseY;
      const rawWidth = resizeState.current.startWidth + dx;
      const rawHeight = resizeState.current.startHeight + dy;
      const snapped = snapSizeToHudGrid({ width: rawWidth, height: rawHeight });
      // resizeHudWidget clamps to the min/viewport-max — no need to duplicate that here.
      resizeHudWidget(type, snapped);
      // Growing in place can push the widget into the safe zone or over a
      // neighbour it previously cleared — re-resolve position (same origin,
      // new size) and only write if it actually needs to move.
      const resolvedPos = resolveHudWidgetPlacement({
        desired: position,
        size: snapped,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        others,
      });
      if (resolvedPos.x !== position.x || resolvedPos.y !== position.y) {
        moveHudWidget(type, resolvedPos);
      }
      resizeState.current = null;
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [type, w, h, resizeHudWidget, position, others, moveHudWidget]);

  const outerStyle: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    // Use transform for position so we can do live updates without layout
    transform: `translate(${position.x}px, ${position.y}px)`,
    width: w,
    height: h,
    pointerEvents: 'auto',
    zIndex: 1,
  };

  const closeBtnStyle: React.CSSProperties = {
    position: 'absolute',
    top: 4,
    right: 6,
    padding: '1px 3px',
    background: 'transparent',
    border: 'none',
    color: theme.textFaint,
    cursor: 'pointer',
    borderRadius: 3,
    lineHeight: 1,
    zIndex: 2,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  const dragHandleStyle: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 28, // leave room for the close button
    height: 28,
    cursor: 'grab',
    zIndex: 1,
    userSelect: 'none',
  };

  return (
    <div ref={widgetRef} style={outerStyle} data-testid={`hud-widget-${type}`}>
      <div style={{ position: 'relative', height: '100%' }}>
        {/* Drag handle overlaid on top of the WidgetWrapper header */}
        <div
          style={dragHandleStyle}
          onMouseDown={handleHeaderMouseDown}
          aria-hidden="true"
          data-testid={`hud-widget-drag-${type}`}
        />
        {/* Close button */}
        <button
          style={closeBtnStyle}
          onClick={() => setHudWidgetVisible(type, false)}
          aria-label={`Close ${meta.title} widget`}
          title={`Close ${meta.title}`}
        >
          <LucideIcon name="X" size={12} />
        </button>
        {/* The actual widget */}
        <WidgetWrapper title={meta.title} iconName={meta.iconName}>
          {renderWidgetBody(type)}
        </WidgetWrapper>
      </div>
      {/* SE resize handle — user-resizing with persisted, grid-snapped size */}
      <div
        className="resize-handle nodrag"
        data-dir="se"
        onMouseDown={handleResizeMouseDown}
        aria-hidden="true"
      />
    </div>
  );
}

// ─── HudWidgetLayer ──────────────────────────────────────────────

export function HudWidgetLayer() {
  const hudWidgets = useDesktopStore(s => s.hudWidgets);

  // Guard against unknown/legacy widget types (e.g. a stale persisted entry) so a
  // bad type can never crash the whole Desktop via WIDGET_META[type].defaultWidth.
  const visibleWidgets = hudWidgets.filter(w => w.visible && WIDGET_META[w.type]);

  if (visibleWidgets.length === 0) return null;

  const layerStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    pointerEvents: 'none',
    zIndex: 180, // above canvas (100), SessionStatusDock (150), but below marketplace/modals (200+)
  };

  // Effective rect (position + effective size) per visible widget, keyed by
  // type — the basis for each widget's `others` prop (every OTHER visible
  // widget's rect) that the placement resolver avoids on drag/resize/spawn.
  const rectsByType = new Map<HudWidgetType, HudRect>();
  for (const w of visibleWidgets) {
    const { width, height } = effectiveWidgetSize(w.type, w.size);
    rectsByType.set(w.type, { x: w.position.x, y: w.position.y, width, height });
  }

  return (
    <div style={layerStyle} data-testid="hud-widget-layer" aria-label="HUD widgets" role="region">
      {visibleWidgets.map(w => (
        <DraggableWidget
          key={w.type}
          type={w.type}
          position={w.position}
          size={w.size}
          others={visibleWidgets.filter(o => o.type !== w.type).map(o => rectsByType.get(o.type)!)}
        />
      ))}
    </div>
  );
}
