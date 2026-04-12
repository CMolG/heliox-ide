/**
 * index.ts — AI Adapter (barrel)
 *
 * Responsibility:
 * - Single public entry point for the ai-adapter package
 * - Re-exports all public types, adapters, registry, and prompt builder
 *
 * Boundaries:
 * - Owns: public API surface of the ai-adapter package
 * - Does NOT own: implementation details (each file owns its own)
 */

// ─── Types ───────────────────────────────────────────────────────
export type { AiAdapter, AiAdapterName, AdapterRunOptions, AiOutputEvent } from './types';

// ─── Base Classes ────────────────────────────────────────────────
export { CliAdapter } from './cli-adapter';

// ─── Concrete Adapters ───────────────────────────────────────────
export { GitHubCopilotAdapter } from './adapters/github-copilot';
export { ClaudeAdapter } from './adapters/claude';
export { OpenAiAdapter } from './adapters/openai';
export { OpenRouterAdapter } from './adapters/openrouter';
export { OpenCodeAdapter } from './adapters/opencode';

// ─── Registry ────────────────────────────────────────────────────
export { createAdapter, AVAILABLE_ADAPTERS } from './adapter-registry';

// ─── Prompt Builder ──────────────────────────────────────────────
export { buildAgentPrompt } from './prompt-builder';
