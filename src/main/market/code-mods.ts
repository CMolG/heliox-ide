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

/**
 * WebBrowserMod — injects the browser_goto / browser_act / browser_extract_seo
 * tool trio into the step's tool surface. Drives the linked preview window when
 * present, falling back to a headless surface when not.
 */
export const WebBrowserMod = {
  id: 'web-browser',
  name: 'WebBrowser',
  type: 'tool_provider',
  config: {
    description:
      'Live web navigation for the agent: browser_goto(url) loads a page and returns a compact '
      + 'accessibility tree (AOM) with numeric element ids; browser_act(elementId, action, value) '
      + 'clicks/fills/selects/presses; browser_extract_seo(url?) returns meta tags, canonical, and '
      + 'Core Web Vitals. Drives the linked preview window when present, else a headless surface.',
  },
} as const satisfies AgenticMod;

/** Mods backed by runtime logic (not pure market `.md` injections). */
export const CODE_MODS: AgenticMod[] = [AntiVerificationInterceptor, WebBrowserMod];
