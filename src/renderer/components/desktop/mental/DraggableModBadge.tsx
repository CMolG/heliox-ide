/**
 * DraggableModBadge.tsx — dnd-kit test atom for StepNode drops
 *
 * Responsibility:
 * - Provides a small draggable Role/Mod badge for the Phase 1 harness dock.
 * - Sends full market item data in active.data so drop handlers can update
 *   StepNode data without IPC or additional lookup work.
 */
import React, { useCallback } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { DraggableSyntheticListeners } from '@dnd-kit/core';
import type { MarketMod, MarketRole } from '@/types/market';
import { LucideIcon } from '../LucideIcon';
import { kebabToTitle } from '../attachable-helpers';

type DraggableAtom =
  | { atomType: 'mod'; item: MarketMod }
  | { atomType: 'role'; item: MarketRole };

type DraggableModBadgeProps = DraggableAtom & {
  id?: string;
};

function getAccent(atom: DraggableAtom): string {
  if (atom.atomType === 'role') {
    const color = atom.item.color;
    return color?.startsWith('#') ? color : color ? `#${color}` : '#E87040';
  }
  return '#4285F4';
}

function getPointerDownHandler(
  listeners: DraggableSyntheticListeners | undefined,
): React.PointerEventHandler<HTMLButtonElement> {
  return (event) => {
    event.stopPropagation();
    listeners?.onPointerDown?.(event);
  };
}

export function DraggableModBadge(props: DraggableModBadgeProps) {
  const { atomType, item } = props;
  const dragId = props.id ?? `harness-${atomType}-${item.name}`;
  const accent = getAccent(props);

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: dragId,
    data: {
      type: atomType,
      name: item.name,
      mod: atomType === 'mod' ? item : undefined,
      role: atomType === 'role' ? item : undefined,
      source: 'step-harness-dock',
    },
  });

  const handlePointerDown = getPointerDownHandler(listeners);
  const stopMouseDown = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
  }, []);

  return (
    <button
      ref={setNodeRef}
      type="button"
      className={`draggable-mod-badge${isDragging ? ' is-dragging' : ''}`}
      style={{
        transform: CSS.Translate.toString(transform),
        ['--draggable-mod-accent' as string]: accent,
      }}
      data-testid={`${atomType === 'mod' ? 'draggable-mod-badge' : 'draggable-role-badge'}-${item.name}`}
      aria-label={`Drag ${atomType} ${kebabToTitle(item.name)}`}
      onMouseDown={stopMouseDown}
      {...attributes}
      {...listeners}
      onPointerDown={handlePointerDown}
    >
      <LucideIcon name={atomType === 'mod' ? 'Wrench' : 'User'} size={13} />
      <span>{kebabToTitle(item.name)}</span>
    </button>
  );
}
