# Borderless Desktop Windows with Full-Surface Drag

**Date:** 2026-04-11  
**Status:** Approved for implementation planning  
**Scope:** Renderer desktop window interaction + related UI copy/tests

## Problem

The desktop window system currently depends on a visible top titlebar for drag and double-click maximize behavior. We need a borderless, no-titlebar window style where:

1. Windows are draggable from anywhere on the window surface.
2. Single click focuses a window.
3. Drag gesture moves the window.
4. Windows can be closed from NodeTree and from right-click context menu.
5. Interaction feels aligned with `@xyflow/react` style drag ergonomics.

## Goals

1. Remove top tab/titlebar UI from desktop windows.
2. Remove visible window outline border while keeping depth shadow.
3. Implement full-surface drag + click-to-focus behavior.
4. Preserve right-click context menu window actions (including close).
5. Keep existing resize, snap, z-index, and store model intact.
6. Preserve unsnapped window-to-grid drag affordance without relying on a titlebar.
7. Keep grid-snapped window ejection available without relying on a titlebar.
8. Update NodeTree wording to use **Close window** for window close semantics.

## Non-Goals

1. No dnd-kit migration for window movement.
2. No desktop store model redesign.
3. No new general-purpose window controls/chrome surfaces beyond relocating existing titlebar-dependent grid drag/eject controls.
4. No market/attachable feature changes beyond interaction compatibility.

## Chosen Approach

Use a **gesture-controller evolution** inside `DesktopWindow.tsx`:

- Keep existing drag/resize/snap/store pathways.
- Remove titlebar-only drag affordance.
- Route window-surface pointer gestures into existing movement logic.

This gives parity with the requested behavior while minimizing architectural churn.

## Functional Requirements

1. **Borderless visual:** remove visible 1px border line from `.desktop-window`; keep depth via shadow system.
2. **No titlebar:** remove `.window-titlebar` render block from `DesktopWindow`.
3. **Focus behavior:** left click on any window point focuses that window.
4. **Drag behavior:** left-click + move on any window point drags window (respecting zoom and snap guides).
5. **Double-click behavior:** double-click anywhere on window toggles maximize/restore.
6. **Context menu behavior:** right-click anywhere in window opens window context menu with close action.
7. **Close semantics in NodeTree menu:** for window targets, action text is `Close window` (not `Delete`).
8. **Grid ejection behavior:** grid-snapped windows still expose an in-window eject action even after titlebar removal.
9. **Grid assignment behavior:** unsnapped windows still expose the existing drag-to-grid affordance after titlebar removal.

## Detailed Design

### 1) `DesktopWindow.tsx` interaction model

- Remove titlebar JSX and related drag hooks bound specifically to titlebar.
- Keep root `.desktop-window` as interaction surface.
- Introduce/adjust gesture handling on root surface:
  - `onMouseDown` (primary button): focus + arm drag intent.
  - `onMouseMove` while armed: promote to active drag when movement threshold is exceeded (4px baseline), then run existing move logic.
  - `onMouseUp`: finalize interaction.
  - `onDoubleClick`: toggle maximize/restore (same window-state API).
  - `onContextMenu`: keep current window menu generation and close action.
- Add explicit interaction precedence:
  - **Resize handles win first** (existing stopPropagation path unchanged).
  - **Right click wins second** (always opens context menu, no drag arm).
  - **Primary button on any other window pixel arms drag intent** (including interactive descendants).
  - If movement stays under threshold, treat as click-only focus and allow normal click action to complete.
  - If movement exceeds threshold, window drag takes ownership of the gesture; text-selection/drag actions inside content are intentionally overridden to satisfy drag-anywhere behavior.
- Double-click maximize remains global to the window surface (including interactive descendants), as explicitly requested.
- Preserve existing drop-time behaviors tied to drag completion:
  - file-viewer absorption into file-explorer on overlap,
  - canvas wave dispatch on drop.
- Preserve multi-window drag behavior when selection rules apply.
- Preserve grid controls by relocating the existing titlebar grip into compact in-window corner affordances:
  - unsnapped windows keep drag-to-grid grip,
  - snapped windows show eject-from-grid grip.

### 2) `index.css` window chrome

- Remove/deprecate `.window-titlebar`, `.window-title-text`, and titlebar-specific visual rules from active layout path.
- Update `.desktop-window` to be borderless while preserving depth:
  - keep shadow stack,
  - remove visible border stroke.
- Keep active/highlight/selected visual feedback by shadow/ring treatment so focus state remains legible.
- Ensure content area (`.window-content`) starts at top with no titlebar offset.

### 3) NodeTree close wording

- In `NodeTree.tsx` context menu item generation:
  - for `target.kind === 'window'`, use `Close window` label.
  - keep delete labels for non-window entities (mental nodes/lines, grids) where semantics are true deletion.

### 4) Grid controls without titlebar

- Existing titlebar-based grid drag/eject controls are removed with titlebar deletion.
- Replacement:
  - when `isGridSnapped === false`, render drag-to-grid grip in the window corner and preserve current `draggingWindowId` flow,
  - when `isGridSnapped === true`, render eject-from-grid button in the same corner.
- Eject action remains `removeWindowFromCell(gridId, windowId)` so store behavior is unchanged.
- NodeTree grid listings continue to provide secondary eject controls.

### 5) Behavioral parity notes vs xyflow style

- Click = focus.
- Drag gesture from node/window body = move.
- Right-click = context actions.
- Minimal chrome, interaction-first surface.

Exact internal implementation does not import xyflow internals; parity is behavioral, not dependency-level.

## Error Handling and Edge Cases

1. **Gesture conflicts:** resize handles retain precedence (their handlers continue to stop propagation and start resize directly).
2. **Minimized windows:** no behavior change; minimized windows remain non-visible/non-interactive.
3. **Maximized windows:** drag/resize guards remain in place; maximize toggle still works via double-click.
4. **Grid-snapped windows:** preserve existing constraints/eject behavior; no hidden titlebar dependency remains.

## Testing Plan

### E2E updates (`e2e/desktop.spec.ts`)

1. Replace assertions that require `.window-titlebar`.
2. Update drag test to drag using `.desktop-window` surface coordinates.
3. Update double-click maximize test to double-click `.desktop-window`.
4. Keep resize-handle tests intact.
5. Add/adjust checks:
   - single-click focus on window surface,
   - right-click window context menu still includes close,
   - NodeTree context menu shows `Close window` for windows,
   - unsnapped window still exposes working drag-to-grid grip behavior,
   - grid-snapped window shows working in-window eject control (window is removed from cell and restored to canvas).

### Unit/store tests

- No expected change to store API contracts (`focusWindow`, `moveWindow`, `removeWindow`, `setWindowState`), so only behavior-coupled tests should be adjusted if selectors/UI assumptions changed.

## Acceptance Criteria

1. No titlebar is rendered in desktop windows.
2. Windows render without visible outline border while retaining depth shadow.
3. Single click on window surface focuses and brings to front.
4. Dragging from any window point moves the window and preserves snap behavior.
5. Double-click anywhere on window surface toggles maximize/restore.
6. Window close works from:
   - NodeTree controls/context menu,
   - window right-click context menu.
7. Updated E2E suite sections pass for window interaction scenarios.

## Implementation Boundaries

- Touch only files required for this behavior (window component, related styles, NodeTree labels, affected tests).
- Avoid unrelated refactors.
- Preserve existing desktop/store architecture.
