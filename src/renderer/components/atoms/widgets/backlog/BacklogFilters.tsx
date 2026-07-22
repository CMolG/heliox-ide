/**
 * BacklogFilters.tsx — search input + status toggle-chip row (F2 Task 7).
 *
 * Ported verbatim from the frozen reference
 * (docs/superpowers/specs/2026-07-08-backlog-bento-reference.tsx:569-608),
 * including its own card chrome (`max-w-4xl` centered white island — part of
 * the 1:1 visual, not a viewport-sizing accident; only `min-h-screen`/
 * `sticky` are the wrapper-relative deviation, applied in
 * BacklogBentoWidget.tsx's own root). `searchTerm`/`activeStatuses` are
 * controlled props — BacklogBentoWidget owns the actual filter state
 * (matches the reference's state living in the same component it renders
 * from). The reference's hand-rolled inline `SearchIcon` becomes
 * `LucideIcon name="Search"` (same glyph, project's icon system).
 */
import React from 'react';
import { LucideIcon } from '@/renderer/components/desktop/LucideIcon';
import { StatusShape } from './StatusShape';
import { statusEntriesByOrder } from './statusConfig';
import type { BacklogStatus } from '@/types/market';

export interface BacklogFiltersProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  activeStatuses: BacklogStatus[];
  onToggleStatus: (status: BacklogStatus) => void;
}

export function BacklogFilters({ searchTerm, onSearchChange, activeStatuses, onToggleStatus }: BacklogFiltersProps) {
  return (
    <div
      data-testid="backlog-filters"
      className="w-full max-w-4xl bg-white border border-black rounded-3xl p-4 sm:p-6 mb-8 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
    >
      <div className="relative mb-6">
        <LucideIcon name="Search" size={20} strokeWidth={2.5} className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400" />
        <input
          type="text"
          className="block w-full pl-12 pr-4 py-3 bg-neutral-100 border-2 border-transparent rounded-2xl text-black placeholder-neutral-500 focus:bg-white focus:border-black focus:ring-0 transition-all font-bold outline-none"
          placeholder="Buscar en el backlog..."
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label="Search backlog"
        />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-extrabold text-neutral-500 uppercase tracking-widest mr-2">Filtros:</span>
        {statusEntriesByOrder().map((config) => {
          const isActive = activeStatuses.includes(config.id);
          return (
            <button
              key={config.id}
              type="button"
              onClick={() => onToggleStatus(config.id)}
              aria-pressed={isActive}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border-2 text-xs font-extrabold uppercase transition-all ${
                isActive
                  ? 'bg-white border-black text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
                  : 'bg-neutral-100 border-transparent text-neutral-400 opacity-60 hover:opacity-100'
              }`}
            >
              {isActive && (
                <StatusShape sides={config.sides} className="w-4 h-4" fillClass={config.fillClass} strokeClass={config.strokeClass} />
              )}
              <div className="flex items-center gap-1.5">
                <LucideIcon name={config.icon} size={14} strokeWidth={2.5} />
                {config.label}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
