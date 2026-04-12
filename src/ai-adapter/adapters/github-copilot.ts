/**
 * github-copilot.ts — AI Adapter / Adapters
 *
 * Responsibility:
 * - GitHub Copilot CLI adapter (spawns `copilot` binary)
 * - Copilot's JSONL output is already in the canonical AiOutputEvent format
 *
 * Boundaries:
 * - Owns: CLI command construction, Copilot-specific flags
 * - Does NOT own: JSONL parsing, event routing (inherited from CliAdapter)
 */
import { CliAdapter } from '../cli-adapter';
import type { AiAdapterName, AdapterRunOptions } from '../types';

export class GitHubCopilotAdapter extends CliAdapter {
  readonly displayName = 'GitHub Copilot';
  readonly name: AiAdapterName = 'copilot';

  protected buildCommand(options: AdapterRunOptions): { cmd: string; args: string[] } {
    const args = [
      '-p', options.prompt,
      '--output-format', 'json',
      '--allow-all-tools',
    ];

    if (options.model) args.push('--model', options.model);
    if (options.resumeSessionId) args.push(`--resume=${options.resumeSessionId}`);

    return { cmd: 'copilot', args };
  }

  // Copilot output is already in canonical format — no normalization needed
}
