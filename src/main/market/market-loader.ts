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

/** Market root. Defaults to `<cwd>/market`; override with HELIOX_MARKET_DIR. */
export function getMarketDir(): string {
  return process.env.HELIOX_MARKET_DIR ?? join(process.cwd(), 'market');
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

function loadMarketMods(): Map<string, AgenticMod> {
  if (modCache) return modCache;

  const dir = getMarketDir();
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

    for (const entry of entries) {
      const siblings = entry.exclusiveGroup
        ? (groupMembers.get(entry.exclusiveGroup) ?? []).filter((name) => name !== entry.name)
        : [];
      // Effective incompatibilities = explicit list ∪ exclusive-group siblings.
      const incompatibleWith = [...new Set([...(entry.incompatibleWith ?? []), ...siblings])].sort();

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
