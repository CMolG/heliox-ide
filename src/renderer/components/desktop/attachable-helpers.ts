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
import type { MarketInventory, MarketMod, MarketRole } from '@/types/market';

export function kebabToTitle(str: string): string {
  return str.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function resolveMarketItem(attachable: DesktopAttachable, inventory: MarketInventory | null) {
  if (!inventory) return null;
  if (attachable.type === 'role') return inventory.roles.find(r => r.name === attachable.name) ?? null;
  if (attachable.type === 'mod') return inventory.mods.find(m => m.name === attachable.name) ?? null;
  if (attachable.type === 'flow') return inventory.flows.find(f => f.name === attachable.name) ?? null;
  if (attachable.type === 'step') return inventory.steps?.find(s => s.name === attachable.name) ?? null;
  return null;
}

/**
 * Non-blocking "domain hint" for a mod being attached to a step. Both the
 * mod and the step's already-assigned role are informational — see the
 * `MarketDomain` doc comment in `types/market.ts` — so this is never a hard
 * rejection, only a same-turn heads-up that the combination may be
 * irrelevant. Returns the ready-to-render message, or `null` when there is
 * nothing to warn about:
 * - the step has no role attached yet,
 * - either side omits `domains`, or
 * - either side declares itself `universal` (role-agnostic), or
 * - the mod's and role's domains intersect.
 */
export function domainMismatchHint(mod: MarketMod, role: MarketRole | null): string | null {
  if (!role) return null;
  const modDomains = mod.domains;
  const roleDomains = role.domains;
  if (!modDomains?.length || modDomains.includes('universal')) return null;
  if (!roleDomains?.length || roleDomains.includes('universal')) return null;
  if (modDomains.some((domain) => roleDomains.includes(domain))) return null;
  return `"${mod.name}" targets ${modDomains.join(', ')}; the attached role "${role.name}" covers ${roleDomains.join(', ')}. Attached anyway — it may be irrelevant here.`;
}

// ─── Role / Mod eligibility (shared by StepConfigCore and StepQuickAddPopover) ───
//
// Both surfaces offer the same two atom pickers (a full picker in the Step
// Config surface, a faster searchable one in the quick-add popover) and must
// reject the same combinations the same way. These were previously two
// hand-synced copies of the same predicates and message strings; this is now
// their single shared source.

/**
 * True when `a` and `b` are mutually incompatible — either declares the
 * other's name in its `incompatibleWith` list. Order-independent: callers
 * don't need to know which side (if either) declared the incompatibility.
 */
export function isModIncompatibleWith(a: MarketMod, b: MarketMod): boolean {
  return Boolean(a.incompatibleWith?.includes(b.name) || b.incompatibleWith?.includes(a.name));
}

/**
 * Roles available to attach to a step: every marketplace role except the
 * one already assigned. Roles are mutually exclusive — one per step — so
 * `attachedRole` is a single value (or `null` when none is assigned yet),
 * not a list.
 */
export function filterAvailableRoles(roles: MarketRole[], attachedRole: MarketRole | null): MarketRole[] {
  return roles.filter((role) => role.name !== attachedRole?.name);
}

/**
 * Mods available to attach to a step: every marketplace mod except those
 * already attached, and those incompatible (either direction) with one
 * that's already attached. Mods are stackable, so — unlike roles —
 * `attachedMods` may hold more than one entry.
 */
export function filterAvailableMods(mods: MarketMod[], attachedMods: MarketMod[]): MarketMod[] {
  return mods.filter((mod) => {
    if (attachedMods.some((assigned) => assigned.name === mod.name)) return false;
    return !attachedMods.some((assigned) => isModIncompatibleWith(assigned, mod));
  });
}

/**
 * Rejection message for a failed `addRoleToStep` call. `roleLabel` is the
 * already-`kebabToTitle`-formatted role name.
 */
export function roleAttachRejectedMessage(roleLabel: string): string {
  return `"${roleLabel}" could not be attached.`;
}

/**
 * Rejection message for a failed `addModToStep` call. `modLabel` is the
 * already-`kebabToTitle`-formatted mod name.
 */
export function modAttachRejectedMessage(modLabel: string): string {
  return `"${modLabel}" was rejected — it may already be on this step or incompatible with one that is.`;
}
