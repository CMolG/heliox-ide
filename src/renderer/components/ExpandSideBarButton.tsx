/**
 * ExpandSideBarButton.tsx — Renderer Composite Component
 *
 * Responsibility:
 * - Renders the ExpandSideBarButton surface in the renderer layer.
 * - Encapsulates Feature-level composition used by the renderer shell and panels.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
import React from 'react';
import { LucideIcon } from '@/renderer/components/desktop/LucideIcon';
import { useHelioxStore } from '@/renderer/store';

// ─── Component ───────────────────────────────────────────────────

export function ExpandSideBarButton() {
  const toggleSidebar = useHelioxStore(s => s.toggleSidebar);

  return (
    <button
      className="expand-sidebar-btn"
      onClick={toggleSidebar}
      title="Expand sidebar (⌘B)"
      aria-label="Expand sidebar"
      data-testid="expand-sidebar-btn"
    >
      <LucideIcon name="PanelLeftOpen" size={18} />
    </button>
  );
}
