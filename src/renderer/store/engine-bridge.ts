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
import { createEngineStore, type EngineStore, type EngineItem, type GridSpec } from '@cmolg/daba-engine';
import { useDesktopStore } from './desktop-store';
import type { StepGraphNode, FrameGraphNode, MentalGraphNode } from '@/types/desktop';
import { kebabToTitle } from '../components/desktop/attachable-helpers';

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
    if (patchKeys.includes('camera')) {
      // Raw set() — NOT setCanvasPan/setCanvasZoom — so this can never call
      // back into engineStore.setState. Going through the public actions here
      // would recreate the exact reentrancy loop this split is meant to avoid:
      // action -> engine.setState -> onChange -> action -> engine.setState -> ...
      useDesktopStore.setState({ canvasPan: state.camera.pan, canvasZoom: state.camera.zoom });
    }
    if (patchKeys.includes('hoveredItemId')) {
      // See the "Window hover <-> engine.hoveredItemId" section below for
      // the full contract — raw set(), NOT setHoveredWindowId, same
      // reentrancy-avoidance shape as the camera branch above.
      const raw = state.hoveredItemId;
      const windowId = raw?.startsWith('win:') ? raw.slice(4) : null;
      useDesktopStore.setState({ hoveredWindowId: windowId });
    }
    if (patchKeys.includes('chrome')) {
      // See the "InspectorPanel collapse <-> engine.chrome.panels" section
      // below for the full contract — raw set(), NOT updateSettings, same
      // reentrancy-avoidance shape as the branches above. Only reacts when
      // the INSPECTOR's own key actually changed value (chrome.panels holds
      // OTHER keys too, e.g. componentsPanel, that this mirror doesn't own).
      const open = state.chrome.panels['sideToolbar'] ?? true;
      const { settings } = useDesktopStore.getState();
      if ((settings.showInspector ?? true) !== open) {
        useDesktopStore.setState({ settings: { ...settings, showInspector: open } });
      }
    }
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

// ─── engine.items mirror (Task 13, Fase 2) ───────────────────────────
//
// windows/grids/mentalNodes (mental/step/frame)/attachables -> engine.items,
// so ComponentsPanel (NodeTree/SideBar) and SideToolbar (InspectorPanel) have
// something to render/resolve. Namespaced ids (`win:`/`grid:`/`mental:`/
// `step:`/`flow:` — task13-decisiones.md Q2 — plus `att:` for attachables,
// an addition beyond Q2's literal list: Q2 enumerated the domains the
// bridge/selection strictly need, but Q8 separately mandates the CURRENT
// "Unattached" NodeTree group stay a 1:1 `ComponentsPanelGroup` like the
// other 7 — which needs its items registered here too, via the exact same
// mechanism, to have rows at all) avoid id collisions across domains;
// `meta.label` carries the human-readable name (window title / grid title /
// node text / step+frame data.title / kebab-to-title attachable name) for
// the motor's generic `itemLabel`/default-row fallback — NodeTree's own
// `renderRow` sources its VISIBLE content straight from desktop-store
// instead (unchanged), so `meta` only matters for the rename-input seed and
// any row that has no custom `renderRow`. Attachables have no `size` field
// (they're small fixed-footprint chips, not resizable) — `ATTACHABLE_SIZE`
// below (220x60) matches the hardcoded half-extents NodeTree's own
// "Unattached" row locate math already assumed (`110`/`30` — see
// `NodeTree.tsx`'s attachables `onClick`), so the motor's generic
// `centerOn(item.position, item.size, ...)` produces an IDENTICAL pan to
// today's manual formula.
//
// PERFORMANCE CONTRACT (read this before touching any of the functions
// below) — this is the load-bearing design the orchestrator signed off on
// after a QUESTION round-trip (see task13-decisiones.md's Fase-2 approval):
//
// `SideToolbar` (motor, `chrome/SideToolbar.tsx`) subscribes to the ENTIRE
// `state.items` record unconditionally — `useEngineSelector((state) =>
// state.items)`, no per-id/per-selection scoping. Any call to
// `engineStore.setState({items: <new top-level object>})` therefore
// re-renders SideToolbar (and everything inside it — i.e. InspectorPanel's
// entire body), REGARDLESS of whether the change touches a selected item.
//
// Meanwhile `MentalGraphCanvas.tsx`'s `onNodesChange` calls `updateMentalNode`
// on EVERY frame of a live React Flow drag (not just drag-stop), rebuilding
// the `mentalNodes` array via `.map()` every single time. A naive "recompute
// + setState the whole items record whenever windows/grids/mentalNodes
// changes reference" would therefore call `engineStore.setState({items})`
// ~60x/second while ANY mental node is being dragged — reintroducing exactly
// the drag-tick reconciliation storm `InspectorPanel.tsx`'s own selectors
// were carefully written to avoid (see its file doc-comment) and that
// `InspectorPanel.test.tsx:859` ("does not re-render when a node is
// repositioned and the change is irrelevant to what is displayed") asserts
// against directly with a `<Profiler>` commit-count probe — for ANY
// mental-node drag, not just a selected one, since SideToolbar's
// subscription doesn't distinguish.
//
// Resolution (satellite-only — no motor patch; the motor's `EngineItem`
// objects are ordinary mutable JS objects, `setState`'s diffing is a plain
// `Object.is` on the KEYS handed to it, and nothing in the contract requires
// per-item objects to be treated as immutable so long as identity changes
// are used deliberately — see core/store.ts's `setState` doc-comment: "the
// consumer is responsible for not mutating its slices in-place if it wants
// the comparison to detect the change", which is precisely the lever this
// uses in reverse): a per-id cache of `EngineItem` objects, keyed by the
// namespaced id.
//
//   - GEOMETRY/LABEL updates to an item that's ALREADY in the cache MUTATE
//     that exact object in place (`existing.position = ...`) — its identity
//     never changes, so `engineStore.setState` is never even called for
//     these. `SideToolbar`/`ComponentsPanel` never re-render, and the
//     Profiler-guarded test above stays green through any number of drag
//     frames on any node, selected or not.
//   - ADD/REMOVE (an id enters or leaves the windows/grids/mentalNodes
//     union) IS a structural change: a fresh top-level record is built from
//     the cache and handed to `engineStore.setState({items})` exactly once
//     for that pass, so ComponentsPanel's groups/rows and SideToolbar's
//     selection-resolution see new/gone items immediately (synchronously,
//     same tick — no debounce: a debounced/deferred sync would fail every
//     EXISTING synchronous unit test that seeds a node then asserts on its
//     row in the same synchronous test body, e.g. `NodeTree.flows.test.tsx`).
//
// Consumers that read `item.position`/`item.size`/`item.meta.label` only
// ever do so at a discrete, later moment in response to a user gesture —
// `ComponentsPanelRow.locate()` reads `item.position`/`size` inside its
// `onClick` handler, and the rename-input seed
// (`itemLabel ? itemLabel(item) : item.id`) reads `item.meta.label` inside a
// `useEffect` gated on `isRenaming` flipping true, itself triggered by a
// context-menu click. Both close over the SAME cached object reference
// handed to React at the last render — since that object is mutated (not
// replaced) on every geometry/label update, both reads see the LATEST value
// at click-time even though no render/notification ever announced the
// mutation. Nothing in NodeTree/SideBar/InspectorPanel displays
// `item.position`/`item.size`/`item.meta.label` directly in JSX (all visible
// row content is sourced straight from desktop-store via NodeTree's own,
// already-reactive `useDesktopStore` subscriptions) — so there is no path by
// which a "silent" mutation could leave stale content on screen.

type BridgeItemKind = 'window' | 'grid' | 'mental' | 'step' | 'flow' | 'attachable';

const BRIDGE_ID_PREFIX: Record<BridgeItemKind, string> = {
  window: 'win',
  grid: 'grid',
  mental: 'mental',
  step: 'step',
  flow: 'flow',
  attachable: 'att',
};

/** Exported so NodeTree.tsx can compute the namespaced id for its OWN `renamingId` (controlled-rename) state without duplicating the prefix table. */
export function namespacedId(kind: BridgeItemKind, rawId: string): string {
  return `${BRIDGE_ID_PREFIX[kind]}:${rawId}`;
}

const PREFIX_TO_KIND: Record<string, BridgeItemKind> = Object.fromEntries(
  (Object.entries(BRIDGE_ID_PREFIX) as [BridgeItemKind, string][]).map(([kind, prefix]) => [prefix, kind]),
);

/**
 * Inverse of `namespacedId` — exported so NodeTree.tsx/InspectorPanel.tsx
 * (the only two consumers of `ComponentsPanel`/`SideToolbar` callbacks that
 * hand back a namespaced id, e.g. `onRename(id, name)`) share ONE canonical
 * prefix<->kind mapping instead of each hardcoding its own copy. Returns
 * `null` for a malformed/unrecognized id (defensive — should not happen for
 * any id this bridge itself produced).
 */
export function parseBridgeId(id: string): { kind: BridgeItemKind; rawId: string } | null {
  const i = id.indexOf(':');
  if (i < 0) return null;
  const kind = PREFIX_TO_KIND[id.slice(0, i)];
  if (!kind) return null;
  return { kind, rawId: id.slice(i + 1) };
}

export type { BridgeItemKind };

/** See the engine.items doc-comment above for why this exact 220x60 value matches today's hardcoded locate math. */
const ATTACHABLE_SIZE = { width: 220, height: 60 };

/** `mentalNodes` entries carry their own type discriminator; 'mental' is the fallback for MentalGraphNode.type's optional/undefined case (see its own type doc-comment in types/desktop.ts). */
function mentalNodeKind(type: string | undefined): BridgeItemKind {
  if (type === 'step') return 'step';
  if (type === 'frame') return 'flow';
  return 'mental';
}

/** Module-level cache of EngineItem objects, keyed by namespaced id — see the PERFORMANCE CONTRACT doc-comment above for why this exists and what it guarantees. */
const itemCache = new Map<string, EngineItem>();

function syncEngineItems(): void {
  const { windows, grids, mentalNodes, attachables } = useDesktopStore.getState();
  const seen = new Set<string>();
  let structuralChange = false;

  const upsert = (
    kind: BridgeItemKind,
    rawId: string,
    position: { x: number; y: number },
    size: { width: number; height: number },
    label: string,
  ): void => {
    const id = namespacedId(kind, rawId);
    seen.add(id);
    const existing = itemCache.get(id);
    if (existing) {
      // Mutate in place — see PERFORMANCE CONTRACT above: no
      // engineStore.setState here, deliberately, so this never notifies.
      existing.position = position;
      existing.size = size;
      existing.meta = { label };
    } else {
      itemCache.set(id, { id, kind, position, size, meta: { label } });
      structuralChange = true;
    }
  };

  for (const w of windows) upsert('window', w.id, w.position, w.size, w.title);
  for (const g of grids) {
    upsert('grid', g.id, g.position, g.size, g.title ?? `Grid ${g.columns}×${g.rows}`);
  }
  for (const n of mentalNodes) {
    const kind = mentalNodeKind(n.type);
    const label =
      kind === 'step' ? (n as StepGraphNode).data.title
      : kind === 'flow' ? (n as FrameGraphNode).data.title
      : (n as MentalGraphNode).text;
    upsert(kind, n.id, n.position, { width: n.width, height: n.height }, label);
  }
  for (const a of attachables) upsert('attachable', a.id, a.position, ATTACHABLE_SIZE, kebabToTitle(a.name));

  // Removals — anything cached from a previous pass that wasn't touched
  // (upserted) this time is gone from its source array.
  for (const id of itemCache.keys()) {
    if (!seen.has(id)) {
      itemCache.delete(id);
      structuralChange = true;
    }
  }

  if (!structuralChange) return; // pure geometry/label mutation(s) — no notification, by design.
  engineStore.setState({ items: Object.fromEntries(itemCache) });
}

// ─── engine.selection mirror (Task 13, Fase 2) ───────────────────────
//
// UNIDIRECTIONAL, domain -> motor, and ONLY `selectedMentalNodeIds` — never
// `selectedWindowIds` (task13-decisiones.md Q2: "el Inspector debe seguir
// ignorando selección de ventanas, como hoy"). SideToolbar resolves
// `state.selection.ids` against `state.items` to route its 0/1/N body, so
// the ids here must use the SAME namespacing as syncEngineItems above.

function syncEngineSelection(): void {
  const { selectedMentalNodeIds, mentalNodes } = useDesktopStore.getState();
  const ids = new Set<string>();
  for (const rawId of selectedMentalNodeIds) {
    const node = mentalNodes.find((n) => n.id === rawId);
    // A stale id (selected, then deleted elsewhere) has no resolving node —
    // its bridged kind is irrelevant since `mental:<staleId>` will never
    // match an `engine.items` entry either way (SideToolbar's `.filter(Boolean)`
    // drops it, same graceful "falls back to 0 resolved" as today).
    ids.add(namespacedId(mentalNodeKind(node?.type), rawId));
  }
  const current = engineStore.getState().selection;
  if (current.ids.size === ids.size && [...ids].every((id) => current.ids.has(id))) return;
  engineStore.setState({ selection: { ids } });
}

// One subscription drives both syncs — both only ever need to react to the
// same three slices (mentalNodes feeds both items AND selection-kind
// resolution; windows/grids feed items only, but re-deriving selection on
// those too is a cheap no-op thanks to syncEngineSelection's own guard).
useDesktopStore.subscribe((state, prevState) => {
  if (
    state.windows !== prevState.windows ||
    state.grids !== prevState.grids ||
    state.mentalNodes !== prevState.mentalNodes ||
    state.attachables !== prevState.attachables
  ) {
    syncEngineItems();
  }
  if (state.selectedMentalNodeIds !== prevState.selectedMentalNodeIds || state.mentalNodes !== prevState.mentalNodes) {
    syncEngineSelection();
  }
});

// Seed both from whatever zustand-persist already hydrated at THIS module's
// load time — same "hydrate once at import time" shape as the camera/snap
// seeds above. Order matters: items before selection, so a persisted
// selection resolves against an already-populated item cache.
syncEngineItems();
syncEngineSelection();

// ─── Window hover <-> engine.hoveredItemId (Task 13, Fase 2) ─────────
//
// Bidirectional mirror, WINDOWS ONLY (task13-decisiones.md Q4): grids and
// mental/step/frame nodes read `engine.hoveredItemId` DIRECTLY (they're
// mounted inside the canvas's own `<EngineProvider>` already — see
// SeamlessCanvas.tsx) with no store round-trip needed. Windows are the one
// kind whose highlight consumer (`DesktopWindow.tsx`) is OUTSIDE any
// `<EngineProvider>` subtree and reads `hoveredWindowId` off desktop-store,
// unchanged (task13-decisiones.md Q4: "DesktopWindow SIGUE leyendo el store
// — los 8 tests de selection-ring quedan intactos").
//
// Direction 1 (engine -> store, primary path): `ComponentsPanelRow`'s OWN
// internal `onMouseEnter`/`onMouseLeave` (motor-owned, inside
// `chrome/ComponentsPanel.tsx`) call `useHoveredItem().setHoveredItemId(id)`
// directly whenever the pointer enters/leaves a NodeTree row — the ONLY
// production write path to `hoveredItemId` today. Handled in the SAME
// `onChange` callback as 'camera' above (a raw `useDesktopStore.setState()`,
// never `setHoveredWindowId`, for the same reentrancy-avoidance reason the
// camera mirror documents at the top of this file).
//
// Direction 2 (store -> engine): `setHoveredWindowId` patched the same
// "wrap, don't replace" way as `updateSettings` above. Nothing in
// production calls it anymore once NodeTree stops owning hover manually
// (Fase 2 rewrite) — the only remaining callers are `desktop-store.test.ts`
// (asserts the action itself) and `DesktopWindow.selection-ring.test.tsx`
// (uses a RAW `setState`, bypassing this action entirely, so it is
// unaffected by anything below) — but wrapping it keeps the mirror correct
// for any future/test call site, matching the literal "bidireccional" the
// orchestrator specified rather than leaving a half-built mirror.
const originalSetHoveredWindowId = useDesktopStore.getState().setHoveredWindowId;

useDesktopStore.setState({
  setHoveredWindowId: (id) => {
    originalSetHoveredWindowId(id);
    const nextHovered = id ? `win:${id}` : null;
    // Guard: clearing to null must not clobber an in-progress hover on a
    // NON-window item (a mental/step/frame/grid row currently hovered via
    // the engine-owned path above) — only push when SETTING a window hover,
    // or when clearing AND the engine is already null/pointing at a window.
    const currentHovered = engineStore.getState().hoveredItemId;
    if (nextHovered !== null || currentHovered === null || currentHovered.startsWith('win:')) {
      engineStore.setState({ hoveredItemId: nextHovered });
    }
  },
});

// ─── InspectorPanel collapse <-> engine.chrome.panels (Task 13, Fase 2) ──
//
// `SideToolbar`'s collapse/expand buttons are entirely internal — there is
// no prop to inject an external `open` boolean or to override what its own
// buttons do; they always read/write `state.chrome.panels[panelKey]`
// directly (`chrome/SideToolbar.tsx`). `InspectorPanel.tsx` mounts
// `<SideToolbar panelKey="sideToolbar" .../>`, so THIS key is what needs to
// stay in lockstep with `settings.showInspector` (task13-decisiones.md: "el
// colapso persistido como hoy... espeja el bit del motor") — persistence
// and every other reader of `showInspector` (App.tsx's width/opacity
// styling, the `data-inspector` attribute) keep working off the SAME
// desktop-store field they always have; the engine's copy is a read replica
// SideToolbar's own buttons happen to write to.
//
// Both defaults already agree without any extra work: SideToolbar's
// `open = state.chrome.panels[panelKey] ?? true` (absent = shown) and
// desktop-store's `settings.showInspector !== false` (absent = shown) are
// the exact same "default to open" convention.
const INSPECTOR_PANEL_KEY = 'sideToolbar';

function pushInspectorOpenToEngine(): void {
  const open = useDesktopStore.getState().settings.showInspector !== false;
  const { chrome } = engineStore.getState();
  if ((chrome.panels[INSPECTOR_PANEL_KEY] ?? true) === open) return;
  engineStore.setState({ chrome: { ...chrome, panels: { ...chrome.panels, [INSPECTOR_PANEL_KEY]: open } } });
}

// Extends the SAME wrapped `updateSettings` from the snap-settings section
// above — one more push appended after the original + pushSnapSettingsToEngine.
const previousWrappedUpdateSettings = useDesktopStore.getState().updateSettings;
useDesktopStore.setState({
  updateSettings: (patch) => {
    previousWrappedUpdateSettings(patch);
    pushInspectorOpenToEngine();
  },
});
pushInspectorOpenToEngine(); // seed, same "hydrate once at import time" shape as every other seed above.

// Reverse direction: SideToolbar's OWN collapse/expand buttons write
// `engine.chrome.panels[panelKey]` directly (motor-owned, no satellite hook
// to intercept) — reflected into `settings.showInspector` via a RAW
// `useDesktopStore.setState()` in the engine's own `onChange` (see the
// 'chrome' branch alongside 'camera'/'hoveredItemId' near the top of this
// file), NOT `updateSettings` — same reentrancy-avoidance shape as the
// camera/hover branches: going through the wrapped `updateSettings` there
// would call `pushInspectorOpenToEngine` again, which would re-notify
// `chrome` (a fresh object reference every time) even though the value
// didn't change, bouncing back into this same `onChange` — a loop the raw
// set() cannot enter since it never touches `engineStore` at all.
