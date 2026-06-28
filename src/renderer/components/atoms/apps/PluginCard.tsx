/**
 * PluginCard.tsx — Renderer Embedded App Component
 *
 * Responsibility:
 * - Renders the PluginCard surface in the renderer layer.
 * - Encapsulates Embedded mini-app surface mounted inside desktop windows.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
import React from 'react';
import { useDesktopStore } from '@/renderer/store/desktop-store';
import { LucideIcon } from '@/renderer/components/desktop/LucideIcon';
import type { Plugin, PluginCategory } from '@/types/desktop';

const CATEGORY_BADGES: Record<PluginCategory, { label: string; color: string }> = {
  flows: { label: 'Flow', color: '#A78BFA' },
  roles: { label: 'Role', color: '#E87040' },
  modifiers: { label: 'Modifier', color: '#4285F4' },
  steps: { label: 'Step', color: '#2BB673' },
  tools: { label: 'Tool', color: '#A0F695' },
};

function subString(str: string, n: number): string {
  if (str.length <= n) return str;
  return str.slice(0, n);
}

export function PluginCard({ plugin }: { plugin: Plugin }) {
  const deployPlugin = useDesktopStore(s => s.deployPlugin);
  const badge = CATEGORY_BADGES[plugin.category];

  const actionLabel = plugin.category === 'flows' ? 'Deploy Flow'
    : plugin.category === 'roles' ? 'Deploy Role'
    : plugin.category === 'modifiers' ? 'Deploy Mod'
    : plugin.category === 'steps' ? 'Deploy Step'
    : 'Open';

  return (
    <a
      className="plugin-card"
      data-testid={`plugin-card-${plugin.id}`}
      role="listitem"
      aria-label={`${plugin.name} — ${badge.label} by ${plugin.author}`}
      onClick={(e) => { e.preventDefault(); deployPlugin(plugin.id); }}
      data-category={plugin.category}
    >
      <div className="plugin-icon-box" style={{ borderColor: `${badge.color}40` }}>
        <LucideIcon name={plugin.iconName} size={22} style={{ color: badge.color }} />
      </div>
      <h3>{plugin.name}</h3>
      <p>{subString(plugin.description, 80)}…</p>

      <span>{plugin.author ?? 'Heliox'}</span>
      <span data-testid={`plugin-deploy-${plugin.id}`}>{actionLabel}</span>
    </a>
  );
}
