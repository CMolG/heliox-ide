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
import { createEngineStore, type EngineStore } from '@javadaba/daba-engine';
import { useDesktopStore } from './desktop-store';

const initial = useDesktopStore.getState();

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
});
