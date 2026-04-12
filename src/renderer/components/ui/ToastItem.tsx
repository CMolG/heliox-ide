/**
 * ToastItem.tsx — Renderer UI Primitive Component
 *
 * Responsibility:
 * - Renders the ToastItem surface in the renderer layer.
 * - Encapsulates Reusable UI primitive used by higher-level panels and surfaces.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/ui/ToastItem.tsx — Individual toast notification item
import React, { useEffect } from 'react';
import { theme } from '../../logic/theme';
import { SuccessIcon } from './SuccessIcon';
import { ErrorIcon } from './ErrorIcon';
import { InfoIcon } from './InfoIcon';

const TOAST_DURATION_MS = 4000;

const iconMap = {
  success: <SuccessIcon />,
  error: <ErrorIcon />,
  info: <InfoIcon />,
};

const bgMap = {
  success: 'rgba(74,222,128,0.08)',
  error: 'rgba(248,113,113,0.08)',
  info: 'rgba(96,165,250,0.08)',
};

const borderMap = {
  success: 'rgba(74,222,128,0.2)',
  error: 'rgba(248,113,113,0.2)',
  info: 'rgba(96,165,250,0.2)',
};

export function ToastItem({ id, message, type, onDismiss }: {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
  onDismiss: (id: string) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(id), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [id, onDismiss]);

  return (
    <div
      className={`pointer-events-auto flex items-center gap-2.5 px-4 py-2.5 rounded-xl shadow-lg backdrop-blur-md animate-slide-in`}
      style={{
        background: bgMap[type],
        border: `1px solid ${borderMap[type]}`,
      }}
      role="alert"
    >
      {iconMap[type]}
      <span className="text-xs font-light max-w-[260px] truncate" style={{ fontFamily: theme.fontManrope, color: theme.textPrimary }}>{message}</span>
      <button
        onClick={() => onDismiss(id)}
        className="hover:opacity-100 opacity-50 ml-1 text-xs transition"
        style={{ color: theme.textMuted }}
        aria-label="Dismiss notification"
      >
        ✕
      </button>
    </div>
  );
}
