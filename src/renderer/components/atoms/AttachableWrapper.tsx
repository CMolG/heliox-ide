/**
 * AttachableWrapper.tsx — Renderer Atomic Component
 *
 * Responsibility:
 * - Renders the AttachableWrapper surface in the renderer layer.
 * - Encapsulates Small composable building block for renderer feature surfaces.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/atoms/AttachableWrapper.tsx — Visual wrapper for attachable puzzle pieces (Roles, Mods, Flows)
import React, { useState } from 'react';
import { theme } from '../../logic/theme';

// ─── Props ───────────────────────────────────────────────────────

interface AttachableWrapperProps {
  children: React.ReactNode;
  color?: string;
  active?: boolean;
  type: 'role' | 'mod' | 'flow';
  className?: string;
  onClick?: () => void;
  'aria-label'?: string;
}

// ─── Type-specific presets ───────────────────────────────────────

const typePresets: Record<AttachableWrapperProps['type'], {
  padding: string;
  borderRadius: number;
  accentWidth: number;
  minHeight: number;
}> = {
  role: { padding: '10px 14px', borderRadius: 10, accentWidth: 4, minHeight: 64 },
  mod: { padding: '6px 10px', borderRadius: 8, accentWidth: 3, minHeight: 40 },
  flow: { padding: '10px 14px', borderRadius: 10, accentWidth: 0, minHeight: 56 },
};

// ─── Component ───────────────────────────────────────────────────

export function AttachableWrapper({
  children,
  color = theme.textMuted,
  active = false,
  type,
  className,
  onClick,
  'aria-label': ariaLabel,
}: AttachableWrapperProps) {
  const [hovered, setHovered] = useState(false);
  const preset = typePresets[type];
  const accentColor = color.startsWith('#') ? color : `#${color}`;

  const containerStyle: React.CSSProperties = {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: preset.padding,
    minHeight: preset.minHeight,
    borderRadius: preset.borderRadius,
    background: theme.surfaceCard,
    border: `1px solid ${active ? `${accentColor}44` : theme.borderLight}`,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    transform: hovered ? 'scale(1.02)' : 'scale(1)',
    boxShadow: active
      ? `0 0 12px ${accentColor}22, inset 0 0 0 1px ${accentColor}33`
      : 'none',
    overflow: 'hidden',
  };

  // Colored left accent edge (roles and mods only)
  const accentEdgeStyle: React.CSSProperties = preset.accentWidth > 0
    ? {
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: preset.accentWidth,
        background: accentColor,
        borderRadius: `${preset.borderRadius}px 0 0 ${preset.borderRadius}px`,
        opacity: active ? 1 : 0.5,
        transition: 'opacity 0.2s ease',
      }
    : {};

  return (
    <div
      style={containerStyle}
      className={className}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      data-testid={`attachable-wrapper-${type}`}
      role="button"
      tabIndex={0}
      aria-pressed={active}
      aria-label={ariaLabel ?? `${type} attachable`}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); } }}
    >
      {preset.accentWidth > 0 && <div style={accentEdgeStyle} aria-hidden="true" />}
      {children}
    </div>
  );
}
