/**
 * engine-bridge.test.ts — Renderer store bridge tests
 *
 * Architecture note:
 * This file follows the explanatory style used across the codebase:
 * explicit intent, clear boundaries, and behavior-preserving structure.
 */
// src/renderer/store/engine-bridge.test.ts — unit tests for the daba-engine <-> desktop-store camera bridge
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// engineStore and useDesktopStore are BOTH module-level singletons, created
// once at import time (see engine-bridge.ts's own doc-comment: the engine's
// initial camera is seeded synchronously from useDesktopStore.getState() at
// that exact moment, mirroring how useDesktopStore itself is hydrated
// synchronously by zustand-persist during its own `create()` call). To
// exercise "hydrates from whatever was already persisted" for different
// persisted values, each test seeds localStorage FIRST, then does
// vi.resetModules() + a fresh dynamic import() so both singletons are
// re-created from scratch against that seed — a static top-of-file import
// would only ever observe ONE hydration (whatever localStorage held on this
// file's very first import).
describe('engine-bridge', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  afterEach(() => {
    localStorage.clear();
  });

  async function loadFresh() {
    const { useDesktopStore } = await import('./desktop-store');
    const { engineStore } = await import('./engine-bridge');
    return { useDesktopStore, engineStore };
  }

  function seedPersisted(canvasPan: { x: number; y: number }, canvasZoom: number) {
    localStorage.setItem('fluxor-desktop', JSON.stringify({
      state: { canvasPan, canvasZoom },
      version: 20,
    }));
  }

  // ─── Hydration ─────────────────────────────────────────────────

  it('hydrates the engine camera from whatever desktop-store already persisted', async () => {
    seedPersisted({ x: 10, y: 20 }, 1.5);
    const { engineStore } = await loadFresh();
    expect(engineStore.getState().camera).toEqual({ pan: { x: 10, y: 20 }, zoom: 1.5 });
  });

  it('defaults to the origin / zoom-1 camera when nothing was persisted', async () => {
    const { engineStore } = await loadFresh();
    expect(engineStore.getState().camera).toEqual({ pan: { x: 0, y: 0 }, zoom: 1 });
  });

  // ─── Motor -> espejo ───────────────────────────────────────────

  it('propagates engine camera changes back into the desktop-store mirror', async () => {
    const { useDesktopStore, engineStore } = await loadFresh();
    engineStore.setState({ camera: { pan: { x: 99, y: 1 }, zoom: 2 } });
    expect(useDesktopStore.getState().canvasPan).toEqual({ x: 99, y: 1 });
    expect(useDesktopStore.getState().canvasZoom).toBe(2);
  });

  it('does not touch the mirror when a non-camera key changes on the engine store', async () => {
    const { useDesktopStore, engineStore } = await loadFresh();
    const panBefore = useDesktopStore.getState().canvasPan;
    engineStore.setState({ selection: { ids: new Set(['x']) } });
    // Reference-stable: the bridge's onChange bailed out (patchKeys did not
    // include 'camera'), so useDesktopStore.setState was never called.
    expect(useDesktopStore.getState().canvasPan).toBe(panBefore);
  });

  // ─── Acción -> motor (delegación) ───────────────────────────────

  it('setCanvasPan delegates to the engine and echoes back into the mirror', async () => {
    const { useDesktopStore, engineStore } = await loadFresh();
    useDesktopStore.getState().setCanvasPan({ x: 5, y: 6 });
    expect(engineStore.getState().camera.pan).toEqual({ x: 5, y: 6 });
    expect(useDesktopStore.getState().canvasPan).toEqual({ x: 5, y: 6 });
  });

  it('setCanvasZoom delegates to the engine, preserving the exact [0.25, 3] clamp', async () => {
    const { useDesktopStore, engineStore } = await loadFresh();

    useDesktopStore.getState().setCanvasZoom(1.5);
    expect(engineStore.getState().camera.zoom).toBe(1.5);
    expect(useDesktopStore.getState().canvasZoom).toBe(1.5);

    useDesktopStore.getState().setCanvasZoom(5); // above max
    expect(engineStore.getState().camera.zoom).toBe(3);
    expect(useDesktopStore.getState().canvasZoom).toBe(3);

    useDesktopStore.getState().setCanvasZoom(0.1); // below min
    expect(engineStore.getState().camera.zoom).toBe(0.25);
    expect(useDesktopStore.getState().canvasZoom).toBe(0.25);
  });

  it('setCanvasPan and setCanvasZoom never clobber the other half of the camera', async () => {
    const { useDesktopStore } = await loadFresh();
    useDesktopStore.getState().setCanvasZoom(2);
    useDesktopStore.getState().setCanvasPan({ x: 3, y: 4 });
    expect(useDesktopStore.getState().canvasZoom).toBe(2);

    useDesktopStore.getState().setCanvasPan({ x: 9, y: 9 });
    useDesktopStore.getState().setCanvasZoom(2.5);
    expect(useDesktopStore.getState().canvasPan).toEqual({ x: 9, y: 9 });
  });

  // ─── Ida y vuelta, sin reentrancia infinita ─────────────────────

  it('round-trips (action -> engine -> mirror, and engine -> mirror directly) without reentrancy', async () => {
    const { useDesktopStore, engineStore } = await loadFresh();
    const listener = vi.fn();
    const unsubscribe = engineStore.subscribe(listener);

    useDesktopStore.getState().setCanvasPan({ x: 7, y: 8 });
    expect(listener).toHaveBeenCalledTimes(1); // exactly one engine notification, no cascade
    expect(useDesktopStore.getState().canvasPan).toEqual({ x: 7, y: 8 });

    // Simulate the engine itself changing the camera (e.g. a live pan
    // gesture inside <DabaCanvas>) — must reach the mirror without bouncing
    // back into the engine a second time (would show up as a 3rd+ call).
    engineStore.setState({ camera: { pan: { x: 11, y: 12 }, zoom: 1 } });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(useDesktopStore.getState().canvasPan).toEqual({ x: 11, y: 12 });

    // The bridge must still be perfectly usable afterward — no stuck/broken
    // state left over from the round trip.
    useDesktopStore.getState().setCanvasPan({ x: 13, y: 14 });
    expect(listener).toHaveBeenCalledTimes(3);
    expect(engineStore.getState().camera.pan).toEqual({ x: 13, y: 14 });
    expect(useDesktopStore.getState().canvasPan).toEqual({ x: 13, y: 14 });

    unsubscribe();
  });

  // ─── Flujo switchBoard / deleteBoard / duplicateBoard ───────────

  it('switchBoard pushes the ENTERING board camera to the engine AND the mirror', async () => {
    const { useDesktopStore, engineStore } = await loadFresh();
    const store = useDesktopStore.getState();

    store.setCanvasPan({ x: 50, y: 75 });
    store.setCanvasZoom(1.5);
    const board2Id = store.createBoard('Board 2'); // switches into board-2 immediately (0,0 / 1)

    expect(engineStore.getState().camera).toEqual({ pan: { x: 0, y: 0 }, zoom: 1 });

    useDesktopStore.getState().setCanvasPan({ x: 999, y: 999 });
    useDesktopStore.getState().setCanvasZoom(2);
    expect(engineStore.getState().camera).toEqual({ pan: { x: 999, y: 999 }, zoom: 2 });

    // Switch back to board-1 — its camera (50,75 / 1.5) must land in BOTH
    // the engine and the mirror, not just the mirror (the bug a generic
    // set()-only implementation of switchBoard would have).
    useDesktopStore.getState().switchBoard('board-1');
    expect(useDesktopStore.getState().canvasPan).toEqual({ x: 50, y: 75 });
    expect(useDesktopStore.getState().canvasZoom).toBe(1.5);
    expect(engineStore.getState().camera).toEqual({ pan: { x: 50, y: 75 }, zoom: 1.5 });

    // board-2's OWN snapshot still preserves what was set while it was
    // active, untouched by switching back to board-1.
    const board2 = useDesktopStore.getState().boards.find(b => b.id === board2Id)!;
    expect(board2.snapshot!.canvasPan).toEqual({ x: 999, y: 999 });
    expect(board2.snapshot!.canvasZoom).toBe(2);
  });

  it('duplicateBoard does NOT push to the engine — it never changes the active camera', async () => {
    const { useDesktopStore, engineStore } = await loadFresh();
    useDesktopStore.getState().setCanvasPan({ x: 42, y: 24 });
    useDesktopStore.getState().setCanvasZoom(1.75);

    const cameraBefore = engineStore.getState().camera;
    useDesktopStore.getState().duplicateBoard('board-1');

    expect(useDesktopStore.getState().activeBoardId).toBe('board-1'); // unaffected — duplicateBoard never switches
    // Reference-stable: proves engineStore.setState was never even called,
    // not just that the values happen to still match.
    expect(engineStore.getState().camera).toBe(cameraBefore);
    expect(useDesktopStore.getState().canvasPan).toEqual({ x: 42, y: 24 });
    expect(useDesktopStore.getState().canvasZoom).toBe(1.75);
  });

  it('deleteBoard only pushes to the engine when the ACTIVE board is the one deleted', async () => {
    const { useDesktopStore, engineStore } = await loadFresh();
    const store = useDesktopStore.getState();
    store.setCanvasPan({ x: 1, y: 1 });
    store.setCanvasZoom(1);
    // 3 boards so deleting the middle one (inactive) still leaves 2 behind
    // (deleteBoard refuses to delete the last remaining board, so this
    // scenario needs board-1 to survive both deletes below).
    store.createBoard('Board 2');
    const board3Id = useDesktopStore.getState().createBoard('Board 3');
    useDesktopStore.getState().setCanvasPan({ x: 2, y: 2 });
    useDesktopStore.getState().setCanvasZoom(1.2);

    // Delete an INACTIVE board (board-2) while board-3 is active: must NOT
    // touch the active camera, and must NOT push anything to the engine.
    const board2Id = useDesktopStore.getState().boards.find(b => b.name === 'Board 2')!.id;
    const cameraBefore = engineStore.getState().camera;
    useDesktopStore.getState().deleteBoard(board2Id);
    expect(useDesktopStore.getState().activeBoardId).toBe(board3Id);
    expect(engineStore.getState().camera).toBe(cameraBefore);

    // Now delete the ACTIVE board (board-3; board-1 and board-3 are the only
    // 2 left) — must fall back to the remaining neighbor (board-1) AND push
    // ITS camera to the engine.
    useDesktopStore.getState().deleteBoard(board3Id);
    expect(useDesktopStore.getState().canvasPan).toEqual({ x: 1, y: 1 });
    expect(useDesktopStore.getState().canvasZoom).toBe(1);
    expect(engineStore.getState().camera).toEqual({ pan: { x: 1, y: 1 }, zoom: 1 });
  });

  // ─── navigateToWindow (4th crude write site found while auditing) ─

  it('navigateToWindow (used by Dock.tsx) also delegates through setCanvasPan, not a raw set()', async () => {
    const { useDesktopStore, engineStore } = await loadFresh();
    const id = useDesktopStore.getState().addWindow('plugin', { position: { x: 100, y: 100 } });
    useDesktopStore.getState().navigateToWindow(id);
    // Whatever pan navigateToWindow computed, the engine must have received
    // the SAME value — not just the mirror (which a raw set() would still
    // update, silently desyncing it from the engine).
    expect(engineStore.getState().camera.pan).toEqual(useDesktopStore.getState().canvasPan);
  });
});
