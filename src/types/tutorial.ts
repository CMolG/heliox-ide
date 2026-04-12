/**
 * tutorial.ts — Shared types for the scenario-driven tutorial system.
 *
 * Covers the tutorial engine, per-scenario content, and persisted progress.
 */

// ─── Tutorial Scenario IDs ──────────────────────────────────────

export type TutorialScenarioId =
  | 'workspace'
  | 'roles'
  | 'mods'
  | 'flows'
  | 'chat'
  | 'file-explorer'
  | 'backlog'
  | 'marketplace'
  | 'design-system-editor'
  | 'diff-viewer'
  | 'file-viewer';

export const ALL_TUTORIAL_SCENARIOS: TutorialScenarioId[] = [
  'workspace',
  'roles',
  'mods',
  'flows',
  'chat',
  'file-explorer',
  'backlog',
  'marketplace',
  'design-system-editor',
  'diff-viewer',
  'file-viewer',
];

// ─── Tutorial Step ──────────────────────────────────────────────

export interface TutorialStep {
  /** CSS selector (data-testid preferred) for the target element */
  target: string;
  /** Bold heading shown in the brutalist card */
  title: string;
  /** Explanation body text */
  description: string;
  /** Tooltip position relative to the highlighted element */
  position: 'top' | 'bottom' | 'left' | 'right';
  /** Highlight a small centered region instead of the full element */
  highlightCenter?: boolean;
  /** Highlight the full viewport (for the canvas — avoids tiny cutout) */
  highlightViewport?: boolean;
}

// ─── Tutorial Scenario ──────────────────────────────────────────

export type TutorialCategory = 'workspace' | 'market' | 'apps';

export interface TutorialScenario {
  id: TutorialScenarioId;
  /** Human-readable name (displayed in settings / header) */
  label: string;
  /** Grouping category for settings UI */
  category: TutorialCategory;
  /** Accent color used in the brutalist card (comic palette) */
  accentColor: string;
  /** Short summary shown as subtitle */
  subtitle: string;
  /** Lucide/Md icon name for the card header (matches LucideIcon map) */
  iconName: string;
  /** Ordered tutorial steps */
  steps: TutorialStep[];
  /** Tags displayed as brutalist tag pills */
  tags: string[];
}

// ─── Persisted Tutorial Progress ────────────────────────────────

export type TutorialProgress = Partial<Record<TutorialScenarioId, boolean>>;
