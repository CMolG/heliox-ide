/**
 * adapter-registry.ts — AI Adapter
 *
 * Responsibility:
 * - Factory function returning the single OpenCode adapter instance.
 *
 * The IDE used to multiplex between several CLI adapters (Copilot, Claude,
 * Codex, OpenRouter…). All of those flows are now handled by OpenCode itself
 * through its provider catalog, so this registry is intentionally minimal.
 */
import type { AiAdapter, AiAdapterName } from './types';
import { OpenCodeAdapter } from './adapters/opencode';

const ADAPTER_MAP: Record<AiAdapterName, new () => AiAdapter> = {
  opencode: OpenCodeAdapter,
};

/**
 * Creates an adapter instance by name. The `name` parameter is kept for
 * historical IPC contracts; only `'opencode'` is valid going forward.
 */
export function createAdapter(name?: AiAdapterName | string): AiAdapter {
  const resolved: AiAdapterName = name === 'opencode' || name === undefined ? 'opencode' : 'opencode';
  return new ADAPTER_MAP[resolved]();
}

export const AVAILABLE_ADAPTERS: readonly AiAdapterName[] = Object.keys(ADAPTER_MAP) as AiAdapterName[];
