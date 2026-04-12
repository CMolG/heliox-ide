/**
 * useTheme.ts — Renderer Hook
 *
 * Responsibility:
 * - Provides the resolved theme tokens based on the active design guideline.
 * - Components call useTheme() instead of importing the base theme directly.
 *
 * Boundaries:
 * - Owns: theme resolution via the design guideline system
 * - Does NOT own: guideline definitions, store state, or CSS injection
 */

import { useMemo } from 'react';
import { useDesktopStore } from '../../store/desktop-store';
import { resolveTheme } from '../design-guidelines/resolver';

export function useTheme() {
  const guidelineId = useDesktopStore((s) => s.designGuidelineId);
  return useMemo(() => resolveTheme(guidelineId), [guidelineId]);
}
