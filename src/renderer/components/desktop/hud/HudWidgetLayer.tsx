/**
 * HudWidgetLayer.tsx — Renderer Desktop Surface Component
 *
 * Responsibility:
 * - Fixed full-screen overlay that renders visible HUD widgets.
 * - Each widget is independently draggable and snap-to-grid positioned.
 * - Sits ABOVE the canvas but BELOW modals/marketplace (z-index 180).
 *
 * Boundaries:
 * - Owns: drag behaviour, widget positioning, close actions
 * - Does NOT own: widget content, store state, or IPC
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
import React, { useRef, useCallback } from 'react';
import { useDesktopStore } from '../../../store/desktop-store';
import type { HudWidgetType } from '../../../store/desktop-store';
import { WidgetWrapper } from '../../atoms/WidgetWrapper';
import { AgentSessionsWidget } from '../../atoms/widgets/AgentSessionsWidget';
import { TextToFlowWidget } from '../../atoms/widgets/TextToFlowWidget';
import { NotificationsWidget } from '../../atoms/widgets/NotificationsWidget';
import { LucideIcon } from '../LucideIcon';
import { snapToHudGrid, clampToViewport } from '../../../logic/hud-grid';
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
  'text-to-flow':     { title: 'Text to Flow',     iconName: 'Workflow',  defaultWidth: 320, defaultHeight: 220 },
  'notifications':    { title: 'Notifications',    iconName: 'Bell',     defaultWidth: 300, defaultHeight: 280 },
};

function renderWidgetBody(type: HudWidgetType) {
  switch (type) {
    case 'agent-sessions':   return <AgentSessionsWidget />;
    case 'text-to-flow':     return <TextToFlowWidget />;
    case 'notifications':    return <NotificationsWidget />;
  }
}

// ─── DraggableWidget ─────────────────────────────────────────────

interface DraggableWidgetProps {
  type: HudWidgetType;
  position: { x: number; y: number };
}

function DraggableWidget({ type, position }: DraggableWidgetProps) {
  const setHudWidgetVisible = useDesktopStore(s => s.setHudWidgetVisible);
  const moveHudWidget       = useDesktopStore(s => s.moveHudWidget);

  const meta = WIDGET_META[type];

  // Track live drag offset separately from stored position to avoid store churn
  const dragState = useRef<{
    startMouseX: number;
    startMouseY: number;
    startPosX: number;
    startPosY: number;
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
      const snapped = snapToHudGrid({ x: rawX, y: rawY });
      const clamped = clampToViewport(
        snapped,
        { width: meta.defaultWidth, height: meta.defaultHeight },
        { width: window.innerWidth, height: window.innerHeight },
      );
      moveHudWidget(type, clamped);
      dragState.current = null;
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [position, type, meta, moveHudWidget]);

  const outerStyle: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    // Use transform for position so we can do live updates without layout
    transform: `translate(${position.x}px, ${position.y}px)`,
    width: meta.defaultWidth,
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
      <div style={{ position: 'relative' }}>
        {/* Drag handle overlaid on top of the WidgetWrapper header */}
        <div
          style={dragHandleStyle}
          onMouseDown={handleHeaderMouseDown}
          aria-hidden="true"
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

  return (
    <div style={layerStyle} data-testid="hud-widget-layer" aria-label="HUD widgets" role="region">
      {visibleWidgets.map(w => (
        <DraggableWidget key={w.type} type={w.type} position={w.position} />
      ))}
    </div>
  );
}
