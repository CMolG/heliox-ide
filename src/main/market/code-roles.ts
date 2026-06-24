import type { Role } from '../../types';

/**
 * code-roles.ts — Engine-internal roles carrying runtime config (model,
 * temperature, token budget) beyond what a market role `.md` captures.
 *
 * User-facing personas live in `/market/roles/*.md` + inventory. `ConfidentExecutor`
 * is the harness's default execution persona, so it keeps a code definition with
 * its runtime parameters. Relocated out of `renderer/store/predefined` because the
 * harness engine (main process) is its only consumer.
 */
export const ConfidentExecutor = {
  id: 'confident-executor',
  name: 'ConfidentExecutor',
  description: 'Efficient code executor that trusts successful tool confirmations.',
  systemPrompt: 'Eres un ejecutor de código altamente eficiente. Confía en las confirmaciones de tus herramientas. Si write_file no devuelve error, asume que el archivo se creó correctamente. ESTÁ TERMINANTEMENTE PROHIBIDO usar list_directory o read_file simplemente para verificar una escritura que acabas de realizar.',
  model: 'mimo/mimo-v2.5-pro',
  temperature: 0.1,
  maxTokens: 4096,
  icon: 'zap',
  createdAt: 0,
} as const satisfies Role;

/** Engine-internal roles backed by runtime config. */
export const CODE_ROLES: Role[] = [ConfidentExecutor];
