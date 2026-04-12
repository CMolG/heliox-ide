/**
 * WindowWrapper.tsx — Renderer Atomic Component
 *
 * Responsibility:
 * - Renders the WindowWrapper surface in the renderer layer.
 * - Encapsulates Small composable building block for renderer feature surfaces.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/atoms/WindowWrapper.tsx — Responsive visual frame for IDE Apps
import React from 'react';
import { theme } from '../../logic/theme';

// ─── Props ───────────────────────────────────────────────────────

interface WindowWrapperProps {
  children: React.ReactNode;
  title?: string;
  iconName?: string;
  className?: string;
  headerSlot?: React.ReactNode;
}

// ─── Styles ──────────────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  height: '100%',
  borderRadius: 10,
  border: `1px solid ${theme.borderLight}`,
  background: theme.surface,
  overflow: 'hidden',
  containerType: 'inline-size' as React.CSSProperties['containerType'],
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 12px',
  borderBottom: `1px solid ${theme.border}`,
  background: theme.surfaceCard,
  minHeight: 36,
  flexShrink: 0,
};

const headerLeftStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
};

const titleStyle: React.CSSProperties = {
  fontFamily: theme.fontGrotesk,
  fontSize: 13,
  fontWeight: 600,
  color: theme.textPrimary,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const iconBadgeStyle: React.CSSProperties = {
  width: 20,
  height: 20,
  borderRadius: 5,
  background: theme.surfaceHover,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 11,
  color: theme.textMuted,
  fontFamily: theme.fontMono,
  flexShrink: 0,
};

const contentStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'auto',
  padding: 12,
};

// ─── Component ───────────────────────────────────────────────────

export function WindowWrapper({
  children,
  title,
  iconName,
  className,
  headerSlot,
}: WindowWrapperProps) {
  const showHeader = title || iconName || headerSlot;

  return (
    <div style={containerStyle} className={className} data-testid="window-wrapper" role="region" aria-label={title ?? 'Window'}>
      {showHeader && (
        <div style={headerStyle} data-testid="window-wrapper-header">
          <div style={headerLeftStyle}>
            {iconName && (
              <div style={iconBadgeStyle} aria-hidden="true">
                {iconName.charAt(0).toUpperCase()}
              </div>
            )}
            {title && (
              <h2 style={titleStyle} title={title} role="heading" aria-level={2}>
                {title}
              </h2>
            )}
          </div>
          {headerSlot && <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{headerSlot}</div>}
        </div>
      )}
      <div style={contentStyle} data-testid="window-wrapper-content">
        {children}
      </div>
    </div>
  );
}
