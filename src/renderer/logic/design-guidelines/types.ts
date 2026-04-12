/**
 * types.ts — Design Guidelines
 *
 * Responsibility:
 * - Defines the DesignGuideline interface and related types.
 * - Each guideline is a partial override of the base theme tokens.
 * - 60 guidelines (0–59) map to clock seconds for the auto-selection mechanic.
 *
 * Boundaries:
 * - Owns: type definitions for design guidelines
 * - Does NOT own: resolution logic (resolver.ts), CSS injection (inject.ts), or store state
 */

export type GuidelineFamily =
  | 'void'        // 00–09: ultra-dark, near-invisible
  | 'terminal'    // 10–19: phosphor / retro
  | 'studio'      // 20–29: creative / expressive
  | 'minimal'     // 30–39: professional / clean
  | 'nature'      // 40–49: organic / elemental
  | 'future';     // 50–59: sci-fi / speculative

export interface GuidelineMeta {
  radius: 'none' | 'subtle' | 'default' | 'rounded' | 'pill';
  density: 'compact' | 'default' | 'airy';
  shadow: 'none' | 'flat' | 'elevated' | 'glow' | 'inset';
  animation: 'instant' | 'crisp' | 'smooth' | 'bouncy' | 'slow';
  borderWeight: 'none' | 'hairline' | 'subtle' | 'visible' | 'bold';
}

export interface ThemeTokens {
  // Surfaces
  bg: string; bgDeep: string; bgApp: string;
  surface: string; surfaceLight: string; surfaceMid: string;
  surfaceCard: string; surfaceRaised: string; surfaceHover: string;
  // Borders
  borderSubtle: string; border: string; borderLight: string;
  borderMedium: string; borderAccent: string;
  // Text
  textPrimary: string; textSecondary: string; textTertiary: string;
  textMuted: string; textMid: string; textDim: string;
  textFaint: string; textGhost: string;
  // Accent
  accentBlue: string; accentBlueBg: string; accentBlueSolid: string;
  accentBlueBorder: string; accentBlueHover: string;
  success: string; successBg: string; successBorder: string;
  danger: string; dangerBg: string; dangerBorder: string;
  warning: string;
  // Fonts
  fontMono: string; fontGrotesk: string;
  fontManrope: string; fontInter: string; fontLexend: string;
  // Design meta (injected as CSS vars)
  '--radius-base': string;
  '--shadow-card': string;
  '--transition-base': string;
  '--density-spacing': string;
}

export interface DesignGuideline {
  id: number;                    // 0–59, maps to clock seconds
  name: string;                  // machine slug: 'phosphor', 'velvet', etc.
  displayName: string;           // human label shown in the picker
  family: GuidelineFamily;       // thematic group
  description: string;           // one-line design intent
  tokens: Partial<ThemeTokens>;  // partial overrides applied on top of base theme
  meta: GuidelineMeta;
}
