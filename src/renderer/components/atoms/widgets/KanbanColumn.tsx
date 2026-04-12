/**
 * KanbanColumn.tsx — Renderer Widget Component
 *
 * Responsibility:
 * - Renders the KanbanColumn surface in the renderer layer.
 * - Encapsulates Widget card/board behavior for dashboard-style interactions.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { DraggableCard } from './DraggableCard';
import type { BacklogCard, BacklogStatus } from '@/types/market';

export function KanbanColumn({
  column,
  cards,
  expandedCard,
  onToggleCard,
  onOpenModal,
  onExecute,
  finiteFlows,
  animatingCards,
  selectedCards,
  onSelect,
}: {
  column: { key: BacklogStatus; label: string; icon: string; color: string };
  cards: BacklogCard[];
  expandedCard: string | null;
  onToggleCard: (filename: string) => void;
  onOpenModal: (card: BacklogCard) => void;
  onExecute: (card: BacklogCard) => void;
  finiteFlows: { name: string; description: string }[];
  animatingCards: Set<string>;
  selectedCards: Set<string>;
  onSelect: (filename: string, event: React.MouseEvent) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key });
  const cardIds = cards.map(c => c.filename);

  return (
    <article
      ref={setNodeRef}
      className={`fd-lane ${isOver ? 'fd-drop-hint' : ''}`}
      data-lane={column.key}
      role="listitem"
      aria-label={`${column.label} column, ${cards.length} cards`}
    >
      {/* Lane header */}
      <header className="fd-laneTop">
        <div className="fd-laneTitle">
          <span className="fd-dot" style={{ background: column.color, boxShadow: `0 0 0 6px ${column.color}18` }} />
          <h2>{column.label}</h2>
        </div>
        <div className="fd-laneMeta">
          <span className="fd-count">{cards.length}</span>
        </div>
      </header>

      {/* Cards */}
      <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
        <div className="fd-laneBody" data-drop={column.key} role="list" aria-label={`${column.label} cards`}>
          {cards.map(card => (
            <DraggableCard
              key={card.filename}
              card={card}
              expanded={expandedCard === card.filename}
              onToggle={() => onToggleCard(card.filename)}
              onOpenModal={() => onOpenModal(card)}
              onExecute={() => onExecute(card)}
              finiteFlows={finiteFlows}
              isAnimating={animatingCards.has(card.filename)}
              laneName={column.key}
              isSelected={selectedCards.has(card.filename)}
              onSelect={onSelect}
            />
          ))}
        </div>
      </SortableContext>
    </article>
  );
}
