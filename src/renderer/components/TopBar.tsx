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
import { HelioxLogo } from './brand/HelioxLogo';

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
        <HelioxLogo size={22} />
        <span
          className="text-xl font-bold leading-7"
          style={{ fontFamily: theme.fontDisplay, color: theme.textSecondary, letterSpacing: '0.03em' }}
          data-testid="topbar-brand"
        >
          Heliox
        </span>
      </div>
    </header>
  );
});
