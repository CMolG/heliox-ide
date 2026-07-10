/**
 * AttachableContent.tsx — Renderer Desktop Surface Component
 *
 * Responsibility:
 * - Renders the visual content of a canvas attachable (role / mod / flow)
 *   based on its matched market inventory entry.
 *
 * Boundaries:
 * - Owns: the type-dispatch and fallback chip rendering.
 * - Does NOT own: market lookups (passed in), drag wiring (DesktopAttachable),
 *   or mental graph rendering (lives in mental/MentalNode + MentalGraphCanvas
 *   — mental is no longer an attachable type).
 */
import React from 'react';
import { AttachableRole } from '../atoms/attachables/AttachableRole';
import { AttachableMod } from '../atoms/attachables/AttachableMod';
import type { DesktopAttachable as AttachableT } from '@/types/desktop';
import type { MarketRole, MarketMod, MarketFlow } from '@/types/market';
import { TYPE_META } from './DesktopAttachable';
import { kebabToTitle } from './attachable-helpers';
import { theme } from '../../logic/theme';

// AttachableFlow.tsx retired (chats→steps re-architecture, F0 decision 4,
// 2026-07-10): flows no longer spawn as a canvas attachable — the market
// copies a flow's steps straight onto the board as real, editable steps
// (see MarketplaceApp's "Add to board"). `attachable.type === 'flow'` can
// still be reached with a legacy persisted attachable (older saved boards),
// so it isn't removed from `AttachableType` — it just falls through to the
// generic chip below instead of a dedicated renderer.
export function AttachableContent({ attachable, marketItem }: { attachable: AttachableT; marketItem: MarketRole | MarketMod | MarketFlow | null }) {
  if (attachable.type === 'role' && marketItem) return <AttachableRole role={marketItem as MarketRole} />;
  if (attachable.type === 'mod' && marketItem) return <AttachableMod mod={marketItem as MarketMod} />;

  const meta = TYPE_META[attachable.type];
  return (
    <div style={{
      padding: '10px 12px', borderRadius: 10, background: theme.surfaceCard,
      border: `1.5px solid ${theme.borderLight}`, display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <span style={{ fontFamily: theme.fontGrotesk, fontSize: 13, fontWeight: 600, color: theme.textPrimary }}>
        {kebabToTitle(attachable.name)}
      </span>
      <span style={{
        fontFamily: theme.fontMono, fontSize: 9, padding: '1px 6px', borderRadius: 4,
        background: `${meta.color}15`, color: meta.color, border: `1px solid ${meta.color}30`,
      }}>{meta.label}</span>
    </div>
  );
}
