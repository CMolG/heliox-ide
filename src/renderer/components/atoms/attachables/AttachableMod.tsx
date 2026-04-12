/**
 * AttachableMod.tsx — Renderer Attachable Component
 *
 * Responsibility:
 * - Renders the AttachableMod surface in the renderer layer.
 * - Encapsulates Attachable panel implementation docked to desktop windows.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/atoms/attachables/AttachableMod.tsx — "Snap-On Jigsaw Piece" UI for a Mod
import React from 'react';
import { MarketMod } from '@/types/market';
import { theme } from '../../../logic/theme';
import { AttachableWrapper } from '../AttachableWrapper';

// ─── Props ───────────────────────────────────────────────────────

interface AttachableModProps {
  mod: MarketMod;
  active?: boolean;
  disabled?: boolean;
  incompatible?: boolean;
  onClick?: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────

function kebabToTitle(str: string): string {
  return str
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ─── Component ───────────────────────────────────────────────────

export function AttachableMod({
  mod,
  active = false,
  disabled = false,
  incompatible = false,
  onClick,
}: AttachableModProps) {
  const displayName = kebabToTitle(mod.name);
  const initial = mod.name.charAt(0).toUpperCase();

  // Determine accent color based on state
  const accentColor = incompatible ? theme.danger : active ? theme.success : theme.textMuted;

  const containerOverrides: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.4 : incompatible ? 0.6 : 1,
    transition: 'opacity 0.2s ease',
  };

  const iconBadgeStyle: React.CSSProperties = {
    width: 26,
    height: 26,
    borderRadius: 6,
    background: incompatible ? `${theme.danger}18` : `${accentColor}18`,
    border: `1.5px solid ${incompatible ? theme.danger : accentColor}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 700,
    fontFamily: theme.fontGrotesk,
    color: incompatible ? theme.danger : accentColor,
    flexShrink: 0,
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
    fontSize: 12,
    fontWeight: 600,
    color: incompatible ? theme.danger : active ? theme.success : theme.textPrimary,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };

  const tagsStyle: React.CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
  };

  const tagStyle: React.CSSProperties = {
    fontFamily: theme.fontMono,
    fontSize: 9,
    color: theme.textFaint,
    background: theme.surfaceHover,
    padding: '1px 5px',
    borderRadius: 4,
    lineHeight: 1.5,
  };

  // "No socket" indicator when disabled (attached to a Flow)
  const disabledIndicator: React.CSSProperties = {
    width: 14,
    height: 14,
    borderRadius: '50%',
    border: `1.5px solid ${theme.textFaint}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 9,
    color: theme.textFaint,
    flexShrink: 0,
  };

  return (
    <AttachableWrapper
      type="mod"
      color={accentColor}
      active={active && !incompatible}
    >
      <div
        onClick={disabled ? undefined : onClick}
        style={containerOverrides}
        data-testid={`attachable-mod-${mod.name}`}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={`${incompatible ? 'Incompatible mod' : active ? 'Active mod' : disabled ? 'Disabled mod' : 'Mod'}: ${displayName}`}
        aria-disabled={disabled}
        aria-pressed={active && !incompatible}
        onKeyDown={(e) => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) onClick?.(); }}
      >
        <div style={iconBadgeStyle} aria-hidden="true">{initial}</div>
        <div style={infoStyle}>
          <span style={nameStyle}>{displayName}</span>
          <div style={tagsStyle}>
            {mod.tags.slice(0, 4).map((tag) => (
              <span key={tag} style={tagStyle}>{tag}</span>
            ))}
          </div>
        </div>
        {disabled && (
          <div style={disabledIndicator} aria-hidden="true" title="No socket available">
            ⊘
          </div>
        )}
      </div>
    </AttachableWrapper>
  );
}
