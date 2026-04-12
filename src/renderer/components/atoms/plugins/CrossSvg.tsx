/**
 * CrossSvg.tsx — Renderer Plugin Surface Component
 *
 * Responsibility:
 * - Renders the CrossSvg surface in the renderer layer.
 * - Encapsulates Plugin-facing UI surface rendered inside the desktop shell.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
import React from 'react';

export function CrossSvg() {
  return (
    <svg className="agent-result-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        className="agent-cross-path"
        d="M6 6L18 18M18 6L6 18"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
