// Minimal cutover shell — fleshed out by the remaining F2 tasks.
import React from 'react';

export function BacklogBentoWidget({ windowId }: { windowId: string }) {
  return (
    <div className="backlog-bento" role="region" aria-label="Backlog" data-window-id={windowId}>
      {/* BacklogFilters + BacklogPile land here in subsequent F2 tasks */}
    </div>
  );
}
