/**
 * AttachableRole.tsx — Renderer Attachable Component
 *
 * Responsibility:
 * - Renders the AttachableRole surface in the renderer layer.
 * - Encapsulates Attachable panel implementation docked to desktop windows.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/atoms/attachables/AttachableRole.tsx — "Core Socket" UI for a Role
import React from 'react';
import { MarketRole } from '@/types/market';
import { theme } from '../../../logic/theme';
import { AttachableWrapper } from '../AttachableWrapper';

// ─── Props ───────────────────────────────────────────────────────

interface AttachableRoleProps {
  role: MarketRole;
  active?: boolean;
  onClick?: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────

function kebabToTitle(str: string): string {
  return str
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function getRoleColor(role: MarketRole): string {
  const color = (role as unknown as Record<string, unknown>).color;
  if (typeof color === 'string' && color.length > 0) return color.startsWith('#') ? color : `#${color}`;
  return theme.textMuted;
}

// ─── Component ───────────────────────────────────────────────────

export function AttachableRole({ role, active = false, onClick }: AttachableRoleProps) {
  const roleColor = getRoleColor(role);
  const displayName = kebabToTitle(role.name);
  const initial = role.name.charAt(0).toUpperCase();

  const iconBadgeStyle: React.CSSProperties = {
    width: 36,
    height: 36,
    borderRadius: '50%',
    background: `${roleColor}22`,
    border: `2px solid ${roleColor}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 16,
    fontWeight: 700,
    fontFamily: theme.fontGrotesk,
    color: roleColor,
    flexShrink: 0,
    transition: 'all 0.2s ease',
    boxShadow: active ? `0 0 14px ${roleColor}44` : 'none',
  };

  const infoStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
    flex: 1,
  };

  const nameStyle: React.CSSProperties = {
    fontFamily: theme.fontGrotesk,
    fontSize: 14,
    fontWeight: 600,
    color: active ? roleColor : theme.textPrimary,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    transition: 'color 0.2s ease',
  };

  const descStyle: React.CSSProperties = {
    fontFamily: theme.fontInter,
    fontSize: 11,
    color: theme.textDim,
    lineHeight: 1.4,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
  };

  return (
    <AttachableWrapper type="role" color={roleColor} active={active}>
      <div
        onClick={onClick}
        style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', cursor: 'pointer' }}
        data-testid={`attachable-role-${role.name}`}
        role="button"
        tabIndex={0}
        aria-label={`${active ? 'Active role' : 'Role'}: ${displayName}`}
        aria-pressed={active}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick?.(); }}
      >
        <div style={iconBadgeStyle} aria-hidden="true">{initial}</div>
        <div style={infoStyle}>
          <span style={nameStyle}>{displayName}</span>
          <span style={descStyle}>{role.description}</span>
        </div>
      </div>
    </AttachableWrapper>
  );
}
