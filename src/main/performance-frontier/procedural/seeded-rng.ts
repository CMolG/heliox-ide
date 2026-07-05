export interface SeededRng {
  next: () => number;
  int: (minInclusive: number, maxInclusive: number) => number;
  pick: <T>(items: readonly T[]) => T;
}

export function createSeededRng(seed: number): SeededRng {
  let state = seed >>> 0;

  function next(): number {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  }

  return {
    next,
    int: (minInclusive, maxInclusive) => (
      Math.floor(next() * (maxInclusive - minInclusive + 1)) + minInclusive
    ),
    pick: (items) => items[Math.floor(next() * items.length)],
  };
}
