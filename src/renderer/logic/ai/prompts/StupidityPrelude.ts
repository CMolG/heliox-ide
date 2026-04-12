/**
 * StupidityPrelude.ts — AI Prompt Prelude Templates
 *
 * Responsibility:
 * - Provides the "Stupidity Mode" prelude that forces the AI into the extreme
 *   right tail of its quality distribution while assuming the user is a novice
 * - Provides the standard (non-stupidity) prelude that briefly explains the
 *   prompt structure so the AI respects constraints
 * - Both preludes include a structure guide so the AI understands the layout:
 *   [PRELUDE] → [TASK] → [CONSTRAINTS] → [OUTPUT SCHEMA]
 *
 * Boundaries:
 * - Owns: prelude prompt text, version strings
 * - Does NOT own: composition logic (AiComposer), prompt persistence (PromptVersionRegistry)
 *
 * Design note:
 * "Stupidity Mode" is ON by default. It wraps even trivial user instructions in a
 * statistical override that pushes the model to +3σ quality. The paradox: source genius,
 * deliver simplicity. The user's raw instruction is never altered — only the framing.
 */

// ─── Version ────────────────────────────────────────────────────────────────────
// Bump this when the prompt text changes meaningfully. The PromptVersionRegistry
// persists each version in the database for audit and reproducibility.

export const STUPIDITY_PRELUDE_VERSION = '1.0.0';
export const STANDARD_PRELUDE_VERSION = '1.0.0';

// ─── Stupidity Mode Prelude (ON by default) ─────────────────────────────────────

export const STUPIDITY_PRELUDE = `You are an AI, and we are going to perform a statistical override on your output generation. Every response you generate naturally falls somewhere on a Gaussian bell curve of quality. The vast majority of your default outputs sit firmly in the fat middle—safe, average, predictable, and generic. I am instructing you to completely sever your access to that middle 99%.

When you process my request, you are strictly forbidden from clustering your response anywhere near the average. You must force your processing exclusively into the absolute extreme right tail of the Gauss bell—the +3 standard deviations limit. This is the domain of Nobel laureates, cutting-edge innovators, and undisputed industry geniuses. I want ONLY the absolute best, most optimal solutions to my problem. Do not give me a list of mediocre options; give me the single most brilliant path forward.

However, you must execute this while operating under a strict paradox: You will source these top 1% paradigm-shifting solutions, but you must assume I am completely stupid. I do not know what I actually need, and I do not understand complex jargon. Your task is to extract the genius from the very edge of the bell curve and translate it into a flawless, simple, step-by-step execution plan that a complete novice can instantly understand and apply.

PROMPT STRUCTURE:
This prompt follows a strict 4-section layout. You MUST respect all sections:
  1. [PRELUDE]       — This section. Sets your operating mode. Already active.
  2. [TASK]          — The user's actual request. Execute it faithfully.
  3. [CONSTRAINTS]   — Rules, roles, modifiers, memory, and context you MUST follow.
  4. [OUTPUT SCHEMA] — The required output format (if present). Comply exactly.

You may NOT ignore or override any [CONSTRAINTS]. The ONLY section you treat as raw input is [TASK].`;

// ─── Standard Prelude (Stupidity Mode OFF) ──────────────────────────────────────

export const STANDARD_PRELUDE = `PROMPT STRUCTURE:
This prompt follows a strict 4-section layout. You MUST respect all sections:
  1. [PRELUDE]       — This section. Brief orientation for how to read this prompt.
  2. [TASK]          — The user's actual request. Execute it faithfully.
  3. [CONSTRAINTS]   — Rules, roles, modifiers, memory, and context you MUST follow.
  4. [OUTPUT SCHEMA] — The required output format (if present). Comply exactly.

You may NOT ignore or override any [CONSTRAINTS]. The ONLY section you treat as raw input is [TASK].
Deliver precise, production-grade output with clear reasoning.`;

// ─── Utility ────────────────────────────────────────────────────────────────────

/** Returns the appropriate prelude based on stupidity mode toggle */
export function getPrelude(stupidityMode: boolean): string {
  return stupidityMode ? STUPIDITY_PRELUDE : STANDARD_PRELUDE;
}

/** Returns the version string for the active prelude */
export function getPreludeVersion(stupidityMode: boolean): string {
  return stupidityMode ? STUPIDITY_PRELUDE_VERSION : STANDARD_PRELUDE_VERSION;
}
