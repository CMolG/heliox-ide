/**
 * types.ts — AI Memory System
 *
 * Responsibility:
 * - Defines the data model for the agent memory system
 * - Memory signals capture approval/rejection decisions on backlog tasks
 * - MemoryEntry dimensions aggregate signals into learnable patterns
 * - NeuralExcitementProfile powers prompt-time preference injection
 *
 * Boundaries:
 * - Owns: type definitions only — no logic, no side effects
 * - Consumed by: MemoryLedger, SignalExtractor, NeuralExcitement, MemoryComposerPlugin
 */
import type { BacklogPriority } from '@/types/market';

// ─── Signal Polarity ─────────────────────────────────────────────

/** Whether a memory signal reinforces (positive) or inhibits (negative) a pattern */
export type MemoryPolarity = 'positive' | 'negative';

// ─── Memory Signal ───────────────────────────────────────────────

/**
 * A single learning data point extracted from a backlog decision.
 *
 * Created when a user drags a BacklogCard to "completed" (positive)
 * or "failed" (negative). Each signal captures the multi-dimensional
 * context of the decision so the system can learn cross-cutting patterns.
 */
export interface MemorySignal {
  /** Unique signal identifier (e.g. "sig-1712345678901") */
  id: string;

  /** Unix timestamp of when the decision was made */
  timestamp: number;

  /** Positive = approved/completed, Negative = rejected/failed */
  polarity: MemoryPolarity;

  /** Traceability back to the original backlog card */
  source: {
    taskId: string;
    filename: string;
    title: string;
  };

  /** Multi-dimensional feature vector extracted from the card */
  dimensions: {
    /** Keywords extracted from title + body (lowercase, deduplicated) */
    keywords: string[];
    /** Which agent/flow was used (e.g. "auto-reducer-finite") */
    targetAgent: string;
    /** Which module was targeted (e.g. "src/renderer/components") */
    targetModule: string;
    /** Task priority level */
    priority: BacklogPriority;
    /** Estimated complexity based on body length */
    complexity: 'low' | 'medium' | 'high';
  };

  /** Optional context — e.g. rejection reason or completion notes */
  context?: string;
}

// ─── Memory Entry ────────────────────────────────────────────────

/**
 * An aggregated pattern from multiple signals along a single dimension.
 *
 * Dimensions are keyed by type and value — e.g.:
 *   "agent:auto-reducer-finite"
 *   "module:src/renderer/components"
 *   "keyword:refactor"
 *   "priority:high"
 *
 * The score is a normalized excitement value in [-1, +1]:
 *   +1 = user always approves tasks with this dimension
 *   -1 = user always rejects tasks with this dimension
 *    0 = neutral or insufficient data
 */
export interface MemoryEntry {
  /** Dimension key (e.g. "keyword:refactor", "agent:auto-reducer") */
  dimension: string;

  /** Number of positive (approved) signals */
  positiveCount: number;

  /** Number of negative (rejected) signals */
  negativeCount: number;

  /** Normalized excitement score in [-1, +1] */
  score: number;

  /** Confidence level in [0, 1] — based on sample size */
  confidence: number;

  /** Timestamp of the most recent signal for this dimension */
  lastSeen: number;
}

// ─── Ranked Dimension ────────────────────────────────────────────

/** A dimension ranked by its absolute excitement magnitude */
export interface RankedDimension {
  dimension: string;
  score: number;
  confidence: number;
  label: string;
  sampleSize: number;
}

// ─── Neural Excitement Profile ───────────────────────────────────

/**
 * The complete excitement profile derived from accumulated memory.
 *
 * Used by MemoryComposerPlugin to generate prompt context
 * and by future UI to visualize learned preferences.
 *
 * "Excitement" is a metaphor from neural activation:
 *   - Highly excited dimensions → the user strongly prefers these
 *   - Inhibited dimensions → the user tends to reject these
 *   - Neutral dimensions → not enough data or mixed signals
 */
export interface NeuralExcitementProfile {
  /** Per-agent excitement scores */
  agentScores: Map<string, MemoryEntry>;

  /** Per-module excitement scores */
  moduleScores: Map<string, MemoryEntry>;

  /** Per-keyword excitement scores */
  keywordScores: Map<string, MemoryEntry>;

  /** Per-priority excitement scores */
  priorityScores: Map<string, MemoryEntry>;

  /** Total number of signals processed */
  totalSignals: number;

  /** When this profile was last computed */
  lastUpdated: number;
}

// ─── Serialization ───────────────────────────────────────────────

/** JSON-safe representation for persistence (Maps → Record) */
export interface SerializedExcitementProfile {
  agentScores: Record<string, MemoryEntry>;
  moduleScores: Record<string, MemoryEntry>;
  keywordScores: Record<string, MemoryEntry>;
  priorityScores: Record<string, MemoryEntry>;
  totalSignals: number;
  lastUpdated: number;
}
