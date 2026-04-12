/**
 * CenterPanel.tsx — Renderer Composite Component
 *
 * Responsibility:
 * - Renders the CenterPanel surface in the renderer layer.
 * - Encapsulates Feature-level composition used by the renderer shell and panels.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/CenterPanel.tsx — Center panel with tab routing
import React from 'react';
import { useHelioxStore } from '../store';
import { FlowsEditor } from './FlowsEditor';
import { RolesEditor } from './RolesEditor';
import { ActionsPanel } from './ActionsPanel';
import { SessionView } from './center/SessionView';

// ─── Center Panel Router ─────────────────────────────────────────

export function CenterPanel() {
  const activeTab = useHelioxStore((s) => s.activeTab);

  switch (activeTab) {
    case 'sessions': return <SessionView />;
    case 'flows': return <FlowsEditor />;
    case 'roles': return <RolesEditor />;
    case 'actions': return <ActionsPanel />;
    default: return <SessionView />;
  }
}
