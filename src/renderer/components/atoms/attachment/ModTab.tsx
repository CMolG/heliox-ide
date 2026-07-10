/**
 * ModTab.tsx — Renderer Attachment Component
 *
 * Responsibility:
 * - Renders the ModTab surface in the renderer layer.
 * - Encapsulates Attachment strip/tab presentation for attachable relationships.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
import React, { useState } from 'react';
import type { MarketMod } from '@/types/market';
import { theme } from '@/renderer/logic/theme';

function kebabToTitle(str: string): string {
  return str
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function ModTab({ mod, index, onDetach, onClick, accentColor, parentActive }: { mod: MarketMod; index: number; onDetach: () => void; onClick?: () => void; accentColor: string; parentActive: boolean }) {
  const [hovered, setHovered] = useState(false);
  const initial = mod.name.charAt(0).toUpperCase();
  const displayName = kebabToTitle(mod.name);
  const isActive = hovered || parentActive;

  const tabStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '5px 10px 7px',
    background: theme.surfaceCard,
    border: `1px solid ${isActive ? accentColor : theme.borderLight}`,
    borderTop: `2px solid ${accentColor}`,
    borderRadius: '0 0 8px 8px',
    cursor: 'default',
    transition: 'all 0.2s ease',
    animationDelay: `${index * 60}ms`,
    opacity: 0,
    boxShadow: isActive
      ? `0 4px 12px ${accentColor}22, 0 0 0 1px ${accentColor}33`
      : '0 4px 12px rgba(0,0,0,0.25)',
    pointerEvents: 'auto' as const,
  };

  const badgeStyle: React.CSSProperties = {
    width: 20,
    height: 20,
    borderRadius: 4,
    background: `${accentColor}18`,
    border: `1.5px solid ${accentColor}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 10,
    fontWeight: 700,
    fontFamily: theme.fontGrotesk,
    color: accentColor,
    flexShrink: 0,
  };

  const nameStyle: React.CSSProperties = {
    fontFamily: theme.fontGrotesk,
    fontSize: 11,
    fontWeight: 600,
    color: theme.textSecondary,
    whiteSpace: 'nowrap',
    maxWidth: 80,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };

  const closeBtnStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    color: hovered ? theme.textSecondary : theme.textGhost,
    padding: 0,
    lineHeight: 1,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    fontSize: 12,
    transition: 'color 0.15s ease',
  };

  return (
    <div
      className="fluxor-mod-tab"
      style={{ ...tabStyle, cursor: onClick ? 'pointer' : 'default' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
      data-testid={`bottom-mod-${mod.name}`}
      title={`${displayName} — Click for details`}
      role="button"
      aria-label={`Mod: ${displayName}. Click for details.`}
    >
      <div style={badgeStyle} aria-hidden="true">{initial}</div>
      <span style={nameStyle}>{displayName}</span>
    </div>
  );
}
