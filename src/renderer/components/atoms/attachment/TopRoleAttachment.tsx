/**
 * TopRoleAttachment.tsx — Renderer Attachment Component
 *
 * Responsibility:
 * - Renders the TopRoleAttachment surface in the renderer layer.
 * - Encapsulates Attachment strip/tab presentation for attachable relationships.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/atoms/attachment/TopRoleAttachment.tsx — Active role arc visualization
import React, { useState, useMemo, useEffect } from 'react';
import { MarketRole } from '@/types/market';
import { theme } from '../../../logic/theme';

// ─── Extended type (inventory.json includes color) ───────────────

interface MarketRoleWithColor extends MarketRole {
  color?: string;
}

// ─── Props ───────────────────────────────────────────────────────

interface TopRoleAttachmentProps {
  roles: MarketRoleWithColor[];
  activeRoleName: string | null;
  onSelectRole: (roleName: string) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────

function kebabToTitle(str: string): string {
  return str
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function resolveColor(role: MarketRoleWithColor): string {
  if (role.color) return role.color.startsWith('#') ? role.color : `#${role.color}`;
  return theme.textMuted;
}

// ─── Inline keyframe injection ───────────────────────────────────

const ANIM_ID = 'heliox-role-pop';

function ensurePopAnimation() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(ANIM_ID)) return;
  const style = document.createElement('style');
  style.id = ANIM_ID;
  style.textContent = `
    @keyframes helioxPopLetter {
      0% { opacity: 0; }
      40% { opacity: 1; }
      100% { opacity: 1; }
    }
    .heliox-pop-letter {
      opacity: 0;
      animation: helioxPopLetter 0.4s ease-out forwards;
    }
  `;
  document.head.appendChild(style);
}

// ─── Component ───────────────────────────────────────────────────

export function TopRoleAttachment({
  roles,
  activeRoleName,
  onSelectRole,
}: TopRoleAttachmentProps) {
  const [animKey, setAnimKey] = useState(0);

  useEffect(() => { ensurePopAnimation(); }, []);

  const activeRole = useMemo(
    () => roles.find((r) => r.name === activeRoleName) ?? null,
    [roles, activeRoleName],
  );

  const activeColor = activeRole ? resolveColor(activeRole) : theme.textDim;
  const activeTitle = activeRole ? kebabToTitle(activeRole.name) : '';

  const handleSelect = (roleName: string) => {
    onSelectRole(roleName);
    setAnimKey((prev) => prev + 1);
  };

  // "Phone cover" wrap — asymmetric border: thick top, medium sides, thin bottom
  const borderTop = 12;   // 4× base
  const borderSide = 6;   // 2× base
  const borderBottom = 3; // 1× base (thin but present — completes the frame)

  const coverStyle: React.CSSProperties = {
    position: 'absolute',
    top: -borderTop,
    left: -borderSide,
    right: -borderSide,
    bottom: -borderBottom,
    borderRadius: 16,
    borderStyle: 'solid',
    borderColor: activeColor,
    borderTopWidth: borderTop,
    borderLeftWidth: borderSide,
    borderRightWidth: borderSide,
    borderBottomWidth: borderBottom,
    pointerEvents: 'none',
    transition: 'border-color 0.5s ease, box-shadow 0.5s ease',
    boxShadow: `0 0 22px ${activeColor}28, inset 0 0 14px ${activeColor}0a`,
    zIndex: -1,
  };

  // Subtle inner glow at the bottom to blend the thin border
  const fadeOverlayStyle: React.CSSProperties = {
    position: 'absolute',
    left: -borderSide,
    right: -borderSide,
    bottom: -borderBottom,
    height: '30%',
    background: `linear-gradient(to top, ${activeColor}0c, transparent)`,
    pointerEvents: 'none',
    borderRadius: '0 0 16px 16px',
  };

  // Role name label centered on the top edge (offset for thick top border)
  const labelStyle: React.CSSProperties = {
    position: 'absolute',
    top: -(borderTop + 10),
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: 0,
    pointerEvents: 'none',
    zIndex: 2,
    whiteSpace: 'nowrap',
  };

  const letterStyle: React.CSSProperties = {
    fontFamily: theme.fontGrotesk,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    color: activeColor,
    transition: 'color 0.5s ease',
    textShadow: `0 0 8px ${activeColor}44`,
  };

  const chipRowStyle: React.CSSProperties = {
    position: 'absolute',
    top: -(borderTop + 10),
    right: 12,
    display: 'flex',
    gap: 4,
    alignItems: 'center',
    pointerEvents: 'auto',
    zIndex: 2,
  };

  return (
    <div data-testid="top-role-attachment" role="region" aria-label="Active role selector" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {/* Phone-cover border wrap */}
      <div style={coverStyle} />
      <div style={fadeOverlayStyle} />

      {/* Animated role name at top center */}
      {activeRole && (
        <div style={labelStyle}>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              background: '#141414',
              padding: '2px 10px',
              borderRadius: 8,
              border: `1px solid ${activeColor}33`,
            }}
          >
            {activeTitle.split('').map((char, index) => (
              <span
                key={`${activeRole.name}-${animKey}-${index}`}
                className="heliox-pop-letter"
                style={{ ...letterStyle, animationDelay: `${index * 40}ms` }}
              >
                {char === ' ' ? '\u00A0' : char}
              </span>
            ))}
          </span>
        </div>
      )}

      {/* Role selector dots — top-right */}
      <div style={chipRowStyle} role="radiogroup" aria-label="Available roles">
        {roles.map((role) => {
          const color = resolveColor(role);
          const isActive = role.name === activeRoleName;

          const chipStyle: React.CSSProperties = {
            width: isActive ? 10 : 7,
            height: isActive ? 10 : 7,
            borderRadius: '50%',
            background: isActive ? color : `${color}44`,
            border: `1.5px solid ${color}`,
            cursor: 'pointer',
            transition: 'all 0.25s ease',
            boxShadow: isActive ? `0 0 8px ${color}55` : 'none',
          };

          return (
            <button
              key={role.name}
              style={chipStyle}
              onClick={() => handleSelect(role.name)}
              aria-label={kebabToTitle(role.name)}
              aria-checked={isActive}
              role="radio"
              title={kebabToTitle(role.name)}
            />
          );
        })}
      </div>
    </div>
  );
}
