/**
 * adapter-registry.ts — AI Adapter
 *
 * Responsibility:
 * - Factory function to instantiate the correct adapter by name
 * - Single source of truth for the adapter name → class mapping
 *
 * Boundaries:
 * - Owns: adapter instantiation and name resolution
 * - Does NOT own: adapter implementations (each lives in adapters/)
 */
import type { AiAdapter, AiAdapterName } from './types';
import { GitHubCopilotAdapter } from './adapters/github-copilot';
import { ClaudeAdapter } from './adapters/claude';
import { OpenAiAdapter } from './adapters/openai';
import { OpenRouterAdapter } from './adapters/openrouter';
import { OpenCodeAdapter } from './adapters/opencode';

/** Registry mapping adapter names to their constructors */
const ADAPTER_MAP: Record<AiAdapterName, new () => AiAdapter> = {
  copilot: GitHubCopilotAdapter,
  claude: ClaudeAdapter,
  openai: OpenAiAdapter,
  openrouter: OpenRouterAdapter,
  opencode: OpenCodeAdapter,
};

/**
 * Creates an adapter instance by name.
 *
 * @param name — The adapter identifier (e.g. 'copilot', 'claude')
 * @returns A fresh AiAdapter instance ready for runPrompt()
 * @throws If the adapter name is not recognized
 */
export function createAdapter(name: AiAdapterName): AiAdapter {
  const AdapterClass = ADAPTER_MAP[name];
  if (!AdapterClass) {
    throw new Error(
      `Unknown AI adapter "${name}". Available: ${Object.keys(ADAPTER_MAP).join(', ')}`
    );
  }
  return new AdapterClass();
}

/** List of all available adapter names */
export const AVAILABLE_ADAPTERS: readonly AiAdapterName[] = Object.keys(ADAPTER_MAP) as AiAdapterName[];
