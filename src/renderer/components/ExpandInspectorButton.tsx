/**
 * ExpandInspectorButton.tsx — Renderer Composite Component
 *
 * Responsibility:
 * - Renders the floating button that restores the right-side Inspector
 *   column once the user has collapsed it — the Inspector's counterpart to
 *   `ExpandSideBarButton.tsx` (left edge), mirrored onto the right edge.
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
import { useDesktopStore } from '@/renderer/store/desktop-store';

// ─── Component ───────────────────────────────────────────────────

export function ExpandInspectorButton() {
  const updateSettings = useDesktopStore(s => s.updateSettings);

  return (
    <button
      className="expand-inspector-btn"
      onClick={() => updateSettings({ showInspector: true })}
      title="Expand inspector (⌘.)"
      aria-label="Expand inspector"
      data-testid="expand-inspector-btn"
    >
      <LucideIcon name="ChevronLeft" size={18} />
    </button>
  );
}
