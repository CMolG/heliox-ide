/**
 * model-router.ts — Smart model-routing engine (Phase 3a)
 *
 * Resolves which model a step should run on once a flow opts into a
 * `ModelPolicy` other than 'fixed'. This module owns the DECISION only — the
 * executor (executor.ts) is the sole caller and is responsible for threading
 * the decision into the LLM runner and the emitted `StepStatusChanged` event.
 *
 * Product framing (do not violate elsewhere in this codebase either):
 *   - Fluxor only vouches for models it actually benchmarked in the Arena.
 *     The seal word is "Benchmarked" (`sealed: true`) — NEVER "verified".
 *   - Smart (Local) — `smart-local` — routes ONLY among Arena-benchmarked
 *     ("sealed") models: the `completed` entries of the Arena leaderboard.
 *     It never recommends a model outside that sealed set.
 *   - Smart (External) — `smart-external` — delegates the pick to
 *     OpenRouter's `openrouter/auto` and is upfront that the pick is
 *     unsealed (`sealed: false`) until the executor attributes the model
 *     OpenRouter actually served back against the sealed set.
 *   - The router must NEVER make a run fail: every public entry point
 *     swallows its own errors and returns `null`, which callers treat as
 *     "fail open — keep using the flow/step's already-resolved model".
 *
 * All IO (leaderboard file, market inventory, env var) sits behind the three
 * `ModelRouterDeps` seams so tests can inject synthetic data and never touch
 * the filesystem or environment.
 */
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgenticStep } from '../../types/harness';
import type { ModelPolicy, RoutedModelEvidence, SelectionStrategy } from '../../types/ipc-events';
import type { ArenaLeaderboardEntry } from '../performance-frontier/arena/arena-runner';
import { completedEntries, selectByStrategy, toEvidence } from '../performance-frontier/arena/selection-strategies';
import { getMarketDir } from '../market/market-loader';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Context available at routing time, beyond the step itself. */
export interface RoutingContext {
  /** The flow's own (already-resolved) model id — informational; the executor (not the router) owns the fallback chain. */
  flowModelId?: string;
}

export interface RoutedModelDecision {
  modelId: string;
  evidence: RoutedModelEvidence;
}

/** A resolved routing policy, bound to one `ModelPolicy` for the duration of a flow run. */
export interface RoutingPolicy {
  /** Returns `null` to mean "fail open" — the caller must fall back to its own default model. */
  resolve(step: AgenticStep, ctx: RoutingContext): Promise<RoutedModelDecision | null>;
}

export interface ModelRouterDeps {
  /** Injectable Arena leaderboard source. Defaults to the on-disk ledger; resolves to `[]` on any read/parse error. */
  getLeaderboard?: () => Promise<ArenaLeaderboardEntry[]>;
  /** Injectable betterOn lookup (market atom name -> recommended model id). Defaults to parsing market/inventory.json; empty Map on any error. */
  getBetterOnById?: () => Map<string, string>;
  /** Injectable OpenRouter-key probe. Defaults to checking `process.env.OPENROUTER_API_KEY`. */
  hasOpenRouterKey?: () => boolean;
}

// ---------------------------------------------------------------------------
// Default deps
// ---------------------------------------------------------------------------

const DEFAULT_LEADERBOARD_PATH = join(process.cwd(), '.fluxor', 'performance-frontier', 'fluxor-leaderboard.json');

/**
 * Default Arena leaderboard loader. Exported so the executor can reuse the
 * exact same on-disk source for its own sealed-set re-check (manual
 * step.model sealing + external-router attribution) without duplicating the
 * path/parsing logic.
 */
export async function loadDefaultLeaderboard(): Promise<ArenaLeaderboardEntry[]> {
  try {
    const raw = await readFile(DEFAULT_LEADERBOARD_PATH, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ArenaLeaderboardEntry[]) : [];
  } catch {
    // No Arena run yet, unreadable, or malformed — fail open to "nothing sealed".
    return [];
  }
}

interface RawBetterOnEntry {
  name?: unknown;
  betterOn?: unknown;
}

interface RawMarketInventory {
  roles?: RawBetterOnEntry[];
  mods?: RawBetterOnEntry[];
}

/**
 * Default betterOn lookup. Reads market/inventory.json (via the same
 * `getMarketDir()` resolution the rest of the market loader uses) and
 * collects every role/mod entry's `name` -> `betterOn` pair — `name` is what
 * `harness-compiler.ts` copies into `AgenticRole.id`/`AgenticMod.id`, so this
 * map is keyed exactly the way a compiled step's `roles[].id`/`mods[].id`
 * need. Synchronous, matching the `ModelRouterDeps.getBetterOnById` contract
 * and the sync `readFileSync` convention `market-loader.ts` already uses for
 * this same file.
 */
function loadDefaultBetterOnById(): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const inventoryPath = join(getMarketDir(), 'inventory.json');
    const raw = readFileSync(inventoryPath, 'utf-8');
    const inventory = JSON.parse(raw) as RawMarketInventory;
    for (const entry of [...(inventory.roles ?? []), ...(inventory.mods ?? [])]) {
      if (typeof entry?.name === 'string' && typeof entry?.betterOn === 'string' && entry.betterOn) {
        map.set(entry.name, entry.betterOn);
      }
    }
  } catch {
    // No inventory yet, unreadable, or malformed — fail open to "no hints".
  }
  return map;
}

function defaultHasOpenRouterKey(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// isSealed — shared "Benchmarked" predicate
// ---------------------------------------------------------------------------

/**
 * True when `modelId` is a member of the sealed ("Benchmarked") Arena set.
 * Exported for the executor's own external-router attribution re-check.
 * Never call the result "verified" — see module header.
 */
export function isSealed(modelId: string, sealedIds: Set<string>): boolean {
  return sealedIds.has(modelId);
}

// ---------------------------------------------------------------------------
// resolve() wrapper — the router NEVER makes a run fail
// ---------------------------------------------------------------------------

function withFailOpen(
  label: string,
  impl: (step: AgenticStep, ctx: RoutingContext) => Promise<RoutedModelDecision | null>,
): RoutingPolicy['resolve'] {
  return async (step, ctx) => {
    try {
      return await impl(step, ctx);
    } catch (error) {
      console.warn(`[model-router] ${label}: resolve() failed, failing open to the flow/step model — ${errorMessage(error)}`);
      return null;
    }
  };
}

// ---------------------------------------------------------------------------
// smart-local
// ---------------------------------------------------------------------------

/** The step's own atoms, in precedence order — role(s) first, then mods. */
function collectAtomIds(step: AgenticStep): string[] {
  return [...step.roles.map((role) => role.id), ...step.mods.map((mod) => mod.id)];
}

function createSmartLocalPolicy(strategy: SelectionStrategy, deps: Required<ModelRouterDeps>): RoutingPolicy {
  // Memoized once per router instance (i.e. once per flow run) — every step's
  // resolve() call reuses the same fetch instead of re-reading the ledger.
  let sealedPromise: Promise<ArenaLeaderboardEntry[]> | null = null;
  let warnedEmpty = false;
  const getSealed = (): Promise<ArenaLeaderboardEntry[]> => {
    if (!sealedPromise) {
      sealedPromise = deps.getLeaderboard().then(completedEntries);
    }
    return sealedPromise;
  };

  return {
    resolve: withFailOpen('smart-local', async (step, _ctx) => {
      const sealed = await getSealed();
      if (sealed.length === 0) {
        if (!warnedEmpty) {
          warnedEmpty = true;
          console.warn('[model-router] smart-local: no Benchmarked (completed) Arena entries yet — failing open to the flow/step model.');
        }
        return null;
      }

      const sealedIds = new Set(sealed.map((entry) => entry.modelId));
      const sealedById = new Map(sealed.map((entry) => [entry.modelId, entry] as const));

      // 1. betterOn — honored only when the recommended model is itself sealed.
      const betterOnById = deps.getBetterOnById();
      for (const atomId of collectAtomIds(step)) {
        const recommended = betterOnById.get(atomId);
        if (!recommended || !sealedIds.has(recommended)) continue;

        const entry = sealedById.get(recommended)!;
        const evidence = toEvidence(entry);
        return {
          modelId: recommended,
          evidence: {
            source: 'betterOn',
            reason: `role/mod "${atomId}" recommends ${recommended} (Arena score ${evidence.score})`,
            sealed: true,
            score: evidence.score,
            costPerRun: evidence.costPerRun,
            latencyMs: evidence.latencyMs,
          },
        };
      }

      // 2. strategy — the Arena leaderboard winner for the user's chosen lens.
      const winner = selectByStrategy(sealed, strategy);
      if (!winner) return null;

      const evidence = toEvidence(winner);
      return {
        modelId: winner.modelId,
        evidence: {
          source: 'arena-leaderboard',
          strategy,
          reason: `${strategy} winner: score ${evidence.score} at $${evidence.costPerRun}/run`,
          sealed: true,
          score: evidence.score,
          costPerRun: evidence.costPerRun,
          latencyMs: evidence.latencyMs,
        },
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// smart-external
// ---------------------------------------------------------------------------

function createSmartExternalPolicy(deps: Required<ModelRouterDeps>): RoutingPolicy {
  let warnedNoKey = false;

  return {
    resolve: withFailOpen('smart-external', async (_step, _ctx) => {
      if (!deps.hasOpenRouterKey()) {
        if (!warnedNoKey) {
          warnedNoKey = true;
          console.warn('[model-router] smart-external: OPENROUTER_API_KEY is not set — failing open to the flow/step model.');
        }
        return null;
      }

      // Not sealed yet — OpenRouter picks the model at request time. The
      // executor attributes + re-seals this against `respondedModelId` once
      // the provider actually answers (see executor.ts).
      return {
        modelId: 'openrouter/auto',
        evidence: {
          source: 'external-router',
          reason: 'delegated to OpenRouter auto-router',
          sealed: false,
        },
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Builds a `RoutingPolicy` for `policy`, or `null` when `policy.mode ===
 * 'fixed'` — callers should skip the router entirely in that case, there is
 * nothing to resolve.
 */
export function createModelRouter(policy: ModelPolicy, deps?: ModelRouterDeps): RoutingPolicy | null {
  if (policy.mode === 'fixed') return null;

  const resolvedDeps: Required<ModelRouterDeps> = {
    getLeaderboard: deps?.getLeaderboard ?? loadDefaultLeaderboard,
    getBetterOnById: deps?.getBetterOnById ?? loadDefaultBetterOnById,
    hasOpenRouterKey: deps?.hasOpenRouterKey ?? defaultHasOpenRouterKey,
  };

  if (policy.mode === 'smart-local') {
    return createSmartLocalPolicy(policy.strategy, resolvedDeps);
  }

  return createSmartExternalPolicy(resolvedDeps);
}
