/**
 * RightFlowAttachment.tsx — Renderer Attachment Component
 *
 * Responsibility:
 * - Renders the RightFlowAttachment surface in the renderer layer.
 * - Encapsulates Attachment strip/tab presentation for attachable relationships.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/atoms/attachment/RightFlowAttachment.tsx — Flow ribbon on the right edge of a window
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { MarketFlow } from '@/types/market';
import { theme } from '../../../logic/theme';

// ─── Props ───────────────────────────────────────────────────────

interface RightFlowAttachmentProps {
  flow: MarketFlow;
  onDetach: () => void;
  onClickFlow?: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────

function kebabToTitle(str: string): string {
  return str
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

const FLOW_COLOR = '#A78BFA';

// ─── Inline keyframe injection ───────────────────────────────────

const ANIM_ID = 'heliox-flow-attach-anim';

function ensureFlowAttachAnimation() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(ANIM_ID)) return;
  const style = document.createElement('style');
  style.id = ANIM_ID;
  style.textContent = `
    @keyframes helioxFlowSlideIn {
      0% { opacity: 0; transform: translateX(-8px); }
      100% { opacity: 1; transform: translateX(0); }
    }
    @keyframes helioxFlowPulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(167,139,250,0); }
      50% { box-shadow: 0 0 12px 2px rgba(167,139,250,0.25); }
    }
    .heliox-flow-ribbon {
      animation: helioxFlowSlideIn 0.3s ease-out forwards;
    }
    .heliox-flow-ribbon[data-running="true"] {
      animation: helioxFlowSlideIn 0.3s ease-out forwards, helioxFlowPulse 2s ease-in-out infinite 0.3s;
    }
  `;
  document.head.appendChild(style);
}

// ─── Component ───────────────────────────────────────────────────

export function RightFlowAttachment({ flow, onDetach, onClickFlow }: RightFlowAttachmentProps) {
  const [hovered, setHovered] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const displayName = kebabToTitle(flow.name);

  React.useEffect(() => { ensureFlowAttachAnimation(); }, []);

  // Close the right-click menu on outside click or Escape
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  // Complexity badge color
  const complexityColors: Record<string, string> = {
    low: theme.success,
    medium: theme.warning,
    high: theme.danger,
  };
  const complexityColor = complexityColors[flow.recommendedComplexity] ?? theme.textMuted;

  const containerStyle: React.CSSProperties = {
    position: 'absolute',
    right: 0,
    top: 12,
    transform: 'translateX(100%)',
    zIndex: 0,
    pointerEvents: 'auto',
  };

  const ribbonStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: '10px 12px',
    background: theme.surfaceCard,
    border: `1px solid ${hovered ? FLOW_COLOR : theme.borderLight}`,
    borderLeft: `3px solid ${FLOW_COLOR}`,
    borderRadius: '0 10px 10px 0',
    transition: 'all 0.2s ease',
    boxShadow: hovered
      ? `4px 0 16px ${FLOW_COLOR}22, 0 0 0 1px ${FLOW_COLOR}33`
      : '4px 0 16px rgba(0,0,0,0.2)',
    minWidth: 44,
    maxWidth: 140,
  };

  const iconAreaStyle: React.CSSProperties = {
    width: 30,
    height: 30,
    borderRadius: '50%',
    background: `${FLOW_COLOR}18`,
    border: `1.5px solid ${FLOW_COLOR}55`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 14,
    color: FLOW_COLOR,
    flexShrink: 0,
    alignSelf: 'center',
  };

  const nameStyle: React.CSSProperties = {
    fontFamily: theme.fontGrotesk,
    fontSize: 11,
    fontWeight: 700,
    color: theme.textSecondary,
    lineHeight: 1.3,
    wordBreak: 'break-word',
    textAlign: 'center',
  };

  const complexityBadgeStyle: React.CSSProperties = {
    fontFamily: theme.fontMono,
    fontSize: 9,
    padding: '2px 6px',
    borderRadius: 10,
    background: `${complexityColor}18`,
    color: complexityColor,
    border: `1px solid ${complexityColor}33`,
    textAlign: 'center',
    lineHeight: 1.2,
  };

  const closeBtnStyle: React.CSSProperties = {
    background: 'none',
    border: `1px solid ${theme.borderLight}`,
    borderRadius: '50%',
    width: 20,
    height: 20,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: hovered ? theme.textSecondary : theme.textGhost,
    cursor: 'pointer',
    fontSize: 11,
    lineHeight: 1,
    transition: 'all 0.15s ease',
    alignSelf: 'center',
    padding: 0,
  };

  return (
    <div
      style={containerStyle}
      data-testid={`right-flow-${flow.name}`}
      role="region"
      aria-label={`Attached flow: ${displayName}`}
    >
      <div
        className="heliox-flow-ribbon"
        style={{ ...ribbonStyle, cursor: onClickFlow ? 'pointer' : 'default' }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={onClickFlow}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY }); }}
        role="button"
        aria-label={`Flow: ${displayName}. Click for details. Right-click to remove.`}
      >
        {/* Flow icon */}
        <div style={iconAreaStyle} aria-hidden="true">⟳</div>

        {/* Flow name */}
        <span style={nameStyle}>{displayName}</span>

        {/* Complexity badge */}
        <span style={complexityBadgeStyle}>
          ⚡ {flow.recommendedComplexity}
        </span>
      </div>

      {/* Right-click context menu — portalled to body to escape the window transform context */}
      {menu && createPortal(
        <div
          data-testid={`flow-context-menu-${flow.name}`}
          role="menu"
          style={{
            position: 'fixed', left: menu.x, top: menu.y, zIndex: 10000,
            minWidth: 160, padding: 4, borderRadius: 8,
            background: theme.surfaceCard, border: `1px solid ${theme.borderMedium}`,
            boxShadow: '0 12px 32px rgba(0,0,0,0.5)', fontFamily: theme.fontInter,
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            data-testid={`flow-remove-${flow.name}`}
            onClick={() => { onDetach(); setMenu(null); }}
            style={{
              width: '100%', textAlign: 'left', padding: '6px 10px', borderRadius: 6,
              border: 'none', background: 'transparent', color: theme.danger,
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 8,
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = theme.surfaceHover; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
          >
            Remove flow
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
