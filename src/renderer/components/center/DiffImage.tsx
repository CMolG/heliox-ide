/**
 * DiffImage.tsx — Renderer Center Panel Component
 *
 * Responsibility:
 * - Renders the DiffImage surface in the renderer layer.
 * - Encapsulates Center-pane visualization for sessions, diffs, and code context.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/center/DiffImage.tsx — Before/after snapshot image for visual diffs
import React from 'react';
import type { SnapshotDiff } from '@/types';
import { theme } from '@/renderer/logic/theme';

export const DiffImage = React.memo(function DiffImage({ diff, side }: { diff?: SnapshotDiff; side: 'before' | 'after' }) {
  const artifact = diff ? (side === 'before' ? diff.before : diff.after) : null;
  if (!artifact?.screenshotBase64) {
    return (
      <div
        className="w-full h-64 rounded-2xl flex items-center justify-center"
        style={{ background: theme.border, border: `1px solid ${theme.border}` }}
      >
        <span className="text-xs" style={{ fontFamily: theme.fontManrope, color: theme.textFaint }}>No screenshot</span>
      </div>
    );
  }
  return (
    <img
      src={`data:image/png;base64,${artifact.screenshotBase64}`}
      alt={`${side} snapshot`}
      className="w-full rounded-2xl"
      style={{ border: `1px solid ${theme.borderLight}` }}
    />
  );
});
