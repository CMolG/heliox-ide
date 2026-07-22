/**
 * BacklogCardItem.tsx — a single pile card (F2 Task 5).
 *
 * Ported verbatim from the frozen reference's per-card JSX
 * (docs/superpowers/specs/2026-07-08-backlog-bento-reference.tsx:623-706):
 * left drag-handle+id+priority-icon+estimate block, center status-shape+
 * status-badge+EpicBadge+title+excerpt+tags, right created/updated metadata
 * (desktop + mobile variants). The reference has no drag-handle icon of its
 * own (the whole card is `draggable` in the mock) — BacklogPile.tsx (Task 6)
 * attaches @dnd-kit's sortable listeners to a thin, unstyled outer wrapper
 * around this component so the WHOLE card stays the drag surface, matching
 * the reference visually with zero added chrome.
 *
 * `isSelected`/`onSelect` are an ADDITIVE affordance for the multi-select
 * behavior preserved from the deleted BacklogKanbanWidget.tsx (the frozen
 * reference itself has no multi-select) — kept visually minimal (a ring only
 * when selected) so the unselected/default look stays 1:1.
 */
import React, { useMemo } from 'react';
import { LucideIcon } from '@/renderer/components/desktop/LucideIcon';
import { useDesktopStore } from '@/renderer/store/desktop-store';
import { STATUS_CONFIG } from './statusConfig';
import { PRIORITY_CONFIG } from './priorityConfig';
import { StatusShape } from './StatusShape';
import { EpicBadge } from './EpicBadge';
import { LaunchMenu } from './LaunchMenu';
import { launchAutoflow, launchEpicFlow, launchExistingFlow } from './launchActions';
import type { BacklogCard, BacklogRunState } from '@/types/market';
import type { CanvasGraphNode, FrameGraphNode } from '@/types/desktop';

function isFrameGraphNode(node: CanvasGraphNode): node is FrameGraphNode {
  return node.type === 'frame';
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** ISO-8601 -> the reference's 'DD-MMM-YYYY' display (F0 spec §1.1 formatting note). */
export function formatCardDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = String(d.getDate()).padStart(2, '0');
  return `${day}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

/**
 * `excerpt` is NOT persisted (F0 spec §1.3 — no separate field like the
 * mock's `card.excerpt`); derived here as the first non-blank line of
 * `description`, further visually clamped by `line-clamp-2` below (mirrors
 * the reference's short one-line excerpt + line-clamp-2 safety net).
 */
function excerptOf(description: string): string {
  const line = description.split('\n').find((l) => l.trim().length > 0);
  return line?.trim() ?? '';
}

/**
 * F4 — the `runState` overlay (F0 spec §3.1: "se pinta como overlay...
 * nunca como columna/filtro"): spinner for `running`, check for `completed`,
 * cross for `failed`, nothing for `idle`. Exported so both this file's own
 * default (below) and BacklogCardModal.tsx's header can render the exact
 * same icon for the exact same runState, mirroring the existing
 * `formatCardDate` cross-import convention between these two files.
 */
const RUN_STATE_OVERLAY_CONFIG: Record<Exclude<BacklogRunState, 'idle'>, { icon: string; className: string; label: string }> = {
  running: { icon: 'Loader2', className: 'animate-spin text-amber-600', label: 'Running' },
  completed: { icon: 'CheckCircle', className: 'text-emerald-600', label: 'Completed' },
  failed: { icon: 'XCircle', className: 'text-red-600', label: 'Failed' },
};

export function runStateOverlayIcon(runState: BacklogRunState): React.ReactNode {
  if (runState === 'idle') return null;
  const cfg = RUN_STATE_OVERLAY_CONFIG[runState];
  return (
    <span
      data-testid="run-state-overlay"
      data-run-state={runState}
      title={cfg.label}
      aria-label={cfg.label}
      className={`inline-flex items-center justify-center ${cfg.className}`}
    >
      <LucideIcon name={cfg.icon} size={16} strokeWidth={2.5} />
    </span>
  );
}

export interface BacklogCardItemProps {
  card: BacklogCard;
  onOpen: () => void;
  isSelected: boolean;
  onSelect: (filename: string, event: React.MouseEvent) => void;
  /**
   * F4 write-back overlay slot (spinner/check/cross next to the
   * StatusShape). Optional explicit override — when omitted (the normal
   * case), the render below falls back to `runStateOverlayIcon(card.runState)`
   * so the pile always reflects the card's live runState with zero extra
   * wiring from callers.
   */
  runStateOverlay?: React.ReactNode;
}

export function BacklogCardItem({ card, onOpen, isSelected, onSelect, runStateOverlay }: BacklogCardItemProps) {
  const statusObj = STATUS_CONFIG[card.status];
  const priorityInfo = PRIORITY_CONFIG[card.priority] ?? PRIORITY_CONFIG.medium;

  // F3 launchers — see launchActions.ts for the actual orchestration (zero
  // new materializer: runFrameWithContext / assemblePipeline+
  // insertPipelineAssembly+runFromStep, both already-existing seams).
  const mentalNodes = useDesktopStore((s) => s.mentalNodes);
  const activeBacklogDir = useDesktopStore((s) => s.activeBacklogDir);
  const frames = useMemo(
    () => mentalNodes.filter(isFrameGraphNode).map((f) => ({ id: f.id, title: f.data.title })),
    [mentalNodes],
  );
  // Bound once — see LaunchMenu.tsx's own comment on why a locally-bound
  // const (not a re-evaluated `card.epic` read) is what survives narrowing
  // into a closure.
  const epic = card.epic;

  return (
    <div
      data-testid="backlog-card"
      data-filename={card.filename}
      role="listitem"
      aria-label={`Task: ${card.title}`}
      aria-selected={isSelected}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) {
          e.stopPropagation();
          onSelect(card.filename, e);
        } else {
          onOpen();
        }
      }}
      className={`group bg-white border border-black rounded-3xl p-5 sm:p-6 flex flex-col sm:flex-row gap-4 sm:gap-6 cursor-pointer transition-all duration-200 hover:-translate-y-1 hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] ${isSelected ? 'ring-2 ring-offset-2 ring-blue-500' : ''}`}
    >
      {/* Info block - Left Side */}
      <div className="flex sm:flex-col justify-between sm:justify-start items-center sm:w-20 shrink-0 gap-4 sm:border-r border-black/10 sm:pr-4">
        <span className="text-xs font-black bg-black text-white px-2 py-1 rounded uppercase tracking-wider">
          {card.taskId}
        </span>

        <div className="flex flex-row sm:flex-col items-center gap-3">
          {/* Priority Indicator */}
          <div title={priorityInfo.label} className={`flex justify-center items-center ${priorityInfo.color}`}>
            <LucideIcon name={priorityInfo.icon} size={24} strokeWidth={3} />
          </div>
          {/* Estimate Block */}
          <div className="bg-neutral-100 border border-black/20 w-12 h-12 flex flex-col items-center justify-center rounded-xl">
            <span className="text-lg font-black leading-none">{card.estimate}</span>
            <span className="text-[9px] font-extrabold text-neutral-500 uppercase">Horas</span>
          </div>
        </div>
      </div>

      {/* Main Content - Center */}
      <div className="flex-1 flex flex-col justify-center min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          {/* Status Shape (outside the badge) */}
          <StatusShape sides={statusObj.sides} className="w-5 h-5" fillClass={statusObj.fillClass} strokeClass={statusObj.strokeClass} />
          {runStateOverlay ?? runStateOverlayIcon(card.runState)}

          {/* Status Badge */}
          <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-[10px] font-extrabold uppercase ${statusObj.colorClass}`}>
            <LucideIcon name={statusObj.icon} size={14} strokeWidth={2.5} />
            {statusObj.label}
          </div>
          <EpicBadge epic={card.epic} />

          <div className="ml-auto">
            <LaunchMenu
              card={card}
              frames={frames}
              onLaunchExisting={(frameId) => { void launchExistingFlow(card, frameId, activeBacklogDir); }}
              onLaunchAutoflow={() => { void launchAutoflow(card, activeBacklogDir); }}
              onLaunchEpic={epic ? () => { void launchEpicFlow(epic, activeBacklogDir); } : undefined}
            />
          </div>
        </div>

        <h3 className="text-lg sm:text-xl font-black text-black leading-tight mb-2 truncate group-hover:whitespace-normal group-hover:overflow-visible group-hover:line-clamp-none line-clamp-1">{card.title}</h3>
        <p className="text-sm text-black/70 font-bold line-clamp-2">{excerptOf(card.description)}</p>

        {card.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-4">
            {card.tags.map((tag) => (
              <span key={tag} className="text-[10px] font-extrabold text-neutral-500 bg-neutral-100 px-2 py-1 rounded uppercase tracking-wider">
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Metadata - Right Side (desktop) */}
      <div className="hidden sm:flex flex-col justify-between items-end shrink-0 w-32 border-l border-black/10 pl-4">
        <div className="flex flex-col items-end gap-1 opacity-40 group-hover:opacity-100 transition-opacity">
          <span className="text-[9px] font-extrabold uppercase">Creado: {formatCardDate(card.createdAt)}</span>
          <span className="w-4 h-[1px] bg-black"></span>
          <span className="text-[9px] font-extrabold uppercase">Act: {formatCardDate(card.updatedAt)}</span>
        </div>
      </div>

      {/* Mobile Metadata */}
      <div className="flex sm:hidden justify-between items-center pt-3 border-t border-black/10 mt-2 opacity-50">
        <span className="text-[9px] font-extrabold uppercase">Cr: {formatCardDate(card.createdAt)}</span>
        <span className="w-1 h-1 bg-black rounded-full"></span>
        <span className="text-[9px] font-extrabold uppercase">Act: {formatCardDate(card.updatedAt)}</span>
      </div>
    </div>
  );
}
