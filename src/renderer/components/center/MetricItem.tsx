/**
 * MetricItem.tsx — Renderer Center Panel Component
 *
 * Responsibility:
 * - Renders the MetricItem surface in the renderer layer.
 * - Encapsulates Center-pane visualization for sessions, diffs, and code context.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/center/MetricItem.tsx — Metric display item for diff metrics bar
import React from 'react';
import { theme } from '@/renderer/logic/theme';

export const MetricItem = React.memo(function MetricItem({ label, value, valueColor = theme.textPrimary }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[10px] font-normal uppercase leading-4" style={{ fontFamily: theme.fontInter, color: theme.textDim }}>{label}</span>
      <span className="text-xl font-bold leading-7" style={{ fontFamily: theme.fontGrotesk, color: valueColor }}>{value}</span>
    </div>
  );
});
