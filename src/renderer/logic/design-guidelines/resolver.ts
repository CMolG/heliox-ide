/**
 * resolver.ts — Design Guidelines
 *
 * Responsibility:
 * - Resolves the active design guideline based on user preference.
 * - Merges guideline token overrides onto the base theme.
 *
 * Boundaries:
 * - Owns: guideline selection logic, theme merging
 * - Does NOT own: guideline definitions (families/), store state, or CSS injection
 */

import { theme as baseTheme } from '../theme';
import { guidelines } from './index';
import type { DesignGuideline } from './types';

export function getActiveGuideline(preferenceId?: number | null): DesignGuideline {
  if (preferenceId !== null && preferenceId !== undefined) {
    return guidelines[preferenceId] ?? guidelines[0];
  }
  return guidelines[0];
}

export function resolveTheme(preferenceId?: number | null) {
  const guideline = getActiveGuideline(preferenceId);
  return { ...baseTheme, ...guideline.tokens };
}
