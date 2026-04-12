/**
 * CollapseSideBarButton.tsx — Renderer Composite Component
 *
 * Responsibility:
 * - Renders the CollapseSideBarButton surface in the renderer layer.
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
import { theme } from '@/renderer/logic/theme';
import { useHelioxStore } from '@/renderer/store';

// ─── Component ───────────────────────────────────────────────────

export function CollapseSideBarButton() {
  const toggleSidebar = useHelioxStore(s => s.toggleSidebar);

  return (
    <button
      onClick={toggleSidebar}
      title="Collapse sidebar (⌘B)"
      aria-label="Collapse sidebar"
      data-testid="collapse-sidebar-btn"
      style={{
        background: 'none', border: 'none', color: theme.textGhost,
        cursor: 'pointer', padding: 6, borderRadius: 6,
        display: 'flex', alignItems: 'center',
        transition: 'color 0.15s ease, background 0.15s ease',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
    >
      <LucideIcon name="PanelLeftClose" size={16} />
    </button>
  );
}
