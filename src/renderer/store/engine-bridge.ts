/**
 * engine-bridge.ts — Renderer store bridge
 *
 * Architecture note:
 * This file follows the explanatory style used across the codebase:
 * explicit intent, clear boundaries, and behavior-preserving structure.
 */
// src/renderer/store/engine-bridge.ts — daba-engine camera store, wired to desktop-store
//
// Task 12 (adoption plan #20, javadaba-web Core): the canvas camera moves
// from being desktop-store's own state to daba-engine's EngineStore. This
// module is the singleton bridge between the two: a module-level
// `createEngineStore` instance (same singleton-of-module pattern as
// `useDesktopStore` — readable outside React, passed to
// `<EngineProvider store={engineStore}>` in SeamlessCanvas.tsx), hydrated
// from whatever zustand-persist already restored into desktop-store at THIS
// module's own load time. `debouncedLocalStorage.getItem` (logic/
// debounced-storage.ts) is synchronous, so zustand's persist middleware
// hydrates useDesktopStore synchronously inside `create()` — by the time
// ANY other module's top-level code runs afterward, `useDesktopStore
// .getState()` below already reflects the persisted canvasPan/canvasZoom.
//
// Design (task12-scout.md §2, followed to the letter per the orchestrator's
// decision — task12-decisiones.md): canvasPan/canvasZoom on desktop-store
// become a MIRROR of the engine's camera, updated ONLY by this module's
// onChange below (a raw useDesktopStore.setState() — never the public
// actions — so there is no reentrancy), while WRITES funnel through exactly
// one delegation point per call-site: setCanvasPan/setCanvasZoom (patched
// onto the store below) and the board-switch call-sites that change the
// active camera as a side effect of a raw set() (switchBoard, deleteBoard's
// active-board branch — see their get()._pushCameraToEngine?.() calls in
// desktop-store.ts; duplicateBoard never touches the active camera, so it
// does not call it).
//
// Circular-import note: desktop-store.ts does NOT import this file — it
// already avoids the equivalent cycle with harness-store (see the comment
// above desktop-store's own `switchBoard`, and `_pushCameraToEngine`'s
// doc-comment on the DesktopStore interface). This file needs
// `useDesktopStore.getState()` synchronously at its own load time to seed
// the engine's initial camera; if desktop-store.ts statically imported this
// file too, loading either module first would deadlock on the other's
// not-yet-initialized export (a `const` circularly referenced before its
// initializer has run throws — it does not silently return undefined, the
// way a CJS `require` cycle might). Instead, this file holds the only
// static import between the two, and patches desktop-store's own
// setCanvasPan/setCanvasZoom/_pushCameraToEngine onto the ALREADY-
// CONSTRUCTED store object after both modules have finished loading —
// indistinguishable, from any caller's perspective, from those actions
// having been written this way inline in desktop-store.ts itself.
import { createEngineStore, type EngineStore, type GridSpec } from '@javadaba/daba-engine';
import { useDesktopStore } from './desktop-store';

const initial = useDesktopStore.getState();

/**
 * Fluxor's OWN default `GridSpec` for snap-to-grid quantization of window /
 * mental-node drags (Task 13, adoption plan #20) — deliberately NOT the
 * motor's `DEFAULT_GRID_SPEC` (that one is `javadaba-web-os`'s DESKTOP-ICON
 * grid: 131x101 cells, 18px gap, 24/44 padding — the wrong domain for
 * arbitrary IDE windows/mental nodes; see task13-scout.md Gap S6 /
 * task13-decisiones.md Q6). Square cell, no gap, no padding, origin at 0,0:
 * a dragged item's raw top-left simply rounds to the nearest multiple of
 * `cell` on both axes (`core/grid.ts`'s `pixelsToColRow`/`colRowToPixels`
 * only read `padding`/`originY`/`cell.width+gap`/`cell.height+gap` — with
 * gap=0 and padding=0 those reduce to a plain `cell`-px rounding grid).
 */
export function fluxorWindowGridSpec(cell: number): GridSpec {
  return { cell: { width: cell, height: cell, gap: 0 }, padding: { x: 0, y: 0 }, originY: 0 };
}

/** `settings.snapGridCellSize`'s default when unset (preset UI: 16/24/32, see SettingsModal.tsx). */
export const DEFAULT_SNAP_GRID_CELL_SIZE = 24;

/**
 * Pushes `desktop-store`'s `settings.snapToGrid`/`settings.snapGridCellSize`
 * into the engine's `snap.grid` slice — a ONE-WAY mirror (settings stay the
 * source of truth, persisted as always; the engine's copy is a read replica
 * for whichever drag-commit call site needs `resolveSnap`'s `SnapConfig`,
 * see `DesktopWindow.tsx`/`MentalGraphCanvas.tsx`). Unlike the camera
 * (bidirectional — see the module doc-comment above), nothing ever writes
 * `snap.grid` FROM the engine back into `settings`, so there is no
 * reentrancy concern here; this only needs to be called after any write to
 * `settings`. Guards against a no-op `engineStore.setState` (which would
 * otherwise fire on EVERY `updateSettings` call, including ones touching
 * unrelated fields like `canvasClickAnimation`, since a freshly-built `spec`
 * object is a new reference every time).
 */
function pushSnapSettingsToEngine(): void {
  const { settings } = useDesktopStore.getState();
  const enabled = settings.snapToGrid === true;
  const cellSize = settings.snapGridCellSize ?? DEFAULT_SNAP_GRID_CELL_SIZE;
  const spec = fluxorWindowGridSpec(cellSize);
  const current = engineStore.getState().snap;
  if (current.grid.enabled === enabled && current.grid.spec.cell.width === spec.cell.width) return;
  engineStore.setState({ snap: { ...current, grid: { enabled, spec } } });
}

/**
 * Module singleton — same pattern as `useDesktopStore`: created once at
 * import time, readable outside React (`engineStore.getState()`), and meant
 * to be passed to `<EngineProvider store={engineStore}>` so every
 * `<DabaCanvas>`/`useCamera()`/`useEngine()` consumer shares this exact
 * instance instead of EngineProvider creating (and owning) its own.
 */
export const engineStore: EngineStore = createEngineStore({
  initialState: { camera: { pan: initial.canvasPan, zoom: initial.canvasZoom } },
  onChange: (state, patchKeys) => {
    if (!patchKeys.includes('camera')) return;
    // Raw set() — NOT setCanvasPan/setCanvasZoom — so this can never call
    // back into engineStore.setState. Going through the public actions here
    // would recreate the exact reentrancy loop this split is meant to avoid:
    // action -> engine.setState -> onChange -> action -> engine.setState -> ...
    useDesktopStore.setState({ canvasPan: state.camera.pan, canvasZoom: state.camera.zoom });
  },
});

/**
 * Reads the CURRENT desktop-store mirror and pushes it to the engine.
 * Patched onto the store below as `_pushCameraToEngine`, and called from
 * desktop-store.ts after any write that changes canvasPan/canvasZoom via a
 * raw `set()` rather than through setCanvasPan/setCanvasZoom — today:
 * switchBoard and deleteBoard's active-board branch, both swapping in an
 * incoming board's snapshot camera as part of a larger state patch that
 * setCanvasPan/setCanvasZoom's single-field signature can't express.
 */
function pushCameraToEngine(): void {
  const { canvasPan, canvasZoom } = useDesktopStore.getState();
  engineStore.setState({ camera: { pan: canvasPan, zoom: canvasZoom } });
}

// Captured BEFORE the patch below overwrites it — `updateSettings`'s own
// merge-patch semantics (`set(s => ({settings: {...s.settings, ...patch}}))`)
// stay completely intact; this only appends the engine push AFTER it runs
// (same "wrap, don't replace" shape as `_pushCameraToEngine` above, chosen
// here instead of `_pushCameraToEngine`'s "replace + explicit call-site"
// shape because `updateSettings` is FLUXOR's single entry point for every
// settings field, snap-related or not — wrapping means every call site that
// already touches `settings.snapToGrid`/`settings.snapGridCellSize`, present
// or future, mirrors correctly with zero extra wiring).
const originalUpdateSettings = useDesktopStore.getState().updateSettings;

useDesktopStore.setState({
  setCanvasPan: (pan) => {
    engineStore.setState({ camera: { pan, zoom: engineStore.getState().camera.zoom } });
  },
  // Same clamp as desktop-store's original inline setCanvasZoom ([0.25, 3])
  // — applied here, before handing the value to the engine, instead of
  // inside a local set(); the onChange mirror above reflects the CLAMPED
  // result back into canvasZoom, exactly like the original
  // set({canvasZoom: clamped}) did.
  setCanvasZoom: (zoom) => {
    const clamped = Math.max(0.25, Math.min(3, zoom));
    engineStore.setState({ camera: { pan: engineStore.getState().camera.pan, zoom: clamped } });
  },
  _pushCameraToEngine: pushCameraToEngine,
  updateSettings: (patch) => {
    originalUpdateSettings(patch);
    pushSnapSettingsToEngine();
  },
});

// Seed the engine's snap.grid from whatever settings.snapToGrid/
// settings.snapGridCellSize zustand-persist already hydrated at THIS
// module's load time — same "hydrate once at import time" shape as the
// camera's own `initial` seed above.
pushSnapSettingsToEngine();
