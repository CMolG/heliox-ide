/**
 * file-tree-helpers.ts — Renderer File Tree Support Module
 *
 * Responsibility:
 * - Houses reusable utility functions shared by file-tree rendering components.
 * - Implements lightweight fuzzy matching used for filename filtering in tree UIs.
 *
 * Boundaries:
 * - Owns: pure matching helper behavior for file-tree queries
 * - Does NOT own: filesystem reads, tree state orchestration, or context menu actions
 *
 * Architectural role:
 * - Pure renderer support module for file-tree presentation and filtering workflows.
 */
// src/renderer/components/file-tree-helpers.ts — Shared helpers for FileTree components

export function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}
