/**
 * FluxorLogo.tsx — Fluxor brand mark
 *
 * Responsibility:
 * - Renders the Fluxor logo (rounded square + silver diamond + helium glyph).
 * - Sourced from the shared SVG asset so filters/gradients render exactly.
 *
 * Boundaries:
 * - Owns: brand mark presentation only.
 * - Does NOT own: layout, theming, or interaction.
 */
import React from 'react';

// Vite resolves this to the emitted asset URL (works in dev and packaged build)
// without needing a global *.svg type declaration.
const LOGO_URL = new URL('../../assets/fluxor-logo.svg', import.meta.url).href;

interface FluxorLogoProps {
  size?: number;
  className?: string;
  title?: string;
}

export function FluxorLogo({ size = 24, className = '', title = 'Fluxor' }: FluxorLogoProps) {
  return (
    <img
      src={LOGO_URL}
      width={size}
      height={size}
      alt={title}
      className={className}
      draggable={false}
      style={{ display: 'block', borderRadius: Math.round(size * 0.12), userSelect: 'none' }}
    />
  );
}
