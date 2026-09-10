/**
 * NodeTree.tsx — Renderer Composite Component
 *
 * Responsibility:
 * - Renders the NodeTree surface in the renderer layer.
 * - Encapsulates Feature-level composition used by the renderer shell and panels.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 *
 * Task 13 (adoption plan #20), Fase 2: this file used to own its OWN shell
 * (group headers, row markup, hover/locate/rename wiring) duplicating what
 * `@cmolg/daba-engine`'s `ComponentsPanel` now provides generically. This
 * file keeps ONLY domain data + decoration: it computes `ComponentsPanelGroup[]`
 * from desktop-store (grouping/labels — 1:1 with the groups that existed
 * before this task, task13-decisiones.md Q8), and supplies `renderRow` to
 * decorate each row with the exact same icons/badges/buttons/chips as
 * before. Locate (pan), rename (in-place edit), hover-highlight, and the
 * empty state are now the motor's job — see `onLocate`/`renamingId`/
 * `itemTestId`/`emptyState` wiring below and `engine-bridge.ts`'s
 * `syncEngineItems`/`syncEngineSelection` for how `engine.items` gets
 * populated in the first place.
 *
 * CAUTION preserved from the orchestrator's review: content nested INSIDE a
 * `renderRow` (attached-item chips, a grid's child-window rows, a flow's
 * child StepRows) used to be RENDERED AS SIBLINGS of the row in the old
 * shell — clicking/right-clicking them was inert (no ancestor listener). Now
 * that they're DESCENDANTS of the motor's own row div (which owns
 * onClick=locate()/onContextMenu=onContextMenuRequest), every nested
 * interactive element below stops propagation on click/dblclick/contextmenu
 * so it doesn't ALSO fire the PARENT row's locate/context-menu — see the
 * inline comments at each nested block, and
 * `NodeTree.nestedRowIsolation.test.tsx` for the regression test.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { useDesktopStore } from '@/renderer/store/desktop-store';
import { useHarnessStore } from '@/renderer/store/harness-store';
import { engineStore, parseBridgeId, namespacedId, type BridgeItemKind } from '@/renderer/store/engine-bridge';
import { LucideIcon } from './desktop/LucideIcon';
import { theme } from '@/renderer/logic/theme';
// NodeTree's inline right-click menu adopted onto @cmolg/daba-engine's
// unified ContextMenu (adoption plan #20, javadaba-web Core, Task 10) — one
// provider per CtxTarget.kind ('window' | 'mental' | 'grid' | 'step'; 'flow'
// and 'attachable' items get NO context menu, matching today — see the
// onContextMenuRequest wiring below).
import {
  ContextMenu, useContextMenuState, ComponentsPanel, EngineProvider, centerOn,
  type ContextMenuContext, type ContextMenuEntry, type ContextMenuProviders,
  type ComponentsPanelGroup, type EngineItem,
} from '@cmolg/daba-engine';
import type { AttachableType, DesktopWindow, FrameGraphNode, MentalGraphNode, StepGraphNode } from '@/types/desktop';
import type { AgenticExecutionStatus } from '@/types/harness';

const ELECTRIC_BLUE = '#4285F4';

const TYPE_META: Record<AttachableType, { color: string; icon: string; label: string }> = {
  role: { color: '#E87040', icon: 'User', label: 'Role' },
  mod:  { color: '#4285F4', icon: 'Wrench', label: 'Mod' },
  flow: { color: '#A78BFA', icon: 'Route', label: 'Flow' },
  step: { color: '#2BB673', icon: 'ListChecks', label: 'Step' },
};

// aria-label prefix per window type — windowAriaLabel() is shared by every
// window row regardless of which group it's in, so the prefix must key off
// the row's own win.type rather than a single hardcoded word (see the
// file-explorer/file-viewer special case in windowAriaLabel() below).
const WINDOW_KIND_LABEL: Record<string, string> = {
  backlog: 'Backlog',
  plugin: 'Plugin',
  'prompt-dev-zone': 'Prompt Dev Zone',
};

// Flow (FrameGraphNode) aggregate status dot — "worst-of" its child steps'
// AgenticExecutionStatus, ranked by how urgently a developer would want to
// notice it: an error anywhere outranks an in-progress run, which outranks a
// paused run, which outranks a clean completion. 'compiling' shares the
// 'running' bucket — StepNode's own `isBusy` check treats them the same way.
const STATUS_SEVERITY: Record<AgenticExecutionStatus, number> = {
  error: 4,
  running: 3,
  compiling: 3,
  paused: 2,
  completed: 1,
  idle: 0,
};

// Reuses the same token vocabulary StepNode/FrameNode already use for status
// (theme.danger/warning/success) plus theme.accentBlue for the running/busy
// state, so the Flows group reads consistently with the canvas nodes it mirrors.
const STATUS_DOT_COLOR: Record<AgenticExecutionStatus, string> = {
  error: theme.danger,
  running: theme.accentBlue,
  compiling: theme.accentBlue,
  paused: theme.warning,
  completed: theme.success,
  idle: theme.textGhost,
};

function worstStepStatus(
  childIds: string[],
  stepStatuses: Record<string, AgenticExecutionStatus>,
): AgenticExecutionStatus {
  let worst: AgenticExecutionStatus = 'idle';
  for (const childId of childIds) {
    const status = stepStatuses[childId] ?? 'idle';
    if (STATUS_SEVERITY[status] > STATUS_SEVERITY[worst]) worst = status;
  }
  return worst;
}

/**
 * A single step row inside the Flows/Steps section — shared by a frame's
 * child steps AND by orphan steps (steps that exist on the canvas but aren't
 * referenced by any frame's `childIds`, rendered in their own "Steps" group).
 *
 * TWO MODES, matching the two call sites below:
 * - NESTED (a frame's child): `onNavigate`/`onContextMenuAction` are
 *   provided — this row is a DESCENDANT of the flow's own motor row, so its
 *   onClick/onContextMenu handlers stop propagation (see the CAUTION in this
 *   file's header comment) after doing the same select+center /
 *   open-context-menu work `navigateToMentalNode`/`openContextMenu` always did.
 * - TOP-LEVEL (an orphan, rendered as the sole `renderRow` content of its
 *   OWN motor row via the "Steps" group): `onNavigate`/`onContextMenuAction`
 *   are omitted — no onClick/onContextMenu attributes at all, so the click/
 *   right-click bubbles up to the motor row itself, which already handles
 *   locate() (pan) + `onLocate` (selection) + `onContextMenuRequest` (kind
 *   'step') generically. Omitting the handlers here (rather than adding a
 *   redundant SECOND one that would need to fire before the row's own) is
 *   the simpler way to get identical behavior out of one shared component.
 */
function StepRow({
  step,
  status,
  onNavigate,
  onContextMenuAction,
  testIdPrefix,
}: {
  step: StepGraphNode;
  status: AgenticExecutionStatus;
  onNavigate?: () => void;
  onContextMenuAction?: (e: React.MouseEvent) => void;
  testIdPrefix: string;
}) {
  return (
    <div
      className="nav-child-item"
      data-testid={`${testIdPrefix}-${step.id}`}
      onClick={onNavigate ? (e) => { e.stopPropagation(); onNavigate(); } : undefined}
      onContextMenu={onContextMenuAction}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 6,
        padding: '4px 12px 4px 32px',
        cursor: onNavigate ? 'pointer' : 'default',
        color: theme.textDim,
        fontSize: 11,
        transition: 'background 0.1s ease',
        borderLeft: '2px solid transparent',
      }}
    >
      <span
        aria-label={`status: ${status}`}
        title={`status: ${status}`}
        data-testid={`${testIdPrefix}-status-${step.id}`}
        style={{
          width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
          background: STATUS_DOT_COLOR[status],
        }}
      />
      <span style={{
        flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {step.data.title}
      </span>
    </div>
  );
}

function kebabToTitle(str: string): string {
  return str.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * Viewport for the motor's `centerOn` (and this file's own `centerViewportOn`
 * wrapper below) — `window.innerWidth - 280`/`window.innerHeight - 60`,
 * unchanged formula, now read LAZILY (a function, not a resolved `Size`) so
 * it reflects the sidebar's ACTUAL width at click time even if it collapses/
 * reopens between renders (task13-decisiones.md Q1 — this is exactly what
 * the motor's `viewport?: Size | (() => Size)` gap (E5) exists for).
 */
function panViewport(): { width: number; height: number } {
  return { width: window.innerWidth - 280, height: window.innerHeight - 60 };
}

/**
 * Computes the canvasPan {x, y} that centers a canvas item (window, grid, or
 * mental/flow/step node) inside the visible viewport. This is the single
 * source of truth for that math — every "locate on canvas" action (row
 * click, keyboard activation, right-click → Locate) calls this instead of
 * re-deriving the formula, so they all agree on what "centered" means.
 *
 * Delegates to the motor's own `centerOn` (task13-decisiones.md Q1: with
 * `viewport = panViewport()` and zero insets, this is algebraically
 * IDENTICAL to the `-(pos.x*zoom) + viewportW/2 - (size.width*zoom)/2`
 * formula this function used to compute inline — verified with a golden-
 * value test, `NodeTree.locateViewport.test.tsx`) — a single canonical
 * implementation instead of two that happen to agree.
 */
export function centerViewportOn(
  position: { x: number; y: number },
  size: { width: number; height: number },
  zoom: number,
): { x: number; y: number } {
  return centerOn({ x: position.x, y: position.y, width: size.width, height: size.height }, panViewport(), zoom, {});
}

type CtxTarget =
  | { kind: 'window'; id: string }
  | { kind: 'mental'; id: string }
  | { kind: 'grid'; id: string }
  | { kind: 'step'; id: string };

/** `File: `/`Grid: `/`Flow: ` etc. prefix per window type — file-explorer and
 *  file-viewer both read "File:" (previously two separate hand-rolled row
 *  blocks that happened to agree; now one shared aria-label function). */
function windowAriaLabel(win: DesktopWindow, isActive: boolean): string {
  const kindLabel =
    win.type === 'file-explorer' || win.type === 'file-viewer' ? 'File'
    : WINDOW_KIND_LABEL[win.type] ?? 'Component';
  return `${kindLabel}: ${win.title}${isActive ? ', active' : ''}`;
}

export function NodeTree() {
  const windows = useDesktopStore(s => s.windows);
  const attachables = useDesktopStore(s => s.attachables);
  const grids = useDesktopStore(s => s.grids);
  const activeWindowId = useDesktopStore(s => s.activeWindowId);
  const focusWindow = useDesktopStore(s => s.focusWindow);
  const focusGrid = useDesktopStore(s => s.focusGrid);
  const setCanvasPan = useDesktopStore(s => s.setCanvasPan);
  const canvasZoom = useDesktopStore(s => s.canvasZoom);
  const removeWindow = useDesktopStore(s => s.removeWindow);
  const setWindowState = useDesktopStore(s => s.setWindowState);
  const connections = useDesktopStore(s => s.connections);
  const detachFromWindow = useDesktopStore(s => s.detachFromWindow);
  const removeAttachedItem = useDesktopStore(s => s.removeAttachedItem);
  const removeAttachable = useDesktopStore(s => s.removeAttachable);
  const mentalNodes = useDesktopStore(s => s.mentalNodes);
  const mentalEdges = useDesktopStore(s => s.mentalEdges);
  const removeMentalNode = useDesktopStore(s => s.removeMentalNode);
  const setSelectedMentalNodeIds = useDesktopStore(s => s.setSelectedMentalNodeIds);
  const mentalMode = useDesktopStore(s => s.mentalMode);
  const setMentalMode = useDesktopStore(s => s.setMentalMode);
  const marketInventory = useDesktopStore(s => s.marketInventory);
  const removeGrid = useDesktopStore(s => s.removeGrid);
  const removeWindowFromCell = useDesktopStore(s => s.removeWindowFromCell);
  const updateWindowTitle = useDesktopStore(s => s.updateWindowTitle);
  const updateMentalNode = useDesktopStore(s => s.updateMentalNode);
  const updateGridTitle = useDesktopStore(s => s.updateGridTitle);
  const stepStatuses = useHarnessStore(s => s.stepStatuses);

  const { state: contextMenuState, open: engineOpenContextMenu, close: closeContextMenu } = useContextMenuState();
  const [renamingItem, setRenamingItem] = useState<CtxTarget | null>(null);

  const navigateToWindow = useCallback((windowId: string) => {
    const win = useDesktopStore.getState().windows.find(w => w.id === windowId);
    if (!win) return;
    focusWindow(windowId);
    setCanvasPan(centerViewportOn(win.position, win.size, canvasZoom));
  }, [focusWindow, setCanvasPan, canvasZoom]);

  const navigateToGrid = useCallback((gridId: string) => {
    const grid = useDesktopStore.getState().grids.find(g => g.id === gridId);
    if (!grid) return;
    focusGrid(gridId);
    setCanvasPan(centerViewportOn(grid.position, grid.size, canvasZoom));
  }, [setCanvasPan, canvasZoom, focusGrid]);

  // Shared by Flow rows and their child Step rows — both are `mentalNodes`
  // entries with the same position/width/height shape, so one lookup +
  // centerViewportOn() call (single source of truth, see helper above) covers
  // "select + center" for either, plus syncing canvas selection to the row.
  const navigateToMentalNode = useCallback((nodeId: string) => {
    const node = useDesktopStore.getState().mentalNodes.find(n => n.id === nodeId);
    if (!node) return;
    setSelectedMentalNodeIds([nodeId]);
    setCanvasPan(centerViewportOn(node.position, { width: node.width, height: node.height }, canvasZoom));
  }, [setSelectedMentalNodeIds, setCanvasPan, canvasZoom]);

  // Thin wrapper over the motor's open() — keeps every NESTED row's
  // onContextMenu call site (`openContextMenu(e, {kind, id})`) unchanged.
  // TOP-LEVEL rows (window/grid/mental/step as their own motor row) get their
  // context menu automatically via `onContextMenuRequest` below instead.
  const openContextMenu = useCallback((e: React.MouseEvent, target: CtxTarget) => {
    e.preventDefault();
    e.stopPropagation();
    engineOpenContextMenu({ targetKind: target.kind, targetId: target.id, worldPos: { x: 0, y: 0 } }, { x: e.clientX, y: e.clientY });
  }, [engineOpenContextMenu]);

  const startRename = useCallback((target: CtxTarget) => {
    setRenamingItem(target);
  }, []);

  // One provider per CtxTarget.kind, entries ported verbatim from the old
  // inline switch (adoption plan #20, Task 10) plus a NEW 'step' provider
  // (orphan steps now reach the context menu through the motor's generic
  // onContextMenuRequest, same as frame-child steps already did manually) —
  // Rename is deliberately absent for 'step' (task13-decisiones.md Q3,
  // corrected semantics: steps never supported rename, even though the OLD
  // per-row menu accidentally offered it with no input to show — see this
  // task's report for the verification). testId mirrors the old
  // `nodetree-ctx-${action}` convention so existing e2e selectors still work.
  const nodeTreeContextMenuProviders: ContextMenuProviders = useMemo(() => {
    const buildEntries = (kind: CtxTarget['kind']) => (ctx: ContextMenuContext): ContextMenuEntry[] => {
      const target: CtxTarget = { kind, id: ctx.targetId! };
      const entries: ContextMenuEntry[] = [];
      if (kind !== 'step') {
        entries.push({
          id: 'rename', testId: 'nodetree-ctx-rename', label: 'Rename',
          icon: <LucideIcon name="Pencil" size={13} style={{ opacity: 0.6, flexShrink: 0 }} />,
          onSelect: () => startRename(target),
        });
      }
      entries.push({
        id: 'locate', testId: 'nodetree-ctx-locate', label: 'Locate',
        icon: <LucideIcon name="Navigation" size={13} style={{ opacity: 0.6, flexShrink: 0 }} />,
        onSelect: () => {
          if (target.kind === 'window') navigateToWindow(target.id);
          // Deliberate behavior change (pre-adoption): this used to
          // re-derive the centering math inline and only re-center, so
          // right-click → Locate and clicking the node's own row disagreed
          // on whether selection followed. Delegating to
          // navigateToMentalNode means Locate now also selects the node,
          // matching row-click behavior (the old split was a duplication
          // artifact, not an intentional difference).
          else if (target.kind === 'mental' || target.kind === 'step') navigateToMentalNode(target.id);
          else if (target.kind === 'grid') navigateToGrid(target.id);
        },
      });
      if (kind === 'window') {
        entries.push({
          id: 'minimize', testId: 'nodetree-ctx-minimize', label: 'Minimize',
          icon: <LucideIcon name="Minus" size={13} style={{ opacity: 0.6, flexShrink: 0 }} />,
          onSelect: () => {
            const win = useDesktopStore.getState().windows.find(w => w.id === target.id);
            if (win) setWindowState(target.id, win.state === 'minimized' ? 'normal' : 'minimized');
          },
        });
        entries.push({
          id: 'delete', testId: 'nodetree-ctx-delete', label: 'Close window', danger: true,
          icon: <LucideIcon name="Trash2" size={13} style={{ opacity: 0.6, flexShrink: 0 }} />,
          onSelect: () => removeWindow(target.id),
        });
      } else {
        entries.push({
          id: 'delete', testId: 'nodetree-ctx-delete', label: 'Delete', danger: true,
          icon: <LucideIcon name="Trash2" size={13} style={{ opacity: 0.6, flexShrink: 0 }} />,
          onSelect: () => {
            if (target.kind === 'mental' || target.kind === 'step') removeMentalNode(target.id);
            else if (target.kind === 'grid') removeGrid(target.id);
          },
        });
      }
      return entries;
    };
    return {
      window: buildEntries('window'),
      mental: buildEntries('mental'),
      grid: buildEntries('grid'),
      step: buildEntries('step'),
    };
  }, [startRename, navigateToWindow, navigateToMentalNode, navigateToGrid, setWindowState, removeWindow, removeMentalNode, removeGrid]);

  // ─── Motor-generic row callbacks (ComponentsPanel props) ────────────

  const itemLabel = useCallback((item: EngineItem): string => {
    return (item.meta as { label?: string } | undefined)?.label ?? item.id;
  }, []);

  const itemClassName = useCallback((item: EngineItem): string | undefined => {
    return item.kind === 'window' || item.kind === 'grid' || item.kind === 'flow' ? 'nav-window-item' : 'nav-child-item';
  }, []);

  const itemTestId = useCallback((item: EngineItem): string | undefined => {
    const parsed = parseBridgeId(item.id);
    if (!parsed) return undefined;
    const { kind, rawId } = parsed;
    if (kind === 'window') return `nav-window-${rawId}`;
    if (kind === 'grid') return `nav-grid-${rawId}`;
    if (kind === 'flow') return `nav-flow-${rawId}`;
    // 'step' is deliberately OMITTED here: an orphan step's own StepRow
    // (rendered as this row's sole renderRow content) already carries
    // `nav-step-${rawId}` on its inner div — giving the OUTER motor row the
    // SAME testid too would make `getByTestId` match two elements at once.
    if (kind === 'mental') return `nav-mental-node-${rawId}`;
    if (kind === 'attachable') {
      const att = attachables.find(a => a.id === rawId);
      return att ? `nav-unattached-${att.type}-${att.name}` : undefined;
    }
    return undefined;
  }, [attachables]);

  const itemAriaLabel = useCallback((item: EngineItem): string | undefined => {
    const parsed = parseBridgeId(item.id);
    if (!parsed) return undefined;
    if (parsed.kind === 'window') {
      const win = windows.find(w => w.id === parsed.rawId);
      return win ? windowAriaLabel(win, win.id === activeWindowId) : undefined;
    }
    if (parsed.kind === 'grid') {
      const grid = grids.find(g => g.id === parsed.rawId);
      return grid ? `Grid: ${grid.title ?? `${grid.columns}×${grid.rows}`}` : undefined;
    }
    if (parsed.kind === 'flow') {
      const frame = mentalNodes.find(n => n.id === parsed.rawId) as FrameGraphNode | undefined;
      return frame ? `Flow: ${frame.data.title}` : undefined;
    }
    return undefined; // mental/step/attachable rows have no aria-label today.
  }, [windows, grids, mentalNodes, activeWindowId]);

  const renameInputTestId = useCallback((item: EngineItem): string | undefined => {
    const parsed = parseBridgeId(item.id);
    if (!parsed) return undefined;
    if (parsed.kind === 'window') return `nav-window-rename-input-${parsed.rawId}`;
    if (parsed.kind === 'grid') return `nav-grid-rename-input-${parsed.rawId}`;
    if (parsed.kind === 'mental') return `nav-mental-rename-input-${parsed.rawId}`;
    return undefined; // step/flow/attachable never support rename.
  }, []);

  const onRename = useCallback((id: string, name: string) => {
    const parsed = parseBridgeId(id);
    if (!parsed) return;
    if (parsed.kind === 'window') updateWindowTitle(parsed.rawId, name);
    else if (parsed.kind === 'grid') updateGridTitle(parsed.rawId, name);
    else if (parsed.kind === 'mental') updateMentalNode(parsed.rawId, { text: name });
  }, [updateWindowTitle, updateGridTitle, updateMentalNode]);

  // Domain side-effect fired AFTER the motor's own locate() pan (see
  // ComponentsPanel's onLocate doc-comment) — this is the generic-row
  // equivalent of what navigateToWindow/navigateToGrid/navigateToMentalNode
  // already do for the context-menu 'locate' action above.
  const onLocate = useCallback((item: EngineItem) => {
    const parsed = parseBridgeId(item.id);
    if (!parsed) return;
    if (parsed.kind === 'window') focusWindow(parsed.rawId);
    else if (parsed.kind === 'grid') focusGrid(parsed.rawId);
    else if (parsed.kind === 'mental' || parsed.kind === 'step' || parsed.kind === 'flow') {
      setSelectedMentalNodeIds([parsed.rawId]);
    }
    // 'attachable': no domain side-effect — matches today (Unattached rows
    // only ever panned the canvas, never selected/focused anything).
  }, [focusWindow, focusGrid, setSelectedMentalNodeIds]);

  // Context menu for TOP-LEVEL motor rows (window/grid/mental/step). 'flow'
  // and 'attachable' get no context menu — matches today exactly for
  // attachables (never had one) and flows (frames never had one either); for
  // windows, file-explorer/file-viewer rows ALSO never had a context menu
  // (only the "Files" special-case row block, unlike Backlog/Plugins/Prompt
  // Dev Zone's renderGroup()) — preserved via the type guard below.
  const onContextMenuRequest = useCallback((kind: string, id: string, _worldPos: unknown, screenPos: { x: number; y: number }) => {
    if (kind === 'window') {
      const win = windows.find(w => w.id === id);
      if (!win || win.type === 'file-explorer' || win.type === 'file-viewer') return;
    }
    if (kind !== 'window' && kind !== 'grid' && kind !== 'mental' && kind !== 'step') return;
    engineOpenContextMenu({ targetKind: kind, targetId: id, worldPos: { x: 0, y: 0 } }, screenPos);
  }, [windows, engineOpenContextMenu]);

  // Sort: active first, then by zIndex desc
  const sortedWindows = [...windows].sort((a, b) => {
    if (a.id === activeWindowId) return -1;
    if (b.id === activeWindowId) return 1;
    return b.zIndex - a.zIndex;
  });

  // 'Chats' group retired (chats→steps re-architecture, F0 decision 2,
  // 2026-07-10) — chat is no longer a window surface at all, and F0
  // explicitly does not preserve it in any reduced form.
  const fileWindows = sortedWindows.filter(w => w.type === 'file-explorer');
  const fileViewerWindows = sortedWindows.filter(w => w.type === 'file-viewer');
  const pluginWindows = sortedWindows.filter(w => w.type === 'plugin');
  const backlogWindows = sortedWindows.filter(w => w.type === 'backlog');
  const promptDevWindows = sortedWindows.filter(w => w.type === 'prompt-dev-zone');

  // Flows on the canvas — FrameGraphNodes among mentalNodes (pipeline frames).
  const frames = mentalNodes.filter((n): n is FrameGraphNode => n.type === 'frame');
  // Steps that exist on the canvas but aren't referenced by any frame's
  // childIds — get a "Steps" group inside Flows/Steps.
  const orphanSteps = mentalNodes.filter(
    (n): n is StepGraphNode => n.type === 'step' && !frames.some(f => f.data.childIds.includes(n.id)),
  );
  // Mental Cards proper — plain MentalGraphNodes only.
  const cards = mentalNodes.filter((n): n is MentalGraphNode => n.type === 'mental');

  const getAttachedItems = (win: DesktopWindow) => {
    const items: Array<{ type: AttachableType; name: string }> = [];
    if (win.roleId) items.push({ type: 'role', name: win.roleId });
    if (win.flowId) items.push({ type: 'flow', name: win.flowId });
    for (const modId of win.modifierIds) {
      items.push({ type: 'mod', name: modId });
    }
    return items;
  };

  // ─── ComponentsPanelGroup[] — 1:1 with the groups that existed before
  // this task (task13-decisiones.md Q8). Empty groups are simply omitted
  // (ComponentsPanel's own `emptyState` fires when ALL groups are empty/gone
  // — see below), matching the old appear/disappear-per-section behavior.

  const groups: ComponentsPanelGroup[] = [];
  if (fileWindows.length > 0 || fileViewerWindows.length > 0) {
    groups.push({
      id: 'files',
      label: `Files (${fileWindows.length + fileViewerWindows.length})`,
      itemIds: [...fileWindows, ...fileViewerWindows].map(w => `win:${w.id}`),
    });
  }
  if (backlogWindows.length > 0) {
    groups.push({ id: 'backlog', label: `Backlog (${backlogWindows.length})`, itemIds: backlogWindows.map(w => `win:${w.id}`) });
  }
  if (pluginWindows.length > 0) {
    groups.push({ id: 'plugins', label: `Plugins (${pluginWindows.length})`, itemIds: pluginWindows.map(w => `win:${w.id}`) });
  }
  if (promptDevWindows.length > 0) {
    groups.push({ id: 'prompt-dev-zone', label: `Prompt Dev Zone (${promptDevWindows.length})`, itemIds: promptDevWindows.map(w => `win:${w.id}`) });
  }
  if (frames.length > 0 || orphanSteps.length > 0) {
    const flowsLabel = orphanSteps.length > 0
      ? `Flows / Steps (${frames.length + orphanSteps.length})`
      : `Flows (${frames.length})`;
    groups.push({ id: 'flows', label: flowsLabel, itemIds: frames.map(f => `flow:${f.id}`) });
    if (orphanSteps.length > 0) {
      groups.push({ id: 'steps', label: `Steps (${orphanSteps.length})`, itemIds: orphanSteps.map(s => `step:${s.id}`) });
    }
  }
  if (grids.length > 0) {
    groups.push({ id: 'grids', label: `Grids (${grids.length})`, itemIds: grids.map(g => `grid:${g.id}`) });
  }
  if (attachables.length > 0) {
    groups.push({ id: 'unattached', label: `Unattached (${attachables.length})`, itemIds: attachables.map(a => `att:${a.id}`) });
  }
  if (cards.length > 0) {
    groups.push({ id: 'mental-cards', label: `Mental Cards (${cards.length})`, itemIds: cards.map(c => `mental:${c.id}`) });
  }

  // ─── renderRow — per-kind decoration ─────────────────────────────

  const renderRow = useCallback((item: EngineItem): React.ReactNode => {
    const parsed = parseBridgeId(item.id);
    if (!parsed) return null;
    const { kind, rawId } = parsed;

    // ── Windows ──────────────────────────────────────────────────
    if (kind === 'window') {
      const win = windows.find(w => w.id === rawId);
      if (!win) return null;
      const isActive = win.id === activeWindowId;
      const isMinimized = win.state === 'minimized';

      const toggleMinimize = (e: React.MouseEvent) => {
        e.stopPropagation();
        setWindowState(win.id, win.state === 'minimized' ? 'normal' : 'minimized');
      };
      const handleRemove = (e: React.MouseEvent) => {
        e.stopPropagation();
        removeWindow(win.id);
      };

      // Compact file-viewer row — no connCount badge, no attached-item chips
      // (file-viewer windows never carry role/mod/flow attachments).
      if (win.type === 'file-viewer') {
        return (
          <>
            <LucideIcon name="FileCode2" size={12} style={{ flexShrink: 0, opacity: 0.7 }} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: isActive ? 500 : 400, fontSize: 11, color: isMinimized ? theme.textGhost : theme.textDim }}>
              {win.title}
            </span>
            <button onClick={toggleMinimize} title={isMinimized ? 'Show' : 'Hide'} style={{ background: 'none', border: 'none', color: theme.textGhost, cursor: 'pointer', padding: 2, borderRadius: 4, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
              <LucideIcon name={isMinimized ? 'Plus' : 'Minus'} size={10} />
            </button>
            <button onClick={handleRemove} title="Close" aria-label={`Close ${win.title}`} style={{ background: 'none', border: 'none', color: theme.textGhost, cursor: 'pointer', padding: 2, borderRadius: 4, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
              <LucideIcon name="X" size={10} />
            </button>
          </>
        );
      }

      const connCount = connections.filter(c => c.sourceWindowId === win.id || c.targetWindowId === win.id).length;
      const attachedItems = getAttachedItems(win);
      // Read-only chips (no testid/buttons) for file-explorer windows — the
      // old "Files" block never rendered unlink/close on these; interactive
      // chips (testid + unlink/remove) for every other window type, matching
      // the old renderGroup() row.
      const chipsInteractive = win.type !== 'file-explorer';

      return (
        <>
          <LucideIcon name={win.iconName} size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
          <span style={{
            flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontWeight: isActive ? 500 : 400, color: isMinimized ? theme.textGhost : theme.textSecondary,
          }}>
            {win.title}
          </span>
          {connCount > 0 && (
            <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 8, background: `${ELECTRIC_BLUE}1f`, color: ELECTRIC_BLUE, flexShrink: 0 }}>
              {connCount}
            </span>
          )}
          <button onClick={toggleMinimize} title={isMinimized ? 'Show' : 'Hide'} aria-label={`${isMinimized ? 'Show' : 'Minimize'} ${win.title}`} style={{ background: 'none', border: 'none', color: theme.textGhost, cursor: 'pointer', padding: 2, borderRadius: 4, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
            <LucideIcon name={isMinimized ? 'Plus' : 'Minus'} size={10} />
          </button>
          <button onClick={handleRemove} title="Close" aria-label={`Close ${win.title}`} style={{ background: 'none', border: 'none', color: theme.textGhost, cursor: 'pointer', padding: 2, borderRadius: 4, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
            <LucideIcon name="X" size={10} />
          </button>

          {/* Attached children (roles, flows, mods) — NESTED inside this
              row now (used to be siblings, see this file's header CAUTION):
              every interactive bit below stops propagation. */}
          {attachedItems.length > 0 && (
            <div
              style={{ position: 'absolute', left: 0, right: 0, top: '100%' }}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onContextMenu={(e) => e.stopPropagation()}
            >
              {attachedItems.map(item => {
                const meta = TYPE_META[item.type];
                const winRoleColor = win.roleId && marketInventory
                  ? (() => {
                      const r = marketInventory.roles.find((rl) => rl.name === win.roleId);
                      if (!r?.color) return null;
                      return r.color.startsWith('#') ? r.color : `#${r.color}`;
                    })()
                  : null;
                const childBorderColor = isActive ? (winRoleColor ?? ELECTRIC_BLUE) : 'transparent';
                return (
                  <div
                    key={`${win.id}-${item.type}-${item.name}`}
                    className="nav-child-item"
                    data-testid={chipsInteractive ? `nav-child-${item.type}-${item.name}` : undefined}
                    data-parent-active={isActive}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 6,
                      padding: '4px 12px 4px 32px',
                      cursor: 'default',
                      color: isActive ? theme.textSecondary : theme.textDim,
                      fontSize: 11,
                      transition: 'background 0.1s ease, border-color 0.1s ease',
                      borderLeft: `2px solid ${childBorderColor}`,
                      background: isActive ? `${winRoleColor ?? ELECTRIC_BLUE}08` : 'transparent',
                    }}
                  >
                    <LucideIcon name={meta.icon} size={12} style={{ flexShrink: 0, color: meta.color, opacity: 0.8 }} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>
                      {kebabToTitle(item.name)}
                    </span>
                    <span style={{
                      fontSize: 8, padding: '0px 4px', borderRadius: 3,
                      background: `${meta.color}15`, color: meta.color, border: `1px solid ${meta.color}30`,
                      flexShrink: 0, textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.03em',
                    }}>
                      {meta.label}
                    </span>
                    {chipsInteractive && (
                      <>
                        <button
                          onClick={(e) => { e.stopPropagation(); detachFromWindow(win.id, item.type, item.name); }}
                          title="Unlink" aria-label={`Unlink ${kebabToTitle(item.name)} from ${win.title}`}
                          data-testid={`nav-child-unlink-${item.type}-${item.name}`}
                          style={{ background: 'none', border: 'none', color: theme.textGhost, cursor: 'pointer', padding: 2, borderRadius: 4, flexShrink: 0, display: 'flex', alignItems: 'center' }}
                        >
                          <LucideIcon name="Unlink" size={10} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); removeAttachedItem(win.id, item.type, item.name); }}
                          title="Remove" aria-label={`Remove ${kebabToTitle(item.name)}`}
                          data-testid={`nav-child-close-${item.type}-${item.name}`}
                          style={{ background: 'none', border: 'none', color: theme.textGhost, cursor: 'pointer', padding: 2, borderRadius: 4, flexShrink: 0, display: 'flex', alignItems: 'center' }}
                        >
                          <LucideIcon name="X" size={10} />
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      );
    }

    // ── Grids ────────────────────────────────────────────────────
    if (kind === 'grid') {
      const grid = grids.find(g => g.id === rawId);
      if (!grid) return null;
      const childWindowIds = Array.from(new Set(grid.cells.filter((id): id is string => Boolean(id))));
      const childWindows = childWindowIds.map(id => windows.find(w => w.id === id)).filter((w): w is DesktopWindow => Boolean(w));
      return (
        <>
          <LucideIcon name="LayoutGrid" size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {grid.title ?? `Grid ${grid.columns}×${grid.rows}`}
          </span>
          <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 8, background: 'rgba(120,160,255,0.1)', color: 'rgba(120,160,255,0.6)', flexShrink: 0 }}>
            {childWindows.length}/{grid.cells.length}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); removeGrid(grid.id); }}
            title="Remove grid" aria-label={`Remove grid ${grid.title ?? `${grid.columns}×${grid.rows}`}`}
            data-testid={`nav-grid-close-${grid.id}`}
            style={{ background: 'none', border: 'none', color: theme.textGhost, cursor: 'pointer', padding: 2, borderRadius: 4, flexShrink: 0, display: 'flex', alignItems: 'center' }}
          >
            <LucideIcon name="X" size={10} />
          </button>
          {childWindows.length > 0 && (
            <div
              style={{ position: 'absolute', left: 0, right: 0, top: '100%' }}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onContextMenu={(e) => e.stopPropagation()}
            >
              {childWindows.map(cw => (
                <div
                  key={cw.id}
                  className="nav-child-item"
                  data-testid={`nav-grid-child-${cw.id}`}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px 4px 32px', cursor: 'default', color: theme.textDim, fontSize: 11, transition: 'background 0.1s ease', borderLeft: '2px solid transparent' }}
                >
                  <LucideIcon name={cw.iconName} size={12} style={{ flexShrink: 0, opacity: 0.6 }} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cw.title}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeWindowFromCell(grid.id, cw.id); }}
                    title="Eject from grid" aria-label={`Eject ${cw.title} from grid`}
                    data-testid={`nav-grid-eject-${cw.id}`}
                    style={{ background: 'none', border: 'none', color: theme.textGhost, cursor: 'pointer', padding: 2, borderRadius: 4, flexShrink: 0, display: 'flex', alignItems: 'center' }}
                  >
                    <LucideIcon name="Minimize2" size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      );
    }

    // ── Flows (frames) ───────────────────────────────────────────
    if (kind === 'flow') {
      const frame = mentalNodes.find(n => n.id === rawId) as FrameGraphNode | undefined;
      if (!frame) return null;
      const childSteps = frame.data.childIds
        .map(childId => mentalNodes.find(n => n.id === childId))
        .filter((n): n is StepGraphNode => n?.type === 'step');
      const aggregateStatus = worstStepStatus(frame.data.childIds, stepStatuses);
      return (
        <>
          <LucideIcon name="Workflow" size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{frame.data.title}</span>
          <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 8, background: 'rgba(167,139,250,0.1)', color: '#A78BFA', flexShrink: 0 }}>
            {frame.data.childIds.length}
          </span>
          <span
            aria-label={`status: ${aggregateStatus}`} title={`status: ${aggregateStatus}`}
            data-testid={`nav-flow-status-${frame.id}`}
            style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: STATUS_DOT_COLOR[aggregateStatus] }}
          />
          <button
            onClick={(e) => { e.stopPropagation(); removeMentalNode(frame.id); }}
            title="Remove flow" aria-label={`Remove flow ${frame.data.title}`}
            data-testid={`nav-flow-close-${frame.id}`}
            style={{ background: 'none', border: 'none', color: theme.textGhost, cursor: 'pointer', padding: 2, borderRadius: 4, flexShrink: 0, display: 'flex', alignItems: 'center' }}
          >
            <LucideIcon name="X" size={10} />
          </button>
          {childSteps.length > 0 && (
            <div style={{ position: 'absolute', left: 0, right: 0, top: '100%' }}>
              {childSteps.map(step => (
                <StepRow
                  key={step.id}
                  step={step}
                  status={stepStatuses[step.id] ?? 'idle'}
                  onNavigate={() => navigateToMentalNode(step.id)}
                  onContextMenuAction={(e) => openContextMenu(e, { kind: 'step', id: step.id })}
                  testIdPrefix="nav-flow-child"
                />
              ))}
            </div>
          )}
        </>
      );
    }

    // ── Steps (orphans, top-level motor row — see StepRow's own doc-comment) ──
    if (kind === 'step') {
      const step = mentalNodes.find(n => n.id === rawId) as StepGraphNode | undefined;
      if (!step) return null;
      return <StepRow step={step} status={stepStatuses[step.id] ?? 'idle'} testIdPrefix="nav-step" />;
    }

    // ── Mental Cards ─────────────────────────────────────────────
    if (kind === 'mental') {
      const node = mentalNodes.find(n => n.id === rawId) as MentalGraphNode | undefined;
      if (!node) return null;
      const nodeLabel = node.text.trim() || 'Untitled card';
      const edgeCount = mentalEdges.filter(e => e.sourceId === node.id || e.targetId === node.id).length;
      return (
        <>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: node.color, flexShrink: 0, border: `1px solid ${theme.borderLight}` }} />
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>{nodeLabel}</span>
          {edgeCount > 0 && (
            <span style={{ fontSize: 8, padding: '0px 3px', borderRadius: 3, background: '#A78BFA15', color: '#A78BFA', border: '1px solid #A78BFA30', flexShrink: 0, fontWeight: 600 }}>
              {edgeCount}
            </span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); removeMentalNode(node.id); }}
            title="Remove" aria-label={`Remove mental card ${nodeLabel}`}
            data-testid={`nav-mental-node-close-${node.id}`}
            style={{ background: 'none', border: 'none', color: theme.textGhost, cursor: 'pointer', padding: 2, borderRadius: 4, flexShrink: 0, display: 'flex', alignItems: 'center' }}
          >
            <LucideIcon name="X" size={10} />
          </button>
        </>
      );
    }

    // ── Unattached (attachables) ─────────────────────────────────
    if (kind === 'attachable') {
      const att = attachables.find(a => a.id === rawId);
      if (!att) return null;
      const meta = TYPE_META[att.type];
      const attachableTitle = kebabToTitle(att.name);
      return (
        <>
          <LucideIcon name={meta.icon} size={12} style={{ flexShrink: 0, color: meta.color, opacity: 0.8 }} />
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>{attachableTitle}</span>
          <span style={{ fontSize: 8, padding: '0px 4px', borderRadius: 3, background: `${meta.color}15`, color: meta.color, border: `1px solid ${meta.color}30`, flexShrink: 0, textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.03em' }}>
            {meta.label}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); removeAttachable(att.id); }}
            title="Remove" aria-label={`Remove ${attachableTitle}`}
            data-testid={`nav-unattached-close-${att.type}-${att.name}`}
            style={{ background: 'none', border: 'none', color: theme.textGhost, cursor: 'pointer', padding: 2, borderRadius: 4, flexShrink: 0, display: 'flex', alignItems: 'center' }}
          >
            <LucideIcon name="X" size={10} />
          </button>
        </>
      );
    }

    return null;
  }, [
    windows, grids, mentalNodes, mentalEdges, attachables, activeWindowId, connections, marketInventory,
    stepStatuses, setWindowState, removeWindow, detachFromWindow, removeAttachedItem, removeGrid,
    removeWindowFromCell, removeMentalNode, removeAttachable, navigateToMentalNode, openContextMenu,
  ]);

  return (
    <EngineProvider store={engineStore}>
      <div data-testid="node-tree" style={{ flex: 1, overflow: 'auto', padding: '4px 0', position: 'relative' }}>
        {/* "Enable Mental Authoring" used to live inline in the Mental Cards
            group header — the motor's ComponentsPanelGroup.label is a plain
            string (no slot for a button), so it's relocated here, above the
            panel. A functionally-identical Dock action
            ('mental-draw-toggle', desktop-store.ts's DEFAULT_DOCK_ITEMS)
            already exists — this is a convenience duplicate, not the only
            way to reach it. */}
        {mentalMode === 'off' && cards.length > 0 && (
          <div style={{ padding: '4px 12px', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={() => setMentalMode('square')}
              title="Enable Mental Authoring"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.textMuted, fontSize: 9, padding: '0 2px', fontFamily: theme.fontMono, letterSpacing: '0.04em' }}
            >
              Enable Mental Authoring
            </button>
          </div>
        )}

        <ComponentsPanel
          groups={groups}
          renderRow={renderRow}
          onRename={onRename}
          viewport={panViewport}
          onContextMenuRequest={onContextMenuRequest}
          itemTestId={itemTestId}
          itemAriaLabel={itemAriaLabel}
          itemClassName={itemClassName}
          onLocate={onLocate}
          itemLabel={itemLabel}
          renamingId={renamingItem ? namespacedId(renamingItem.kind as BridgeItemKind, renamingItem.id) : null}
          onRenameDismiss={() => setRenamingItem(null)}
          renameInputTestId={renameInputTestId}
          emptyState={
            <div style={{ padding: '24px 16px', textAlign: 'center', color: theme.textGhost, fontSize: 12 }}>
              No components open
            </div>
          }
        />

        {/* Right-click context menu for all item types */}
        <ContextMenu
          state={contextMenuState}
          providers={nodeTreeContextMenuProviders}
          onClose={closeContextMenu}
          backdropTestId="nodetree-context-menu-backdrop"
          menuTestId="nodetree-context-menu"
        />
      </div>
    </EngineProvider>
  );
}
