/**
 * AttachableOverlayCard.tsx — Renderer Desktop Surface Component
 *
 * Responsibility:
 * - Renders the AttachableOverlayCard surface in the renderer layer.
 * - Encapsulates Desktop canvas/window composition within the renderer workspace.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/desktop/AttachableOverlayCard.tsx — Overlay card rendered inside DragOverlay
import React from 'react';
import { useDesktopStore } from '../../store/desktop-store';
import { AttachableContent } from './AttachableContent';
import { resolveMarketItem } from './attachable-helpers';
import type { DesktopAttachable as AttachableT } from '@/types/desktop';

interface Props {
  attachable: AttachableT;
}

export function AttachableOverlayCard({ attachable }: Props) {
  const marketInventory = useDesktopStore(s => s.marketInventory);
  const marketItem = resolveMarketItem(attachable, marketInventory);
  const cardWidth = attachable.type === 'flow' ? 280 : 220;

  return (
    <div style={{
      width: cardWidth, cursor: 'grabbing', pointerEvents: 'none',
      filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.5))',
    }}>
      <AttachableContent attachable={attachable} marketItem={marketItem} />
    </div>
  );
}
