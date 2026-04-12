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
}

export interface MarketDesignSystemPreview {
  typography: {
    heading: string;   // CSS font-family stack
    body: string;      // CSS font-family stack
    mono: string;      // CSS font-family stack
  };
  tokens: {
    accent: string;    // usually mirrors accentColor
    bg: string;
    surface: string;
    text: string;
    radius: number;    // px
    gap: number;       // px base spacing
  };
  components: {
    buttonLabel: string;
    inputPlaceholder: string;
    chipLabel: string;
    cardTitle: string;
    cardMeta: string;
  };
}

// ─── Brand Identity Card Types ───────────────────────────────────

export interface MarketBrandIdentityBrand {
  name: string;
  tagline: string;
  description: string;
  initials: string;
  ctaLabel: string;
  badge: string;
}

export interface MarketBrandIdentityCtaStyle {
  background: string;
  color: string;
  border: string;
  borderRadius: string;
  padding: string;
  fontWeight: string;
  letterSpacing: string;
  textTransform: string;
  fontSize: string;
  cursor: string;
  boxShadow?: string;
  fontFamily?: string;
}

export interface MarketBrandIdentityTheme {
  name: string;
  fontDisplay: string;
  fontBody: string;
  fontMono: string;
  primary: string;
  secondary: string;
  accent: string;
  surface: string;
  text: string;
  textMuted: string;
  textOnPrimary: string;
  border: string;
  radius: string;
  badgeBg: string;
  badgeColor: string;
  spacing: string;
  letterSpacing: string;
  ctaStyle: MarketBrandIdentityCtaStyle;
}

export interface MarketBrandIdentityCard {
  brand: MarketBrandIdentityBrand;
  theme: MarketBrandIdentityTheme;
}

// ─── Design System ──────────────────────────────────────────────

export interface MarketDesignSystem {
  name: string;
  icon: string;
  iconLibrary: string;
  description: string;
  tags: string[];
  /** Primary accent color for the design system (hex) */
  accentColor?: string;
  /** Preview color tokens from the palette */
  colorTokens?: string[];
  /** The full design system prompt/spec injected into constraints (loaded from market/design-systems/*.md) */
  prompt?: string;
  /** Micro-preview spec for visual sample rendering */
  preview?: MarketDesignSystemPreview;
  /** Brand Identity Card data for rich preview rendering */
  brandIdentityCard?: MarketBrandIdentityCard;
}

export interface MarketInventory {
  flows: MarketFlow[];
  roles: MarketRole[];
  mods: MarketMod[];
  designSystems: MarketDesignSystem[];
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
  category: 'flows' | 'roles' | 'mods' | 'design-systems';
  content: string;
}
