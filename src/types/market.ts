/**
 * market.ts — Shared types
 *
 * Architecture note:
 * This file follows the explanatory style used across the codebase:
 * explicit intent, clear boundaries, and behavior-preserving structure.
 */
// src/types/market.ts — Types for the market inventory and backlog system

// ─── Market Inventory (mirrors market/inventory.json) ────────────

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
}

export interface MarketRole {
  name: string;
  icon: string;
  iconLibrary: string;
  description: string;
  tags: string[];
  color?: string;
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
