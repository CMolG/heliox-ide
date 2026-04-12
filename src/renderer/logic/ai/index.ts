/**
 * AI Package — Barrel Export
 *
 * Responsibility:
 * - Single entry point for all AI-related logic in the renderer
 *
 * Boundaries:
 * - Owns: re-exporting AI modules (AiComposer, prompt templates, memory system, version registry)
 * - Does NOT own: adapter execution (ai-adapter), agent orchestration (main process)
 */
export { AiComposer } from './AiComposer';
export { resolveMarketPrompt, resolveMarketPrompts } from './MarketPromptResolver';
export type { MarketCategory } from './MarketPromptResolver';

// ─── Prompts sub-package ─────────────────────────────────────────
export {
  INFINITY_LOOP_PROMPT,
  INFINITY_LOOP_PROMPT_VERSION,
  STUPIDITY_PRELUDE,
  STANDARD_PRELUDE,
  STUPIDITY_PRELUDE_VERSION,
  STANDARD_PRELUDE_VERSION,
  getPrelude,
  getPreludeVersion,
  PromptVersionRegistry,
  promptRegistry,
} from './prompts';

export type {
  PromptVersion,
  RegisteredPrompt,
} from './prompts';

// ─── Memory sub-package ──────────────────────────────────────────
export {
  SignalExtractor,
  NeuralExcitement,
  MemoryLedger,
  MemoryComposerPlugin,
} from './memory';

export type {
  MemoryPolarity,
  MemorySignal,
  MemoryEntry,
  RankedDimension,
  NeuralExcitementProfile,
  SerializedExcitementProfile,
  SerializedLedger,
} from './memory';
