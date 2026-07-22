/**
 * statusConfig.ts — status polygon/label/color config for the backlog bento
 * pile (F2 Task 2).
 *
 * Ported from the frozen reference's STATUS_CONFIG
 * (docs/superpowers/specs/2026-07-08-backlog-bento-reference.tsx:27-70) —
 * same 6 keys, same `order`/`sides`/`colorClass`/`fillClass`/`strokeClass`
 * values, same icon SET (Rocket/Eye/Code2/Box/PlayCircle/ListTodo). `icon`
 * is a `LucideIcon` name string rather than a `lucide-react` component
 * reference — this project has no `lucide-react` dependency, only
 * `react-icons` behind the shared `LucideIcon` wrapper
 * (src/renderer/components/desktop/LucideIcon.tsx); same icon, different
 * access mechanism, per the plan's own Task 2 note ("mapped through the
 * project's LucideIcon").
 *
 * `label` is NOT ported verbatim (the reference's Spanish 'Desplegar' /
 * 'Revisar' / 'En Desarrollo' / 'Por Desarrollar' / 'Por Iniciar' /
 * 'Refinar') — task doc resolved decision #2
 * (docs/superpowers/backlog/2026-07-08-backlog-bento-redesign-launchers.md,
 * "Idioma de labels — RESUELTA"): stable ids + EN labels by default (IDE
 * consistency), centralized once in this table. Shape/order/color are
 * unchanged from the mockup.
 */
import type { BacklogStatus } from '@/types/market';

export interface StatusConfigEntry {
  id: BacklogStatus;
  label: string;
  order: number;
  sides: number;
  /** LucideIcon name (see module doc — not a lucide-react component ref). */
  icon: string;
  colorClass: string;
  fillClass: string;
  strokeClass: string;
}

export const STATUS_CONFIG: Record<BacklogStatus, StatusConfigEntry> = {
  deploy: {
    id: 'deploy', label: 'Deploy', order: 1, sides: 7,
    icon: 'Rocket',
    colorClass: 'bg-blue-100 text-blue-900 border-blue-300',
    fillClass: 'fill-blue-100',
    strokeClass: 'stroke-blue-500',
  },
  review: {
    id: 'review', label: 'Review', order: 2, sides: 6,
    icon: 'Eye',
    colorClass: 'bg-purple-100 text-purple-900 border-purple-300',
    fillClass: 'fill-purple-100',
    strokeClass: 'stroke-purple-500',
  },
  doing: {
    id: 'doing', label: 'In Progress', order: 3, sides: 5,
    icon: 'Code2',
    colorClass: 'bg-amber-100 text-amber-900 border-amber-300',
    fillClass: 'fill-amber-100',
    strokeClass: 'stroke-amber-500',
  },
  ready: {
    id: 'ready', label: 'Ready', order: 4, sides: 4,
    icon: 'Box',
    colorClass: 'bg-emerald-100 text-emerald-900 border-emerald-300',
    fillClass: 'fill-emerald-100',
    strokeClass: 'stroke-emerald-500',
  },
  todo: {
    id: 'todo', label: 'To Do', order: 5, sides: 3,
    icon: 'PlayCircle',
    colorClass: 'bg-pink-100 text-pink-900 border-pink-300',
    fillClass: 'fill-pink-100',
    strokeClass: 'stroke-pink-500',
  },
  refine: {
    id: 'refine', label: 'Refine', order: 6, sides: 2,
    icon: 'ListTodo',
    colorClass: 'bg-neutral-200 text-neutral-900 border-neutral-400',
    fillClass: 'fill-neutral-200',
    strokeClass: 'stroke-neutral-500',
  },
};

/** Status entries sorted by workflow `order` (mirrors the reference's own `.sort()` at render time, :583-584). */
export function statusEntriesByOrder(): StatusConfigEntry[] {
  return Object.values(STATUS_CONFIG).sort((a, b) => a.order - b.order);
}
