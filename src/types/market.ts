/**
 * market.ts — Shared types
 *
 * Architecture note:
 * This file follows the explanatory style used across the codebase:
 * explicit intent, clear boundaries, and behavior-preserving structure.
 */
// src/types/market.ts — Types for the market inventory and backlog system

import type { StepContract } from './harness';

// ─── Market Inventory (mirrors market/inventory.json) ────────────

/**
 * Where a market atom is meaningful. `universal` marks role-agnostic process
 * atoms (e.g. `self-review`). The UI uses domains to hint when a mod is
 * attached outside the active role's domain; the Meta-Agent uses them for
 * auto-selection. Informational — never a hard enforcement boundary.
 */
export type MarketDomain =
  | 'frontend'
  | 'backend'
  | 'web'
  | 'data'
  | 'infra'
  | 'universal';

/**
 * Declarative runtime powers for a market mod — the bridge between pure `.md`
 * prompt injections and TypeScript code-mods. Everything here is inert data
 * interpreted by the engine against built-in capabilities; a market entry can
 * never declare arbitrary command execution (that would reopen the
 * market→RCE hole closed in the 2026-07 audit).
 */
export interface MarketModRuntime {
  /**
   * Tool names stripped from the step's tool surface while this mod is active
   * (e.g. `dry-run` blocks `write_file` so "no code generation" is enforced
   * by the runtime instead of trusted to the prompt).
   */
  blockTools?: string[];
  /**
   * Built-in toolsets granted while this mod is active. `web-browser`
   * attaches the browser_goto / browser_act / browser_extract_seo trio so
   * verification mods (seo-meta, web-vitals…) can check their own claims
   * against the live page.
   */
  attachTools?: string[];
  /**
   * Completion-contract fragment merged into the step's `StepContract` and
   * verified by the guardrail engine with corrective retries (e.g.
   * `test-driven` requires that a test artifact actually exists).
   */
  contract?: StepContract;
}

/** Role accent palette rendered by the attachment pills and app headers. */
export interface MarketRolePalette {
  background: string;
  text: string;
  accents: string;
  hover: string;
}

/**
 * A single step in a `MarketFlow`'s prebuilt pipeline (chats→steps
 * re-architecture, F0 decision 4, 2026-07-10: flows change from an
 * attachable "sealed engine" to a pipeline prebuilt that's copied onto the
 * board as real, independently editable steps).
 *
 * Shaped to convert directly into a `PipelineAssemblyStep` (see
 * `src/types/meta-agent.ts`, the contract `insertPipelineAssembly` —
 * desktop-store.ts — expects) WITHOUT going through `assemblePipeline`: a
 * market flow's steps are pre-authored content, not an LLM-generated intent,
 * so re-generating them via the Meta-Agent would be slower, non-deterministic,
 * and pointless. `MarketplaceApp`'s "Add to board" action builds that
 * `PipelineAssembly` straight from this shape.
 */
export interface MarketFlowStep {
  /**
   * Kebab-case slug, unique within this flow's `steps[]`. Becomes both the
   * inserted step node's id suffix and its display title (title-cased) —
   * see `insertPipelineAssembly`'s `titleFromId`. Also the addressable target
   * for another step's `loopBackTo.stepId` and for `prevStepIds`.
   */
  id: string;
  /** Instruction text materialized verbatim into the inserted step's `prompt`. */
  prompt: string;
  /**
   * Optional persona seeded on the step at insertion time. Left unset for a
   * step with no clear single-persona fit — the step still lands with a
   * "no role" state, freely assignable afterward via the step's helm UI. This
   * is an initial seed only: `validateStepAtoms` (main process) remains the
   * sole runtime authority on Single Persona / mod compatibility, and the
   * user can add/replace/remove roles and mods once the step is on the board.
   */
  roleId?: string;
  /** Optional mods seeded on the step at insertion time (see `roleId` above for the same "seed, not a lock" semantics). */
  modIds?: string[];
  /**
   * Explicit predecessor step ids (by `id`, within the same flow). Omit for
   * the default linear chain: each step follows the previous one in array
   * order (the shape every current market flow needs — a plain ordered
   * pipeline). Present only if a future flow needs a non-linear graph
   * (parallel branches, a router fan-out).
   */
  prevStepIds?: string[];
  /**
   * Bounded loop-back to an earlier step in the SAME flow — the structural
   * translation of a `cost: infinite` "Karpathy loop" flow (its prose used to
   * end in "...commit and loop to the next X"). Re-runs the steps between
   * the target and this one, `maxIterations` total passes; mirrors
   * `PipelineAssemblyStep.loopBackTo` exactly.
   */
  loopBackTo?: { stepId: string; maxIterations: number };
}

export interface MarketFlow {
  name: string;
  betterOn: string;
  recommendedComplexity: 'low' | 'medium' | 'high';
  cost: 'low' | 'medium' | 'high' | 'infinite';
  icon: string;
  iconLibrary: string;
  description: string;
  tags: string[];
  usableBy?: string[];
  /**
   * Prebuilt pipeline steps materialized by "Add to board" (MarketplaceApp) —
   * NOT an attachable surface (that form retired, F0 decision 4). Optional:
   * a flow with no authored `steps[]` (e.g. a single-shot conversational
   * flow whose whole value is one system prompt, like `brainstorm-cards`)
   * falls back to a single mono-step carrying `description` as its prompt.
   */
  steps?: MarketFlowStep[];
}

export interface MarketRole {
  name: string;
  icon: string;
  iconLibrary: string;
  description: string;
  tags: string[];
  color?: string;
  palette?: MarketRolePalette;
  /** Optional model hint, mirroring `MarketFlow.betterOn`. */
  betterOn?: string;
  /** Domains this persona covers (informational; see MarketDomain). */
  domains?: MarketDomain[];
}

export interface MarketMod {
  name: string;
  icon: string;
  iconLibrary: string;
  description: string;
  tags: string[];
  incompatibleWith?: string[];
  /**
   * Mods sharing an `exclusiveGroup` are mutually incompatible — only one can be
   * active at a time. This is how a design system is modeled: as a mod in the
   * `design-system` exclusive group, so two design systems can never stack and
   * blend their concepts.
   */
  exclusiveGroup?: string;
  /** Domains where this mod is meaningful; `['universal']` = role-agnostic. */
  domains?: MarketDomain[];
  /** Declarative runtime powers (tool gating, toolset grants, contracts). */
  runtime?: MarketModRuntime;
}

export interface MarketStep {
  name: string;
  icon: string;
  iconLibrary: string;
  description: string;
  tags: string[];
}

export interface MarketInventory {
  flows: MarketFlow[];
  roles: MarketRole[];
  mods: MarketMod[];
  steps?: MarketStep[];
}

// ─── Backlog Cards (parsed from .backlog/*.md YAML frontmatter) ──

export type BacklogPriority = 'critical' | 'high' | 'medium' | 'low';
export type BacklogStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface BacklogCard {
  filename: string;
  taskId: string;
  targetAgent: string;
  targetModule: string;
  priority: BacklogPriority;
  status: BacklogStatus;
  order: number;
  title: string;
  body: string;
}

// ─── Connector State ─────────────────────────────────────────────

export interface ConnectorState {
  flowId: string | null;
  roleId: string | null;
  modIds: string[];
}

// ─── Loaded Prompt Content (cached from .md files) ───────────────

export interface LoadedPrompt {
  name: string;
  category: 'flows' | 'roles' | 'mods' | 'steps';
  content: string;
}
