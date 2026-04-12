/**
 * ToggleSetting.tsx — Renderer Modal Component
 *
 * Responsibility:
 * - Renders the ToggleSetting surface in the renderer layer.
 * - Encapsulates Modal dialog composition and modal-scoped interactions.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
import React from 'react';

export function ToggleSetting({ label, description, value, onChange, testId }: {
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
  testId?: string;
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      role="switch"
      aria-checked={value}
      className="settings-toggle"
      data-testid={testId}
    >
      <div className={`settings-toggle-track ${value ? 'active' : ''}`}>
        <div className={`settings-toggle-thumb ${value ? 'active' : ''}`} />
      </div>
      <div className="settings-toggle-content">
        <span className="settings-toggle-label">{label}</span>
        <span className="settings-toggle-desc">{description}</span>
      </div>
    </button>
  );
}
