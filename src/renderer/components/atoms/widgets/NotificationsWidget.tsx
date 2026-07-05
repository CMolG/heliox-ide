/**
 * NotificationsWidget.tsx — Renderer IDE Widget Component
 *
 * Responsibility:
 * - Renders the notification list inside the HUD widget system.
 * - Mirrors the panel logic from the old NotificationCenterApp.
 *
 * Boundaries:
 * - Owns: component-level rendering and local interaction wiring
 * - Does NOT own: notification creation, persistence, or IPC
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
import React, { useEffect } from 'react';
import { useDesktopStore } from '../../../store/desktop-store';
import { LucideIcon } from '../../desktop/LucideIcon';
import { theme } from '../../../logic/theme';

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ─── Component ───────────────────────────────────────────────────

export function NotificationsWidget() {
  const notifications = useDesktopStore(s => s.notifications);
  const unreadCount   = useDesktopStore(s => s.unreadCount);
  const markAllRead   = useDesktopStore(s => s.markAllRead);
  const clearNotifications = useDesktopStore(s => s.clearNotifications);

  // Mark all read when this widget is shown
  useEffect(() => {
    if (unreadCount > 0) markAllRead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const listStyle: React.CSSProperties = {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    maxHeight: 260,
    overflowY: 'auto',
  };

  const emptyStyle: React.CSSProperties = {
    fontFamily: theme.fontGrotesk,
    fontSize: 11,
    color: theme.textGhost,
    textAlign: 'center',
    padding: '16px 0',
  };

  const itemBase: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    padding: '5px 6px',
    borderRadius: 5,
    background: theme.surfaceCard,
  };

  const unreadItemStyle: React.CSSProperties = {
    ...itemBase,
    borderLeft: `2px solid ${theme.accentBlue}`,
    background: theme.accentBlueBg,
  };

  const timeStyle: React.CSSProperties = {
    fontFamily: theme.fontMono,
    fontSize: 9,
    color: theme.textFaint,
  };

  const msgStyle: React.CSSProperties = {
    fontFamily: theme.fontGrotesk,
    fontSize: 11,
    color: theme.textSecondary,
    lineHeight: 1.4,
  };

  const clearBtnStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '3px 8px',
    borderRadius: 5,
    border: `1px solid ${theme.borderLight}`,
    background: 'transparent',
    color: theme.textFaint,
    fontFamily: theme.fontGrotesk,
    fontSize: 10,
    cursor: 'pointer',
    marginBottom: 6,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {notifications.length > 0 && (
        <button
          onClick={clearNotifications}
          style={clearBtnStyle}
          data-testid="notifications-widget-clear"
        >
          <LucideIcon name="X" size={10} />
          Clear all
        </button>
      )}

      <ul style={listStyle} role="list" aria-label="Notifications">
        {notifications.length === 0 ? (
          <li style={emptyStyle} role="status" aria-live="polite">No notifications</li>
        ) : (
          notifications.map(n => (
            <li
              key={n.id}
              style={n.read ? itemBase : unreadItemStyle}
              data-testid={`notification-item-${n.id}`}
            >
              <span style={timeStyle}>{formatTime(n.timestamp)}</span>
              <span style={msgStyle}>{n.message}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
