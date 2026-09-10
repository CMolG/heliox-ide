/**
 * SignalExtractor.ts — AI Memory System
 *
 * Responsibility:
 * - Extracts learnable MemorySignal data points from BacklogCard decisions
 * - Performs lightweight keyword extraction from task title and body
 * - Estimates task complexity from body length
 *
 * Boundaries:
 * - Owns: signal creation logic, keyword extraction, complexity heuristic
 * - Does NOT own: signal storage (MemoryLedger), scoring (NeuralExcitement)
 */
import type { BacklogCard } from '@/types/market';
import type { MemorySignal, MemoryPolarity } from './types';

/** Words to skip during keyword extraction (common English stop words + code noise) */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'must', 'ought',
  'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either',
  'neither', 'each', 'every', 'all', 'any', 'few', 'more', 'most',
  'other', 'some', 'such', 'than', 'too', 'very', 'just', 'also',
  'of', 'in', 'to', 'for', 'with', 'on', 'at', 'from', 'by', 'about',
  'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'this', 'that', 'these', 'those', 'it', 'its', 'they', 'them', 'their',
  'we', 'us', 'our', 'you', 'your', 'he', 'she', 'him', 'her', 'his',
  'what', 'which', 'who', 'whom', 'when', 'where', 'why', 'how',
  'if', 'up', 'no', 'file', 'code', 'src', 'new', 'use', 'using',
]);

/** Complexity thresholds based on body character count */
const COMPLEXITY_LOW = 300;
const COMPLEXITY_HIGH = 1200;

/**
 * Extracts structured memory signals from backlog task decisions.
 *
 * Pure static utility — no instance state, no side effects.
 * Call extractFromApproval() when a card moves to "completed"
 * and extractFromRejection() when a card moves to "failed".
 */
export class SignalExtractor {

  /**
   * Create a positive memory signal from an approved (completed) backlog card.
   */
  static extractFromApproval(card: BacklogCard, context?: string): MemorySignal {
    return SignalExtractor.extract(card, 'positive', context);
  }

  /**
   * Create a negative memory signal from a rejected (failed) backlog card.
   */
  static extractFromRejection(card: BacklogCard, context?: string): MemorySignal {
    return SignalExtractor.extract(card, 'negative', context);
  }

  /**
   * Extract keywords from text using lightweight NLP heuristics.
   *
   * Approach:
   *   1. Strip markdown syntax and code fences
   *   2. Tokenize on word boundaries
   *   3. Lowercase and filter stop words + short tokens
   *   4. Deduplicate and limit to top N by frequency
   */
  static extractKeywords(text: string, maxKeywords = 12): string[] {
    const cleaned = text
      .replace(/```[\s\S]*?```/g, '')     // strip code blocks
      .replace(/`[^`]*`/g, '')            // strip inline code
      .replace(/[#*_\[\](){}|>~`]/g, ' ') // strip markdown syntax
      .replace(/https?:\/\/\S+/g, '')      // strip URLs
      .replace(/[^a-zA-Z0-9\s-]/g, ' ');  // keep only alphanumeric + hyphens

    const tokens = cleaned.toLowerCase().split(/\s+/).filter(Boolean);

    // Count frequency, filtering stop words and short tokens
    const freq = new Map<string, number>();
    for (const token of tokens) {
      if (token.length < 3 || STOP_WORDS.has(token)) continue;
      freq.set(token, (freq.get(token) ?? 0) + 1);
    }

    // Sort by frequency descending, take top N
    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxKeywords)
      .map(([word]) => word);
  }

  /**
   * Estimate task complexity from body length.
   * Short descriptions → low, medium-length → medium, verbose → high.
   */
  static estimateComplexity(body: string): 'low' | 'medium' | 'high' {
    const len = body.trim().length;
    if (len < COMPLEXITY_LOW) return 'low';
    if (len > COMPLEXITY_HIGH) return 'high';
    return 'medium';
  }

  // ─── Private ────────────────────────────────────────────────────

  private static extract(
    card: BacklogCard,
    polarity: MemoryPolarity,
    context?: string,
  ): MemorySignal {
    const combinedText = `${card.title} ${card.description}`;

    return {
      id: `sig-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      polarity,
      source: {
        taskId: card.taskId,
        filename: card.filename,
        title: card.title,
      },
      dimensions: {
        keywords: SignalExtractor.extractKeywords(combinedText),
        targetAgent: card.targetAgent,
        targetModule: card.targetModule,
        priority: card.priority,
        complexity: SignalExtractor.estimateComplexity(card.description),
      },
      context,
    };
  }
}
