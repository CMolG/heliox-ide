/**
 * HelioxLogo.tsx — Heliox brand mark
 *
 * Responsibility:
 * - Renders the Heliox logo (rounded square + silver diamond + helium glyph).
 * - Sourced from the shared SVG asset so filters/gradients render exactly.
 *
 * Boundaries:
 * - Owns: brand mark presentation only.
 * - Does NOT own: layout, theming, or interaction.
 */
import React from 'react';

// Vite resolves this to the emitted asset URL (works in dev and packaged build)
// without needing a global *.svg type declaration.
const LOGO_URL = new URL('../../assets/heliox-logo.svg', import.meta.url).href;

interface HelioxLogoProps {
  size?: number;
  className?: string;
  title?: string;
}

export function HelioxLogo({ size = 24, className = '', title = 'Heliox' }: HelioxLogoProps) {
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
