/**
 * WidgetWrapper.tsx — Renderer Atomic Component
 *
 * Responsibility:
 * - Renders the WidgetWrapper surface in the renderer layer.
 * - Encapsulates Small composable building block for renderer feature surfaces.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/atoms/WidgetWrapper.tsx — Lightweight glanceable wrapper for IDE Widgets
import React, { useRef, useEffect, useState } from 'react';
import { theme } from '../../logic/theme';

// ─── Props ───────────────────────────────────────────────────────

interface WidgetWrapperProps {
  children: React.ReactNode;
  title?: string;
  iconName?: string;
  className?: string;
}

// ─── Component ───────────────────────────────────────────────────

export function WidgetWrapper({ children, title, iconName, className }: WidgetWrapperProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setCompact(entry.contentRect.width < 200);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    height: '100%',
    borderRadius: 8,
    border: `1px solid ${theme.border}`,
    background: `rgba(17,17,17,0.85)`,
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    overflow: 'hidden',
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: compact ? '4px 6px' : '5px 8px',
    borderBottom: `1px solid ${theme.borderSubtle}`,
    minHeight: 28,
    flexShrink: 0,
  };

  const iconStyle: React.CSSProperties = {
    width: 16,
    height: 16,
    borderRadius: 4,
    background: theme.surfaceHover,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 9,
    color: theme.textMuted,
    fontFamily: theme.fontMono,
    flexShrink: 0,
  };

  const titleStyle: React.CSSProperties = {
    fontFamily: theme.fontGrotesk,
    fontSize: 11,
    fontWeight: 600,
    color: theme.textSecondary,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };

  const contentStyle: React.CSSProperties = {
    flex: 1,
    overflow: 'auto',
    padding: compact ? 6 : 8,
  };

  const showHeader = title || iconName;

  return (
    <div ref={containerRef} style={containerStyle} className={className} data-testid="widget-wrapper" role="region" aria-label={title ?? 'Widget'}>
      {showHeader && (
        <div style={headerStyle} data-testid="widget-wrapper-header">
          {iconName && (
            <div style={iconStyle} aria-hidden="true">
              {iconName.charAt(0).toUpperCase()}
            </div>
          )}
          {!compact && title && (
            <h3 style={titleStyle} title={title} role="heading" aria-level={3}>
              {title}
            </h3>
          )}
        </div>
      )}
      <div style={contentStyle} data-testid="widget-wrapper-content">
        {children}
      </div>
    </div>
  );
}
