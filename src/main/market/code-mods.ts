import type { AgenticMod } from '../../types/harness';

/**
 * code-mods.ts — Mods whose behavior requires runtime code, not just a market
 * `.md` system-injection.
 *
 * Most prebuilt mods live in `/market` as `.md` + an inventory entry and are
 * loaded by `market-loader`. A handful of mods additionally hook the execution
 * runtime (e.g. blocking tools mid-run) and therefore keep a code definition
 * here. They are still registered in the discovery catalog so the Meta-Agent can
 * select them.
 *
 * NOTE: this lives in `src/main` (not `renderer/store`) because the harness
 * engine is the only consumer — keeping it here avoids a main→renderer layer
 * violation.
 */
export const AntiVerificationInterceptor = {
  id: 'anti-verification-interceptor',
  name: 'AntiVerificationInterceptor',
  type: 'system_override',
  config: {
    interceptor: 'anti-verification',
    description: 'Blocks verification noise immediately after successful write_file calls.',
    blockToolsAfterWrite: ['list_directory', 'read_file'],
    message: 'System Mod Interception: Directory listing blocked. Trust the previous write_file success. Proceed to the next step.',
  },
} as const satisfies AgenticMod;

/** Mods backed by runtime logic (not pure market `.md` injections). */
export const CODE_MODS: AgenticMod[] = [AntiVerificationInterceptor];
