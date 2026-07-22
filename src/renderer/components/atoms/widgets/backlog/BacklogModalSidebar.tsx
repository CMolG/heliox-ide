/**
 * BacklogModalSidebar.tsx — modal metadata sidebar (F2 Task 8).
 *
 * Ported verbatim from the frozen reference
 * (docs/superpowers/specs/2026-07-08-backlog-bento-reference.tsx:503-558):
 * priority, estimate (hours, unconditional per F0 spec §1.1), tags
 * (conditional), assignees, created/updated history. `sticky top-6` is kept
 * as-is — this sidebar lives inside the canvas-level modal's own internal
 * scroll container (`max-h-[90vh] overflow-y-auto`), a legitimate full-app
 * overlay by design, not the widget-wrapper case Gate 1's
 * "min-h-screen/sticky -> wrapper-relative" deviation targets.
 *
 * Assignees empty state is "Unassigned" (EN) per the plan's Task 8 note /
 * task doc resolved decision #2 — overriding the reference's "Sin asignar".
 * Everything else here (section headers, "Horas"→n/a here since estimate
 * has no unit label change) ports verbatim.
 */
import React from 'react';
import { LucideIcon } from '@/renderer/components/desktop/LucideIcon';
import { PRIORITY_CONFIG } from './priorityConfig';
import { formatCardDate } from './BacklogCardItem';
import type { BacklogCard } from '@/types/market';

export function BacklogModalSidebar({ card }: { card: BacklogCard }) {
  const priorityInfo = PRIORITY_CONFIG[card.priority] ?? PRIORITY_CONFIG.medium;

  return (
    <div className="w-full md:w-64 flex flex-col gap-6 bg-neutral-100 p-5 border border-black rounded-2xl h-fit sticky top-6">
      <div>
        <h3 className="text-xs font-extrabold uppercase text-neutral-500 mb-2">Prioridad</h3>
        <div className={`flex items-center gap-2 font-black text-sm uppercase ${priorityInfo.color}`}>
          <LucideIcon name={priorityInfo.icon} size={18} />
          {priorityInfo.label}
        </div>
      </div>

      <div>
        <h3 className="text-xs font-extrabold uppercase text-neutral-500 mb-2">Estimación</h3>
        <div className="flex items-center gap-2 font-black text-lg">
          <LucideIcon name="Clock" size={16} />
          {card.estimate}h
        </div>
      </div>

      {card.tags.length > 0 && (
        <div>
          <h3 className="text-xs font-extrabold uppercase text-neutral-500 mb-2">Etiquetas</h3>
          <div className="flex flex-wrap gap-2">
            {card.tags.map((tag) => (
              <span key={tag} className="flex items-center gap-1 text-[10px] font-extrabold bg-white border border-black px-2 py-1 rounded-md uppercase">
                <LucideIcon name="Tag" size={10} /> {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-xs font-extrabold uppercase text-neutral-500 mb-2">Asignados</h3>
        <div className="flex items-center gap-2 font-bold text-sm bg-white p-2 rounded-lg border border-neutral-200">
          <LucideIcon name="User" size={16} />
          {card.assignees.length > 0 ? card.assignees.join(', ') : 'Unassigned'}
        </div>
      </div>

      <div>
        <h3 className="text-xs font-extrabold uppercase text-neutral-500 mb-2">Historial</h3>
        <ul className="flex flex-col gap-3 text-xs border-l-2 border-black/10 pl-3 py-1">
          <li className="relative">
            <span className="absolute -left-[17px] top-1 w-2 h-2 rounded-full bg-black"></span>
            <span className="font-extrabold text-black block">Creado</span>
            <span className="font-bold text-neutral-500">{formatCardDate(card.createdAt)}</span>
          </li>
          <li className="relative">
            <span className="absolute -left-[17px] top-1 w-2 h-2 rounded-full bg-black/50"></span>
            <span className="font-extrabold text-black block">Última actualización</span>
            <span className="font-bold text-neutral-500">{formatCardDate(card.updatedAt)}</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
