/**
 * BacklogPile.tsx — the single flat, sortable pile (F2 Task 6).
 *
 * Layout/empty-state ported verbatim from the frozen reference
 * (docs/superpowers/specs/2026-07-08-backlog-bento-reference.tsx:610-707,
 * plus the `filteredAndSortedCards` useMemo at :221-236). Sort = by
 * `STATUS_CONFIG[status].order` primary, `card.order` secondary (F0 spec
 * §1.1's `order`-is-a-tiebreaker-within-status note — the reference itself
 * has no secondary key since its mock cards have no persisted `order`
 * field).
 *
 * DnD behavior layer reconstructed from the deleted
 * `atoms/widgets/BacklogKanbanWidget.tsx` (git history, commit a0e6e657) —
 * PointerSensor+KeyboardSensor sensors, multi-select (meta/ctrl toggle,
 * shift range within the same status), reorder persisted via
 * `window.fluxorAPI.updateBacklogCards` — now flattened to one pile: a drop
 * only ever reassigns a dense, global `order` across every card (mirrors
 * the reference's own `handleDrop`, which splices the FULL `cards` array by
 * id, never touching `statusId`/`status`). Native HTML5 DnD → `@dnd-kit`
 * (Gate 1's allowed deviation #3) — the reference's "whole card is
 * draggable" look is preserved by attaching the sortable listeners to a
 * thin, unstyled wrapper around `BacklogCardItem` rather than adding a
 * visible grip handle (the reference has none).
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter,
} from '@dnd-kit/core';
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDesktopStore } from '@/renderer/store/desktop-store';
import { STATUS_CONFIG } from './statusConfig';
import { BacklogCardItem } from './BacklogCardItem';
import type { BacklogCard, BacklogStatus } from '@/types/market';

export interface BacklogPileProps {
  /** Full (unfiltered) card set for the currently-open backlog. */
  cards?: BacklogCard[];
  searchTerm: string;
  activeStatuses: BacklogStatus[];
  /** Directory backing the open backlog — used to persist reorders via `updateBacklogCards`. */
  backlogDir: string;
}

/**
 * Pure reorder core — splices `draggedFilenames` (as a contiguous,
 * order-preserved batch) out of `allCards` and reinserts them immediately
 * before `targetFilename`'s post-removal position, then reassigns a dense
 * global `order` (0..N-1) to the WHOLE resulting array. Mirrors the frozen
 * reference's own splice-based `handleDrop` (operates on the FULL array by
 * id, not a filtered/status-scoped subset), extended to move a
 * multi-selection together (ported behavior from the deleted
 * BacklogKanbanWidget.tsx's handleDragEnd). `status` is NEVER touched — a
 * card's status only changes via the modal/launcher/human edit, never via
 * drag reorder (this is why cross-status drops visually "snap back": the
 * status-first sort always re-groups on the next render, exactly matching
 * the reference's own stable-sort behavior).
 */
export function reorderBacklogCards(
  allCards: BacklogCard[],
  draggedFilenames: string[],
  targetFilename: string,
): BacklogCard[] {
  const draggedSet = new Set(draggedFilenames);
  const dragged = allCards.filter((c) => draggedSet.has(c.filename));
  const rest = allCards.filter((c) => !draggedSet.has(c.filename));
  const targetIdx = rest.findIndex((c) => c.filename === targetFilename);
  const insertAt = targetIdx === -1 ? rest.length : targetIdx;
  rest.splice(insertAt, 0, ...dragged);
  return rest.map((c, i) => ({ ...c, order: i }));
}

function SortableCard({
  card, isSelected, onOpen, onSelect,
}: {
  card: BacklogCard;
  isSelected: boolean;
  onOpen: () => void;
  onSelect: (filename: string, event: React.MouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.filename });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? undefined,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <BacklogCardItem card={card} isSelected={isSelected} onOpen={onOpen} onSelect={onSelect} />
    </div>
  );
}

export function BacklogPile({ cards, searchTerm, activeStatuses, backlogDir }: BacklogPileProps) {
  const storeBacklogCards = useDesktopStore((s) => s.backlogCards);
  const setBacklogCards = useDesktopStore((s) => s.setBacklogCards);
  const openCanvasModal = useDesktopStore((s) => s.openCanvasModal);
  const backlogCards = cards ?? storeBacklogCards;

  const [selectedFilenames, setSelectedFilenames] = useState<Set<string>>(new Set());
  const [activeFilename, setActiveFilename] = useState<string | null>(null);
  const lastClickedRef = useRef<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const filteredAndSortedCards = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return backlogCards
      .filter((card) => {
        const matchesSearch =
          card.title.toLowerCase().includes(term) ||
          card.description.toLowerCase().includes(term) ||
          card.tags.some((t) => t.toLowerCase().includes(term));
        const matchesStatus = activeStatuses.includes(card.status);
        return matchesSearch && matchesStatus;
      })
      .sort((a, b) => {
        const orderA = STATUS_CONFIG[a.status].order;
        const orderB = STATUS_CONFIG[b.status].order;
        if (orderA !== orderB) return orderA - orderB;
        return a.order - b.order;
      });
  }, [backlogCards, searchTerm, activeStatuses]);

  const activeCard = activeFilename ? backlogCards.find((c) => c.filename === activeFilename) ?? null : null;

  const handleCardSelect = useCallback((filename: string, event: React.MouseEvent) => {
    if (event.metaKey || event.ctrlKey) {
      setSelectedFilenames((prev) => {
        const next = new Set(prev);
        if (next.has(filename)) next.delete(filename); else next.add(filename);
        return next;
      });
      lastClickedRef.current = filename;
    } else if (event.shiftKey && lastClickedRef.current) {
      const lastCard = backlogCards.find((c) => c.filename === lastClickedRef.current);
      const curCard = backlogCards.find((c) => c.filename === filename);
      if (lastCard && curCard && lastCard.status === curCard.status) {
        const sameStatusCards = backlogCards.filter((c) => c.status === curCard.status).sort((a, b) => a.order - b.order);
        const lastIdx = sameStatusCards.findIndex((c) => c.filename === lastClickedRef.current);
        const curIdx = sameStatusCards.findIndex((c) => c.filename === filename);
        const [from, to] = lastIdx < curIdx ? [lastIdx, curIdx] : [curIdx, lastIdx];
        setSelectedFilenames((prev) => {
          const next = new Set(prev);
          for (let i = from; i <= to; i++) next.add(sameStatusCards[i].filename);
          return next;
        });
      }
    }
  }, [backlogCards]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const id = event.active.id as string;
    setActiveFilename(id);
    if (!selectedFilenames.has(id)) setSelectedFilenames(new Set());
  }, [selectedFilenames]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveFilename(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const draggedFilename = active.id as string;
    const targetFilename = over.id as string;
    const draggedFilenames = selectedFilenames.has(draggedFilename) && selectedFilenames.size > 1
      ? Array.from(selectedFilenames)
      : [draggedFilename];

    const reindexed = reorderBacklogCards(backlogCards, draggedFilenames, targetFilename);
    const prevCards = backlogCards;
    setBacklogCards(reindexed);
    setSelectedFilenames(new Set());

    const updates = reindexed.map((c, i) => ({ filename: c.filename, order: i }));
    void window.fluxorAPI?.updateBacklogCards(backlogDir, updates).catch(() => {
      setBacklogCards(prevCards);
    });
  }, [backlogCards, selectedFilenames, setBacklogCards, backlogDir]);

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="w-full max-w-4xl flex flex-col gap-4 relative pb-20" data-testid="backlog-pile" role="list" aria-label="Backlog cards">
        {filteredAndSortedCards.length === 0 ? (
          <div className="text-center py-20 bg-white border border-dashed border-black rounded-3xl" data-testid="backlog-pile-empty">
            <p className="text-neutral-500 font-extrabold uppercase tracking-widest text-sm">No hay tarjetas que coincidan con los filtros.</p>
          </div>
        ) : (
          <SortableContext items={filteredAndSortedCards.map((c) => c.filename)} strategy={verticalListSortingStrategy}>
            {filteredAndSortedCards.map((card) => (
              <SortableCard
                key={card.filename}
                card={card}
                isSelected={selectedFilenames.has(card.filename)}
                onOpen={() => openCanvasModal(card)}
                onSelect={handleCardSelect}
              />
            ))}
          </SortableContext>
        )}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeCard ? (
          <BacklogCardItem card={activeCard} onOpen={() => {}} isSelected={false} onSelect={() => {}} />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
