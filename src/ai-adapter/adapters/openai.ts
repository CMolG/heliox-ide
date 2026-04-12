/**
 * openai.ts — AI Adapter / Adapters
 *
 * Responsibility:
 * - OpenAI Codex CLI adapter (spawns `codex` binary)
 * - Codex JSONL output follows the same event schema as Copilot
 *
 * Boundaries:
 * - Owns: CLI command construction, OpenAI-specific flags
 * - Does NOT own: JSONL parsing, event routing (inherited from CliAdapter)
 */
import { CliAdapter } from '../cli-adapter';
import type { AiAdapterName, AdapterRunOptions } from '../types';

export class OpenAiAdapter extends CliAdapter {
  readonly displayName = 'OpenAI Codex';
  readonly name: AiAdapterName = 'openai';

  protected buildCommand(options: AdapterRunOptions): { cmd: string; args: string[] } {
    const args = [
      '-p', options.prompt,
      '--output-format', 'json',
    ];

    if (options.model) args.push('--model', options.model);

    return { cmd: 'codex', args };
  }

  // Codex JSONL format is Copilot-compatible — no normalization needed
}
