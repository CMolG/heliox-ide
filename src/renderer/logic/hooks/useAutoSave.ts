/**
 * useAutoSave.ts — Renderer UI
 *
 * Architecture note:
 * This file follows the explanatory style used across the codebase:
 * explicit intent, clear boundaries, and behavior-preserving structure.
 */
import { useEffect, useRef } from 'react';

export function useAutoSave(deps: unknown[], save: () => void, delay = 1000) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(save, delay);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}
