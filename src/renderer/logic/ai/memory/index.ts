/**
 * index.ts — AI Memory System (barrel)
 *
 * Responsibility:
 * - Single entry point for the memory sub-package
 * - Re-exports all public types, classes, and utilities
 *
 * Boundaries:
 * - Owns: public API surface of logic/ai/memory
 * - Does NOT own: implementation details (each file owns its own)
 */

// ─── Types ───────────────────────────────────────────────────────
export type {
  MemoryPolarity,
  MemorySignal,
  MemoryEntry,
  RankedDimension,
  NeuralExcitementProfile,
  SerializedExcitementProfile,
} from './types';

// ─── Classes ─────────────────────────────────────────────────────
export { SignalExtractor } from './SignalExtractor';
export { NeuralExcitement } from './NeuralExcitement';
export { MemoryLedger } from './MemoryLedger';
export type { SerializedLedger } from './MemoryLedger';
export { MemoryComposerPlugin } from './MemoryComposerPlugin';
