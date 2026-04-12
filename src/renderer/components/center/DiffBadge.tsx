/**
 * DiffBadge.tsx — Renderer Center Panel Component
 *
 * Responsibility:
 * - Renders the DiffBadge surface in the renderer layer.
 * - Encapsulates Center-pane visualization for sessions, diffs, and code context.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/center/DiffBadge.tsx — Small badge component for diff stats
import React from 'react';

const BADGE_CLASS = "text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ml-1";

export function DiffBadge({ label, bg, color, border }: { label: string; bg: string; color: string; border: string }) {
  return <span className={BADGE_CLASS} style={{ background: bg, color, border }}>{label}</span>;
}
