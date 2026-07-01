/**
 * PluginCard.tsx — Renderer Embedded App Component
 *
 * Responsibility:
 * - Renders a single marketplace grid cell.
 * - Clicking the card OPENS the product detail sheet for this plugin (via
 *   `onOpen`) — it never deploys directly. Deploying now happens exclusively
 *   from the sheet's "Deploy" button (see MarketplaceApp's ProductSheet).
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
import React from 'react';
import { LucideIcon } from '@/renderer/components/desktop/LucideIcon';
import type { Plugin, PluginCategory } from '@/types/desktop';

// Exported so MarketplaceApp's product sheet can reuse the exact same
// category → { label, color } mapping (single source of truth, avoids the
// card and the sheet ever drifting out of visual sync).
export const CATEGORY_BADGES: Record<PluginCategory, { label: string; color: string }> = {
  flows: { label: 'Flow', color: '#A78BFA' },
  roles: { label: 'Role', color: '#E87040' },
  modifiers: { label: 'Mod', color: '#4285F4' },
  steps: { label: 'Step', color: '#2BB673' },
  tools: { label: 'Tool', color: '#A0F695' },
};

function subString(str: string, n: number): string {
  if (str.length <= n) return str;
  return str.slice(0, n);
}

export interface PluginCardProps {
  plugin: Plugin;
  /** Opens the product detail sheet for this plugin. Deploying happens from there. */
  onOpen: (plugin: Plugin) => void;
}

export function PluginCard({ plugin, onOpen }: PluginCardProps) {
  const badge = CATEGORY_BADGES[plugin.category];

  return (
    <li>
      <button
        type="button"
        className="plugin-card"
        data-testid={`plugin-card-${plugin.id}`}
        aria-label={`View details for ${plugin.name} — ${badge.label} by ${plugin.author}`}
        onClick={() => onOpen(plugin)}
        data-category={plugin.category}
      >
        <div className="plugin-icon-box" style={{ borderColor: `${badge.color}40` }}>
          <LucideIcon name={plugin.iconName} size={22} style={{ color: badge.color }} />
        </div>
        {/* <button> only permits phrasing content (unlike the <a> this replaces,
            which was content-transparent) — plain <span>s with explicit classes,
            not h3/p or fragile :nth-of-type counting. */}
        <span className="plugin-card-title">{plugin.name}</span>
        <span className="plugin-card-desc">{subString(plugin.description, 80)}…</span>

        <span className="plugin-card-author">{plugin.author ?? 'Heliox'}</span>
        <span className="plugin-card-type">{badge.label}</span>
      </button>
    </li>
  );
}
