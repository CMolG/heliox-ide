/**
 * MarketplaceApp.tsx — Renderer Embedded App Component
 *
 * Responsibility:
 * - Renders the MarketplaceApp surface in the renderer layer.
 * - Encapsulates Embedded mini-app surface mounted inside desktop windows.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/atoms/apps/MarketplaceApp.tsx — Figma-style grid marketplace
import React, { useMemo } from 'react';
import { useDesktopStore } from '../../../store/desktop-store';
import { LucideIcon } from '../../desktop/LucideIcon';
import { PluginCard } from './PluginCard';
import type { PluginCategory } from '../../../../types/desktop';

const CATEGORY_TABS: Array<{ key: PluginCategory | 'all'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'flows', label: 'Flows' },
  { key: 'roles', label: 'Roles' },
  { key: 'modifiers', label: 'Modifiers' },
];

export function MarketplaceApp() {
  const showMarketplace = useDesktopStore(s => s.showMarketplace);
  const setShowMarketplace = useDesktopStore(s => s.setShowMarketplace);
  const availablePlugins = useDesktopStore(s => s.availablePlugins);
  const marketplaceFilter = useDesktopStore(s => s.marketplaceFilter);
  const setMarketplaceFilter = useDesktopStore(s => s.setMarketplaceFilter);
  const [search, setSearch] = React.useState('');

  const filtered = useMemo(() => {
    let list = availablePlugins;
    if (marketplaceFilter !== 'all') {
      list = list.filter(p => p.category === marketplaceFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q));
    }
    return list;
  }, [availablePlugins, marketplaceFilter, search]);

  if (!showMarketplace) return null;

  return (
    <div className="fixed inset-0 z-[200] bg-black/35 backdrop-blur-[8px] flex items-center justify-center animate-fade-in" onClick={() => setShowMarketplace(false)} data-testid="marketplace" role="dialog" aria-modal="true" aria-label="Plugin marketplace">
      <div className="w-[min(90vw,960px)] max-h-[80vh] bg-white rounded-2xl border border-black/[0.08] shadow-[0_16px_64px_rgba(0,0,0,0.18)] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 pt-5 flex flex-col gap-3.5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[#1a1a2e] font-['Space_Grotesk',sans-serif] m-0">Marketplace</h2>
            <button
              onClick={() => setShowMarketplace(false)}
              className="bg-transparent border-none text-[#888] cursor-pointer p-1 rounded-md flex items-center justify-center hover:text-[#333] hover:bg-black/[0.06]"
              aria-label="Close marketplace"
            >
              <LucideIcon name="X" size={16} />
            </button>
          </div>

          {/* Search */}
          <input
            type="text"
            placeholder="Search inventory..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="marketplace-search"
            className="marketplace-search"
            aria-label="Search inventory"
          />

          {/* Category tabs */}
          <div className="flex gap-1" role="tablist" aria-label="Inventory categories">
            {CATEGORY_TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setMarketplaceFilter(tab.key)}
                data-testid={`marketplace-tab-${tab.key}`}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-medium border-none cursor-pointer transition-all duration-150 ${
                  marketplaceFilter === tab.key
                    ? 'bg-[rgba(var(--cli-accent-rgb),0.12)] text-[var(--cli-accent)]'
                    : 'bg-black/[0.04] text-[#666] hover:bg-black/[0.06]'
                }`}
                role="tab"
                aria-selected={marketplaceFilter === tab.key}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-auto mt-4">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))]" role="list" aria-label="Available items">
            {filtered.map(plugin => (
              <PluginCard key={plugin.id} plugin={plugin} />
            ))}
          </div>
          {filtered.length === 0 && (
            <div className="p-10 text-center text-sm text-[#999]">
              {availablePlugins.length === 0
                ? 'No inventory loaded — open a project with market/inventory.json'
                : 'No items found'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
