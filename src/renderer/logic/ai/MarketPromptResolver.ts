/**
 * MarketPromptResolver — Market Prompt Content Loader
 *
 * Responsibility:
 * - Resolve market inventory IDs to full `.md` prompt content
 * - Provide a single entry point for loading market prompts by category + ID
 * - Batch-resolve multiple items in parallel
 *
 * Boundaries:
 * - Owns: resolving market item names to markdown content via IPC
 * - Does NOT own: IPC transport (preload/ipc-handlers), inventory metadata,
 *   or prompt composition (AiComposer)
 */

export type MarketCategory = 'flows' | 'roles' | 'mods' | 'steps';

/**
 * Resolves a single market prompt by category and item name.
 * Returns the full `.md` content or null if not found.
 */
export async function resolveMarketPrompt(
  projectPath: string,
  category: MarketCategory,
  name: string,
): Promise<string | null> {
  if (!window.helioxAPI) return null;
  try {
    return await window.helioxAPI.readMarketPrompt(projectPath, category, name);
  } catch {
    return null;
  }
}

/**
 * Resolves multiple market prompts in parallel for a given category.
 * Returns an array of resolved content strings (skipping nulls).
 */
export async function resolveMarketPrompts(
  projectPath: string,
  category: MarketCategory,
  names: string[],
): Promise<string[]> {
  const results = await Promise.all(
    names.map(name => resolveMarketPrompt(projectPath, category, name)),
  );
  return results.filter((r): r is string => r !== null);
}
