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

  // ─── Task 13 (adoption plan #20): settings.snapToGrid/snapGridCellSize
  // -> engine snap.grid mirror ──────────────────────────────────────
  // One-way mirror (settings stay the source of truth, persisted as always)
  // — see engine-bridge.ts's pushSnapSettingsToEngine doc-comment. Unlike
  // the camera bridge, there is no round-trip to verify (nothing ever writes
  // snap.grid FROM the engine back into settings).

  it('defaults the engine grid to disabled, 24px cell, when nothing was persisted', async () => {
    const { engineStore } = await loadFresh();
    expect(engineStore.getState().snap.grid).toEqual({
      enabled: false,
      spec: { cell: { width: 24, height: 24, gap: 0 }, padding: { x: 0, y: 0 }, originY: 0 },
    });
  });

  it('hydrates the engine grid from whatever desktop-store already persisted', async () => {
    localStorage.setItem('fluxor-desktop', JSON.stringify({
      state: { settings: { canvasClickAnimation: true, tourCompleted: false, tutorialCompleted: {}, snapToGrid: true, snapGridCellSize: 32 } },
      version: 20,
    }));
    const { engineStore } = await loadFresh();
    expect(engineStore.getState().snap.grid).toEqual({
      enabled: true,
      spec: { cell: { width: 32, height: 32, gap: 0 }, padding: { x: 0, y: 0 }, originY: 0 },
    });
  });

  it('updateSettings({snapToGrid: true}) enables the engine grid (default 24px cell)', async () => {
    const { useDesktopStore, engineStore } = await loadFresh();
    useDesktopStore.getState().updateSettings({ snapToGrid: true });
    expect(engineStore.getState().snap.grid.enabled).toBe(true);
    expect(engineStore.getState().snap.grid.spec.cell).toEqual({ width: 24, height: 24, gap: 0 });
  });

  it('updateSettings({snapGridCellSize}) resizes the engine grid cell', async () => {
    const { useDesktopStore, engineStore } = await loadFresh();
    useDesktopStore.getState().updateSettings({ snapToGrid: true, snapGridCellSize: 16 });
    expect(engineStore.getState().snap.grid.spec.cell).toEqual({ width: 16, height: 16, gap: 0 });
  });

  it('updateSettings still merges into settings exactly as before (patch semantics untouched)', async () => {
    const { useDesktopStore } = await loadFresh();
    useDesktopStore.getState().updateSettings({ canvasClickAnimation: false });
    expect(useDesktopStore.getState().settings.canvasClickAnimation).toBe(false);
    expect(useDesktopStore.getState().settings.tourCompleted).toBe(false); // untouched fields survive the merge
  });

  it('an unrelated settings patch does not touch the engine snap.grid reference', async () => {
    const { useDesktopStore, engineStore } = await loadFresh();
    const gridBefore = engineStore.getState().snap.grid;
    useDesktopStore.getState().updateSettings({ canvasClickAnimation: false });
    // Reference-stable: pushSnapSettingsToEngine's guard bailed out (same
    // enabled/cell-width as before), so engineStore.setState was never even
    // called for `snap` — not just that the values happen to still match.
    expect(engineStore.getState().snap.grid).toBe(gridBefore);
  });

  // ─── Task 13, Fase 2: engine.items mirror ────────────────────────
  // See engine-bridge.ts's "PERFORMANCE CONTRACT" doc-comment above
  // syncEngineItems for the full rationale — SideToolbar (motor) subscribes
  // to the WHOLE items record unconditionally, and MentalGraphCanvas commits
  // a position patch on every drag FRAME (not just drag-stop), so a naive
  // "setState on every geometry change" would storm InspectorPanel's
  // always-mounted subtree during any node drag. These tests pin down the
  // resulting contract directly at the bridge level (InspectorPanel.test.tsx
  // pins the SAME contract end-to-end via a <Profiler> commit count).

  describe('engine.items mirror', () => {
    it('is empty when nothing exists', async () => {
      const { engineStore } = await loadFresh();
      expect(engineStore.getState().items).toEqual({});
    });

    it('adding a window creates a namespaced win: entry and notifies subscribers', async () => {
      const { useDesktopStore, engineStore } = await loadFresh();
      const listener = vi.fn();
      engineStore.subscribe(listener);

      const id = useDesktopStore.getState().addWindow('plugin', {
        position: { x: 10, y: 20 }, size: { width: 100, height: 50 }, title: 'My Plugin',
      });

      expect(listener).toHaveBeenCalled();
      expect(engineStore.getState().items[`win:${id}`]).toMatchObject({
        id: `win:${id}`, kind: 'window',
        position: { x: 10, y: 20 }, size: { width: 100, height: 50 },
        meta: { label: 'My Plugin' },
      });
    });

    it('adding a grid creates a namespaced grid: entry, falling back to "Grid CxR" when untitled', async () => {
      const { useDesktopStore, engineStore } = await loadFresh();
      const id = useDesktopStore.getState().addGrid({ position: { x: 1, y: 2 }, columns: 2, rows: 3 });
      expect(engineStore.getState().items[`grid:${id}`]).toMatchObject({
        kind: 'grid', meta: { label: 'Grid 2×3' },
      });
    });

    it('adding a mental card / step / frame creates mental:/step:/flow: entries respectively', async () => {
      const { useDesktopStore, engineStore } = await loadFresh();
      const store = useDesktopStore.getState();
      const cardId = store.addMentalNode({ position: { x: 0, y: 0 }, width: 10, height: 10, text: 'note', color: '#fff', shape: 'square' });
      const stepId = store.addStepNode({ position: { x: 0, y: 0 }, title: 'Step 1' });
      const frameId = store.addFrameNode({ position: { x: 0, y: 0 }, width: 300, height: 200, title: 'Flow 1', childIds: [] });

      const items = engineStore.getState().items;
      expect(items[`mental:${cardId}`]).toMatchObject({ kind: 'mental', meta: { label: 'note' } });
      expect(items[`step:${stepId}`]).toMatchObject({ kind: 'step', meta: { label: 'Step 1' } });
      expect(items[`flow:${frameId}`]).toMatchObject({ kind: 'flow', meta: { label: 'Flow 1' } });
    });

    it('repositioning an EXISTING window does NOT notify engineStore subscribers, but a later read sees the new position', async () => {
      const { useDesktopStore, engineStore } = await loadFresh();
      const id = useDesktopStore.getState().addWindow('plugin', { position: { x: 0, y: 0 } });

      const listener = vi.fn();
      engineStore.subscribe(listener);
      useDesktopStore.getState().moveWindow(id, { x: 999, y: 888 });

      expect(listener).not.toHaveBeenCalled();
      expect(engineStore.getState().items[`win:${id}`].position).toEqual({ x: 999, y: 888 });
    });

    it('repositioning an EXISTING mental node does NOT notify (the exact shape of a React Flow drag-frame commit)', async () => {
      const { useDesktopStore, engineStore } = await loadFresh();
      const id = useDesktopStore.getState().addStepNode({ position: { x: 0, y: 0 }, title: 'Draggable' });

      const listener = vi.fn();
      engineStore.subscribe(listener);
      // updateMentalNode is exactly what MentalGraphCanvas's onNodesChange
      // calls on every frame of a live drag.
      useDesktopStore.getState().updateMentalNode(id, { position: { x: 42, y: 43 } });
      useDesktopStore.getState().updateMentalNode(id, { position: { x: 44, y: 45 } });
      useDesktopStore.getState().updateMentalNode(id, { position: { x: 46, y: 47 } });

      expect(listener).not.toHaveBeenCalled();
      expect(engineStore.getState().items[`step:${id}`].position).toEqual({ x: 46, y: 47 });
    });

    it('removing a window deletes its entry and DOES notify subscribers', async () => {
      const { useDesktopStore, engineStore } = await loadFresh();
      const id = useDesktopStore.getState().addWindow('plugin', { position: { x: 0, y: 0 } });

      const listener = vi.fn();
      engineStore.subscribe(listener);
      useDesktopStore.getState().removeWindow(id);

      expect(listener).toHaveBeenCalled();
      expect(engineStore.getState().items[`win:${id}`]).toBeUndefined();
    });

    it('removing a mental node deletes its entry and DOES notify subscribers', async () => {
      const { useDesktopStore, engineStore } = await loadFresh();
      const id = useDesktopStore.getState().addMentalNode({ position: { x: 0, y: 0 }, width: 10, height: 10, text: 'x', color: '#fff', shape: 'square' });

      const listener = vi.fn();
      engineStore.subscribe(listener);
      useDesktopStore.getState().removeMentalNode(id);

      expect(listener).toHaveBeenCalled();
      expect(engineStore.getState().items[`mental:${id}`]).toBeUndefined();
    });

    it('renaming a window mutates meta.label in place without notifying, and a later read sees the new title', async () => {
      const { useDesktopStore, engineStore } = await loadFresh();
      const id = useDesktopStore.getState().addWindow('plugin', { position: { x: 0, y: 0 }, title: 'Old' });
      const itemBefore = engineStore.getState().items[`win:${id}`];

      const listener = vi.fn();
      engineStore.subscribe(listener);
      useDesktopStore.getState().updateWindowTitle(id, 'New');

      expect(listener).not.toHaveBeenCalled();
      // Same object reference (mutated, not replaced) — this is exactly what
      // lets a click-time read (locate/rename-seed) stay fresh with zero
      // notification, see the PERFORMANCE CONTRACT doc-comment.
      expect(engineStore.getState().items[`win:${id}`]).toBe(itemBefore);
      expect(engineStore.getState().items[`win:${id}`].meta).toEqual({ label: 'New' });
    });
  });

  // ─── Task 13, Fase 2: engine.selection mirror ────────────────────
  // Unidirectional (domain -> motor), ONLY selectedMentalNodeIds — never
  // selectedWindowIds (task13-decisiones.md Q2).

  describe('engine.selection mirror', () => {
    it('mirrors selectedMentalNodeIds as namespaced ids, resolved by each node\'s own kind', async () => {
      const { useDesktopStore, engineStore } = await loadFresh();
      const store = useDesktopStore.getState();
      const stepId = store.addStepNode({ position: { x: 0, y: 0 }, title: 'S' });
      const frameId = store.addFrameNode({ position: { x: 0, y: 0 }, width: 10, height: 10, title: 'F', childIds: [] });

      useDesktopStore.getState().setSelectedMentalNodeIds([stepId, frameId]);

      expect(engineStore.getState().selection.ids).toEqual(new Set([`step:${stepId}`, `flow:${frameId}`]));
    });

    it('clears back to an empty selection set', async () => {
      const { useDesktopStore, engineStore } = await loadFresh();
      const stepId = useDesktopStore.getState().addStepNode({ position: { x: 0, y: 0 }, title: 'S' });
      useDesktopStore.getState().setSelectedMentalNodeIds([stepId]);
      useDesktopStore.getState().setSelectedMentalNodeIds([]);
      expect(engineStore.getState().selection.ids).toEqual(new Set());
    });

    it('never reflects selectedWindowIds — selecting windows leaves engine.selection untouched', async () => {
      const { useDesktopStore, engineStore } = await loadFresh();
      const id = useDesktopStore.getState().addWindow('plugin', { position: { x: 0, y: 0 } });
      useDesktopStore.getState().setSelectedWindowIds([id]);
      expect(engineStore.getState().selection.ids).toEqual(new Set());
    });

    it('a stale (deleted-elsewhere) selected id still namespaces gracefully, without throwing', async () => {
      const { useDesktopStore, engineStore } = await loadFresh();
      expect(() => useDesktopStore.getState().setSelectedMentalNodeIds(['ghost-id'])).not.toThrow();
      expect(engineStore.getState().selection.ids).toEqual(new Set(['mental:ghost-id']));
    });
  });

  // ─── Task 13, Fase 2: window hover <-> engine.hoveredItemId ──────
  // Bidirectional, WINDOWS ONLY (task13-decisiones.md Q4) — see
  // engine-bridge.ts's own section doc-comment for the full contract.

  describe('window hover <-> engine.hoveredItemId', () => {
    it('engine.hoveredItemId = "win:x" (set by a NodeTree row, motor-owned) mirrors into hoveredWindowId', async () => {
      const { useDesktopStore, engineStore } = await loadFresh();
      const id = useDesktopStore.getState().addWindow('plugin', { position: { x: 0, y: 0 } });
      engineStore.setState({ hoveredItemId: `win:${id}` });
      expect(useDesktopStore.getState().hoveredWindowId).toBe(id);
    });

    it('engine.hoveredItemId pointing at a NON-window kind clears hoveredWindowId to null', async () => {
      const { useDesktopStore, engineStore } = await loadFresh();
      const id = useDesktopStore.getState().addWindow('plugin', { position: { x: 0, y: 0 } });
      engineStore.setState({ hoveredItemId: `win:${id}` });
      expect(useDesktopStore.getState().hoveredWindowId).toBe(id);

      engineStore.setState({ hoveredItemId: 'mental:some-node' });
      expect(useDesktopStore.getState().hoveredWindowId).toBeNull();
    });

    it('setHoveredWindowId(id) delegates through to engine.hoveredItemId as "win:id"', async () => {
      const { useDesktopStore, engineStore } = await loadFresh();
      const id = useDesktopStore.getState().addWindow('plugin', { position: { x: 0, y: 0 } });
      useDesktopStore.getState().setHoveredWindowId(id);
      expect(engineStore.getState().hoveredItemId).toBe(`win:${id}`);
      expect(useDesktopStore.getState().hoveredWindowId).toBe(id);
    });

    it('setHoveredWindowId(null) clears engine.hoveredItemId when it was pointing at that same window', async () => {
      const { useDesktopStore, engineStore } = await loadFresh();
      const id = useDesktopStore.getState().addWindow('plugin', { position: { x: 0, y: 0 } });
      useDesktopStore.getState().setHoveredWindowId(id);
      useDesktopStore.getState().setHoveredWindowId(null);
      expect(engineStore.getState().hoveredItemId).toBeNull();
    });

    it('setHoveredWindowId(null) does NOT clobber an in-progress hover on a non-window item', async () => {
      const { useDesktopStore, engineStore } = await loadFresh();
      engineStore.setState({ hoveredItemId: 'mental:some-node' });
      useDesktopStore.getState().setHoveredWindowId(null);
      // The guard: clearing a window hover that was never set must not
      // blow away an unrelated mental/step/frame/grid row's hover.
      expect(engineStore.getState().hoveredItemId).toBe('mental:some-node');
    });
  });

  // ─── Task 13, Fase 2: InspectorPanel collapse <-> engine.chrome.panels ──
  // Bidirectional — settings.showInspector stays the persisted source of
  // truth (App.tsx's width/opacity styling, the Cmd+. shortcut, every other
  // updateSettings({showInspector}) call site keep reading/writing it
  // unchanged); SideToolbar's OWN collapse/expand buttons write
  // engine.chrome.panels.sideToolbar directly (no prop to intercept that),
  // so THIS mirror is what keeps the two in lockstep both ways.

  describe('InspectorPanel collapse <-> engine.chrome.panels', () => {
    it('defaults the engine panel to open when nothing was persisted (absence = open, same convention as SideToolbar\'s own `?? true`)', async () => {
      const { engineStore } = await loadFresh();
      // pushInspectorOpenToEngine's own guard skips the initial push here —
      // both sides already agree it's "open" by absence (default settings
      // has no showInspector key either), so there is nothing to notify.
      // The key genuinely being absent IS the correct/expected state, not a
      // bug — SideToolbar reads it as `state.chrome.panels[panelKey] ?? true`.
      expect(engineStore.getState().chrome.panels['sideToolbar'] ?? true).toBe(true);
    });

    it('hydrates the engine panel from whatever desktop-store already persisted (showInspector: false)', async () => {
      localStorage.setItem('fluxor-desktop', JSON.stringify({
        state: { settings: { canvasClickAnimation: true, tourCompleted: false, tutorialCompleted: {}, showInspector: false } },
        version: 20,
      }));
      const { engineStore } = await loadFresh();
      expect(engineStore.getState().chrome.panels['sideToolbar']).toBe(false);
    });

    it('updateSettings({showInspector: false}) collapses the engine panel', async () => {
      const { useDesktopStore, engineStore } = await loadFresh();
      useDesktopStore.getState().updateSettings({ showInspector: false });
      expect(engineStore.getState().chrome.panels['sideToolbar']).toBe(false);
    });

    it('updateSettings({showInspector: true}) re-expands the engine panel', async () => {
      const { useDesktopStore, engineStore } = await loadFresh();
      useDesktopStore.getState().updateSettings({ showInspector: false });
      useDesktopStore.getState().updateSettings({ showInspector: true });
      expect(engineStore.getState().chrome.panels['sideToolbar']).toBe(true);
    });

    it('an unrelated settings patch does not touch the engine chrome.panels reference', async () => {
      const { useDesktopStore, engineStore } = await loadFresh();
      const chromeBefore = engineStore.getState().chrome;
      useDesktopStore.getState().updateSettings({ canvasClickAnimation: false });
      expect(engineStore.getState().chrome).toBe(chromeBefore);
    });

    it('SideToolbar\'s own collapse (a raw engine chrome.panels write) mirrors back into settings.showInspector', async () => {
      const { useDesktopStore, engineStore } = await loadFresh();
      // Simulates what SideToolbar's internal setOpen(false) does — a raw
      // engine setState, exactly as the motor's own collapse button would
      // trigger, never going through any Fluxor action.
      const { chrome } = engineStore.getState();
      engineStore.setState({ chrome: { ...chrome, panels: { ...chrome.panels, sideToolbar: false } } });
      expect(useDesktopStore.getState().settings.showInspector).toBe(false);
    });

    it('SideToolbar\'s own re-expand mirrors back into settings.showInspector too', async () => {
      const { useDesktopStore, engineStore } = await loadFresh();
      const { chrome: chrome1 } = engineStore.getState();
      engineStore.setState({ chrome: { ...chrome1, panels: { ...chrome1.panels, sideToolbar: false } } });
      const { chrome: chrome2 } = engineStore.getState();
      engineStore.setState({ chrome: { ...chrome2, panels: { ...chrome2.panels, sideToolbar: true } } });
      expect(useDesktopStore.getState().settings.showInspector).toBe(true);
    });

    it('round-trips without reentrancy (action -> engine -> mirror, and engine -> mirror directly)', async () => {
      const { useDesktopStore, engineStore } = await loadFresh();
      const listener = vi.fn();
      engineStore.subscribe(listener);

      useDesktopStore.getState().updateSettings({ showInspector: false });
      expect(listener).toHaveBeenCalledTimes(1); // one engine notification, no cascade back into itself

      const { chrome } = engineStore.getState();
      engineStore.setState({ chrome: { ...chrome, panels: { ...chrome.panels, sideToolbar: true } } });
      expect(listener).toHaveBeenCalledTimes(2);
      expect(useDesktopStore.getState().settings.showInspector).toBe(true);
    });
  });
});
