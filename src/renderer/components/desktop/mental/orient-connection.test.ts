import { describe, it, expect } from 'vitest';
import { orientConnection } from './orient-connection';

describe('orientConnection', () => {
  it('keeps source/target when drag started at the reported source', () => {
    const c = { source: 'a', target: 'b', sourceHandle: 'right', targetHandle: 'left' };
    expect(orientConnection('a', c)).toEqual(c);
  });

  it('swaps source/target (and handles) when drag started at the reported target', () => {
    const c = { source: 'a', target: 'b', sourceHandle: 'right', targetHandle: 'left' };
    expect(orientConnection('b', c)).toEqual({
      source: 'b', target: 'a', sourceHandle: 'left', targetHandle: 'right',
    });
  });

  it('keeps the connection as-is when drag origin is unknown', () => {
    const c = { source: 'a', target: 'b', sourceHandle: null, targetHandle: null };
    expect(orientConnection(null, c)).toEqual(c);
  });
});
