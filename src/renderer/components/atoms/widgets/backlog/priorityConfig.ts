/**
 * priorityConfig.ts — priority chevron/label/color config for the backlog
 * bento pile (F2 Task 2).
 *
 * Ported from the frozen reference's PRIORITY_CONFIG
 * (docs/superpowers/specs/2026-07-08-backlog-bento-reference.tsx:72-78) —
 * same 5 keys, same `ChevronsUp/ChevronUp/Minus/ChevronDown/ChevronsDown`
 * icons, same colors. `icon` is a LucideIcon name string — see
 * statusConfig.ts's module doc for why (no `lucide-react` dependency here).
 *
 * `label` is NOT ported verbatim (reference's Spanish 'Crítica'/'Alta'/
 * 'Media'/'Baja'/'Muy Baja') — same task doc resolved decision #2 as
 * statusConfig.ts (EN labels by default, IDE consistency).
 */
import type { BacklogPriority } from '@/types/market';

export interface PriorityConfigEntry {
  id: BacklogPriority;
  label: string;
  /** LucideIcon name (see module doc). */
  icon: string;
  color: string;
}

export const PRIORITY_CONFIG: Record<BacklogPriority, PriorityConfigEntry> = {
  superHigh: { id: 'superHigh', label: 'Critical', icon: 'ChevronsUp', color: 'text-red-500' },
  high: { id: 'high', label: 'High', icon: 'ChevronUp', color: 'text-orange-500' },
  medium: { id: 'medium', label: 'Medium', icon: 'Minus', color: 'text-yellow-500' },
  low: { id: 'low', label: 'Low', icon: 'ChevronDown', color: 'text-blue-500' },
  superLow: { id: 'superLow', label: 'Very Low', icon: 'ChevronsDown', color: 'text-cyan-400' },
};
