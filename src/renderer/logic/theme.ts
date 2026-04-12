/**
 * theme.ts — Renderer UI
 *
 * Architecture note:
 * This file follows the explanatory style used across the codebase:
 * explicit intent, clear boundaries, and behavior-preserving structure.
 */
// src/renderer/utils/theme.ts — Single source of truth for Heliox IDE theme tokens
// All color values used in inline styles should reference these constants.

import { CliProvider, CLI_THEME_COLORS } from '../../types/desktop';

export const theme = {
  // Surfaces
  bg: '#0a0a0a',
  bgDeep: '#0f0f0f',
  bgApp: '#0c0a09',
  surface: '#111111',
  surfaceLight: '#141414',
  surfaceMid: '#171717',
  surfaceCard: '#1a1a1a',
  surfaceRaised: '#1c1c1c',
  surfaceHover: '#262626',

  // Borders
  borderSubtle: 'rgba(63,63,70,0.05)',
  border: 'rgba(63,63,70,0.1)',
  borderLight: 'rgba(63,63,70,0.15)',
  borderMedium: 'rgba(63,63,70,0.2)',
  borderAccent: 'rgba(214,211,209,0.1)',

  // Text
  textPrimary: '#e4e4e7',
  textSecondary: '#d6d3d1',
  textTertiary: '#d4d4d8',
  textMuted: '#a1a1aa',
  textMid: '#a3a3a3',
  textDim: '#808080',
  textFaint: '#636363',
  textGhost: '#525252',

  // Accent
  accentBlue: '#4DA8FF',
  accentBlueBg: 'rgba(77,168,255,0.15)',
  accentBlueSolid: '#2B8AE6',
  accentBlueBorder: 'rgba(77,168,255,0.35)',
  accentBlueHover: '#5CB4FF',
  success: '#A0F695',
  successBg: 'rgba(160,246,149,0.15)',
  successBorder: 'rgba(160,246,149,0.2)',
  danger: '#F02525',
  dangerBg: 'rgba(240,37,37,0.1)',
  dangerBorder: 'rgba(240,37,37,0.2)',
  warning: '#f59e0b',

  // Fonts
  fontMono: "'Liberation Mono', monospace",
  fontGrotesk: "'Atkinson Hyperlegible', 'Inter', 'Segoe UI', Roboto, 'Noto Sans', sans-serif",
  fontManrope: "'Atkinson Hyperlegible', 'Inter', 'Segoe UI', Roboto, 'Noto Sans', sans-serif",
  fontInter: "'Atkinson Hyperlegible', 'Inter', 'Segoe UI', Roboto, 'Noto Sans', sans-serif",
  fontLexend: "'Atkinson Hyperlegible', 'Inter', 'Segoe UI', Roboto, 'Noto Sans', sans-serif",
} as const;

/** Apply CLI theme as CSS custom properties on an element or :root */
export function applyCliTheme(provider: CliProvider, el?: HTMLElement) {
  const target = el ?? document.documentElement;
  const colors = CLI_THEME_COLORS[provider] ?? CLI_THEME_COLORS.copilot;
  target.style.setProperty('--cli-accent', colors.accent);
  target.style.setProperty('--cli-accent-rgb', colors.accentRgb);
}
