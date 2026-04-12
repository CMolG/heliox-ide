/**
 * InfoIcon.tsx — Renderer UI Primitive Component
 *
 * Responsibility:
 * - Renders the InfoIcon surface in the renderer layer.
 * - Encapsulates Reusable UI primitive used by higher-level panels and surfaces.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/ui/InfoIcon.tsx — SVG info icon for toast notifications
import React from 'react';

export function InfoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" stroke="#60a5fa" strokeWidth="1.5"/>
      <path d="M8 7v4M8 5v.5" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}
