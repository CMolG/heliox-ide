/**
 * WindowContextPlugin.tsx — Renderer Plugin Surface Component
 *
 * Responsibility:
 * - Renders the WindowContextPlugin surface in the renderer layer.
 * - Encapsulates Plugin-facing UI surface rendered inside the desktop shell.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/desktop/PluginWindowContent.tsx — Renders plugin content by componentKey
import React from 'react';
import { useDesktopStore } from '../../../store/desktop-store';
import { LucideIcon } from '../../desktop/LucideIcon';
import { FlowsEditor } from '../../FlowsEditor';
import { ActionsPanel } from '../../ActionsPanel';
import { LogsPanel } from '../../LogsPanel';
import { TerminalPanel } from '../../TerminalPanel';
import { RolesEditor } from '../../RolesEditor';

const COMPONENT_MAP: Record<string, React.ComponentType> = {
  'flows-editor': FlowsEditor,
  'actions-panel': ActionsPanel,
  'logs-panel': LogsPanel,
  'terminal-panel': TerminalPanel,
  'roles-editor': RolesEditor,
};

interface PluginWindowContentProps {
  pluginId: string;
}

export function WindowContextPlugin({ pluginId }: PluginWindowContentProps) {
  const plugin = useDesktopStore(s => s.installedPlugins.find(p => p.id === pluginId));

  if (!plugin) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#525252', fontSize: 13 }} role="alert">
        Plugin not installed
      </div>
    );
  }

  const Component = plugin.componentKey ? COMPONENT_MAP[plugin.componentKey] : null;

  if (!Component) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 20 }}>
        <LucideIcon name={plugin.iconName} size={32} style={{ color: 'var(--cli-accent, #888)' }} />
        <span style={{ fontSize: 14, fontWeight: 600, color: '#e4e4e7' }}>{plugin.name}</span>
        <span style={{ fontSize: 12, color: '#808080', textAlign: 'center' }}>{plugin.description}</span>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflow: 'auto' }}>
      <Component />
    </div>
  );
}
