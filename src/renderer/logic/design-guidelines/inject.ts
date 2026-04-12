/**
 * inject.ts — Design Guidelines
 *
 * Responsibility:
 * - Injects design guideline meta tokens as CSS custom properties on :root.
 * - Allows deeply nested components to respond to guideline changes without props.
 *
 * Boundaries:
 * - Owns: CSS variable injection for meta tokens
 * - Does NOT own: theme resolution or guideline selection
 */

import type { ThemeTokens } from './types';

const CSS_VARS = ['--radius-base', '--shadow-card', '--transition-base', '--density-spacing'] as const;

export function injectGuidelineCSSVars(tokens: Partial<ThemeTokens>) {
  const root = document.documentElement;
  for (const v of CSS_VARS) {
    if (tokens[v]) {
      root.style.setProperty(v, tokens[v]!);
    }
  }
}
