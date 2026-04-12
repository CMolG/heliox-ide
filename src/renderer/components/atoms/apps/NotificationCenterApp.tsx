/**
 * NotificationCenterApp.tsx — Renderer Embedded App Component
 *
 * Responsibility:
 * - Renders the NotificationCenterApp surface in the renderer layer.
 * - Encapsulates Embedded mini-app surface mounted inside desktop windows.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/desktop/NotificationCenter.tsx — System message notifications with bell + pulse
import React from 'react';
import { useDesktopStore } from '../../../store/desktop-store';
import { LucideIcon } from '../../desktop/LucideIcon';

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function NotificationCenterApp() {
  const notifications = useDesktopStore(s => s.notifications);
  const unreadCount = useDesktopStore(s => s.unreadCount);
  const showNotifications = useDesktopStore(s => s.showNotifications);
  const setShowNotifications = useDesktopStore(s => s.setShowNotifications);
  const markAllRead = useDesktopStore(s => s.markAllRead);
  const clearNotifications = useDesktopStore(s => s.clearNotifications);

  const handleToggle = () => {
    const next = !showNotifications;
    setShowNotifications(next);
    if (next && unreadCount > 0) {
      markAllRead();
    }
  };

  return (
    <>
      {/* Bell button in dock area */}
      <button
        className="notification-bell"
        data-testid="notification-bell"
        onClick={handleToggle}
        title="Notifications"
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-expanded={showNotifications}
      >
        <LucideIcon name={unreadCount > 0 ? 'BellDot' : 'Bell'} size={18} />
        {unreadCount > 0 && (
          <span className="notification-pulse" data-testid="notification-pulse" aria-label={`${unreadCount > 9 ? '9+' : unreadCount} unread notifications`}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Notification panel */}
      {showNotifications && (
        <div className="notification-panel" data-testid="notification-panel" role="region" aria-label="Notification center">
          <div className="notification-header">
            <span className="notification-title">Notifications</span>
            <div style={{ display: 'flex', gap: 8 }}>
              {notifications.length > 0 && (
                <button
                  onClick={clearNotifications}
                  className="notification-clear"
                  data-testid="notification-clear"
                >
                  Clear all
                </button>
              )}
              <button
                onClick={() => setShowNotifications(false)}
                className="notification-close"
                aria-label="Close notifications"
              >
                <LucideIcon name="X" size={14} />
              </button>
            </div>
          </div>

          <ul className="notification-list" role="list">
            {notifications.length === 0 ? (
              <li className="notification-empty" role="status" aria-live="polite">No notifications</li>
            ) : (
              notifications.map(n => (
                <li
                  key={n.id}
                  className={`notification-item ${n.read ? '' : 'unread'}`}
                  data-testid={`notification-${n.id}`}
                >
                  <span className="notification-time">{formatTime(n.timestamp)}</span>
                  <span className="notification-message">{n.message}</span>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </>
  );
}
