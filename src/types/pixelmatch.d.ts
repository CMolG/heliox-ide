/**
 * pixelmatch.d.ts — Shared types
 *
 * Architecture note:
 * This file follows the explanatory style used across the codebase:
 * explicit intent, clear boundaries, and behavior-preserving structure.
 */
declare module 'pixelmatch' {
  function pixelmatch(
    img1: Buffer | Uint8Array,
    img2: Buffer | Uint8Array,
    output: Buffer | Uint8Array | null,
    width: number,
    height: number,
    options?: { threshold?: number; includeAA?: boolean; alpha?: number; aaColor?: [number, number, number]; diffColor?: [number, number, number]; diffColorAlt?: [number, number, number]; diffMask?: boolean }
  ): number;
  export default pixelmatch;
}
