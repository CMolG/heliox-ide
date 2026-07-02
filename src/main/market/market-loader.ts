/**
 * market-loader.ts — Consume prebuilt Mods from the /market resource folder.
 *
 * The `/market` folder is the single source of truth for prebuilt resources
 * (flows, roles, mods, steps). Each mod is a `.md` system-injection file plus a
 * registry entry in `market/inventory.json`.
 *
 * The harness engine historically hard-coded its mods in TypeScript, bypassing
 * the market entirely (an inherited flaw). This loader closes that gap: the
 * engine now reads mod definitions from the market, so the marketplace UI and the
 * agentic engine share one canonical source.
 *
 * Runs in the main/CLI process (headless), so it reads the filesystem directly
 * rather than going through the renderer IPC bridge.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { AgenticMod, AgenticRole } from '../../types/harness';
import type { MarketMod, MarketRole } from '../../types/market';
import { verifyMarket, TRUSTED_MARKET_KEYS } from './market-trust';

/** Market root. Defaults to `<cwd>/market`; override with HELIOX_MARKET_DIR. */
export function getMarketDir(): string {
  return process.env.HELIOX_MARKET_DIR ?? join(process.cwd(), 'market');
}

// ─── Signature verification policy (audit 1.5) ─────────────────────────────
//
// This loader runs headless (CLI/serve) as well as inside Electron, so it
// cannot hard-depend on the `electron` module — `require('electron')` outside
// a running Electron process does not expose `app`, so every access is guarded
// exactly like the existing dev/packaged detection in dev-session-logger.ts.
let _electron: typeof import('electron') | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- must be synchronous and swallow failure; matches dev-session-logger.ts/logger.ts.
  _electron = require('electron');
} catch { /* headless CLI/tests — no Electron */ }

function isPackagedApp(): boolean {
  try {
    if (_electron?.app && typeof _electron.app.isPackaged === 'boolean') {
      return _electron.app.isPackaged;
    }
  } catch { /* app not ready yet */ }
  return false;
}

let marketVerified = false;

/**
 * Verification policy (runs at most once per process — reset by
 * clearMarketModCache for tests):
 *   - TRUSTED_MARKET_KEYS empty (bootstrap mode, today) → skip, one warning.
 *   - Keys configured + packaged build → fail closed: throw, refuse to load.
 *   - Keys configured + dev build → warn on invalid/missing, keep loading.
 * Called BEFORE the try/catch below that swallows read errors, so a fail-closed
 * throw actually propagates instead of being absorbed into "no mods available".
 */
function ensureMarketVerified(dir: string): void {
  if (marketVerified) return;
  marketVerified = true;

  if (Object.keys(TRUSTED_MARKET_KEYS).length === 0) {
    console.warn(
      '[market-loader] Market signature verification is SKIPPED — TRUSTED_MARKET_KEYS is empty ' +
      '(bootstrap mode). Provision a key with `npx tsx scripts/market-sign.ts --gen-key`.',
    );
    return;
  }

  const result = verifyMarket(dir, TRUSTED_MARKET_KEYS);
  if (result.ok) return;

  const message = `[market-loader] Market signature verification FAILED (${result.reason}) for ${dir}.`;
  if (isPackagedApp()) {
    throw new Error(`${message} Refusing to load an unverified market in a packaged build.`);
  }
  console.warn(`${message} Continuing in dev mode — this is a fatal error in a packaged build.`);
}

interface RawInventory {
  mods?: MarketMod[];
  roles?: MarketRole[];
}

let modCache: Map<string, AgenticMod> | null = null;
let roleCache: Map<string, MarketRoleEntry> | null = null;

interface MarketRoleEntry {
  role: AgenticRole;
  description: string;
}

function readResource(dir: string, category: string, name: string): string {
  try {
    return readFileSync(join(dir, category, `${name}.md`), 'utf-8').trim();
  } catch {
    return '';
  }
}

function readModInjection(dir: string, name: string): string {
  return readResource(dir, 'mods', name);
}

/** Built-in toolset grants a mod's `runtime.attachTools` may request. */
const KNOWN_ATTACH_TOOLSETS = new Set(['web-browser']);

/**
 * Passthrough a market mod's declared `runtime` into the AgenticMod config,
 * filtering out any `attachTools` entry outside the engine's known toolset
 * grants (today: only `web-browser`). An unknown toolset name is a market
 * authoring mistake the executor cannot act on — dropped with a warning
 * instead of silently reaching the executor as dead data. The rest of the
 * runtime (blockTools, contract) passes through intact.
 */
function sanitizeMarketModRuntime(runtime: MarketMod['runtime']): MarketMod['runtime'] | undefined {
  if (!runtime) return undefined;
  if (!Array.isArray(runtime.attachTools)) return runtime;

  const known: string[] = [];
  for (const toolset of runtime.attachTools) {
    if (KNOWN_ATTACH_TOOLSETS.has(toolset)) {
      known.push(toolset);
    } else {
      console.warn(`[market-loader] mod runtime.attachTools names unknown toolset "${toolset}" — ignoring.`);
    }
  }

  return { ...runtime, attachTools: known };
}

function loadMarketMods(): Map<string, AgenticMod> {
  if (modCache) return modCache;

  const dir = getMarketDir();
  ensureMarketVerified(dir);
  const mods = new Map<string, AgenticMod>();

  try {
    const inventory = JSON.parse(readFileSync(join(dir, 'inventory.json'), 'utf-8')) as RawInventory;
    const entries = (inventory.mods ?? []).filter((entry): entry is MarketMod => Boolean(entry?.name));

    // Build exclusive-group membership: mods in the same group are mutually
    // exclusive (e.g. design systems), so two of them can never stack.
    const groupMembers = new Map<string, string[]>();
    for (const entry of entries) {
      if (!entry.exclusiveGroup) continue;
      const members = groupMembers.get(entry.exclusiveGroup) ?? [];
      members.push(entry.name);
      groupMembers.set(entry.exclusiveGroup, members);
    }

    // Phase 1: per-entry effective incompatibility = explicit manual list ∪
    // exclusive-group siblings.
    const incompatibilities = new Map<string, Set<string>>();
    for (const entry of entries) {
      const siblings = entry.exclusiveGroup
        ? (groupMembers.get(entry.exclusiveGroup) ?? []).filter((name) => name !== entry.name)
        : [];
      incompatibilities.set(entry.name, new Set([...(entry.incompatibleWith ?? []), ...siblings]));
    }

    // Phase 2: global symmetrization pass. Manually-authored `incompatibleWith`
    // lists can be asymmetric (A lists B, B forgets to list A back); a
    // one-directional gap would let the context-builder's pairwise guard
    // silently miss half of a declared conflict. Mirror every edge both ways.
    // A dangling reference to a name absent from the inventory is left alone
    // here (defensive; market-integrity guardrails flag it as a data error).
    for (const entry of entries) {
      const targets = incompatibilities.get(entry.name);
      if (!targets) continue;
      for (const target of targets) {
        incompatibilities.get(target)?.add(entry.name);
      }
    }

    for (const entry of entries) {
      const incompatibleWith = [...(incompatibilities.get(entry.name) ?? [])].sort();
      const runtime = sanitizeMarketModRuntime(entry.runtime);

      mods.set(entry.name, {
        id: entry.name,
        name: entry.name,
        // In our modular harness a market mod is applied as a pre_process context
        // injection: its `.md` system-injection is surfaced to the agent verbatim
        // (the default context-builder resolver reads `config.inject`).
        type: 'pre_process',
        config: {
          description: entry.description ?? entry.name,
          inject: readModInjection(dir, entry.name),
          ...(entry.tags ? { tags: entry.tags } : {}),
          ...(incompatibleWith.length > 0 ? { incompatibleWith } : {}),
          ...(entry.exclusiveGroup ? { exclusiveGroup: entry.exclusiveGroup } : {}),
          ...(entry.domains ? { domains: entry.domains } : {}),
          ...(runtime ? { runtime } : {}),
        },
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[market-loader] Could not read market inventory from ${dir}: ${message}`);
  }

  modCache = mods;
  return modCache;
}

/** Reset the in-memory caches (used by tests and hot-reload). */
export function clearMarketModCache(): void {
  modCache = null;
  roleCache = null;
  marketVerified = false;
}

export function getMarketMods(): AgenticMod[] {
  return [...loadMarketMods().values()];
}

/** Resolve a single prebuilt mod by its market name; throws if unregistered. */
export function getMarketMod(name: string): AgenticMod {
  const mod = loadMarketMods().get(name);
  if (!mod) {
    throw new Error(`Market mod "${name}" is not registered in market/inventory.json.`);
  }
  return mod;
}

export interface MarketModCatalogEntry {
  id: string;
  name: string;
  type: string;
  description: string;
}

export function getMarketModCatalog(): MarketModCatalogEntry[] {
  return getMarketMods().map((mod) => ({
    id: mod.id,
    name: mod.name,
    type: mod.type,
    description: String(mod.config?.description ?? mod.name),
  }));
}

// ─── Roles ──────────────────────────────────────────────────────
//
// Market roles are `.md` personas + an inventory entry. A role is loaded as an
// AgenticRole whose systemPrompt is the `.md` content, so the harness engine and
// the Meta-Agent discovery catalog consume roles from the market too.

function loadMarketRoles(): Map<string, MarketRoleEntry> {
  if (roleCache) return roleCache;

  const dir = getMarketDir();
  ensureMarketVerified(dir);
  const roles = new Map<string, MarketRoleEntry>();

  try {
    const inventory = JSON.parse(readFileSync(join(dir, 'inventory.json'), 'utf-8')) as RawInventory;
    for (const entry of inventory.roles ?? []) {
      if (!entry?.name) continue;
      roles.set(entry.name, {
        role: {
          id: entry.name,
          name: entry.name,
          systemPrompt: readResource(dir, 'roles', entry.name),
        },
        description: entry.description ?? entry.name,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[market-loader] Could not read market roles from ${dir}: ${message}`);
  }

  roleCache = roles;
  return roleCache;
}

export function getMarketRoles(): AgenticRole[] {
  return [...loadMarketRoles().values()].map((entry) => entry.role);
}

/** Resolve a single prebuilt role by its market name; throws if unregistered. */
export function getMarketRole(name: string): AgenticRole {
  const entry = loadMarketRoles().get(name);
  if (!entry) {
    throw new Error(`Market role "${name}" is not registered in market/inventory.json.`);
  }
  return entry.role;
}

export interface MarketRoleCatalogEntry {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
}

export function getMarketRoleCatalog(): MarketRoleCatalogEntry[] {
  return [...loadMarketRoles().values()].map((entry) => ({
    id: entry.role.id,
    name: entry.role.name,
    description: entry.description,
    systemPrompt: entry.role.systemPrompt,
  }));
}
