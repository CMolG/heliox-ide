/**
 * WidgetLauncher.tsx — Renderer Desktop Surface Component
 *
 * Responsibility:
 * - Bottom-right floating button that replaces the standalone notification bell.
 * - On hover, reveals a compact menu of available HUD widgets to toggle.
 * - Retains an unread-notifications badge so notifications remain visible.
 *
 * Boundaries:
 * - Owns: hover menu state, widget toggle dispatches
 * - Does NOT own: widget content, notification creation, or IPC
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
import React, { useState, useRef, useCallback } from 'react';
import { useDesktopStore } from '../../../store/desktop-store';
import type { HudWidgetType } from '../../../store/desktop-store';
import { LucideIcon } from '../LucideIcon';
import { theme } from '../../../logic/theme';

// ─── Widget label map ────────────────────────────────────────────

const WIDGET_LABELS: Record<HudWidgetType, { label: string; iconName: string }> = {
  'agent-sessions':   { label: 'Agent Sessions',   iconName: 'Bot' },
  'text-to-flow':     { label: 'Text to Flow',     iconName: 'Workflow' },
  'notifications':    { label: 'Notifications',    iconName: 'Bell' },
};

const WIDGET_ORDER: HudWidgetType[] = ['agent-sessions', 'text-to-flow', 'notifications'];

// ─── Component ───────────────────────────────────────────────────

export function WidgetLauncher() {
  const hudWidgets      = useDesktopStore(s => s.hudWidgets);
  const toggleHudWidget = useDesktopStore(s => s.toggleHudWidget);
  const unreadCount     = useDesktopStore(s => s.unreadCount);

  const [open, setOpen] = useState(false);
  const closeTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const handleEnter = useCallback(() => {
    clearCloseTimer();
    setOpen(true);
  }, [clearCloseTimer]);

  const handleLeave = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => setOpen(false), 200);
  }, [clearCloseTimer]);

  const handleToggle = useCallback((type: HudWidgetType) => {
    toggleHudWidget(type);
  }, [toggleHudWidget]);

  // ─── Styles ────────────────────────────────────────────────

  const wrapperStyle: React.CSSProperties = {
    position: 'fixed',
    bottom: 24,
    right: 24,
    zIndex: 190,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 8,
  };

  const buttonStyle: React.CSSProperties = {
    width: 40,
    height: 40,
    borderRadius: 12,
    background: theme.surfaceCard,
    border: `1px solid ${theme.borderLight}`,
    color: theme.textSecondary,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    position: 'relative',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
    flexShrink: 0,
  };

  const badgeStyle: React.CSSProperties = {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    background: theme.accentBlue,
    color: '#fff',
    fontSize: 9,
    fontFamily: theme.fontMono,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 3px',
    pointerEvents: 'none',
  };

  const menuStyle: React.CSSProperties = {
    background: theme.surfaceCard,
    border: `1px solid ${theme.borderLight}`,
    borderRadius: 10,
    padding: '6px 0',
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    minWidth: 192,
  };

  const menuItemStyle = (visible: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '7px 14px',
    cursor: 'pointer',
    background: 'transparent',
    border: 'none',
    width: '100%',
    textAlign: 'left',
    color: visible ? theme.accentBlue : theme.textSecondary,
    fontFamily: theme.fontGrotesk,
    fontSize: 12,
    transition: 'background 0.1s',
  });

  const menuLabelStyle: React.CSSProperties = {
    flex: 1,
  };

  const checkStyle = (visible: boolean): React.CSSProperties => ({
    width: 14,
    height: 14,
    borderRadius: 3,
    border: `1px solid ${visible ? theme.accentBlue : theme.borderLight}`,
    background: visible ? theme.accentBlueBg : 'transparent',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  });

  return (
    <div
      style={wrapperStyle}
      onPointerEnter={handleEnter}
      onPointerLeave={handleLeave}
    >
      {/* Hover menu — shown above the trigger button */}
      {open && (
        <div
          style={menuStyle}
          role="menu"
          aria-label="HUD widget launcher menu"
        >
          {WIDGET_ORDER.map(type => {
            const meta = WIDGET_LABELS[type];
            const widget = hudWidgets.find(w => w.type === type);
            const visible = widget?.visible ?? false;
            return (
              <button
                key={type}
                style={menuItemStyle(visible)}
                role="menuitemcheckbox"
                aria-checked={visible}
                aria-label={`${visible ? 'Hide' : 'Show'} ${meta.label}`}
                onClick={() => handleToggle(type)}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = theme.surfaceHover; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                <LucideIcon name={meta.iconName} size={14} />
                <span style={menuLabelStyle}>{meta.label}</span>
                <span style={checkStyle(visible)} aria-hidden="true">
                  {visible && <LucideIcon name="CheckCircle" size={10} style={{ color: theme.accentBlue }} />}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Launcher trigger button */}
      <button
        style={buttonStyle}
        aria-label="Open widget launcher"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="widget-launcher"
        title="Widget launcher"
      >
        <LucideIcon name="LayoutGrid" size={18} />
        {unreadCount > 0 && (
          <span
            style={badgeStyle}
            data-testid="widget-launcher-badge"
            aria-label={`${unreadCount > 9 ? '9+' : unreadCount} unread notifications`}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
    </div>
  );
}
