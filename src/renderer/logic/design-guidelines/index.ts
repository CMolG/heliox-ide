/**
 * index.ts — Design Guidelines
 *
 * Responsibility:
 * - Assembles all 60 design guidelines from the 6 family files.
 * - Exports the guidelines array indexed by ID (0–59).
 *
 * Boundaries:
 * - Owns: guideline registry assembly
 * - Does NOT own: individual guideline definitions (families/), resolution logic (resolver.ts)
 */

import { voidFamily } from './families/void';
import { terminalFamily } from './families/terminal';
import { studioFamily } from './families/studio';
import { minimalFamily } from './families/minimal';
import { natureFamily } from './families/nature';
import { futureFamily } from './families/future';
import type { DesignGuideline } from './types';

const allFamilies = [
  ...voidFamily,
  ...terminalFamily,
  ...studioFamily,
  ...minimalFamily,
  ...natureFamily,
  ...futureFamily,
];

// Build a 60-slot array indexed by guideline ID for O(1) lookup
export const guidelines: DesignGuideline[] = new Array(60);
for (const g of allFamilies) {
  guidelines[g.id] = g;
}

// Re-exports
export type { DesignGuideline, GuidelineFamily, GuidelineMeta, ThemeTokens } from './types';
export { getActiveGuideline, resolveTheme } from './resolver';
export { injectGuidelineCSSVars } from './inject';
