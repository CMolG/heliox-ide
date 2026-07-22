/**
 * EpicBadge.tsx — the "Epic: X" pill on a backlog card. Ported verbatim from
 * the frozen reference
 * (docs/superpowers/specs/2026-07-08-backlog-bento-reference.tsx:667-671).
 * Renders null when `epic` is absent (matches the reference's `card.epic &&`
 * guard — F0 spec §1.1).
 */
import React from 'react';

export function EpicBadge({ epic }: { epic?: string }) {
  if (!epic) return null;
  return (
    <span className="px-3 py-1 bg-neutral-100 text-neutral-600 border border-neutral-200 rounded-full text-[10px] font-extrabold uppercase truncate max-w-[120px]">
      Epic: {epic}
    </span>
  );
}
