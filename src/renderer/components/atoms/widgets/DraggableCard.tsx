/**
 * DraggableCard.tsx — Renderer Widget Component
 *
 * Responsibility:
 * - Renders the DraggableCard surface in the renderer layer.
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
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { FlowDeckCard } from './FlowDeckCard';
import { LucideIcon } from '@/renderer/components/desktop/LucideIcon';
import type { BacklogCard } from '@/types/market';

export function DraggableCard({
  card,
  expanded,
  onToggle,
  onOpenModal,
  onExecute,
  finiteFlows,
  isAnimating,
  laneName,
  isSelected,
  onSelect,
}: {
  card: BacklogCard;
  expanded: boolean;
  onToggle: () => void;
  onOpenModal: () => void;
  onExecute: () => void;
  finiteFlows: { name: string; description: string }[];
  isAnimating: boolean;
  laneName: string;
  isSelected: boolean;
  onSelect: (filename: string, event: React.MouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.filename,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? undefined,
    opacity: isDragging ? 0.4 : 1,
  };

  const className = [
    'fd-card-draggable',
    isAnimating ? 'backlog-card-animate-in' : '',
  ].filter(Boolean).join(' ');

  return (
    <div ref={setNodeRef} style={style} className={className}>
      <div className="fd-drag-handle" {...attributes} {...listeners}>
        <LucideIcon name="GripVertical" size={12} />
      </div>
      <FlowDeckCard
        card={card}
        expanded={expanded}
        onToggle={onToggle}
        onOpenModal={onOpenModal}
        onExecute={onExecute}
        finiteFlows={finiteFlows}
        laneName={laneName}
        isSelected={isSelected}
        onSelect={onSelect}
      />
    </div>
  );
}
