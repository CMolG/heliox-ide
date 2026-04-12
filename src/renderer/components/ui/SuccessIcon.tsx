/**
 * SuccessIcon.tsx — Renderer UI Primitive Component
 *
 * Responsibility:
 * - Renders the SuccessIcon surface in the renderer layer.
 * - Encapsulates Reusable UI primitive used by higher-level panels and surfaces.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/ui/SuccessIcon.tsx — SVG success icon for toast notifications
import React from 'react';

export function SuccessIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" stroke="#4ade80" strokeWidth="1.5"/>
      <path d="M5 8l2 2 4-4" stroke="#4ade80" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
