// Minimal cutover shell — fleshed out by F2 Task 9.
import React from 'react';
import { useDesktopStore } from '../../../../store/desktop-store';

export function BacklogCardModal() {
  const modalCard = useDesktopStore(s => s.canvasModalCard);
  const closeModal = useDesktopStore(s => s.closeCanvasModal);
  if (!modalCard) return null;
  return (
    <div data-testid="backlog-card-modal" onClick={closeModal}>
      <div onClick={(e) => e.stopPropagation()}>{modalCard.title}</div>
    </div>
  );
}
