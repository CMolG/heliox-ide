/**
 * RunningBars.tsx — Renderer Plugin Surface Component
 *
 * Responsibility:
 * - Renders the RunningBars surface in the renderer layer.
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

export function RunningBars() {
  return (
    <div className="agent-bars">
      <div className="agent-bar" />
      <div className="agent-bar" />
      <div className="agent-bar" />
    </div>
  );
}
