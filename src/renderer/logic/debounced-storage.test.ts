import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StateStorage } from 'zustand/middleware';
import { DebouncedStorage } from './debounced-storage';

// ─── Helpers ─────────────────────────────────────────────────────

/** A minimal in-memory StateStorage double with spied setItem/getItem/removeItem. */
function makeMockStorage(): StateStorage {
  const data = new Map<string, string>();
  return {
    getItem: vi.fn((name: string) => data.get(name) ?? null),
    setItem: vi.fn((name: string, value: string) => { data.set(name, value); }),
    removeItem: vi.fn((name: string) => { data.delete(name); }),
  };
}

describe('DebouncedStorage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('collapses multiple setItem calls within the debounce window into a single underlying write', () => {
    const inner = makeMockStorage();
    const storage = new DebouncedStorage(inner, 500);

    storage.setItem('k', '{"a":1}');
    vi.advanceTimersByTime(200);
    storage.setItem('k', '{"a":2}');
    vi.advanceTimersByTime(200);
    storage.setItem('k', '{"a":3}');
    vi.advanceTimersByTime(500);

    expect(inner.setItem).toHaveBeenCalledTimes(1);
    expect(inner.setItem).toHaveBeenCalledWith('k', '{"a":3}');
  });

  it('does not write before the debounce window elapses', () => {
    const inner = makeMockStorage();
    const storage = new DebouncedStorage(inner, 500);

    storage.setItem('k', 'value');
    vi.advanceTimersByTime(499);
    expect(inner.setItem).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(inner.setItem).toHaveBeenCalledTimes(1);
  });

  it('debounces each key independently — one underlying write per key', () => {
    const inner = makeMockStorage();
    const storage = new DebouncedStorage(inner, 500);

    storage.setItem('a', '1');
    storage.setItem('b', '2');
    vi.advanceTimersByTime(500);

    expect(inner.setItem).toHaveBeenCalledTimes(2);
    expect(inner.setItem).toHaveBeenCalledWith('a', '1');
    expect(inner.setItem).toHaveBeenCalledWith('b', '2');
  });

  it('getItem returns the pending value before the debounce timer fires (read-your-writes)', () => {
    const inner = makeMockStorage();
    inner.setItem('k', 'old');
    vi.mocked(inner.setItem).mockClear(); // Seeding the double must not count as a "real" write below.
    const storage = new DebouncedStorage(inner, 500);

    storage.setItem('k', 'new');
    expect(storage.getItem('k')).toBe('new');
    expect(inner.setItem).not.toHaveBeenCalled(); // Not flushed yet — inner storage still holds 'old'

    vi.advanceTimersByTime(500);
    expect(storage.getItem('k')).toBe('new');
    expect(inner.setItem).toHaveBeenCalledWith('k', 'new');
  });

  it('getItem falls back to the underlying storage when nothing is pending', () => {
    const inner = makeMockStorage();
    inner.setItem('k', 'persisted-value');
    const storage = new DebouncedStorage(inner, 500);

    expect(storage.getItem('k')).toBe('persisted-value');
  });

  it('flush() writes a pending value immediately and prevents a duplicate later write', () => {
    const inner = makeMockStorage();
    const storage = new DebouncedStorage(inner, 500);

    storage.setItem('k', 'value');
    storage.flush();
    expect(inner.setItem).toHaveBeenCalledTimes(1);
    expect(inner.setItem).toHaveBeenCalledWith('k', 'value');

    // The original timer must be cancelled by flush() — advancing time
    // afterward must not trigger a second underlying write.
    vi.advanceTimersByTime(1000);
    expect(inner.setItem).toHaveBeenCalledTimes(1);
  });

  it('flush() is a no-op when nothing is pending', () => {
    const inner = makeMockStorage();
    const storage = new DebouncedStorage(inner, 500);
    expect(() => storage.flush()).not.toThrow();
    expect(inner.setItem).not.toHaveBeenCalled();
  });

  it('removeItem cancels a pending write for that key and calls through immediately', () => {
    const inner = makeMockStorage();
    const storage = new DebouncedStorage(inner, 500);

    storage.setItem('k', 'value');
    storage.removeItem('k');

    // The cancelled pending write must never reach the underlying storage.
    vi.advanceTimersByTime(1000);
    expect(inner.setItem).not.toHaveBeenCalled();
    expect(inner.removeItem).toHaveBeenCalledWith('k');
    // getItem no longer sees a pending value either.
    expect(storage.getItem('k')).toBe(null);
  });

  it('removeItem does not disturb a pending write for a different key', () => {
    const inner = makeMockStorage();
    const storage = new DebouncedStorage(inner, 500);

    storage.setItem('a', '1');
    storage.removeItem('b');
    vi.advanceTimersByTime(500);

    expect(inner.setItem).toHaveBeenCalledWith('a', '1');
  });

  it('defaults to a ~500ms debounce window when no delay is given', () => {
    const inner = makeMockStorage();
    const storage = new DebouncedStorage(inner);

    storage.setItem('k', 'value');
    vi.advanceTimersByTime(499);
    expect(inner.setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(inner.setItem).toHaveBeenCalledTimes(1);
  });
});

describe('DebouncedStorage — flush on unload/hide', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    // Restore the default visibility state so later tests/files aren't affected.
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  it('flushes pending writes when the document becomes hidden (visibilitychange)', () => {
    const inner = makeMockStorage();
    const storage = new DebouncedStorage(inner, 500);
    storage.setItem('k', 'value');

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(inner.setItem).toHaveBeenCalledWith('k', 'value');
  });

  it('does not flush on visibilitychange when the document stays visible', () => {
    const inner = makeMockStorage();
    const storage = new DebouncedStorage(inner, 500);
    storage.setItem('k', 'value');

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(inner.setItem).not.toHaveBeenCalled();
  });

  it('flushes pending writes on window beforeunload', () => {
    const inner = makeMockStorage();
    const storage = new DebouncedStorage(inner, 500);
    storage.setItem('k', 'value');

    window.dispatchEvent(new Event('beforeunload'));

    expect(inner.setItem).toHaveBeenCalledWith('k', 'value');
  });
});
