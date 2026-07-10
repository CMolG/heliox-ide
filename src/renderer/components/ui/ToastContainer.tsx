/**
 * ToastContainer.tsx — Renderer UI Primitive Component
 *
 * Responsibility:
 * - Renders the ToastContainer surface in the renderer layer.
 * - Encapsulates Reusable UI primitive used by higher-level panels and surfaces.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/ToastContainer.tsx — Lightweight toast notification system
import React, { useCallback } from 'react';
import { useFluxorStore } from '../../store';
import { ToastItem } from './ToastItem';

export function ToastContainer() {
  const { toasts, removeToast } = useFluxorStore();

  const handleDismiss = useCallback((id: string) => {
    removeToast(id);
  }, [removeToast]);

  return (
    <div
      className="fixed top-4 right-6 z-50 flex flex-col gap-2 pointer-events-none"
      aria-live="polite"
      aria-label="Notifications"
      aria-atomic="true"
    >
      {toasts.map(toast => (
        <ToastItem
          key={toast.id}
          id={toast.id}
          message={toast.message}
          type={toast.type}
          onDismiss={handleDismiss}
        />
      ))}
    </div>
  );
}
