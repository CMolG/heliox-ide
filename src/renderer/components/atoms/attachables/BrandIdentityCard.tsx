/**
 * BrandIdentityCard.tsx — Canonical Design-System Preview Renderer
 *
 * Responsibility:
 * - Renders a full brand-identity composition for a design system.
 * - Single renderer used in both marketplace (sm) and attachable modal (md).
 * - Pure presentational: all data comes from props.
 *
 * Boundaries:
 * - Owns: brand-identity layout, inline-styled preview elements
 * - Does NOT own: design system data fetching, inventory lookups
 */
import React from 'react';
import type { MarketBrandIdentityCard as BrandIdentityCardData } from '@/types/market';

// ─── Props ───────────────────────────────────────────────────────

interface BrandIdentityCardProps {
  data: BrandIdentityCardData;
  size?: 'sm' | 'md';
}

// ─── Component ───────────────────────────────────────────────────

export function BrandIdentityCard({ data, size = 'md' }: BrandIdentityCardProps) {
  const { brand, theme: t } = data;
  const isSm = size === 'sm';
  const scale = isSm ? 0.72 : 1;

  const card: React.CSSProperties = {
    background: t.surface,
    border: t.border,
    borderRadius: t.radius,
    padding: t.spacing,
    fontFamily: t.fontBody,
    color: t.text,
    display: 'flex',
    flexDirection: 'column',
    gap: `${16 * scale}px`,
    width: '100%',
    boxSizing: 'border-box',
    transform: isSm ? `scale(${scale})` : undefined,
    transformOrigin: isSm ? 'top left' : undefined,
  };

  const logoSize = Math.round(56 * scale);

  const logo: React.CSSProperties = {
    width: logoSize,
    height: logoSize,
    background: t.primary,
    borderRadius: t.radius === '0px' ? '0px' : `calc(${t.radius} * 0.6)`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: t.fontDisplay,
    fontWeight: 900,
    fontSize: `${Math.round(18 * scale)}px`,
    color: t.textOnPrimary,
    letterSpacing: t.letterSpacing,
    flexShrink: 0,
  };

  const nameStyle: React.CSSProperties = {
    fontFamily: t.fontDisplay,
    fontSize: `${Math.round(28 * scale)}px`,
    fontWeight: 900,
    color: t.text,
    letterSpacing: t.letterSpacing,
    margin: 0,
    lineHeight: 1,
  };

  const taglineStyle: React.CSSProperties = {
    fontFamily: t.fontBody,
    fontSize: `${Math.round(13 * scale)}px`,
    color: t.textMuted,
    margin: 0,
    letterSpacing: '0.02em',
    lineHeight: 1.5,
  };

  const divider: React.CSSProperties = {
    borderTop: `1px solid ${t.accent}`,
    opacity: 0.3,
    margin: `${Math.round(4 * scale)}px 0`,
  };

  const descStyle: React.CSSProperties = {
    fontSize: `${Math.round(13 * scale)}px`,
    color: t.textMuted,
    lineHeight: 1.6,
    margin: 0,
    fontFamily: t.fontBody,
  };

  const swatchColors = [t.primary, t.secondary, t.accent, t.surface];
  const swatchLabels = ['Primary', 'Secondary', 'Accent', 'Surface'];
  const swatchSize = Math.round(32 * scale);

  const badgeStyle: React.CSSProperties = {
    display: 'inline-block',
    background: t.badgeBg,
    color: t.badgeColor,
    border: t.badgeBg === 'transparent' ? `1px solid ${t.accent}` : 'none',
    borderRadius: t.radius === '0px' ? '0px' : `calc(${t.radius} * 0.5)`,
    padding: `${Math.round(4 * scale)}px ${Math.round(12 * scale)}px`,
    fontSize: `${Math.round(10 * scale)}px`,
    fontFamily: t.fontMono,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    fontWeight: 600,
    alignSelf: 'flex-start',
  };

  const typeRow: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: `${Math.round(4 * scale)}px`,
    padding: `${Math.round(10 * scale)}px ${Math.round(12 * scale)}px`,
    background: t.secondary,
    borderRadius: t.radius,
    border: t.border,
  };

  // Size-scaled CTA style
  const ctaStyle: React.CSSProperties = {
    ...t.ctaStyle,
    fontSize: `${Math.round(parseInt(t.ctaStyle.fontSize) * scale)}px`,
    padding: isSm
      ? `${Math.round(8 * scale)}px ${Math.round(20 * scale)}px`
      : t.ctaStyle.padding,
  };

  return (
    <div style={card} data-testid="brand-identity-card">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: `${Math.round(14 * scale)}px` }}>
        <div style={logo}>{brand.initials}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: `${Math.round(4 * scale)}px` }}>
          <h2 style={nameStyle}>{brand.name}</h2>
          <p style={taglineStyle}>{brand.tagline}</p>
        </div>
      </div>

      <div style={divider} />

      {/* Description */}
      <p style={descStyle}>{brand.description}</p>

      {/* Palette */}
      <div>
        <p style={{
          fontSize: `${Math.round(10 * scale)}px`,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: t.textMuted,
          margin: `0 0 ${Math.round(8 * scale)}px`,
          fontFamily: t.fontMono,
        }}>
          Color palette
        </p>
        <div style={{ display: 'flex', gap: `${Math.round(8 * scale)}px`, alignItems: 'center' }}>
          {swatchColors.map((color, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: `${Math.round(4 * scale)}px`, alignItems: 'center' }}>
              <div style={{
                width: swatchSize,
                height: swatchSize,
                background: color,
                borderRadius: t.radius,
                border: color === t.surface ? t.border : 'none',
                flexShrink: 0,
              }} />
              <span style={{
                fontSize: `${Math.round(9 * scale)}px`,
                color: t.textMuted,
                fontFamily: t.fontMono,
                letterSpacing: '0.06em',
              }}>
                {swatchLabels[i]}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Typography specimen */}
      <div style={typeRow}>
        <span style={{
          fontFamily: t.fontDisplay,
          fontSize: `${Math.round(17 * scale)}px`,
          fontWeight: 900,
          color: t.text,
          letterSpacing: t.letterSpacing,
          lineHeight: 1,
        }}>
          {t.fontDisplay.split(',')[0].replace(/'/g, '')}
        </span>
        <span style={{
          fontFamily: t.fontBody,
          fontSize: `${Math.round(12 * scale)}px`,
          color: t.textMuted,
          lineHeight: 1.5,
        }}>
          The quick brown fox jumps over the lazy dog.
        </span>
        <span style={{
          fontFamily: t.fontMono,
          fontSize: `${Math.round(11 * scale)}px`,
          color: t.accent,
        }}>
          0123456789 — mono
        </span>
      </div>

      {/* Badge + CTA */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: `${Math.round(12 * scale)}px` }}>
        <span style={badgeStyle}>{brand.badge}</span>
        <button style={ctaStyle}>{brand.ctaLabel}</button>
      </div>

      {/* Theme label */}
      <div style={{
        marginTop: 'auto',
        paddingTop: `${Math.round(8 * scale)}px`,
        borderTop: t.border,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span style={{
          fontFamily: t.fontMono,
          fontSize: `${Math.round(10 * scale)}px`,
          color: t.textMuted,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}>
          {t.name}
        </span>
        <span style={{
          fontFamily: t.fontMono,
          fontSize: `${Math.round(10 * scale)}px`,
          color: t.accent,
          letterSpacing: '0.06em',
        }}>
          Design System
        </span>
      </div>
    </div>
  );
}
