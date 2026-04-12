/**
 * DesignSystemMicroPreview.tsx — Renderer Atom Component
 *
 * Responsibility:
 * - Renders a compact visual sample of a design system using its preview tokens.
 * - Shows typography samples (heading, body, mono), component specimens
 *   (primary button, ghost button, input, chip, card surface), and color strip.
 * - Pure presentational: all data comes from props.
 *
 * Boundaries:
 * - Owns: micro-preview layout, inline-styled sample elements
 * - Does NOT own: design system data fetching, inventory lookups
 */
import React from 'react';
import type { MarketDesignSystemPreview } from '../../../../types/market';
import type { ResolvedPreviewTheme } from '../../../logic/design-system-preview';

interface DesignSystemMicroPreviewProps {
  preview?: MarketDesignSystemPreview;   // backward compat
  theme?: ResolvedPreviewTheme;          // new resolved theme
  accentColor?: string;
  size?: 'sm' | 'md';
}

/** Derive a ResolvedPreviewTheme-like shape from the legacy preview prop,
 *  forcing a light palette for consistent rendering. */
function deriveFromPreview(
  preview: MarketDesignSystemPreview,
  accentOverride?: string,
): ResolvedPreviewTheme {
  const accent = accentOverride ?? preview.tokens.accent;
  const text = '#18181B';
  return {
    typography: preview.typography,
    palette: {
      bg: '#FFFFFF',
      surface: '#F4F4F5',
      text,
      accent,
      muted: `${text}8C`,   // ~55% alpha
      border: `${text}26`,   // ~15% alpha
    },
    shape: {
      radius: preview.tokens.radius,
      gap: preview.tokens.gap,
    },
    components: preview.components,
  };
}

export function DesignSystemMicroPreview({
  preview,
  theme: resolvedTheme,
  accentColor,
  size = 'md',
}: DesignSystemMicroPreviewProps) {
  // Resolve theme: prefer explicit theme, fall back to legacy preview
  const t = resolvedTheme ?? (preview ? deriveFromPreview(preview, accentColor) : null);
  if (!t) return null;

  const accent = accentColor ?? t.palette.accent;
  const scale = size === 'sm' ? 0.8 : 1;
  const r = t.shape.radius;
  const g = t.shape.gap;

  return (
    <div
      data-testid="design-system-micro-preview"
      style={{
        background: t.palette.bg,
        borderRadius: r * 1.5,
        padding: g * 1.5 * scale,
        display: 'flex',
        flexDirection: 'column',
        gap: g * scale,
        overflow: 'hidden',
        border: `1px solid ${t.palette.surface}`,
        transform: `scale(${scale})`,
        transformOrigin: 'top left',
        width: size === 'sm' ? 200 : 260,
      }}
    >
      {/* Typography specimen */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{
          fontFamily: t.typography.heading,
          fontSize: 13 * scale,
          fontWeight: 700,
          color: t.palette.text,
          lineHeight: 1.2,
        }}>
          {t.components.cardTitle}
        </span>
        <span style={{
          fontFamily: t.typography.body,
          fontSize: 10 * scale,
          color: t.palette.muted,
          lineHeight: 1.3,
        }}>
          {t.components.cardMeta}
        </span>
        <span style={{
          fontFamily: t.typography.mono,
          fontSize: 9 * scale,
          color: t.palette.muted,
          lineHeight: 1.3,
          letterSpacing: '-0.01em',
        }}>
          {'const theme = {};'}
        </span>
      </div>

      {/* Component specimens row */}
      <div style={{ display: 'flex', gap: g * 0.5 * scale, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Primary button */}
        <div style={{
          background: accent,
          color: '#fff',
          fontFamily: t.typography.body,
          fontSize: 9 * scale,
          fontWeight: 600,
          padding: `${2 * scale}px ${8 * scale}px`,
          borderRadius: r,
          whiteSpace: 'nowrap',
        }}>
          {t.components.buttonLabel}
        </div>

        {/* Ghost / secondary button */}
        <div style={{
          background: 'transparent',
          color: accent,
          fontFamily: t.typography.body,
          fontSize: 9 * scale,
          fontWeight: 600,
          padding: `${2 * scale}px ${8 * scale}px`,
          borderRadius: r,
          whiteSpace: 'nowrap',
          border: `1px solid ${accent}66`,
        }}>
          Cancel
        </div>

        {/* Mini chip */}
        <div style={{
          background: `${accent}22`,
          color: accent,
          fontFamily: t.typography.mono,
          fontSize: 8 * scale,
          padding: `${1 * scale}px ${6 * scale}px`,
          borderRadius: r * 0.75,
          whiteSpace: 'nowrap',
          border: `1px solid ${accent}44`,
        }}>
          {t.components.chipLabel}
        </div>
      </div>

      {/* Mini input */}
      <div style={{
        background: t.palette.surface,
        border: `1px solid ${t.palette.border}`,
        borderRadius: r,
        padding: `${3 * scale}px ${6 * scale}px`,
        fontFamily: t.typography.mono,
        fontSize: 9 * scale,
        color: t.palette.muted,
      }}>
        {t.components.inputPlaceholder}
      </div>

      {/* Card / surface block */}
      <div style={{
        background: t.palette.surface,
        borderRadius: r,
        padding: `${g * 0.75 * scale}px ${g * scale}px`,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}>
        <span style={{
          fontFamily: t.typography.heading,
          fontSize: 9 * scale,
          fontWeight: 600,
          color: t.palette.text,
          lineHeight: 1.2,
        }}>
          {t.components.cardTitle}
        </span>
        <span style={{
          fontFamily: t.typography.body,
          fontSize: 8 * scale,
          color: t.palette.muted,
          lineHeight: 1.3,
        }}>
          {t.components.cardMeta}
        </span>
      </div>

      {/* Color palette strip */}
      <div style={{ display: 'flex', gap: 2, marginTop: 2 }}>
        {[accent, t.palette.bg, t.palette.surface, t.palette.text].map((c, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: 6 * scale,
              borderRadius: 3,
              background: c,
              border: `1px solid ${t.palette.text}22`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
