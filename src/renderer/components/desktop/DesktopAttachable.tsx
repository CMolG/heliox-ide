/**
 * DesktopAttachable.tsx — Renderer Desktop Surface Component
 *
 * Responsibility:
 * - Renders the DesktopAttachable surface in the renderer layer.
 * - Encapsulates Desktop canvas/window composition within the renderer workspace.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/desktop/DesktopAttachable.tsx — Draggable canvas item delegating to atom components
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
  'design-system': { color: '#10B981', icon: 'Palette', label: 'Design System' },
  mental: { color: '#A78BFA', icon: 'Shapes', label: 'Mental' },
};

// ─── Component ──────────────────────────────────────────────────

interface Props {
  attachable: AttachableT;
}

export function DesktopAttachable({ attachable }: Props) {
  const removeAttachable = useDesktopStore(s => s.removeAttachable);
  const marketInventory = useDesktopStore(s => s.marketInventory);
  const mentalMode = useDesktopStore(s => s.mentalMode);
  const setMentalLineSourceId = useDesktopStore(s => s.setMentalLineSourceId);
  const addMentalConnection = useDesktopStore(s => s.addMentalConnection);
  const mentalLineSourceId = useDesktopStore(s => s.mentalLineSourceId);

  const [hovered, setHovered] = useState(false);
  const [mentalContextMenu, setMentalContextMenu] = useState<{ x: number; y: number } | null>(null);

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
  const isMental = attachable.type === 'mental';
  const isMentalLineSource = isMental && mentalMode === 'lines' && mentalLineSourceId === attachable.id;

  // Width varies by type: flows are wider (richer content + badges)
  const cardWidth = attachable.type === 'flow' ? 280 : (attachable.type === 'mental' ? (attachable.mental?.width ?? 220) : 220);

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

  const shouldBlockMentalDragFromTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false;
    const noDragElement = target.closest('[data-mental-no-drag="true"]');
    if (!noDragElement) return false;
    return true;
  };

  return (
    <div
      ref={setNodeRef}
      style={containerStyle}
      data-testid={`desktop-attachable-${attachable.type}-${attachable.name}`}
      data-attachable-id={attachable.id}
      data-mental-line-source={isMentalLineSource || undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={(e) => {
        if (!isMental) return;
        e.preventDefault();
        e.stopPropagation();
        setMentalContextMenu({ x: e.clientX, y: e.clientY });
      }}
      onClick={(e) => {
        if (!isMental || mentalMode !== 'lines') return;
        if (mentalContextMenu) return;
        e.stopPropagation();
        if (mentalLineSourceId === null) {
          setMentalLineSourceId(attachable.id);
          return;
        }
        if (mentalLineSourceId === attachable.id) return;
        const created = addMentalConnection(mentalLineSourceId, attachable.id);
        if (created) {
          setMentalLineSourceId(null);
        }
      }}
      onPointerDownCapture={(e) => {
        if (!isMental || mentalMode !== 'shapes') return;
        if (shouldBlockMentalDragFromTarget(e.target)) {
          e.stopPropagation();
        }
      }}
      {...(isMental && mentalMode === 'lines' ? {} : listeners)}
      {...(isMental && mentalMode === 'lines' ? {} : attributes)}
    >
      <div style={{ position: 'relative' }}>
        {/* Close button (all non-mental attachables) */}
        {!isMental && (
          <button
            style={closeStyle}
            onClick={(e) => { e.stopPropagation(); removeAttachable(attachable.id); }}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={`Remove ${displayName} attachable`}
            data-testid={`attachable-close-${attachable.id}`}
          >
            <LucideIcon name="X" size={10} />
          </button>
        )}

        {/* Delegate to the type-specific atom component */}
        <AttachableContent attachable={attachable} marketItem={marketItem} />
      </div>
      {isMental && mentalContextMenu && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 10002 }}
          onClick={() => setMentalContextMenu(null)}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div
            style={{
              position: 'absolute',
              left: mentalContextMenu.x,
              top: mentalContextMenu.y,
              minWidth: 130,
              padding: 6,
              borderRadius: 8,
              background: 'rgba(20, 20, 20, 0.95)',
              border: '1px solid rgba(255, 255, 255, 0.14)',
              boxShadow: '0 8px 20px rgba(0,0,0,0.35)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              style={{
                width: '100%',
                border: 'none',
                borderRadius: 6,
                background: 'transparent',
                color: '#f4f4f5',
                fontSize: 12,
                textAlign: 'left',
                padding: '6px 8px',
              }}
              onClick={() => {
                removeAttachable(attachable.id);
                setMentalContextMenu(null);
              }}
              data-testid={`mental-card-delete-${attachable.id}`}
            >
              Delete card
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
