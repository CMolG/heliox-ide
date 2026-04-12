# Borderless Window System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement borderless, titlebar-free desktop windows with full-surface drag/focus behavior, while preserving close actions in NodeTree and window context menus.

**Architecture:** Keep the existing Zustand desktop store and drag/resize/snap pathways, but move drag/maximize interaction from titlebar-only to the full window surface. Remove titlebar chrome from markup/CSS, keep visual depth via shadows, and preserve grid workflows by rendering corner controls inside the window surface.

**Tech Stack:** React 19, TypeScript, Zustand, CSS, Playwright

---

## File Structure and Responsibilities

- `src/renderer/components/desktop/DesktopWindow.tsx` (modify): Replace titlebar-driven interactions with full-surface gesture handling; keep resize/snap/drop behaviors; render in-surface grid drag/eject controls.
- `src/renderer/index.css` (modify): Remove titlebar styling dependencies, enforce borderless window visuals, and style new corner controls.
- `src/renderer/components/NodeTree.tsx` (modify): Change window context-menu destructive label from `Delete` to `Close window` while preserving non-window delete semantics.
- `e2e/desktop.spec.ts` (modify): Replace titlebar-coupled tests with surface-based drag/maximize assertions and borderless checks.
- `e2e/context-menus.spec.ts` (modify): Validate NodeTree window menu shows `Close window` text, while mental/grid menus still show `Delete`.
- `e2e/grid-validate.spec.ts` (modify if needed): Keep grid grip/eject assertions stable after titlebar removal.

Skills to apply during implementation:
- `@playwright-best-practices` for pointer interactions and resilient selectors.

### Task 1: Surface-First Window Interaction (TDD slice)

**Files:**
- Modify: `e2e/desktop.spec.ts` (current titlebar-dependent blocks around lines `193-214`, `255-286`, `1220-1239`, `4047-4061`)
- Modify: `src/renderer/components/desktop/DesktopWindow.tsx` (interaction/titlebar block around lines `149-200`, `275-392`, `507-633`)

- [ ] **Step 1: Write failing tests for chrome-less surface behavior**

```ts
// Replace all titlebar-dependent assertions in this file with surface-based assertions.
// Explicitly remove/rename tests that reference `.window-titlebar`.

test('window does not render titlebar chrome', async () => {
  await spawnChatWindow();
  const win = page.locator('.desktop-window').last();
  await expect(win.locator('.window-titlebar')).toHaveCount(0);
});

test('drag window to new position from window surface', async () => {
  await spawnChatWindow();
  const win = page.locator('.desktop-window').last();
  const box = await win.boundingBox();
  if (!box) throw new Error('No window bounding box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 60, { steps: 10 });
  await page.mouse.up();
  await expect(win).toBeVisible();
});

test('window surface double-click toggles maximize', async () => {
  await spawnChatWindow();
  const win = page.locator('.desktop-window').last();
  await win.dblclick();
  const state = await page.evaluate(() => {
    const s = (window as any).__DESKTOP_STORE__?.getState();
    return s?.windows?.[s.windows.length - 1]?.state;
  });
  expect(state).toBe('maximized');
});

test('single-click on window surface focuses and brings it to front', async () => {
  await spawnChatWindow();
  await spawnChatWindow();
  const first = page.locator('.desktop-window').first();
  const targetId = await first.getAttribute('data-window-id');
  await first.click();
  const activeId = await page.evaluate(() => {
    const s = (window as any).__DESKTOP_STORE__?.getState();
    return s?.activeWindowId ?? null;
  });
  expect(activeId).toBe(targetId);
});

test('window right-click context menu still includes Close window', async () => {
  await spawnChatWindow();
  const win = page.locator('.desktop-window').last();
  await win.click({ button: 'right' });
  await expect(page.locator('[data-testid="window-context-menu"]')).toBeVisible();
  await expect(page.locator('[data-testid="ctx-menu-close-window"]')).toBeVisible();
});
```

- [ ] **Step 2: Run targeted desktop tests to verify failures**

Run:
```bash
npm run test:e2e -- e2e/desktop.spec.ts --grep "titlebar chrome|window surface|single-click on window surface focuses|right-click context menu still includes Close window"
```

Expected: FAIL on `.window-titlebar` expectations and/or missing surface maximize behavior.

- [ ] **Step 3: Implement full-surface gesture handling in `DesktopWindow.tsx`**

```tsx
const DRAG_ACTIVATION_PX = 4;
const dragArmRef = useRef<{ startX: number; startY: number } | null>(null);

const handleSurfaceMouseDown = useCallback((e: React.MouseEvent) => {
  if (!win || e.button !== 0) return;
  focusWindow(windowId);
  if (!isGridSnapped && win.state !== 'maximized') {
    dragArmRef.current = { startX: e.clientX, startY: e.clientY };
  }
}, [win, windowId, focusWindow, isGridSnapped]);

const beginDragInteraction = useCallback((clientX: number, clientY: number) => {
  // Extract drag setup from existing onInteractionStart into a helper that does
  // not require a React synthetic event and is only called once threshold is crossed.
  // Keep current move/snap/drop logic intact.
  startWindowDrag(windowId, { clientX, clientY });
}, [windowId]);

useEffect(() => {
  const onMove = (ev: MouseEvent) => {
    const arm = dragArmRef.current;
    if (!arm) return;
    const dx = ev.clientX - arm.startX;
    const dy = ev.clientY - arm.startY;
    if (Math.hypot(dx, dy) < DRAG_ACTIVATION_PX) return;
    dragArmRef.current = null;
    beginDragInteraction(arm.startX, arm.startY);
  };
  const onUp = () => { dragArmRef.current = null; };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  return () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
}, [beginDragInteraction]);

const handleSurfaceDoubleClick = useCallback((e: React.MouseEvent) => {
  e.stopPropagation();
  if (!win || isGridSnapped) return;
  setWindowState(windowId, win.state === 'maximized' ? 'normal' : 'maximized');
}, [win, windowId, isGridSnapped, setWindowState]);

// root surface:
<div
  className={`desktop-window ${shaking ? 'animate-shake' : ''}`}
  onMouseDown={handleSurfaceMouseDown}
  onDoubleClick={handleSurfaceDoubleClick}
  onContextMenu={handleContextMenu}
>
```

Implementation notes:
- Remove the `.window-titlebar` JSX block entirely.
- Keep existing `onInteractionStart`, drop-wave, snap-guide, and file-viewer absorption paths.
- Do not call `preventDefault/stopPropagation` before threshold crossing; preserve click-only passthrough.
- Keep resize handles unchanged so resize precedence remains intact.

- [ ] **Step 4: Run targeted desktop tests to verify pass**

Run:
```bash
npm run test:e2e -- e2e/desktop.spec.ts --grep "titlebar chrome|window surface|single-click on window surface focuses|right-click context menu still includes Close window|drag window to new position|wave triggers on window drag-drop"
```

Expected: PASS for updated surface interaction scenarios.

- [ ] **Step 5: Commit**

```bash
git add e2e/desktop.spec.ts src/renderer/components/desktop/DesktopWindow.tsx
git commit -m "feat(desktop): move window drag/maximize to full surface" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 2: Borderless Visual Style (TDD slice)

**Files:**
- Modify: `e2e/desktop.spec.ts` (window aesthetics block around lines `1213-1239`, titlebar describe around `3142-3173`)
- Modify: `src/renderer/index.css` (window chrome block around `705-942`, title text around `1145-1154`)

- [ ] **Step 1: Write failing borderless assertions**

```ts
test('window has no visible border outline', async () => {
  const win = page.locator('.desktop-window').last();
  const border = await win.evaluate((el) => {
    const s = getComputedStyle(el);
    return { width: s.borderTopWidth, style: s.borderTopStyle };
  });
  expect(border.width).toBe('0px');
  expect(border.style).toBe('none');
});

test('window keeps depth shadow while borderless', async () => {
  const win = page.locator('.desktop-window').last();
  const boxShadow = await win.evaluate((el) => getComputedStyle(el).boxShadow);
  expect(boxShadow).not.toBe('none');
});
```

- [ ] **Step 2: Run targeted aesthetics tests to verify failures**

Run:
```bash
npm run test:e2e -- e2e/desktop.spec.ts --grep "border outline|depth shadow|Window Titlebar|Window Aesthetics"
```

Expected: FAIL while `.desktop-window` still has border/titlebar assumptions.

- [ ] **Step 3: Implement borderless CSS and remove titlebar styling dependencies**

```css
.desktop-window {
  border: none;
  background: #141414;
  box-shadow:
    0 6px 28px rgba(0,0,0,0.45),
    0 0 0 1px rgba(255,255,255,0.03),
    inset 0 1px 0 rgba(255,255,255,0.08);
}

/* obsolete after titlebar removal */
.window-titlebar,
.window-title-text {
  display: none;
}
```

Also update role/active/highlight/selected states to avoid relying on visible border stroke for legibility.

- [ ] **Step 4: Run targeted aesthetics tests to verify pass**

Run:
```bash
npm run test:e2e -- e2e/desktop.spec.ts --grep "border outline|depth shadow|Window Aesthetics"
```

Expected: PASS for borderless + shadow assertions.

- [ ] **Step 5: Commit**

```bash
git add e2e/desktop.spec.ts src/renderer/index.css
git commit -m "feat(desktop): apply borderless window chrome with preserved depth" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 3: Relocate Existing Grid Drag/Eject Controls (TDD slice)

**Files:**
- Modify: `e2e/grid-validate.spec.ts` (custom drag + snapped eject checks around `349-410`, `452-482`)
- Modify: `e2e/desktop.spec.ts` (add one explicit snapped-window eject check)
- Modify: `src/renderer/components/desktop/DesktopWindow.tsx` (replace titlebar grid controls around `567-607`)
- Modify: `src/renderer/index.css` (corner control styles near `.window-grid-grip`)

- [ ] **Step 1: Write failing tests for in-surface grid controls**

```ts
test('unsnapped window still exposes drag-to-grid grip', async () => {
  const grip = page.locator('.window-grid-grip[title="Drag into a grid cell"]').first();
  await expect(grip).toBeVisible({ timeout: 3000 });
});

test('grid-snapped window exposes in-surface eject control', async () => {
  // keep existing setup helpers from this file
  const grip = page.locator('.window-grid-grip').first();
  await expect(grip).toBeVisible({ timeout: 3000 });
  await expect(grip).toHaveAttribute('title', 'Eject from grid');
});
```

- [ ] **Step 2: Run grid validation tests to verify failures**

Run:
```bash
npm run test:e2e -- e2e/grid-validate.spec.ts --grep "custom drag|drag-to-grid grip|eject button|in-surface eject|grid-snapped window"
```

Expected: FAIL if titlebar removal removed/misplaced relocated grid controls.

- [ ] **Step 3: Implement corner drag/eject controls in window surface**

```tsx
<div className="window-surface-corner-controls">
  {isGridSnapped ? (
    <button
      className="window-grid-grip window-grid-eject"
      title="Eject from grid"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        removeWindowFromCell(win.gridId!, win.id);
      }}
    >
      <LucideIcon name="Minimize2" size={12} />
    </button>
  ) : (
    <button
      className="window-grid-grip window-grid-drag"
      title="Drag into a grid cell"
      onMouseDown={(e) => {
        e.stopPropagation();
        startGridDragFromSurface(e);
      }}
    >
      <LucideIcon name="GripVertical" size={12} />
    </button>
  )}
</div>
```

```css
.window-surface-corner-controls {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 12;
  display: flex;
}
```

- [ ] **Step 4: Run grid tests to verify pass**

Run:
```bash
npm run test:e2e -- e2e/grid-validate.spec.ts --grep "custom drag|drag-to-grid grip|eject button|grid-snapped window|in-surface eject"
```

Expected: PASS for both unsnapped drag-to-grid and snapped eject behavior.

- [ ] **Step 5: Commit**

```bash
git add e2e/grid-validate.spec.ts e2e/desktop.spec.ts src/renderer/components/desktop/DesktopWindow.tsx src/renderer/index.css
git commit -m "feat(desktop): preserve grid drag/eject controls after titlebar removal" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 4: NodeTree Window Menu Copy: “Close window” (TDD slice)

**Files:**
- Modify: `e2e/context-menus.spec.ts` (NodeTree window context menu assertions around `287-292`, `332-349`)
- Modify: `src/renderer/components/NodeTree.tsx` (menu item array around `947-954`)

- [ ] **Step 1: Write failing copy assertions**

```ts
const windowDeleteBtn = page.locator('[data-testid="nodetree-ctx-delete"]');
await expect(windowDeleteBtn).toHaveText('Close window');

// keep non-window semantics unchanged
await expect(page.locator('[data-testid="nodetree-ctx-delete"]')).toHaveText('Delete');
```

- [ ] **Step 2: Run NodeTree context-menu tests to verify failures**

Run:
```bash
npm run test:e2e -- e2e/context-menus.spec.ts --grep "NodeTree window context menu|NodeTree mental card context menu|NodeTree grid context menu"
```

Expected: FAIL because window menu currently renders `Delete`.

- [ ] **Step 3: Implement conditional label in `NodeTree.tsx`**

```tsx
const menuItems = [
  { label: 'Rename', icon: 'Pencil', action: 'rename' },
  { label: 'Locate', icon: 'Navigation', action: 'locate' },
  ...(contextMenu.target.kind === 'window'
    ? [
        { label: 'Minimize', icon: 'Minus', action: 'minimize' },
        { label: 'Close window', icon: 'Trash2', action: 'delete' },
      ]
    : [{ label: 'Delete', icon: 'Trash2', action: 'delete' }]),
];
```

- [ ] **Step 4: Run NodeTree context-menu tests to verify pass**

Run:
```bash
npm run test:e2e -- e2e/context-menus.spec.ts --grep "NodeTree window context menu|NodeTree mental card context menu|NodeTree grid context menu"
```

Expected: PASS (window = `Close window`; mental/grid = `Delete`).

- [ ] **Step 5: Commit**

```bash
git add e2e/context-menus.spec.ts src/renderer/components/NodeTree.tsx
git commit -m "feat(nodetree): rename window delete action to close window" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 5: Final Regression Gate

**Files:**
- Modify only if regressions are discovered during final run

- [ ] **Step 1: Run focused E2E regression batch**

Run:
```bash
npm run test:e2e -- e2e/desktop.spec.ts e2e/context-menus.spec.ts e2e/grid-validate.spec.ts
```

Expected: PASS for updated window interaction + NodeTree + grid workflows.

- [ ] **Step 2: Run desktop store unit suite as safety net**

Run:
```bash
npm run test -- src/renderer/__tests__/desktop-store.test.ts
```

Expected: PASS (store contracts remain unchanged).

- [ ] **Step 3: If failures occur, apply minimal fixes in touched files only**

```ts
// Example constraint for fixes:
// - no unrelated refactors
// - keep selectors stable where possible
// - preserve existing store API contracts
```

- [ ] **Step 4: Re-run failing commands until green**

Run only failed command(s) from steps 1-2 until PASS.

- [ ] **Step 5: Final commit**

```bash
git add src/renderer/components/desktop/DesktopWindow.tsx src/renderer/index.css src/renderer/components/NodeTree.tsx e2e/desktop.spec.ts e2e/context-menus.spec.ts e2e/grid-validate.spec.ts
git commit -m "test: finalize borderless window system regressions" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
