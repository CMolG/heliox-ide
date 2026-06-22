/**
 * index.ts — AI Adapter (barrel)
 *
 * Single public entry for the ai-adapter package. Only the OpenCode adapter
 * is exposed — every provider is reached through it.
 */

export type { AiAdapter, AiAdapterName, AdapterRunOptions, AiOutputEvent } from './types';
export { CliAdapter } from './cli-adapter';
export { OpenCodeAdapter } from './adapters/opencode';
export { createAdapter, AVAILABLE_ADAPTERS } from './adapter-registry';
export { buildAgentPrompt } from './prompt-builder';
