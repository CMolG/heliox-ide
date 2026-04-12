/**
 * SnapGuides.tsx — Renderer Desktop Surface Component
 *
 * Responsibility:
 * - Renders the SnapGuides surface in the renderer layer.
 * - Encapsulates Desktop canvas/window composition within the renderer workspace.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/desktop/SnapGuides.tsx — Visual snap alignment guides
import React from 'react';
import { useDesktopStore } from '../../store/desktop-store';

export function SnapGuides() {
  const guides = useDesktopStore(s => s.activeSnapGuides);

  if (guides.length === 0) return null;

  return (
    <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 9999 }}>
      {guides.map((g, i) => (
        <div
          key={`${g.axis}-${g.position}-${i}`}
          className="snap-guide"
          data-axis={g.axis}
          style={g.axis === 'x' ? { left: g.position } : { top: g.position }}
        />
      ))}
    </div>
  );
}
