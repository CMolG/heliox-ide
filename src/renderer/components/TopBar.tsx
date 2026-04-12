/**
 * TopBar.tsx — Renderer Composite Component
 *
 * Responsibility:
 * - Renders the TopBar surface in the renderer layer.
 * - Encapsulates Feature-level composition used by the renderer shell and panels.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/TopBar.tsx — Top navigation bar
import React from 'react';
import { theme } from '../logic/theme';
import { LucideIcon } from './desktop/LucideIcon';

export const TopBar = React.memo(function TopBar() {
  return (
    <header
      role="banner"
      aria-label="Heliox IDE header"
      className="heliox-topbar title-bar-drag"
      style={{
        background: 'rgba(12, 10, 9, 0.8)',
        borderBottom: `1px solid ${theme.borderAccent}`,
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        zIndex: 50,
      }}
    >
      <div className="py-3 flex items-center justify-end" style={{ paddingLeft: '88px', paddingRight: '24px', gap: '10px' }}>
        <LucideIcon name="Orbit" size={22} style={{ color: '#ffffff' }} />
        <span
          className="text-xl font-bold leading-7"
          style={{ fontFamily: theme.fontGrotesk, color: theme.textSecondary }}
          data-testid="topbar-brand"
        >
          Heliox <span style={{ color: theme.textFaint, fontWeight: 400 }}>(HeO₂)</span>
        </span>
      </div>
    </header>
  );
});
