/**
 * Prompts Sub-Package — Barrel Export
 *
 * Responsibility:
 * - Single entry point for all versioned prompt templates and the version registry
 *
 * Boundaries:
 * - Owns: re-exporting prompt modules
 * - Does NOT own: composition logic (AiComposer), DB schema (migrations/)
 */
export {
  STUPIDITY_PRELUDE,
  STANDARD_PRELUDE,
  STUPIDITY_PRELUDE_VERSION,
  STANDARD_PRELUDE_VERSION,
  getPrelude,
  getPreludeVersion,
} from './StupidityPrelude';

export {
  INFINITY_LOOP_PROMPT,
  INFINITY_LOOP_PROMPT_VERSION,
} from './InfinityLoopPrompt';

export {
  PromptVersionRegistry,
  promptRegistry,
} from './PromptVersionRegistry';

export type {
  PromptVersion,
  RegisteredPrompt,
} from './PromptVersionRegistry';
