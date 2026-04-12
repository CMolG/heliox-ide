/**
 * helpers.ts — Renderer Center Panel Support Module
 *
 * Responsibility:
 * - Defines shared center-panel constants and data shapes used by diff/session views.
 * - Centralizes git-status visual metadata so center components render consistent badges.
 *
 * Boundaries:
 * - Owns: center-panel helper constants and TypeScript type contracts
 * - Does NOT own: data fetching, IPC boundaries, or React component lifecycle behavior
 *
 * Architectural role:
 * - Pure renderer support module consumed by center-panel UI boundaries.
 */
// src/renderer/components/center/helpers.ts — Shared types and constants for center-panel components

// ─── Git status styling map ──────────────────────────────────────

export const GIT_STATUS: Record<string, { color: string; label: string }> = {
  added:     { color: '#A0F695', label: 'A' },
  untracked: { color: '#A0F695', label: 'U' },
  deleted:   { color: '#F02525', label: 'D' },
  modified:  { color: '#fbbf24', label: 'M' },
  renamed:   { color: '#60a5fa', label: 'R' },
};

// ─── Shared types ────────────────────────────────────────────────

export type GitEntry = { path: string; name: string; isDir: boolean; gitStatus?: string };

export interface DiffHunk {
  header: string;
  lines: Array<{ type: '+' | '-' | ' '; content: string }>;
}

export interface ParsedFileDiff {
  path: string;
  oldPath: string;
  hunks: DiffHunk[];
  linesAdded: number;
  linesRemoved: number;
  isNew: boolean;
  isDeleted: boolean;
}
