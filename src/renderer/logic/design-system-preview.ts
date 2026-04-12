/**
 * design-system-preview.ts — Renderer Logic
 *
 * Pure compiler that transforms design-system inventory records into resolved
 * preview themes for the canonical applied-preview renderer.
 *
 * Boundaries:
 * - Owns: theme resolution, default derivation, contrast enforcement
 * - Does NOT own: rendering, store mutations, IPC
 */

import type { MarketDesignSystem, MarketDesignSystemPreview } from '@/types/market';

// ─── Public Types ────────────────────────────────────────────────

export interface ResolvedPreviewTheme {
  typography: {
    heading: string;
    body: string;
    mono: string;
  };
  palette: {
    bg: string;
    surface: string;
    text: string;
    accent: string;
    muted: string;   // derived: text at 55% opacity
    border: string;  // derived: text at 15% opacity
  };
  shape: {
    radius: number;
    gap: number;
  };
  components: {
    buttonLabel: string;
    inputPlaceholder: string;
    chipLabel: string;
    cardTitle: string;
    cardMeta: string;
  };
}

export interface PreviewValidationError {
  designSystemName: string;
  missingFields: string[];
}

// ─── Defaults ────────────────────────────────────────────────────

const DEFAULT_TYPOGRAPHY = {
  heading: 'Inter, system-ui, sans-serif',
  body: 'Inter, system-ui, sans-serif',
  mono: "'JetBrains Mono', 'Fira Code', monospace",
};

const DEFAULT_TOKENS = {
  accent: '#6366F1',
  bg: '#FFFFFF',
  surface: '#F4F4F5',
  text: '#18181B',
  radius: 8,
  gap: 8,
};

const DEFAULT_COMPONENTS = {
  buttonLabel: 'Action',
  inputPlaceholder: 'Type here…',
  chipLabel: 'Tag',
  cardTitle: 'Card Title',
  cardMeta: 'Subtitle text',
};

// ─── Color Utilities ─────────────────────────────────────────────

/** Parse a hex color (3, 4, 6, or 8 digit) into [r, g, b]. */
function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3 || h.length === 4) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  const n = parseInt(h.substring(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Relative luminance per WCAG 2.1. */
function relativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map(c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * Returns '#FFFFFF' or '#111111' based on which has better contrast
 * against the given background.
 */
export function deriveContrastText(bgColor: string): string {
  const [r, g, b] = hexToRgb(bgColor);
  return relativeLuminance(r, g, b) > 0.179 ? '#111111' : '#FFFFFF';
}

/** Appends a hex-alpha suffix to a hex color. */
function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  const base = hex.startsWith('#') ? hex : `#${hex}`;
  // Normalize to 6-digit hex
  let h = base.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return `#${h.substring(0, 6)}${a}`;
}

// Light-mode base palette — previews always render on a light background
// while retaining each design system's unique accent, typography, and spacing.
const LIGHT_PALETTE = {
  bg: '#FFFFFF',
  surface: '#F4F4F5',
  text: '#18181B',
};

// ─── Compiler ────────────────────────────────────────────────────

/**
 * Compiles a MarketDesignSystem into a fully resolved preview theme.
 * Fills missing preview fields with defaults derived from accentColor,
 * colorTokens, and sensible fallbacks.
 *
 * Palette is always forced to light-mode so previews remain readable
 * and visually distinct across different design systems.
 */
export function compilePreviewTheme(ds: MarketDesignSystem): ResolvedPreviewTheme {
  const preview = ds.preview;
  const accent = preview?.tokens.accent ?? ds.accentColor ?? DEFAULT_TOKENS.accent;

  // Force light palette for all previews
  const bg = LIGHT_PALETTE.bg;
  const surface = LIGHT_PALETTE.surface;
  const text = LIGHT_PALETTE.text;

  const resolvedText = text;
  const muted = withAlpha(resolvedText, 0.55);
  const border = withAlpha(resolvedText, 0.15);

  return {
    typography: {
      heading: preview?.typography.heading ?? DEFAULT_TYPOGRAPHY.heading,
      body: preview?.typography.body ?? DEFAULT_TYPOGRAPHY.body,
      mono: preview?.typography.mono ?? DEFAULT_TYPOGRAPHY.mono,
    },
    palette: {
      bg,
      surface,
      text: resolvedText,
      accent,
      muted,
      border,
    },
    shape: {
      radius: preview?.tokens.radius ?? DEFAULT_TOKENS.radius,
      gap: preview?.tokens.gap ?? DEFAULT_TOKENS.gap,
    },
    components: {
      buttonLabel: preview?.components.buttonLabel ?? DEFAULT_COMPONENTS.buttonLabel,
      inputPlaceholder: preview?.components.inputPlaceholder ?? DEFAULT_COMPONENTS.inputPlaceholder,
      chipLabel: preview?.components.chipLabel ?? DEFAULT_COMPONENTS.chipLabel,
      cardTitle: preview?.components.cardTitle ?? DEFAULT_COMPONENTS.cardTitle,
      cardMeta: preview?.components.cardMeta ?? DEFAULT_COMPONENTS.cardMeta,
    },
  };
}

// ─── Validation ──────────────────────────────────────────────────

/**
 * Returns a structured validation error if the design system can't
 * produce a usable preview, or null if it's valid.
 *
 * A design system is considered valid if it has either:
 * - A complete `preview` block, or
 * - At minimum an `accentColor` so the compiler can derive defaults
 */
export function validatePreviewData(ds: MarketDesignSystem): PreviewValidationError | null {
  const missing: string[] = [];

  if (!ds.preview && !ds.accentColor) {
    missing.push('preview', 'accentColor');
  }

  if (ds.preview) {
    const p = ds.preview;
    if (!p.typography?.heading) missing.push('preview.typography.heading');
    if (!p.typography?.body) missing.push('preview.typography.body');
    if (!p.typography?.mono) missing.push('preview.typography.mono');
    if (!p.tokens?.accent) missing.push('preview.tokens.accent');
    if (!p.tokens?.bg) missing.push('preview.tokens.bg');
    if (!p.tokens?.surface) missing.push('preview.tokens.surface');
    if (!p.tokens?.text) missing.push('preview.tokens.text');
    if (p.tokens?.radius == null) missing.push('preview.tokens.radius');
    if (p.tokens?.gap == null) missing.push('preview.tokens.gap');
  }

  return missing.length > 0
    ? { designSystemName: ds.name, missingFields: missing }
    : null;
}

/** Batch validation across all design systems. */
export function validateAllDesignSystems(systems: MarketDesignSystem[]): PreviewValidationError[] {
  const errors: PreviewValidationError[] = [];
  for (const ds of systems) {
    const err = validatePreviewData(ds);
    if (err) errors.push(err);
  }
  return errors;
}
