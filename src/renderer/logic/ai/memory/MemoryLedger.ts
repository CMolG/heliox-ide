/**
 * MemoryLedger.ts — AI Memory System
 *
 * Responsibility:
 * - Central memory store for the AI preference learning system
 * - Records approval/rejection signals from backlog card decisions
 * - Aggregates signals into MemoryEntry dimensions for pattern recognition
 * - Computes a NeuralExcitementProfile on demand for prompt injection
 * - Serializes/deserializes for persistence via StorageAPI
 *
 * Boundaries:
 * - Owns: signal append, dimension aggregation, profile computation, serialization
 * - Does NOT own: signal extraction (SignalExtractor), scoring math (NeuralExcitement),
 *   prompt generation (MemoryComposerPlugin), persistence I/O (caller's responsibility)
 *
 * Design note:
 * The ledger is append-only for signals — like an event log. Aggregation into
 * MemoryEntry dimensions is computed on demand, not materialized. This keeps
 * the data model simple and allows recomputation with different parameters
 * (e.g., different decay rates or confidence thresholds) without data loss.
 */
import type {
  MemorySignal, MemoryEntry, NeuralExcitementProfile,
  SerializedExcitementProfile,
} from './types';
import { NeuralExcitement } from './NeuralExcitement';

/** JSON-serializable ledger state for persistence */
export interface SerializedLedger {
  version: 1;
  signals: MemorySignal[];
}

/**
 * The MemoryLedger accumulates decision signals and computes
 * a NeuralExcitementProfile that reveals user preferences.
 *
 * Usage:
 *   const ledger = new MemoryLedger();
 *   ledger.recordSignal(SignalExtractor.extractFromApproval(card));
 *   const profile = ledger.computeProfile();
 *   const promptText = MemoryComposerPlugin.compose(profile);
 */
export class MemoryLedger {
  private signals: MemorySignal[] = [];

  // ─── Signal Recording ─────────────────────────────────────────

  /** Append a new memory signal to the ledger */
  recordSignal(signal: MemorySignal): void {
    this.signals.push(signal);
  }

  /** Append multiple signals at once */
  recordSignals(signals: MemorySignal[]): void {
    this.signals.push(...signals);
  }

  /** Get all recorded signals (read-only snapshot) */
  getSignals(): readonly MemorySignal[] {
    return this.signals;
  }

  /** Number of signals in the ledger */
  get size(): number {
    return this.signals.length;
  }

  /** Remove all signals */
  clear(): void {
    this.signals = [];
  }

  // ─── Dimension Aggregation ─────────────────────────────────────

  /**
   * Aggregate all signals into MemoryEntry dimensions.
   *
   * Each signal contributes to multiple dimensions (one per keyword,
   * one per agent, one per module, one per priority). Time decay is
   * applied so recent decisions carry more weight than old ones.
   */
  computeEntries(): MemoryEntry[] {
    if (this.signals.length === 0) return [];

    const now = Date.now();
    const decayed = NeuralExcitement.applyTimeDecay(this.signals, now);

    // Accumulate weighted counts per dimension
    const dims = new Map<string, { pos: number; neg: number; lastSeen: number; rawPos: number; rawNeg: number }>();

    const accumulate = (key: string, polarity: 'positive' | 'negative', weight: number, ts: number) => {
      const entry = dims.get(key) ?? { pos: 0, neg: 0, lastSeen: 0, rawPos: 0, rawNeg: 0 };
      if (polarity === 'positive') {
        entry.pos += weight;
        entry.rawPos++;
      } else {
        entry.neg += weight;
        entry.rawNeg++;
      }
      entry.lastSeen = Math.max(entry.lastSeen, ts);
      dims.set(key, entry);
    };

    for (const { signal, weight } of decayed) {
      const d = signal.dimensions;

      // Agent dimension
      if (d.targetAgent) {
        accumulate(`agent:${d.targetAgent}`, signal.polarity, weight, signal.timestamp);
      }

      // Module dimension
      if (d.targetModule) {
        accumulate(`module:${d.targetModule}`, signal.polarity, weight, signal.timestamp);
      }

      // Priority dimension
      accumulate(`priority:${d.priority}`, signal.polarity, weight, signal.timestamp);

      // Complexity dimension
      accumulate(`complexity:${d.complexity}`, signal.polarity, weight, signal.timestamp);

      // Keyword dimensions (each keyword is its own dimension)
      for (const kw of d.keywords) {
        accumulate(`keyword:${kw}`, signal.polarity, weight, signal.timestamp);
      }
    }

    // Convert to MemoryEntry with scores and confidence
    const entries: MemoryEntry[] = [];
    for (const [dimension, agg] of dims) {
      const total = agg.pos + agg.neg;
      const score = total > 0 ? (agg.pos - agg.neg) / (total + 2) : 0; // Laplace-smoothed
      const sampleSize = agg.rawPos + agg.rawNeg;

      entries.push({
        dimension,
        positiveCount: agg.rawPos,
        negativeCount: agg.rawNeg,
        score,
        confidence: NeuralExcitement.computeConfidence(sampleSize),
        lastSeen: agg.lastSeen,
      });
    }

    return entries;
  }

  // ─── Profile Computation ───────────────────────────────────────

  /**
   * Compute the full NeuralExcitementProfile from all accumulated signals.
   *
   * This is the main output consumed by MemoryComposerPlugin to generate
   * preference-aware prompt context.
   */
  computeProfile(): NeuralExcitementProfile {
    const entries = this.computeEntries();

    const agentScores = new Map<string, MemoryEntry>();
    const moduleScores = new Map<string, MemoryEntry>();
    const keywordScores = new Map<string, MemoryEntry>();
    const priorityScores = new Map<string, MemoryEntry>();

    for (const entry of entries) {
      const colonIdx = entry.dimension.indexOf(':');
      if (colonIdx === -1) continue;

      const type = entry.dimension.slice(0, colonIdx);
      const value = entry.dimension.slice(colonIdx + 1);

      switch (type) {
        case 'agent': agentScores.set(value, entry); break;
        case 'module': moduleScores.set(value, entry); break;
        case 'keyword': keywordScores.set(value, entry); break;
        case 'priority': priorityScores.set(value, entry); break;
        // 'complexity' entries are included in keyword bucket for simplicity
      }
    }

    return {
      agentScores,
      moduleScores,
      keywordScores,
      priorityScores,
      totalSignals: this.signals.length,
      lastUpdated: Date.now(),
    };
  }

  // ─── Serialization ─────────────────────────────────────────────

  /** Serialize the ledger to JSON for persistence */
  toJSON(): SerializedLedger {
    return {
      version: 1,
      signals: this.signals,
    };
  }

  /** Restore ledger state from a persisted JSON object */
  static fromJSON(data: SerializedLedger): MemoryLedger {
    const ledger = new MemoryLedger();
    if (data.version === 1 && Array.isArray(data.signals)) {
      ledger.signals = data.signals;
    }
    return ledger;
  }

  /**
   * Serialize a NeuralExcitementProfile to a JSON-safe format.
   * Converts Maps to plain Records for storage/transmission.
   */
  static serializeProfile(profile: NeuralExcitementProfile): SerializedExcitementProfile {
    return {
      agentScores: Object.fromEntries(profile.agentScores),
      moduleScores: Object.fromEntries(profile.moduleScores),
      keywordScores: Object.fromEntries(profile.keywordScores),
      priorityScores: Object.fromEntries(profile.priorityScores),
      totalSignals: profile.totalSignals,
      lastUpdated: profile.lastUpdated,
    };
  }

  /**
   * Deserialize a NeuralExcitementProfile from a JSON-safe format.
   */
  static deserializeProfile(data: SerializedExcitementProfile): NeuralExcitementProfile {
    return {
      agentScores: new Map(Object.entries(data.agentScores)),
      moduleScores: new Map(Object.entries(data.moduleScores)),
      keywordScores: new Map(Object.entries(data.keywordScores)),
      priorityScores: new Map(Object.entries(data.priorityScores)),
      totalSignals: data.totalSignals,
      lastUpdated: data.lastUpdated,
    };
  }
}
