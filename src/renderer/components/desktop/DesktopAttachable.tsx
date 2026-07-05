/**
 * DesktopAttachable.tsx — Renderer Desktop Surface Component
 *
 * Responsibility:
 * - Renders a draggable canvas item for the AttachableType variants
 *   (role / mod / flow).
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport,
 *   or main-process orchestration. Mental nodes are NOT attachables — they
 *   live in the xyflow surface (see mental/MentalGraphCanvas).
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
import React, { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { useDesktopStore } from '../../store/desktop-store';
import { LucideIcon } from './LucideIcon';
import { AttachableContent } from './AttachableContent';
import type { DesktopAttachable as AttachableT, AttachableType } from '@/types/desktop';
import { kebabToTitle, resolveMarketItem } from './attachable-helpers';
import { theme } from '../../logic/theme';

// Re-export helpers so existing consumers keep working
export { kebabToTitle } from './attachable-helpers';
export { AttachableOverlayCard } from './AttachableOverlayCard';

// ─── Type colors/icons (re-exported for DesktopWindow, WindowNavigator) ─

export const TYPE_META: Record<AttachableType, { color: string; icon: string; label: string }> = {
  role: { color: '#E87040', icon: 'User', label: 'Role' },
  mod: { color: '#4285F4', icon: 'Wrench', label: 'Mod' },
  flow: { color: '#A78BFA', icon: 'Route', label: 'Flow' },
  step: { color: '#2BB673', icon: 'ListChecks', label: 'Step' },
};

// ─── Component ──────────────────────────────────────────────────

interface Props {
  attachable: AttachableT;
}

export function DesktopAttachable({ attachable }: Props) {
  const removeAttachable = useDesktopStore(s => s.removeAttachable);
  const marketInventory = useDesktopStore(s => s.marketInventory);

  const [hovered, setHovered] = useState(false);

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: attachable.id,
    data: {
      type: attachable.type,
      name: attachable.name,
      attachableId: attachable.id,
    },
  });

  const marketItem = resolveMarketItem(attachable, marketInventory);
  const displayName = kebabToTitle(attachable.name);

  // Width varies by type: flows are wider (richer content + badges)
  const cardWidth = attachable.type === 'flow' ? 280 : 220;

  const containerStyle: React.CSSProperties = {
    position: 'absolute',
    left: attachable.position.x,
    top: attachable.position.y,
    width: cardWidth,
    pointerEvents: 'auto',
    zIndex: attachable.zIndex ?? 5,
    cursor: isDragging ? 'grabbing' : 'grab',
    transition: isDragging ? 'none' : 'box-shadow 0.2s ease',
    opacity: isDragging ? 0.3 : 1,
  };

  const closeStyle: React.CSSProperties = {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 18,
    height: 18,
    borderRadius: '50%',
    background: theme.surfaceHover,
    border: `1px solid ${theme.borderMedium}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    opacity: hovered ? 1 : 0,
    transition: 'opacity 0.15s ease',
    zIndex: 2,
  };

  return (
    <div
      ref={setNodeRef}
      style={containerStyle}
      data-testid={`desktop-attachable-${attachable.type}-${attachable.name}`}
      data-attachable-id={attachable.id}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      {...listeners}
      {...attributes}
    >
      <div style={{ position: 'relative' }}>
        <button
          style={closeStyle}
          onClick={(e) => { e.stopPropagation(); removeAttachable(attachable.id); }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={`Remove ${displayName} attachable`}
          data-testid={`attachable-close-${attachable.id}`}
        >
          <LucideIcon name="X" size={10} />
        </button>

        {/* Delegate to the type-specific atom component */}
        <AttachableContent attachable={attachable} marketItem={marketItem} />
      </div>
    </div>
  );
}
