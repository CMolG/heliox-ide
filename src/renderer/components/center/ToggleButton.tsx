/**
 * ToggleButton.tsx — Renderer Center Panel Component
 *
 * Responsibility:
 * - Renders the ToggleButton surface in the renderer layer.
 * - Encapsulates Center-pane visualization for sessions, diffs, and code context.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/center/ToggleButton.tsx — Tab toggle button for diff view modes
import React from 'react';
import { theme } from '@/renderer/logic/theme';

export const ToggleButton = React.memo(function ToggleButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className="px-4 py-1.5 rounded-full flex items-center justify-center transition-all"
      style={{ background: active ? theme.surfaceHover : 'transparent' }}
      role="tab"
      aria-selected={active}
    >
      <span className="text-center text-[10px] font-semibold uppercase leading-4" style={{ fontFamily: theme.fontInter, color: active ? theme.textPrimary : theme.textDim }}>
        {label}
      </span>
    </button>
  );
});
