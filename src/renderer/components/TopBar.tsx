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
import { FluxorLogo } from './brand/FluxorLogo';
import { BoardSwitcher } from './BoardSwitcher';

export const TopBar = React.memo(function TopBar() {
  return (
    <header
      role="banner"
      aria-label="Fluxor IDE header"
      className="fluxor-topbar title-bar-drag"
      style={{
        background: 'rgba(12, 10, 9, 0.8)',
        borderBottom: `1px solid ${theme.borderAccent}`,
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        zIndex: 50,
      }}
    >
      {/* 3-zone layout: left spacer (keeps the macOS traffic-light inset via
          paddingLeft below), center board switcher, right brand cluster
          (unchanged). A grid with a 1fr/auto/1fr template centers the middle
          column regardless of how wide the outer zones end up. */}
      <div
        className="py-3"
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'center',
          paddingLeft: '88px',
          paddingRight: '24px',
        }}
      >
        <div aria-hidden="true" />

        <div className="flex items-center justify-center">
          <BoardSwitcher />
        </div>

        <div className="flex items-center justify-end" style={{ gap: '10px' }}>
          <FluxorLogo size={22} />
          <span
            className="text-xl font-bold leading-7"
            style={{ fontFamily: theme.fontDisplay, color: theme.textSecondary, letterSpacing: '0.03em' }}
            data-testid="topbar-brand"
          >
            Fluxor
          </span>
        </div>
      </div>
    </header>
  );
});
