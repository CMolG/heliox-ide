/**
 * attachable-helpers.ts — Renderer Attachable Support Module
 *
 * Responsibility:
 * - Provides shared formatting and lookup helpers for desktop attachable entities.
 * - Resolves attachable references against marketplace inventory snapshots.
 *
 * Boundaries:
 * - Owns: attachable label formatting and inventory item resolution helpers
 * - Does NOT own: attachable state mutations, marketplace persistence, or UI rendering lifecycle
 *
 * Architectural role:
 * - Pure renderer support logic module consumed by desktop attachable components.
 */
// src/renderer/components/desktop/attachable-helpers.ts — Shared helpers for attachable components
import type { DesktopAttachable } from '@/types/desktop';
import type { MarketInventory } from '@/types/market';

export function kebabToTitle(str: string): string {
  return str.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function resolveMarketItem(attachable: DesktopAttachable, inventory: MarketInventory | null) {
  if (!inventory) return null;
  if (attachable.type === 'role') return inventory.roles.find(r => r.name === attachable.name) ?? null;
  if (attachable.type === 'mod') return inventory.mods.find(m => m.name === attachable.name) ?? null;
  if (attachable.type === 'flow') return inventory.flows.find(f => f.name === attachable.name) ?? null;
  return null;
}
