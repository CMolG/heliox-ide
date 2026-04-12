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

  // ── Styles ──

  const wrapperStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    maxWidth: 320,
    margin: '0 auto',
  };

  const svgContainerStyle: React.CSSProperties = {
    position: 'relative',
    width: '100%',
    filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.3))',
  };

  const chipRowStyle: React.CSSProperties = {
    display: 'flex',
    gap: 8,
    justifyContent: 'center',
    flexWrap: 'wrap',
  };

  return (
    <div style={wrapperStyle} data-testid="top-role-attachment" role="region" aria-label="Active role selector">
      {/* SVG Arc Visualization */}
      <div style={svgContainerStyle}>
        <svg viewBox="0 0 400 260" style={{ width: '100%', height: 'auto', overflow: 'visible' }} role="img" aria-label={activeRole ? `Active role: ${activeTitle}` : 'No active role'}>
          <defs>
            {/* Text path — slightly larger radius than the semicircle */}
            <path
              id="heliox-role-text-arc"
              d="M 55 230 A 145 145 0 0 1 345 230"
              fill="none"
            />
          </defs>

          {/* Solid semicircle */}
          <path
            d="M 70 230 A 130 130 0 0 1 330 230 Z"
            fill={activeColor}
            style={{ transition: 'fill 0.5s ease' }}
          />

          {/* Curved text */}
          {activeRole && (
            <text
              aria-hidden="true"
              style={{
                fill: activeColor,
                fontFamily: theme.fontGrotesk,
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: '0.15em',
                textTransform: 'uppercase' as const,
                transition: 'fill 0.5s ease',
              }}
            >
              <textPath href="#heliox-role-text-arc" startOffset="50%" textAnchor="middle">
                {activeTitle.split('').map((char, index) => (
                  <tspan
                    key={`${activeRole.name}-${animKey}-${index}`}
                    className="heliox-pop-letter"
                    style={{ animationDelay: `${index * 40}ms` }}
                  >
                    {char === ' ' ? '\u00A0' : char}
                  </tspan>
                ))}
              </textPath>
            </text>
          )}
        </svg>
      </div>

      {/* Role selector chips */}
      <div style={chipRowStyle} role="radiogroup" aria-label="Available roles">
        {roles.map((role) => {
          const color = resolveColor(role);
          const isActive = role.name === activeRoleName;

          const chipStyle: React.CSSProperties = {
            width: isActive ? 14 : 10,
            height: isActive ? 14 : 10,
            borderRadius: '50%',
            background: isActive ? color : `${color}44`,
            border: `2px solid ${color}`,
            cursor: 'pointer',
            transition: 'all 0.25s ease',
            boxShadow: isActive ? `0 0 10px ${color}66` : 'none',
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
