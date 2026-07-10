/**
 * FluxorSpinner.tsx — Fluxor loading mark
 *
 * Responsibility:
 * - Renders the Fluxor diamond (the logo's inner rhombus, lifted out of its square
 *   background) rotating as a loading indicator. Mirrors the javadaba spinner motion.
 *
 * Boundaries:
 * - Owns: spinner presentation/animation only.
 * - Does NOT own: when to show loading, or layout placement.
 */
import React from 'react';

interface FluxorSpinnerProps {
  size?: number;
  spinning?: boolean;
  /** Seconds per full rotation. */
  speed?: number;
  className?: string;
}

export function FluxorSpinner({ size = 28, spinning = true, speed = 1.8, className = '' }: FluxorSpinnerProps) {
  const inner = Math.round(size * 0.62);
  return (
    <div
      className={`fluxor-spinner ${className}`.trim()}
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: spinning ? `hx-spin-linear ${speed}s linear infinite` : undefined,
      }}
      aria-hidden="true"
    >
      {/* The silver diamond — square rotated 45°, transparent around it (no background). */}
      <div
        style={{
          width: inner,
          height: inner,
          background: 'linear-gradient(135deg, #E1D4B4 0%, #E2E2E2 52%, #ffffff 100%)',
          borderRadius: Math.max(2, Math.round(size * 0.05)),
          transform: 'rotate(45deg)',
          boxShadow: `0 0 ${size * 0.2}px rgba(245, 217, 198, 0.45), 0 0 ${size * 0.07}px rgba(255, 255, 255, 0.65), inset 0 0 ${size * 0.03}px rgba(0, 0, 0, 0.18)`,
        }}
      />
    </div>
  );
}
