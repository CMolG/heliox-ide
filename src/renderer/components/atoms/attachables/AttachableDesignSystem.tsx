/**
 * AttachableDesignSystem.tsx — Renderer Attachable Component
 *
 * Responsibility:
 * - Renders the AttachableDesignSystem surface in the renderer layer.
 * - Encapsulates Attachable panel implementation docked to desktop windows.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import type { MarketDesignSystem } from '@/types/market';
import { theme } from '../../../logic/theme';
import { AttachableWrapper } from '../AttachableWrapper';
import { DesignSystemMicroPreview } from './DesignSystemMicroPreview';
import { BrandIdentityCard } from './BrandIdentityCard';

// ─── Props ───────────────────────────────────────────────────────

interface AttachableDesignSystemProps {
  designSystem: MarketDesignSystem;
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

// ─── Component ───────────────────────────────────────────────────

export function AttachableDesignSystem({ designSystem, active = false, onClick }: AttachableDesignSystemProps) {
  const [showPreview, setShowPreview] = useState(false);
  const accentColor = designSystem.accentColor ?? '#10B981';
  const displayName = kebabToTitle(designSystem.name);
  const initial = designSystem.name.charAt(0).toUpperCase();

  const iconBadgeStyle: React.CSSProperties = {
    width: 36,
    height: 36,
    borderRadius: 8,
    background: `${accentColor}22`,
    border: `2px solid ${accentColor}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 16,
    fontWeight: 700,
    fontFamily: theme.fontGrotesk,
    color: accentColor,
    flexShrink: 0,
    transition: 'all 0.2s ease',
    boxShadow: active ? `0 0 14px ${accentColor}44` : 'none',
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
    color: active ? accentColor : theme.textPrimary,
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

  // Color swatch row — preview of the palette tokens
  const swatches = (designSystem.colorTokens ?? []).slice(0, 6);

  return (
    <AttachableWrapper type="design-system" color={accentColor} active={active}>
      <div
        onClick={onClick}
        style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', cursor: 'pointer' }}
        data-testid={`attachable-design-system-${designSystem.name}`}
        role="button"
        tabIndex={0}
        aria-label={`${active ? 'Active design system' : 'Design System'}: ${displayName}`}
        aria-pressed={active}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick?.(); }}
      >
        <div style={iconBadgeStyle} aria-hidden="true">{initial}</div>
        <div style={infoStyle}>
          <span style={nameStyle}>{displayName}</span>
          <span style={descStyle}>{designSystem.description}</span>
          {swatches.length > 0 && (
            <div style={{ display: 'flex', gap: 3, marginTop: 3 }}>
              {swatches.map((color, i) => (
                <div
                  key={i}
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 3,
                    background: color,
                    border: `1px solid ${theme.borderLight}`,
                  }}
                  title={color}
                />
              ))}
            </div>
          )}
          {/* Micro-preview toggle */}
          {(designSystem.brandIdentityCard || designSystem.preview) && (
            <button
              data-testid={`micro-preview-toggle-${designSystem.name}`}
              onClick={(e) => { e.stopPropagation(); setShowPreview(true); }}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontFamily: theme.fontMono, fontSize: 9, color: theme.textMuted,
                padding: '2px 0', marginTop: 2, textAlign: 'left',
              }}
            >
              ▸ Show preview
            </button>
          )}
        </div>
      </div>
      {/* Preview modal via portal */}
      {showPreview && (designSystem.brandIdentityCard || designSystem.preview) && createPortal(
        <div
          data-testid={`ds-preview-modal-backdrop-${designSystem.name}`}
          onClick={() => setShowPreview(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            data-testid={`ds-preview-modal-${designSystem.name}`}
            onClick={(e) => e.stopPropagation()}
            style={{
              background: theme.surface,
              borderRadius: 12,
              padding: 24,
              boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
              maxWidth: 520,
              width: '90vw',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{
                fontFamily: theme.fontGrotesk,
                fontSize: 14, fontWeight: 600, color: theme.textPrimary,
              }}>
                {displayName}
              </span>
              <button
                data-testid={`ds-preview-modal-close-${designSystem.name}`}
                onClick={() => setShowPreview(false)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: theme.textMuted, fontSize: 16, padding: '2px 6px',
                  borderRadius: 4,
                }}
                aria-label="Close preview"
              >
                ✕
              </button>
            </div>
            {designSystem.brandIdentityCard ? (
              <BrandIdentityCard data={designSystem.brandIdentityCard} size="md" />
            ) : (
              <DesignSystemMicroPreview preview={designSystem.preview} accentColor={accentColor} size="md" />
            )}
          </div>
        </div>,
        document.body,
      )}
    </AttachableWrapper>
  );
}
