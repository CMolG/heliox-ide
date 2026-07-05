/**
 * MarketplaceApp.tsx — Renderer Embedded App Component
 *
 * Responsibility:
 * - Renders the MarketplaceApp surface in the renderer layer.
 * - Encapsulates Embedded mini-app surface mounted inside desktop windows.
 * - Hosts an intermediate product-detail sheet: clicking a card no longer
 *   deploys immediately — it opens a sheet describing the item, and only the
 *   sheet's "Deploy" button deploys.
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
import { PluginCard, CATEGORY_BADGES } from './PluginCard';
import type { Plugin, PluginCategory } from '../../../../types/desktop';
import type { MarketInventory, MarketFlow, MarketRole, MarketMod, MarketStep } from '../../../../types/market';

const CATEGORY_TABS: Array<{ key: PluginCategory | 'all'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'flows', label: 'Flows' },
  { key: 'roles', label: 'Roles' },
  { key: 'modifiers', label: 'Mods' },
  { key: 'steps', label: 'Steps' },
];

// One short, factual sentence describing what "Deploy" actually does for each
// category — this IS part of "explaining what the item does" (spec item 2),
// since deploy has different real-world outcomes (attachable dock vs. a window).
const DEPLOY_HINTS: Record<PluginCategory, string> = {
  flows: 'Adds this Flow to your attachable dock, ready to drag onto the canvas.',
  roles: 'Adds this Role to your attachable dock — drag it onto a chat window to assign it.',
  modifiers: 'Adds this Mod to your attachable dock — drag it onto a chat window to stack it.',
  steps: 'Adds this Step to your attachable dock, ready to drag onto a pipeline.',
  tools: 'Opens this tool in its own window.',
};

// ─── Inventory matching ───────────────────────────────────────────
//
// Plugins built from inventory (see loadInventoryPlugins in desktop-store.ts)
// derive their display `name` from the raw kebab-case inventory `name` via
// the exact same title-casing transform used here — so re-applying that
// transform to each inventory candidate and comparing to plugin.name is a
// reliable, dependency-free way to find the original entry back.
function toTitleCase(raw: string): string {
  return raw.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

type InventoryMatch =
  | { kind: 'flows'; item: MarketFlow }
  | { kind: 'roles'; item: MarketRole }
  | { kind: 'modifiers'; item: MarketMod }
  | { kind: 'steps'; item: MarketStep };

function findInventoryMatch(plugin: Plugin, inventory: MarketInventory | null): InventoryMatch | null {
  if (!inventory) return null;
  switch (plugin.category) {
    case 'flows': {
      const item = inventory.flows.find(f => toTitleCase(f.name) === plugin.name);
      return item ? { kind: 'flows', item } : null;
    }
    case 'roles': {
      const item = inventory.roles.find(r => toTitleCase(r.name) === plugin.name);
      return item ? { kind: 'roles', item } : null;
    }
    case 'modifiers': {
      const item = inventory.mods.find(m => toTitleCase(m.name) === plugin.name);
      return item ? { kind: 'modifiers', item } : null;
    }
    case 'steps': {
      const item = (inventory.steps ?? []).find(s => toTitleCase(s.name) === plugin.name);
      return item ? { kind: 'steps', item } : null;
    }
    default:
      // 'tools' (built-in plugins) have no inventory equivalent — fall back
      // gracefully to the plugin's own fields (spec item 2).
      return null;
  }
}

// ─── Small presentational helpers ──────────────────────────────────

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <dt className="text-[10px] font-bold uppercase tracking-wide text-[#555] m-0">{label}</dt>
      <dd className="text-xs text-[#1a1a2e] m-0 break-words">{value}</dd>
    </div>
  );
}

// ─── Product Sheet ──────────────────────────────────────────────────
//
// Renders IN PLACE of the grid body, inside the same outer dialog/header —
// there is only ever one `role="dialog"` element (spec: "Keep everything
// inside the existing MarketplaceApp dialog").

interface ProductSheetProps {
  plugin: Plugin;
  inventory: MarketInventory | null;
  onBack: () => void;
  onDeploy: () => void;
  backButtonRef: React.RefObject<HTMLButtonElement | null>;
  addButtonRef: React.RefObject<HTMLButtonElement | null>;
}

function ProductSheet({ plugin, inventory, onBack, onDeploy, backButtonRef, addButtonRef }: ProductSheetProps) {
  const badge = CATEGORY_BADGES[plugin.category];
  const match = useMemo(() => findInventoryMatch(plugin, inventory), [plugin, inventory]);
  const tags = match?.item.tags ?? [];
  const headingId = `plugin-sheet-heading-${plugin.id}`;

  return (
    <div
      className="flex-1 overflow-auto mt-4 px-6 pb-6 flex flex-col gap-4"
      role="region"
      aria-labelledby={headingId}
      data-testid="plugin-sheet"
    >
      <button
        ref={backButtonRef}
        type="button"
        onClick={onBack}
        className="self-start -ml-2 min-h-11 inline-flex items-center gap-1.5 rounded-md border-none bg-transparent px-2 text-xs font-semibold text-[#555] cursor-pointer hover:bg-black/[0.06] hover:text-[#1a1a2e]"
      >
        <LucideIcon name="ArrowLeft" size={14} />
        Back
      </button>

      {/* Icon, name, category badge, author */}
      <div className="flex flex-wrap items-start gap-4">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center flex-shrink-0"
          style={{ background: `${badge.color}14`, border: `1px solid ${badge.color}40` }}
        >
          <LucideIcon name={plugin.iconName} size={32} style={{ color: badge.color }} />
        </div>
        <div className="min-w-0 flex-1 flex flex-col gap-1.5">
          <h3 id={headingId} className="text-lg font-bold text-[#1a1a2e] font-['Space_Grotesk',sans-serif] m-0 break-words">
            {plugin.name}
          </h3>
          <span
            className="inline-flex self-start items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold text-[#1a1a2e]"
            style={{ background: `${badge.color}14`, border: `1px solid ${badge.color}55` }}
          >
            {badge.label}
          </span>
          <span className="text-xs text-[#555]">by {plugin.author ?? 'Heliox'}</span>
        </div>
      </div>

      {/* Full (untruncated) description */}
      <p className="text-sm leading-relaxed text-[#555] m-0">{plugin.description}</p>

      {/* Tags — common to all inventory categories */}
      {tags.length > 0 && (
        <div>
          <h4 className="text-[10px] font-bold uppercase tracking-wide text-[#555] m-0 mb-1.5">Tags</h4>
          <ul className="flex flex-wrap gap-1.5 list-none p-0 m-0">
            {tags.map(tag => (
              <li key={tag} className="rounded-full border border-black/[0.08] bg-black/[0.04] px-2 py-0.5 text-[11px] text-[#1a1a2e]">
                {tag}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Category-specific compatibility / metadata */}
      {match?.kind === 'flows' && (
        <dl className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-3 m-0">
          <MetaRow label="Better on" value={match.item.betterOn} />
          <MetaRow label="Cost" value={match.item.cost} />
          <MetaRow label="Recommended complexity" value={match.item.recommendedComplexity} />
        </dl>
      )}
      {match?.kind === 'roles' && (match.item.betterOn || (match.item.domains?.length ?? 0) > 0) && (
        <dl className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-3 m-0">
          {match.item.betterOn && <MetaRow label="Better on" value={match.item.betterOn} />}
          {!!match.item.domains?.length && (
            <MetaRow label="Domains" value={match.item.domains.join(', ')} />
          )}
        </dl>
      )}
      {match?.kind === 'modifiers' && (
        match.item.exclusiveGroup || (match.item.incompatibleWith?.length ?? 0) > 0 || (match.item.domains?.length ?? 0) > 0
      ) && (
        <dl className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-3 m-0">
          {match.item.exclusiveGroup && <MetaRow label="Exclusive group" value={match.item.exclusiveGroup} />}
          {!!match.item.incompatibleWith?.length && (
            <MetaRow label="Incompatible with" value={match.item.incompatibleWith.join(', ')} />
          )}
          {!!match.item.domains?.length && (
            <MetaRow label="Domains" value={match.item.domains.join(', ')} />
          )}
        </dl>
      )}

      {/* Deploy — the ONLY control that deploys */}
      <div className="mt-auto pt-4 border-t border-black/[0.06] flex flex-col gap-2">
        <p className="text-[11px] text-[#555] m-0">{DEPLOY_HINTS[plugin.category]}</p>
        <button
          ref={addButtonRef}
          type="button"
          data-testid={`plugin-deploy-${plugin.id}`}
          onClick={onDeploy}
          className="self-end min-h-11 rounded-lg border-none bg-[#1a1a2e] px-5 text-sm font-semibold text-white cursor-pointer hover:bg-[#2a2a45]"
        >
          Deploy
        </button>
      </div>
    </div>
  );
}

// ─── Marketplace ────────────────────────────────────────────────────

export function MarketplaceApp() {
  const showMarketplace = useDesktopStore(s => s.showMarketplace);
  const setShowMarketplace = useDesktopStore(s => s.setShowMarketplace);
  const availablePlugins = useDesktopStore(s => s.availablePlugins);
  const marketplaceFilter = useDesktopStore(s => s.marketplaceFilter);
  const setMarketplaceFilter = useDesktopStore(s => s.setMarketplaceFilter);
  const marketInventory = useDesktopStore(s => s.marketInventory);
  const deployPlugin = useDesktopStore(s => s.deployPlugin);
  const [search, setSearch] = React.useState('');
  const [selected, setSelected] = React.useState<Plugin | null>(null);

  const closeButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const backButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const addButtonRef = React.useRef<HTMLButtonElement | null>(null);
  // The plugin-card testid that opened the sheet — used to restore focus to
  // the exact originating card once the grid re-mounts (the grid is swapped
  // out while the sheet is shown, so we can't just keep a DOM ref to it).
  const lastOpenedIdRef = React.useRef<string | null>(null);

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

  const openSheet = React.useCallback((plugin: Plugin) => {
    lastOpenedIdRef.current = plugin.id;
    setSelected(plugin);
  }, []);

  const closeSheet = React.useCallback(() => {
    setSelected(null);
  }, []);

  const handleDeploy = React.useCallback(() => {
    if (!selected) return;
    deployPlugin(selected.id); // already closes the marketplace (desktop-store.ts)
    closeSheet();
  }, [selected, deployPlugin, closeSheet]);

  // Header close (X): while the sheet is open it steps back to the grid
  // (spec item 4); otherwise it closes the whole marketplace as before.
  const handleHeaderClose = React.useCallback(() => {
    if (selected) { closeSheet(); return; }
    setShowMarketplace(false);
  }, [selected, closeSheet, setShowMarketplace]);

  // Safety net: whichever path closed the marketplace (backdrop click, the
  // global Escape handler in App.tsx, Cmd+Shift+M, or a successful deploy),
  // make sure we never reopen straight back into a stale sheet.
  React.useEffect(() => {
    if (!showMarketplace) setSelected(null);
  }, [showMarketplace]);

  // Focus management: move focus into the sheet when it opens (onto the
  // safe/non-destructive "Back" control, not "Deploy", so an accidental
  // Enter/Space can't deploy); restore focus to the originating card once the
  // grid re-mounts after closing the sheet.
  React.useEffect(() => {
    if (selected) {
      backButtonRef.current?.focus();
      return;
    }
    const id = lastOpenedIdRef.current;
    if (!id) return;
    lastOpenedIdRef.current = null;
    const raf = requestAnimationFrame(() => {
      const card = document.querySelector<HTMLElement>(`[data-testid="plugin-card-${CSS.escape(id)}"]`);
      card?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [selected]);

  // Escape returns to the grid instead of closing the whole marketplace
  // (spec item 5). Registered on the CAPTURE phase so it runs before
  // App.tsx's global bubble-phase Escape handler (which otherwise closes the
  // entire marketplace) — stopping propagation here prevents that handler
  // from ever seeing the event.
  React.useEffect(() => {
    if (!selected) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      closeSheet();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [selected, closeSheet]);

  // Mini focus trap for the sheet: while it's open, the search input/tabs/grid
  // are unmounted, so the entire focusable universe is [close, back, add].
  // Keep Tab cycling within that trio instead of escaping behind the modal.
  const handleDialogKeyDown = React.useCallback((e: React.KeyboardEvent) => {
    if (!selected || e.key !== 'Tab') return;
    const order = [closeButtonRef.current, backButtonRef.current, addButtonRef.current].filter(
      (el): el is HTMLButtonElement => !!el,
    );
    if (order.length === 0) return;
    const first = order[0]!;
    const last = order[order.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, [selected]);

  if (!showMarketplace) return null;

  return (
    <div className="fixed inset-0 z-[200] bg-black/35 backdrop-blur-[8px] flex items-center justify-center animate-fade-in" onClick={() => setShowMarketplace(false)} data-testid="marketplace" role="dialog" aria-modal="true" aria-label="Plugin marketplace">
      <div
        className="w-[min(90vw,960px)] max-h-[80vh] bg-white rounded-2xl border border-black/[0.08] shadow-[0_16px_64px_rgba(0,0,0,0.18)] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
        onKeyDown={handleDialogKeyDown}
      >
        {/* Header */}
        <div className="px-6 pt-5 flex flex-col gap-3.5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[#1a1a2e] font-['Space_Grotesk',sans-serif] m-0">Marketplace</h2>
            <button
              ref={closeButtonRef}
              onClick={handleHeaderClose}
              className="bg-transparent border-none text-[#888] cursor-pointer min-w-11 min-h-11 rounded-md flex items-center justify-center hover:text-[#333] hover:bg-black/[0.06]"
              aria-label="Close marketplace"
            >
              <LucideIcon name="X" size={16} />
            </button>
          </div>

          {!selected && (
            <>
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
            </>
          )}
        </div>

        {selected ? (
          <ProductSheet
            plugin={selected}
            inventory={marketInventory}
            onBack={closeSheet}
            onDeploy={handleDeploy}
            backButtonRef={backButtonRef}
            addButtonRef={addButtonRef}
          />
        ) : (
          <div className="flex-1 overflow-auto mt-4">
            <ul className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))]" aria-label="Available items">
              {filtered.map(plugin => (
                <PluginCard key={plugin.id} plugin={plugin} onOpen={openSheet} />
              ))}
            </ul>
            {filtered.length === 0 && (
              <div className="p-10 text-center text-sm text-[#999]">
                {availablePlugins.length === 0
                  ? 'No inventory loaded — open a project with market/inventory.json'
                  : 'No items found'}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
