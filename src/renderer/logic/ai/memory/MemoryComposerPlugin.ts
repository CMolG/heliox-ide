/**
 * MemoryComposerPlugin.ts — AI Memory System
 *
 * Responsibility:
 * - Generates human-readable prompt text from a NeuralExcitementProfile
 * - Formats learned preferences into a [MEMORY] section for AiComposer
 * - Separates "excited" (approved) patterns from "inhibited" (rejected) patterns
 *
 * Boundaries:
 * - Owns: prompt text generation from memory data
 * - Does NOT own: memory storage (MemoryLedger), scoring (NeuralExcitement),
 *   prompt assembly (AiComposer)
 *
 * Design note:
 * The plugin outputs a structured text block that slots into AiComposer's
 * composition pipeline. It's designed to be read by both humans (debugging)
 * and AI models (behavioral steering). The language uses "excitement" metaphors
 * consistently so models can interpret preference strength.
 */
import type { NeuralExcitementProfile, MemoryEntry, RankedDimension } from './types';
import { NeuralExcitement } from './NeuralExcitement';

/** Minimum confidence to include a dimension in the prompt */
const MIN_PROMPT_CONFIDENCE = 0.3;

/** Maximum number of preferences to include (prevents prompt bloat) */
const MAX_EXCITED = 8;
const MAX_INHIBITED = 6;

/**
 * Generates prompt text from learned memory.
 * All methods are static — no instance state required.
 */
export class MemoryComposerPlugin {

  /**
   * Compose a complete [MEMORY] prompt section from a profile.
   *
   * Returns null if there's insufficient data to generate meaningful
   * preferences (avoids injecting noise into prompts).
   */
  static compose(profile: NeuralExcitementProfile): string | null {
    if (profile.totalSignals < 3) return null;

    const allEntries = MemoryComposerPlugin.collectEntries(profile);
    const ranked = NeuralExcitement.rankDimensions(allEntries, MIN_PROMPT_CONFIDENCE);

    if (ranked.length === 0) return null;

    const excited = ranked.filter(r => r.score > 0).slice(0, MAX_EXCITED);
    const inhibited = ranked.filter(r => r.score < 0).slice(0, MAX_INHIBITED);

    if (excited.length === 0 && inhibited.length === 0) return null;

    const sections: string[] = [];
    sections.push('LEARNED PREFERENCES (from previous task decisions):');

    if (excited.length > 0) {
      sections.push('');
      sections.push('The user tends to APPROVE tasks involving:');
      for (const dim of excited) {
        sections.push(MemoryComposerPlugin.formatDimension(dim, 'positive'));
      }
    }

    if (inhibited.length > 0) {
      sections.push('');
      sections.push('The user tends to REJECT tasks involving:');
      for (const dim of inhibited) {
        sections.push(MemoryComposerPlugin.formatDimension(dim, 'negative'));
      }
    }

    sections.push('');
    sections.push(
      'Apply these learned preferences when generating suggestions, ' +
      'prioritizing tasks, or choosing implementation approaches. ' +
      'Excitement scores range from -1.0 (strongly avoided) to +1.0 (strongly preferred).'
    );

    return sections.join('\n');
  }

  /**
   * Generate a compact summary for UI display (not for prompt injection).
   * Returns top 5 preferences as one-liners.
   */
  static summarize(profile: NeuralExcitementProfile, maxItems = 5): string[] {
    const allEntries = MemoryComposerPlugin.collectEntries(profile);
    const ranked = NeuralExcitement.rankDimensions(allEntries, MIN_PROMPT_CONFIDENCE);

    return ranked.slice(0, maxItems).map(dim => {
      const direction = dim.score > 0 ? '👍' : '👎';
      const pct = Math.round(Math.abs(dim.score) * 100);
      return `${direction} ${dim.label} (${pct}% confidence from ${dim.sampleSize} decisions)`;
    });
  }

  // ─── Private Helpers ──────────────────────────────────────────

  /** Collect all MemoryEntry values from the profile's dimension maps */
  private static collectEntries(profile: NeuralExcitementProfile): MemoryEntry[] {
    const entries: MemoryEntry[] = [];
    for (const map of [
      profile.agentScores,
      profile.moduleScores,
      profile.keywordScores,
      profile.priorityScores,
    ]) {
      for (const entry of map.values()) {
        entries.push(entry);
      }
    }
    return entries;
  }

  /** Format a single ranked dimension as a prompt line */
  private static formatDimension(dim: RankedDimension, polarity: 'positive' | 'negative'): string {
    const arrow = polarity === 'positive' ? '↑' : '↓';
    const score = dim.score.toFixed(2);
    const conf = Math.round(dim.confidence * 100);
    return `  ${arrow} ${dim.label} (excitement: ${score}, confidence: ${conf}%, ${dim.sampleSize} signals)`;
  }
}
