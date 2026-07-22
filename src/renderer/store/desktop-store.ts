/**
 * desktop-store.ts — Renderer UI
 *
 * Architecture note:
 * This file follows the explanatory style used across the codebase:
 * explicit intent, clear boundaries, and behavior-preserving structure.
 */
// src/renderer/store/desktop-store.ts — Zustand store for seamless desktop state
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getConnectedComponent } from '../logic/mental-graph';
import { debouncedLocalStorage } from '../logic/debounced-storage';
// MIN_WIDGET_WIDTH/HEIGHT moved with the HUD widget adoption onto @javadaba/daba-engine
// (Task 10, #20): logic/hud-grid.ts is gone (its generic math ported to the motor's
// core/hud-grid); these two constants are Fluxor's own widget-sizing policy, now in
// logic/hud-widget-policy.ts (a thin adapter over the motor's primitives).
import { MIN_WIDGET_WIDTH, MIN_WIDGET_HEIGHT } from '../logic/hud-widget-policy';
import { normalizeEdgeTypes } from '../logic/normalize-edge-types';
import type {
  DesktopWindow, WindowPosition, WindowSize, WindowConnection,
  DockItem, Plugin, PluginCategory, SnapGuide, CliProvider, ConnectionPort, CanvasPan,
  DesktopAttachable, AttachableType, DesktopGrid, MentalMode, MentalShape,
  MentalTool, MentalGraphNode, MentalGraphEdge, StepGraphNode, CanvasGraphNode, FrameGraphNode,
  StepNodeData, FrameNodeData, Board, BoardSnapshot,
} from '@/types/desktop';
import type { MarketInventory, MarketMod, MarketRole, BacklogCard } from '@/types/market';
import type { TutorialScenarioId, TutorialProgress } from '@/types/tutorial';
import type { PipelineAssembly } from '@/types/meta-agent';
import { clampLoopIterations, LOOP_DEFAULT_MAX_ITERATIONS } from '@/types/harness';
import type { AgenticStepType } from '@/types/harness';
import type { ModelPolicy } from '@/types/ipc-events';
import { wouldCreateStepCycle } from '../lib/harness-compiler';


// ─── Unified z-stack helper ───────────────────────────────────────
// Computes the globally highest z-index across windows, attachables, and
// mental nodes, then returns that value + 1 so the caller can place content
// on top of everything in the unified stack.

function globalTopZ(s: {
  nextZIndex: number;
  windows: Array<{ zIndex?: number }>;
  attachables: Array<{ zIndex?: number }>;
  mentalZ: Record<string, number>;
}): number {
  return Math.max(
    s.nextZIndex,
    0,
    ...s.windows.map(w => w.zIndex ?? 0),
    ...s.attachables.map(a => a.zIndex ?? 0),
    ...Object.values(s.mentalZ ?? {}),
  ) + 1;
}

// ─── Grid cell geometry helper ───────────────────────────────────
// Computes the absolute canvas position and size for a grid cell.
// Must match the CSS: padding 4px, gap 2px (see .grid-cells in index.css).

export const GRID_PADDING = 4;
export const GRID_GAP = 2;

function computeCellRect(
  grid: DesktopGrid,
  cellIndex: number,
  colSpan = 1,
  rowSpan = 1,
): { position: WindowPosition; size: WindowSize } {
  const row = Math.floor(cellIndex / grid.columns);
  const col = cellIndex % grid.columns;
  const cellW = (grid.size.width - GRID_PADDING * 2 - (grid.columns - 1) * GRID_GAP) / grid.columns;
  const cellH = (grid.size.height - GRID_PADDING * 2 - (grid.rows - 1) * GRID_GAP) / grid.rows;
  return {
    position: {
      x: grid.position.x + GRID_PADDING + col * (cellW + GRID_GAP),
      y: grid.position.y + GRID_PADDING + row * (cellH + GRID_GAP),
    },
    size: {
      width: colSpan * cellW + (colSpan - 1) * GRID_GAP,
      height: rowSpan * cellH + (rowSpan - 1) * GRID_GAP,
    },
  };
}

/** Reposition all windows assigned to a grid so they match cell coordinates */
function repositionGridWindows(grid: DesktopGrid, windows: DesktopWindow[]): DesktopWindow[] {
  return windows.map(w => {
    if (w.gridId !== grid.id || w.gridCellIndex == null) return w;
    if (w.gridCellIndex < 0 || w.gridCellIndex >= grid.cells.length) return w;
    const rect = computeCellRect(grid, w.gridCellIndex, w.gridColSpan ?? 1, w.gridRowSpan ?? 1);
    return { ...w, position: rect.position, size: rect.size };
  });
}

// ─── CLI icon names (Lucide) per provider ────────────────────────

/** Provider-id → Lucide icon mapping for chat window decoration. */
export const CLI_ICON_NAMES: Record<string, string> = {
  opencode:                'Zap',
  'xiaomi-token-plan-ams': 'Cpu',
  'xiaomi-token-plan-cn':  'Cpu',
  openrouter:              'Network',
  anthropic:               'Bot',
  openai:                  'Brain',
  google:                  'Sparkles',
  groq:                    'Zap',
  deepseek:                'Compass',
  xai:                     'Wand',
  custom:                  'Terminal',
};

// ─── Default Dock Items (minimal) ────────────────────────────────

const DEFAULT_DOCK_ITEMS: DockItem[] = [
  // Label/behavior evolved by the chats→steps re-architecture (F0 decision 2,
  // 2026-07-10): this no longer spawns a chat window — it reveals + focuses
  // the single Auto-Chat HUD panel (see Dock.tsx's 'new-chat' case). The
  // `id`/`action` literals are kept stable ('new-chat') so persisted dock
  // arrays from before this change keep matching this entry (migration
  // v19 relabels any already-persisted 'new-chat' item in place — see
  // migrate() below).
  { id: 'dock-new-chat', type: 'action', label: 'Auto-Chat', iconName: 'MessageSquare', action: 'new-chat' },
  { id: 'dock-file-explorer', type: 'action', label: 'Files', iconName: 'FileText', action: 'file-explorer' },
  { id: 'dock-backlog', type: 'action', label: 'Backlog', iconName: 'KanbanSquare', action: 'backlog' },
  { id: 'dock-mental-draw-toggle', type: 'action', label: 'Enable Mental Authoring', iconName: 'PenTool', action: 'mental-draw-toggle' },
  { id: 'dock-new-step', type: 'action', label: 'New Step', iconName: 'SquarePlus', action: 'new-step' },
  { id: 'dock-new-flow', type: 'action', label: 'New Flow', iconName: 'Workflow', action: 'new-flow' },
  { id: 'dock-marketplace', type: 'action', label: 'Marketplace', iconName: 'Store', action: 'marketplace' },
  ...(import.meta.env.DEV ? [
    { id: 'dock-prompt-dev-zone', type: 'action', label: 'Prompt Dev Zone', iconName: 'FlaskConical', action: 'prompt-dev-zone' } satisfies DockItem,
  ] : []),
];

// ─── Built-in Plugins ────────────────────────────────────────────

// Only tools are built-in — roles, mods, and flows come exclusively from inventory.json
const BUILTIN_PLUGINS: Plugin[] = [
  {
    id: 'tool-flows', name: 'E2E Flows', iconName: 'Route', category: 'tools',
    description: 'Define and manage E2E test flows for visual regression',
    author: 'Fluxor', installed: true, componentKey: 'flows-editor',
  },
  {
    id: 'tool-actions', name: 'Actions', iconName: 'Zap', category: 'tools',
    description: 'Predefined orchestration prompts for systematic analysis',
    author: 'Fluxor', installed: true, componentKey: 'actions-panel',
  },
  {
    id: 'tool-logs', name: 'Logs Viewer', iconName: 'ScrollText', category: 'tools',
    description: 'View application and agent logs',
    author: 'Fluxor', installed: true, componentKey: 'logs-panel',
  },
  {
    id: 'tool-terminal', name: 'Terminal Output', iconName: 'Terminal', category: 'tools',
    description: 'Agent reasoning, tool calls, and raw CLI output',
    author: 'Fluxor', installed: true, componentKey: 'terminal-panel',
  },
];

// ─── Constants ───────────────────────────────────────────────────

const DEFAULT_WINDOW_SIZE: WindowSize = { width: 480, height: 500 };
const MIN_WINDOW_SIZE: WindowSize = { width: 320, height: 250 };
const SNAP_THRESHOLD = 8; // px
const DEFAULT_MENTAL_WIDTH = 220;
const DEFAULT_MENTAL_HEIGHT = 120;
const DEFAULT_MENTAL_EDGE_COLOR = '#4DA8FF';
const DEFAULT_STEP_WIDTH = 300;
const DEFAULT_STEP_HEIGHT = 190;

// ─── Notification type ───────────────────────────────────────────

export interface DesktopNotification {
  id: string;
  message: string;
  timestamp: number;
  sessionId?: string;
  read: boolean;
}

// ─── Auto-chat panel — lightweight intent history ─────────────────
//
// One entry per intent submitted to HudAutoChatPanel: what was typed + what
// it materialized (or the error). This is deliberately NOT a multi-turn
// agent transcript (F0 spec + plan Task W1) — assemblePipeline is a one-shot
// intent→PipelineAssembly call, not a conversation, so there is no
// "assistant reply" to log, only the outcome of materializing (or failing
// to materialize) a flow. Real per-step tool/transcript evidence lives in
// StepRunEvidence (Task T), which this history does NOT attempt to
// duplicate. NOT persisted (see `autoChatHistory` below) — mirrors
// `notifications`'s session-only lifetime.
export interface AutoChatHistoryEntry {
  id: string;
  intent: string;
  timestamp: number;
  result:
    | { kind: 'success'; frameId: string; stepCount: number }
    | { kind: 'error'; message: string };
}

interface AddStepNodeInput {
  id?: string;
  parentId?: string;
  position?: WindowPosition;
  width?: number;
  height?: number;
  title?: string;
  description?: string;
  prompt?: string;
  roleId?: string;
  modIds?: string[];
  mods?: MarketMod[];
  roles?: MarketRole[];
  stepType?: AgenticStepType;
}

interface AddFrameNodeInput {
  id?: string;
  position: WindowPosition;
  width: number;
  height: number;
  title: string;
  description?: string;
  childIds?: string[];
  missingCapabilitiesRequested?: string[];
}

interface InsertPipelineAssemblyInput {
  assembly: PipelineAssembly;
  position: WindowPosition;
  frameWidth: number;
  frameHeight: number;
}

interface InsertPipelineAssemblyResult {
  frameId: string;
  stepIds: string[];
}

// ─── HUD Widget Types ─────────────────────────────────────────────

// 'text-to-flow' renamed to 'auto-chat' (chats→steps re-architecture, F0
// decision 2, 2026-07-10): the one-shot intent→flow widget IS the single
// automation-chat surface the F0 spec calls for — evolved in place (new
// history list, same assemblePipeline→insertPipelineAssembly seam) rather
// than adding a second, overlapping HUD widget. Migration v20 renames the
// persisted type in place (mirrors the v16→v17 'text-to-pipeline'→
// 'text-to-flow' precedent below); merge()'s alias is the defensive backstop.
export type HudWidgetType = 'agent-sessions' | 'auto-chat' | 'notifications';

export interface HudWidget {
  type: HudWidgetType;
  visible: boolean;
  position: { x: number; y: number };
  size?: { width: number; height: number };
}

// Default positions (fixed px, not window-relative so they work before mount)
const DEFAULT_HUD_WIDGETS: HudWidget[] = [
  { type: 'agent-sessions',   visible: false, position: { x: 900, y: 80 } },
  { type: 'auto-chat',    visible: true,  position: { x: 360, y: 140 } },
  { type: 'notifications',    visible: false, position: { x: 900, y: 360 } },
];

// ─── Store Interface ─────────────────────────────────────────────

interface DesktopStore {
  // Windows
  windows: DesktopWindow[];
  activeWindowId: string | null;
  nextZIndex: number;
  _updateWindow: (windowId: string, patch: Partial<DesktopWindow>) => void;
  addWindow: (type: DesktopWindow['type'], opts?: Partial<DesktopWindow>) => string;
  removeWindow: (windowId: string) => void;
  focusWindow: (windowId: string) => void;
  moveWindow: (windowId: string, position: WindowPosition) => void;
  resizeWindow: (windowId: string, size: WindowSize, position?: WindowPosition) => void;
  setWindowState: (windowId: string, state: DesktopWindow['state']) => void;
  assignRole: (windowId: string, roleId: string) => boolean;
  removeRole: (windowId: string) => void;
  addModifier: (windowId: string, modifierId: string) => boolean;
  removeModifier: (windowId: string, modifierId: string) => void;
  updateWindowTitle: (windowId: string, title: string) => void;

  // ── M2 Agent surface linking ───────────────────────────────────
  /**
   * Mark `windowId` as the active agent surface (sets `agentLinked: true`).
   * If `linked` is false, clears the link on that window only.
   * Only one web-preview window can be agent-linked at a time — enabling one
   * automatically clears any previous agent-linked window.
   */
  linkWindowToAgent: (windowId: string, linked: boolean) => void;

  // Multi-selection
  selectedWindowIds: string[];
  setSelectedWindowIds: (ids: string[]) => void;
  moveSelectedWindows: (dx: number, dy: number, startX: number, startY: number, endX: number, endY: number) => void;

  // Clipboard (copy/paste windows)
  clipboardWindows: DesktopWindow[];
  copyWindows: () => void;
  pasteWindows: () => void;

  // Flow connectors (max 1 per window) — retired alongside 'chat' (F0
  // decision 2/4): connectFlow always returns false now, see its
  // implementation comment. disconnectFlow stays a plain, ungated setter
  // (used generically by removeAttachedItem/detachFromWindow).
  connectFlow: (windowId: string, flowName: string) => boolean;
  disconnectFlow: (windowId: string) => void;

  // Market Inventory
  marketInventory: MarketInventory | null;
  setMarketInventory: (inventory: MarketInventory) => void;
  getModIncompatibilities: (modName: string) => string[];

  // Backlog
  backlogCards: BacklogCard[];
  setBacklogCards: (cards: BacklogCard[]) => void;
  /**
   * Replaces `backlogCards` wholesale (the main process/watcher is the
   * source of truth) and live-patches `canvasModalCard` in place if it is
   * one of the updated cards. Used by the F1 watcher push
   * (`onBacklogChanged`) and any full-directory refetch. If the modal's card
   * disappeared from the fresh set, the modal is left as-is (no surprise
   * auto-close) — F4.
   */
  mergeBacklogCards: (cards: BacklogCard[]) => void;
  /**
   * Transient (NOT persisted — mirrors `activeBacklogDir`'s own treatment
   * below), stepId -> owning card, populated by each F3 launcher at launch
   * time (`launchActions.ts`). Lets harness-store's existing
   * `StepStatusChanged` handling write the card's status/runState back
   * without threading card identity through the harness event stream itself
   * (F4 — card<->run correlation).
   */
  backlogRunCorrelation: Record<string, { backlogDir: string; filename: string }>;
  registerBacklogRunStep: (stepId: string, backlogDir: string, filename: string) => void;
  clearBacklogRunStep: (stepId: string) => void;
  /**
   * Directory backing the currently-open backlog (set by
   * BacklogBentoWidget's picker/back navigation — F2 Task 10). Read by
   * BacklogCardModal (F2 Task 9) to resolve where to persist content edits:
   * the modal is a canvas-level surface (mounted in SeamlessCanvas.tsx, not
   * inside the widget's own wrapper) so it has no other route to this path.
   * Transient, not persisted (mirrors canvasModalCard's own treatment).
   */
  activeBacklogDir: string | null;
  setActiveBacklogDir: (dir: string | null) => void;

  // Connections
  connections: WindowConnection[];
  removeConnection: (connectionId: string) => void;

  // Dock
  dockItems: DockItem[];

  // Plugins (marketplace = launcher, not install/uninstall)
  installedPlugins: Plugin[];
  availablePlugins: Plugin[];
  loadInventoryPlugins: () => void;
  showMarketplace: boolean;
  setShowMarketplace: (v: boolean) => void;
  deployPlugin: (pluginId: string) => void;
  marketplaceFilter: PluginCategory | 'all';
  setMarketplaceFilter: (f: PluginCategory | 'all') => void;

  // Desktop Attachables (draggable market items on canvas)
  attachables: DesktopAttachable[];
  spawnAttachable: (
    type: AttachableType,
    name: string,
    position?: WindowPosition,
  ) => string;
  removeAttachable: (attachableId: string) => void;
  moveAttachable: (attachableId: string, position: WindowPosition) => void;
  /** Retired alongside 'chat' (F0 decision 2) — was: drop an attachable onto a chat window (attaches and removes from canvas). Always returns false now, see the implementation comment. */
  attachToWindow: (attachableId: string, windowId: string) => boolean;
  /** Detach a role/mod/flow from a window — respawns as attachable on canvas */
  detachFromWindow: (windowId: string, type: AttachableType, name: string) => void;
  /** Remove a role/mod/flow from a window permanently (no respawn) */
  removeAttachedItem: (windowId: string, type: AttachableType, name: string) => void;

  // Desktop Grids (top-level layout containers)
  grids: DesktopGrid[];
  addGrid: (opts?: { position?: WindowPosition; size?: WindowSize; columns?: number; rows?: number }) => string;
  removeGrid: (gridId: string) => void;
  updateGridTitle: (gridId: string, title: string) => void;
  moveGrid: (gridId: string, position: WindowPosition) => void;
  resizeGrid: (gridId: string, size: WindowSize, position?: WindowPosition) => void;
  focusGrid: (gridId: string) => void;
  /** Assign a window to a grid cell — hides window from canvas */
  assignWindowToCell: (gridId: string, cellIndex: number, windowId: string) => boolean;
  /** Remove a window from a grid cell — restores it to the canvas */
  removeWindowFromCell: (gridId: string, windowId: string) => void;
  /** Add a row to the bottom of the grid and expand container height */
  addGridRow: (gridId: string) => void;
  /** Add a column to the right of the grid and expand container width */
  addGridColumn: (gridId: string) => void;
  /** Resize a gridded window by merging/unmerging adjacent empty cells */
  resizeWindowInGrid: (windowId: string, newOriginCell: number, colSpan: number, rowSpan: number) => boolean;

  // Window-to-grid drag state (custom drag, not HTML5 native)
  draggingWindowId: string | null;
  setDraggingWindowId: (id: string | null) => void;

  // Snap guides (transient)
  activeSnapGuides: SnapGuide[];
  setActiveSnapGuides: (guides: SnapGuide[]) => void;
  calculateSnapGuides: (windowId: string, pos: WindowPosition, size: WindowSize) => { guides: SnapGuide[]; snappedPos: WindowPosition };

  // CLI theming
  cliProvider: CliProvider;
  setCliProvider: (p: CliProvider) => void;

  // Canvas pan + zoom — canvasPan/canvasZoom are a mirror of the daba-engine
  // camera (src/renderer/store/engine-bridge.ts): setCanvasPan/setCanvasZoom
  // delegate to the engine (which clamps/normalizes and echoes back into
  // these fields), so every existing READ call-site keeps working untouched.
  canvasPan: CanvasPan;
  setCanvasPan: (pan: CanvasPan) => void;
  canvasZoom: number;
  setCanvasZoom: (zoom: number) => void;
  /**
   * Internal seam patched by engine-bridge.ts (undefined until that module
   * loads — a no-op via the `?.()` call sites below). desktop-store.ts must
   * NOT import engine-bridge.ts directly: engine-bridge.ts needs
   * `useDesktopStore.getState()` synchronously at its own module-eval time
   * to hydrate the engine's initial camera, so a static import in the other
   * direction would deadlock on load (same class of cycle this file already
   * avoids with harness-store — see the comment above `switchBoard`).
   * switchBoard/deleteBoard change canvasPan/canvasZoom via a raw `set()`
   * (the active-slice board-snapshot swap) and call this afterward so the
   * incoming board's camera reaches the engine too, not just this mirror.
   */
  _pushCameraToEngine?: () => void;
  /** xyflow authoring gate — 'off' = read-only; otherwise the default shape for new nodes. */
  mentalMode: MentalMode;
  setMentalMode: (mode: MentalMode) => void;

  // ─── Boards (Figma-like multiple canvases) ──────────────────────
  // See the ACTIVE-SLICE PATTERN section comment above the `boards` field in
  // this store's implementation (below) for how board data relates to the
  // top-level canvas slices (mentalNodes/mentalEdges/canvasPan/canvasZoom).
  boards: Board[];
  activeBoardId: string;
  /**
   * Creates a new empty board, switches to it (see switchBoard), and returns its id.
   * Callers that change the active board are responsible for clearing harness execution state
   * (see BoardSwitcher) — this store cannot import harness-store (circular).
   */
  createBoard: (name?: string) => string;
  /**
   * No-op if `targetId` is already active or unknown.
   * Callers that change the active board are responsible for clearing harness execution state
   * (see BoardSwitcher) — this store cannot import harness-store (circular).
   */
  switchBoard: (targetId: string) => void;
  /** Trims `name`; ignores empty. */
  renameBoard: (id: string, name: string) => void;
  /**
   * Refuses (no-op) when `id` names the only remaining board.
   * Callers that change the active board are responsible for clearing harness execution state
   * (see BoardSwitcher) — this store cannot import harness-store (circular).
   */
  deleteBoard: (id: string) => void;
  /** Deep-copies a board (capturing LIVE canvas state if `id` is the active board) as "<name> copy". Does not switch to the copy. */
  duplicateBoard: (id: string) => string;

  // ─── Mental Graph (xyflow source of truth) ─────────────
  mentalNodes: CanvasGraphNode[];
  mentalEdges: MentalGraphEdge[];
  mentalTool: MentalTool;
  mentalEditingNodeId: string | null;
  setMentalTool: (tool: MentalTool) => void;
  setMentalEditingNodeId: (nodeId: string | null) => void;
  addMentalNode: (node: Omit<MentalGraphNode, 'id' | 'createdAt'> & { id?: string }) => string;
  updateMentalNode: (nodeId: string, patch: Partial<Pick<MentalGraphNode, 'position' | 'width' | 'height' | 'text' | 'color'>>) => void;
  addFrameNode: (node: AddFrameNodeInput) => string;
  addStepNode: (node?: AddStepNodeInput) => string;
  insertPipelineAssembly: (input: InsertPipelineAssemblyInput) => InsertPipelineAssemblyResult;
  addModToStep: (stepId: string, modData: MarketMod) => boolean;
  removeModFromStep: (stepId: string, modId: string) => void;
  addRoleToStep: (stepId: string, roleData: MarketRole) => boolean;
  removeRoleFromStep: (stepId: string, roleId: string) => void;
  /**
   * Patch arbitrary fields on a Step node's `data` (e.g. `prompt`). Powers the
   * Step Config panel's instructions editor — the compiler's `normalizePrompt`
   * reads `data.prompt` first, so edits made here feed execution directly.
   * No-ops (does not mutate) if `stepId` doesn't name a Step node.
   */
  updateStepData: (stepId: string, patch: Partial<StepNodeData>) => void;
  /**
   * Patch arbitrary fields on a Frame node's `data` (e.g. `title`,
   * `description`, `tags`, `author`, `version`, `contextMode`). Powers the
   * Inspector's Flow tools editor (FlowInspector) and FrameNode.tsx's
   * context-mode select — `compileFlowFromCanvas`'s owning-frame lookup
   * (`findOwningFrame`) reads these fields directly (see
   * harness-compiler.ts), so edits made here feed the compiled AgenticFlow's
   * matching fields on the next compile. No-ops (does not mutate) if
   * `frameId` doesn't name a Frame node.
   */
  updateFrameData: (frameId: string, patch: Partial<FrameNodeData>) => void;
  removeMentalNode: (nodeId: string) => void;
  addMentalEdge: (sourceId: string, targetId: string, edgeType?: MentalGraphEdge['type'], sourceHandle?: string, targetHandle?: string, maxIterations?: number) => string | null;
  removeMentalEdge: (edgeId: string) => void;
  updateMentalEdgeColor: (edgeId: string, color: string) => void;
  /** Patch loop-edge data (currently `maxIterations`, clamped to [1, cap]). No-ops if `edgeId` doesn't exist. */
  updateMentalEdgeData: (edgeId: string, patch: { maxIterations?: number }) => void;
  /**
   * Swaps an edge's sourceId/targetId (and sourceHandle/targetHandle), then
   * re-classifies it against the rest of the graph (minus itself):
   * reversal closes a cycle → 'loop' (gains/keeps `maxIterations`); otherwise
   * → 'link' (drops `maxIterations`), except 'ramification' edges which keep
   * their type. No-ops if `edgeId` doesn't exist.
   */
  invertMentalEdge: (edgeId: string) => void;
  createRamificationFromDrop: (sourceId: string, flowPosition: { x: number; y: number }) => { nodeId: string; edgeId: string } | null;

  // ─── Mental Graph selection (mirrors xyflow's selected nodes) ─
  selectedMentalNodeIds: string[];
  setSelectedMentalNodeIds: (ids: string[]) => void;

  // ─── Unified z-stack: per-node recency z-index ────────────────
  // Transient — NOT persisted. Drives interleaved z-ordering of mental nodes
  // and windows within the single React Flow viewport stacking context.
  mentalZ: Record<string, number>;
  bringMentalToFront: (nodeId: string) => void;

  // ─── Mental → Chat attachments ───────────────────────────────
  // Each chat window keeps a matrix of attached subgraphs: each inner
  // array is one attachment (list of node ids). An empty inner array
  // means "the entire mental graph at send-time".
  attachMentalToWindow: (windowId: string, nodeIds: string[]) => void;
  detachMentalAttachment: (windowId: string, index: number) => void;
  clearMentalAttachments: (windowId: string) => void;

  // Notifications
  notifications: DesktopNotification[];
  unreadCount: number;
  showNotifications: boolean;
  setShowNotifications: (v: boolean) => void;
  addNotification: (message: string, sessionId?: string) => void;
  markAllRead: () => void;
  clearNotifications: () => void;

  // ─── Auto-chat panel (HudAutoChatPanel) — NOT persisted, see the
  // AutoChatHistoryEntry doc comment for why this isn't a transcript.
  autoChatHistory: AutoChatHistoryEntry[];
  addAutoChatHistoryEntry: (entry: Omit<AutoChatHistoryEntry, 'id' | 'timestamp'>) => void;
  clearAutoChatHistory: () => void;

  // ─── Mono-step gesture (W2) — transient "please focus me" signal ──
  // Set the moment a step is created via the double-click-empty-canvas
  // gesture (or any future launcher that wants the same "ready to type"
  // feel), naming the step whose input should grab DOM focus once. NOT
  // persisted (transient UI signal only) — mirrors `mentalEditingNodeId`'s
  // shape. Consumer contract: whichever component owns the step's
  // prompt/text input (Task H2, ola B1 — no such input exists on the canvas
  // yet as of this task) should watch this id, focus its own input when it
  // matches its `stepId`, then call `setPendingStepFocusId(null)` so it only
  // fires once. Until H2 lands, nothing consumes this — the gesture below
  // (W2) still selects the step and opens the Inspector so it's visible and
  // ready, this field just carries the "and please focus" intent forward.
  pendingStepFocusId: string | null;
  setPendingStepFocusId: (id: string | null) => void;

  // Navigator highlight — Figma-style hover/select border
  hoveredWindowId: string | null;
  setHoveredWindowId: (id: string | null) => void;

  // Active drag state for DnD overlay
  activeDragId: string | null;
  setActiveDragId: (id: string | null) => void;

  // Selected attachable (for dock → canvas highlight)
  selectedAttachableId: string | null;
  setSelectedAttachableId: (id: string | null) => void;
  focusAttachable: (attachableId: string) => void;

  // Settings
  settings: {
    canvasClickAnimation: boolean;
    tourCompleted: boolean;
    tutorialCompleted: TutorialProgress;
    /** WS2 smart model-routing policy (default: `{mode:'fixed'}` — today's behavior, unchanged). */
    modelPolicy?: ModelPolicy;
    /**
     * Figma-like right-side Inspector column visibility (Phase 8). Optional
     * + defaulted to `true` below rather than a required field bumping the
     * persist `version` — `settings` is persisted whole (see `partialize`),
     * so pre-Phase-8 persisted blobs simply lack this key; every call site
     * treats absence as "shown" via `settings.showInspector !== false`
     * rather than truthiness, so old and new state both render the same way.
     */
    showInspector?: boolean;
    /**
     * Snap-to-grid for window/mental-node drag commits (Task 13, adoption
     * plan #20, `engine-bridge.ts` mirrors this into the daba-engine
     * `snap.grid` slice). Optional + defaulted to OFF by absence — same
     * default-by-absence convention as `showInspector`, but inverted:
     * `showInspector !== false` there means "shown by default", while here
     * `snapToGrid === true` means "enabled" — pre-existing persisted blobs
     * (and anyone who never opens Settings) get byte-identical drag behavior
     * to before this feature existed.
     */
    snapToGrid?: boolean;
    /** Grid cell size in px (presets 16/24/32) for `snapToGrid` quantization; defaults to 24 when unset. */
    snapGridCellSize?: number;
  };
  updateSettings: (patch: Partial<DesktopStore['settings']>) => void;
  /** Set the WS2 smart-routing policy applied to every subsequent harness dispatch. */
  setModelPolicy: (policy: ModelPolicy) => void;

  // Tutorial engine state (not persisted — active scenario lives in-memory)
  activeTutorial: TutorialScenarioId | null;
  setActiveTutorial: (id: TutorialScenarioId | null) => void;

  /** Pan the canvas so a given window is centered in the viewport */
  navigateToWindow: (windowId: string) => void;

  // Project picker modal — was: pick a child project before spawning a chat
  // window. 'chat' is retired (F0 decision 2) and Dock.tsx (its only
  // renderer) no longer mounts <ProjectPickerModal>, so setting this flag
  // is now a no-op in the UI. Left in place (not deleted) only because
  // App.tsx's Cmd+N shortcut and SeamlessCanvas.tsx's canvas context-menu
  // "New Chat" action still call `setShowProjectPicker` — both outside this
  // task's territory; see this task's final report for the exact call
  // sites pending reassignment (Cmd+N → mono-step is already Task L's job;
  // the canvas context-menu entry is a newly-found 6th chat-launcher not
  // yet assigned to anyone).
  showProjectPicker: boolean;
  pendingChatPosition: WindowPosition | null;
  setShowProjectPicker: (v: boolean, position?: WindowPosition | null) => void;

  // Canvas-level backlog card modal
  canvasModalCard: import('@/types/market').BacklogCard | null;
  openCanvasModal: (card: import('@/types/market').BacklogCard) => void;
  closeCanvasModal: () => void;

  // File explorer persistent state (per windowId)
  fileExplorerStates: Record<string, {
    expandedDirs: string[];
    openTabs: Array<{ path: string; relPath: string; name: string }>;
    activeTabPath: string | null;
    sidebarWidth: number;
  }>;
  setFileExplorerState: (windowId: string, state: DesktopStore['fileExplorerStates'][string]) => void;
  clearFileExplorerState: (windowId: string) => void;

  // ─── HUD Widgets ───────────────────────────────────────────────
  hudWidgets: HudWidget[];
  setHudWidgetVisible: (type: HudWidgetType, visible: boolean) => void;
  /** Persists verbatim — caller must pass resolveHudWidgetPlacement's output (logic/hud-widget-policy.ts). */
  moveHudWidget: (type: HudWidgetType, position: { x: number; y: number }) => void;
  /** Clamps SIZE only; does not reposition — see the implementation-site comment below. */
  resizeHudWidget: (type: HudWidgetType, size: { width: number; height: number }) => void;
  toggleHudWidget: (type: HudWidgetType) => void;
}

// ─── Helper: Stagger position for new windows ────────────────────

let spawnIndex = 0;

// Returns a position centered in the currently visible canvas viewport,
// accounting for canvasPan and canvasZoom so new windows never spawn off-screen.
function getViewportCenteredSpawnPosition(pan: CanvasPan, zoom: number): WindowPosition {
  const stagger = (spawnIndex % 8) * 32;
  spawnIndex++;
  const vpW = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const vpH = typeof window !== 'undefined' ? window.innerHeight : 800;
  // Convert screen-center to canvas-space coordinates
  const centerX = (vpW / 2 - pan.x) / zoom;
  const centerY = (vpH / 2 - pan.y) / zoom;
  return {
    x: centerX - DEFAULT_WINDOW_SIZE.width / 2 + stagger,
    y: centerY - DEFAULT_WINDOW_SIZE.height / 2 + stagger,
  };
}

function isStepGraphNode(node: CanvasGraphNode): node is StepGraphNode {
  return node.type === 'step';
}

function isFrameGraphNode(node: CanvasGraphNode): node is FrameGraphNode {
  return node.type === 'frame';
}

/** The empty graph + default viewport used to seed a brand-new board, and as
 *  the fallback when a board's `snapshot` is null (shouldn't happen for an
 *  inactive board in practice, but keeps switchBoard/deleteBoard total). */
function emptyBoardSnapshot(): BoardSnapshot {
  return { mentalNodes: [], mentalEdges: [], canvasPan: { x: 0, y: 0 }, canvasZoom: 1 };
}

function marketEntityId(entity: MarketMod | MarketRole): string {
  return entity.name;
}

function titleFromId(id: string): string {
  return id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function roleFromId(roleId: string): MarketRole {
  return {
    name: roleId,
    icon: 'MdPerson',
    iconLibrary: 'react-icons/md',
    description: `${titleFromId(roleId)} role selected by the Meta-Agent.`,
    tags: ['meta-agent', 'generated'],
    color: '#E87040',
  };
}

function modFromId(modId: string): MarketMod {
  return {
    name: modId,
    icon: 'MdTune',
    iconLibrary: 'react-icons/md',
    description: `${titleFromId(modId)} mod selected by the Meta-Agent.`,
    tags: ['meta-agent', 'generated'],
  };
}

// ─── Store ───────────────────────────────────────────────────────

export const useDesktopStore = create<DesktopStore>()(
  persist(
    (set, get) => ({
      // ─── Windows ───────────────────────────────────────
      windows: [],
      activeWindowId: null,
      nextZIndex: 10,

      // ─── Unified z-stack ────────────────────────────────
      mentalZ: {},
      bringMentalToFront: (nodeId) => set((s) => {
        const component = getConnectedComponent([nodeId], s.mentalEdges);
        // Include parent frame(s) of any component node, and if a frame was
        // clicked, include its children too.
        const clicked = s.mentalNodes.find(n => n.id === nodeId);
        const ids = new Set<string>(component);
        for (const id of component) {
          const n = s.mentalNodes.find(m => m.id === id);
          if (n && (n as any).parentId) ids.add((n as any).parentId);
        }
        if (clicked && (clicked as any).type === 'frame') {
          for (const n of s.mentalNodes) {
            if ((n as any).parentId === nodeId) ids.add(n.id);
          }
        }
        const z = globalTopZ(s);
        const mentalZ = { ...s.mentalZ };
        for (const id of ids) mentalZ[id] = z;
        return { mentalZ, nextZIndex: z + 1 };
      }),

      addWindow: (type, opts) => {
        const state = get();
        const id = `win-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const position = opts?.position ?? getViewportCenteredSpawnPosition(state.canvasPan, state.canvasZoom);
        const size = opts?.size ?? DEFAULT_WINDOW_SIZE;
        const zIndex = globalTopZ(state);
        // 'chat' branch retired alongside DesktopWindow['type'] (F0 decision 2,
        // 2026-07-10) — every remaining type falls through this ternary chain
        // exactly as it did before (the 'chat' arm was always first/exclusive,
        // never reached by any other type).
        const defaultTitle = type === 'file-explorer' ? 'Files'
          : type === 'backlog' ? 'Backlog'
          : type === 'file-viewer' ? (opts?.title ?? 'File')
          : type === 'diff-viewer' ? (opts?.title ?? 'Diff Viewer')
          : type === 'prompt-dev-zone' ? 'Prompt Dev Zone'
          : type === 'web-preview' ? (opts?.title ?? 'Preview')
          : type === 'arena' ? 'Fluxor Arena'
          : 'Plugin';
        const defaultIcon = type === 'file-explorer' ? 'FileText'
          : type === 'backlog' ? 'KanbanSquare'
          : type === 'file-viewer' ? 'FileCode2'
          : type === 'diff-viewer' ? 'GitCompareArrows'
          : type === 'prompt-dev-zone' ? 'FlaskConical'
          : type === 'web-preview' ? 'Globe'
          : type === 'arena' ? 'Trophy'
          : 'Blocks';
        const win: DesktopWindow = {
          id,
          type,
          title: opts?.title ?? defaultTitle,
          iconName: opts?.iconName ?? defaultIcon,
          position,
          size,
          zIndex,
          state: 'normal',
          sessionId: opts?.sessionId,
          cliProvider: undefined,
          pluginId: opts?.pluginId,
          roleId: opts?.roleId,
          modifierIds: opts?.modifierIds ?? [],
          childProjectPath: opts?.childProjectPath,
          filePath: opts?.filePath,
          // M1 web-preview fields — passed through from addWindow opts
          url: opts?.url,
          boundPort: opts?.boundPort,
          agentLinked: opts?.agentLinked,
          createdAt: Date.now(),
        };
        set({
          windows: [...state.windows, win],
          activeWindowId: id,
          nextZIndex: zIndex + 1,
        });
        return id;
      },

      removeWindow: (windowId) => set((s) => {
        const conns = s.connections.filter(
          c => c.sourceWindowId !== windowId && c.targetWindowId !== windowId
        );
        const { [windowId]: _, ...remainingFEStates } = s.fileExplorerStates;
        return {
          windows: s.windows.filter(w => w.id !== windowId),
          connections: conns,
          activeWindowId: s.activeWindowId === windowId ? null : s.activeWindowId,
          fileExplorerStates: remainingFEStates,
        };
      }),

      _updateWindow: (windowId, patch) => set((s) => ({
        windows: s.windows.map(w => w.id === windowId ? { ...w, ...patch } : w),
      })),

      focusWindow: (windowId) => set((s) => {
        // Always rise ABOVE every existing window, attachable, AND mental node.
        // `nextZIndex` is NOT persisted (it resets to its initial value each
        // launch) while window `zIndex` IS persisted — so trusting the counter
        // alone can hand a clicked window a z BELOW its peers, making it sink
        // behind instead of coming to the front. globalTopZ covers all layers.
        const z = globalTopZ(s);
        return {
          windows: s.windows.map(w => w.id === windowId ? { ...w, zIndex: z, state: w.state === 'minimized' ? 'normal' : w.state } : w),
          activeWindowId: windowId,
          nextZIndex: z + 1,
        };
      }),

      moveWindow: (windowId, position) => get()._updateWindow(windowId, { position }),

      resizeWindow: (windowId, size, position) => set((s) => ({
        windows: s.windows.map(w => w.id === windowId ? {
          ...w,
          size: {
            width: Math.max(MIN_WINDOW_SIZE.width, size.width),
            height: Math.max(MIN_WINDOW_SIZE.height, size.height),
          },
          ...(position ? { position } : {}),
        } : w),
      })),

      setWindowState: (windowId, state) => {
        const win = get().windows.find(w => w.id === windowId);
        if (!win) return;
        if (state === 'maximized' && win.state !== 'maximized') {
          // Save current rect before maximizing
          get()._updateWindow(windowId, {
            state,
            preMaximizeRect: { position: { ...win.position }, size: { ...win.size } },
          });
        } else if (state === 'normal' && win.state === 'maximized' && win.preMaximizeRect) {
          // Restore previous rect on un-maximize
          get()._updateWindow(windowId, {
            state,
            position: win.preMaximizeRect.position,
            size: win.preMaximizeRect.size,
            preMaximizeRect: undefined,
          });
        } else {
          get()._updateWindow(windowId, { state });
        }
      },

      assignRole: (windowId, roleId) => {
        const state = get();
        const win = state.windows.find(w => w.id === windowId);
        if (!win || win.roleId) return false;
        state._updateWindow(windowId, { roleId });
        return true;
      },

      removeRole: (windowId) => get()._updateWindow(windowId, { roleId: undefined }),

      addModifier: (windowId, modifierId) => {
        const state = get();
        const win = state.windows.find(w => w.id === windowId);
        if (!win || win.modifierIds.includes(modifierId)) return false;

        // Check mod compatibility against market inventory
        const inventory = state.marketInventory;
        if (inventory) {
          const newMod = inventory.mods.find(m => m.name === modifierId);
          if (newMod?.incompatibleWith?.length) {
            const conflict = win.modifierIds.find(existing =>
              newMod.incompatibleWith!.includes(existing)
            );
            if (conflict) return false;
          }
          // Also check reverse: existing mods that declare incompatibility with the new one
          for (const existingId of win.modifierIds) {
            const existingMod = inventory.mods.find(m => m.name === existingId);
            if (existingMod?.incompatibleWith?.includes(modifierId)) return false;
          }
        }

        set((s) => ({
          windows: s.windows.map(w =>
            w.id === windowId
              ? { ...w, modifierIds: [...w.modifierIds, modifierId] }
              : w
          ),
        }));
        return true;
      },

      removeModifier: (windowId, modifierId) => set((s) => ({
        windows: s.windows.map(w =>
          w.id === windowId
            ? { ...w, modifierIds: w.modifierIds.filter(m => m !== modifierId) }
            : w
        ),
      })),

      updateWindowTitle: (windowId, title) => get()._updateWindow(windowId, { title }),

      // ─── M2 Agent surface linking ─────────────────────────────
      linkWindowToAgent: (windowId, linked) => set((s) => ({
        windows: s.windows.map(w => {
          if (w.id === windowId) return { ...w, agentLinked: linked };
          // Clear the link on all other web-preview windows when enabling
          if (linked && w.type === 'web-preview' && w.agentLinked) return { ...w, agentLinked: false };
          return w;
        }),
      })),

      // ─── Multi-selection ────────────────────────────────
      selectedWindowIds: [],
      setSelectedWindowIds: (ids) => set({ selectedWindowIds: ids }),
      moveSelectedWindows: (dx, dy) => set((s) => ({
        windows: s.windows.map(w =>
          s.selectedWindowIds.includes(w.id)
            ? { ...w, position: { x: w.position.x + dx, y: w.position.y + dy } }
            : w
        ),
      })),

      // ─── Clipboard (copy/paste) ────────────────────────
      clipboardWindows: [],
      copyWindows: () => {
        const state = get();
        // Copy selected windows, or active window if no selection
        const toCopy = state.selectedWindowIds.length > 0
          ? state.windows.filter(w => state.selectedWindowIds.includes(w.id))
          : state.activeWindowId
            ? state.windows.filter(w => w.id === state.activeWindowId)
            : [];
        set({ clipboardWindows: toCopy.map(w => ({ ...w })) });
      },
      pasteWindows: () => {
        const state = get();
        if (state.clipboardWindows.length === 0) return;
        const offset = 40;
        let z = state.nextZIndex;
        const newWindows = state.clipboardWindows.map(w => {
          const id = `win-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          z++;
          return {
            ...w,
            id,
            position: { x: w.position.x + offset, y: w.position.y + offset },
            zIndex: z,
            sessionId: undefined, // Don't share sessions
            createdAt: Date.now(),
          };
        });
        set({
          windows: [...state.windows, ...newWindows],
          nextZIndex: z + 1,
          selectedWindowIds: newWindows.map(w => w.id),
          activeWindowId: newWindows[newWindows.length - 1]?.id ?? state.activeWindowId,
        });
      },

      // ─── Flow Connectors (max 1 per window) ────────────
      // Retired (F0 decision 2/4, 2026-07-10): flow-attach-to-WINDOW was only
      // ever valid for chat windows (the sole drop target it supported,
      // enforced by the guard below) — 'chat' no longer exists, and flows
      // themselves change nature from "attach to a window" to "prebuilt
      // pipeline copied to the board" (market F4 task, insertPipelineAssembly
      // directly). No window can satisfy `isChatWindowTarget` anymore, so
      // this always fails now — identical observable behavior to before for
      // every window type that still exists (they never passed the old
      // `win.type === 'chat'` gate either). Kept as a no-op (not deleted) so
      // AttachableFlow.tsx/RightFlowAttachment.tsx — retired by the market
      // F4 task, not yet landed as of this task — still compile; safe to
      // delete alongside them.
      connectFlow: (windowId, flowName) => {
        const win = get().windows.find(w => w.id === windowId);
        const isChatWindowTarget = false; // was: win.type === 'chat' — 'chat' retired
        if (!win || !isChatWindowTarget) return false;
        get()._updateWindow(windowId, { flowId: flowName });
        return true;
      },

      disconnectFlow: (windowId) => get()._updateWindow(windowId, { flowId: undefined }),

      // ─── Market Inventory ──────────────────────────────
      marketInventory: null,
      setMarketInventory: (inventory) => {
        set({ marketInventory: inventory });

        // Auto-merge inventory items into availablePlugins
        get().loadInventoryPlugins();
      },

      getModIncompatibilities: (modName) => {
        const inventory = get().marketInventory;
        if (!inventory) return [];
        const mod = inventory.mods.find(m => m.name === modName);
        return mod?.incompatibleWith ?? [];
      },

      // ─── Backlog ───────────────────────────────────────
      backlogCards: [],
      setBacklogCards: (cards) => set({ backlogCards: cards }),
      mergeBacklogCards: (cards) => set((s) => {
        const byFilename = new Map(cards.map((c) => [c.filename, c]));
        const nextModalCard = s.canvasModalCard && byFilename.has(s.canvasModalCard.filename)
          ? byFilename.get(s.canvasModalCard.filename)!
          : s.canvasModalCard;
        return { backlogCards: cards, canvasModalCard: nextModalCard };
      }),

      backlogRunCorrelation: {},
      registerBacklogRunStep: (stepId, backlogDir, filename) => set((s) => ({
        backlogRunCorrelation: { ...s.backlogRunCorrelation, [stepId]: { backlogDir, filename } },
      })),
      clearBacklogRunStep: (stepId) => set((s) => {
        const { [stepId]: _removed, ...rest } = s.backlogRunCorrelation;
        return { backlogRunCorrelation: rest };
      }),

      activeBacklogDir: null,
      setActiveBacklogDir: (dir) => set({ activeBacklogDir: dir }),

      // ─── Connections ───────────────────────────────────
      connections: [],

      removeConnection: (connectionId) => set((s) => ({
        connections: s.connections.filter(c => c.id !== connectionId),
      })),

      // ─── Dock ──────────────────────────────────────────
      dockItems: DEFAULT_DOCK_ITEMS,

      // ─── Plugins ───────────────────────────────────────
      installedPlugins: BUILTIN_PLUGINS.filter(p => p.installed),
      availablePlugins: [...BUILTIN_PLUGINS],

      loadInventoryPlugins: () => {
        const inventory = get().marketInventory;
        if (!inventory) return;

        // Pass Md* icon names directly — OptimizedIcon resolves them via react-icons/md
        const inventoryPlugins: Plugin[] = [];

        for (const flow of inventory.flows) {
          inventoryPlugins.push({
            id: `flow-${flow.name}`,
            name: flow.name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            description: flow.description,
            iconName: flow.icon || 'MdBolt',
            category: 'flows',
            author: 'Fluxor Market',
            installed: true,
          });
        }
        for (const role of inventory.roles) {
          inventoryPlugins.push({
            id: `inv-role-${role.name}`,
            name: role.name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            description: role.description,
            iconName: role.icon || 'MdAccessibility',
            category: 'roles',
            author: 'Fluxor Market',
            installed: true,
          });
        }
        for (const mod of inventory.mods) {
          inventoryPlugins.push({
            id: `inv-mod-${mod.name}`,
            name: mod.name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            description: mod.description,
            iconName: mod.icon || 'MdBuild',
            category: 'modifiers',
            author: 'Fluxor Market',
            installed: true,
          });
        }
        for (const step of inventory.steps ?? []) {
          inventoryPlugins.push({
            id: `inv-step-${step.name}`,
            name: step.name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            description: step.description,
            iconName: step.icon || 'MdLayers',
            category: 'steps',
            author: 'Fluxor Market',
            installed: true,
          });
        }

        const mergedAvailablePlugins = [
          ...BUILTIN_PLUGINS,
          ...inventoryPlugins.filter(inv => !BUILTIN_PLUGINS.some(b => b.id === inv.id)),
        ];

        set({
          availablePlugins: mergedAvailablePlugins,
        });
      },
      showMarketplace: false,
      setShowMarketplace: (v) => set({ showMarketplace: v }),
      marketplaceFilter: 'all',
      setMarketplaceFilter: (f) => set({ marketplaceFilter: f }),

      // Deploy = spawn a draggable attachable on the desktop canvas
      deployPlugin: (pluginId) => {
        const state = get();
        const plugin = state.availablePlugins.find(p => p.id === pluginId);
        if (!plugin) return;

        // Map plugin category → attachable type
        const typeMap: Record<string, AttachableType> = {
          roles: 'role',
          modifiers: 'mod',
          flows: 'flow',
          steps: 'step',
        };
        const attachableType = typeMap[plugin.category];
        if (attachableType) {
          // Extract inventory name from plugin id (e.g. 'inv-role-frontend-engineer' → 'frontend-engineer')
          let inventoryName = pluginId;
          if (pluginId.startsWith('inv-role-')) inventoryName = pluginId.replace('inv-role-', '');
          else if (pluginId.startsWith('inv-mod-')) inventoryName = pluginId.replace('inv-mod-', '');
          else if (pluginId.startsWith('inv-step-')) inventoryName = pluginId.replace('inv-step-', '');
          else if (pluginId.startsWith('flow-')) inventoryName = pluginId.replace('flow-', '');
          state.spawnAttachable(attachableType, inventoryName);
          set({ showMarketplace: false });
          return;
        }

        // For tools, spawn a plugin window (or focus existing)
        const existing = state.windows.find(w => w.pluginId === pluginId);
        if (existing) {
          state.navigateToWindow(existing.id);
          set({ showMarketplace: false });
          return;
        }

        const winId = state.addWindow('plugin', {
          title: plugin.name,
          iconName: plugin.iconName,
          pluginId: plugin.id,
        });
        set({ showMarketplace: false });
        requestAnimationFrame(() => get().navigateToWindow(winId));
      },

      // ─── Desktop Attachables ────────────────────────────
      attachables: [],

      spawnAttachable: (type, name, position) => {
        const state = get();
        const id = `att-${type}-${name}-${Date.now()}`;
        const pos = position ?? getViewportCenteredSpawnPosition(state.canvasPan, state.canvasZoom);
        const z = state.nextZIndex;
        const nextAttachable: DesktopAttachable = {
          id,
          type,
          name,
          position: pos,
          zIndex: z,
        };
        set({
          attachables: [
            ...state.attachables,
            nextAttachable,
          ],
          nextZIndex: z + 1,
        });
        return id;
      },

      removeAttachable: (attachableId) => set((s) => ({
        attachables: s.attachables.filter(a => a.id !== attachableId),
      })),

      moveAttachable: (attachableId, position) => set((s) => ({
        attachables: s.attachables.map(a => a.id === attachableId ? { ...a, position } : a),
      })),

      attachToWindow: (attachableId, windowId) => {
        const state = get();
        const att = state.attachables.find(a => a.id === attachableId);
        const win = state.windows.find(w => w.id === windowId);
        // Retired (F0 decision 2, 2026-07-10): attaching a role/mod to a
        // WINDOW (vs. a step) was only ever valid for chat windows, the sole
        // drop target this supported — 'chat' no longer exists, so no window
        // can ever satisfy this anymore. Same "always false, zero observable
        // change for surviving window types" reasoning as connectFlow above
        // — see that comment for why this is kept rather than deleted.
        const isChatWindowTarget = false; // was: win.type === 'chat' — 'chat' retired
        if (!att || !win || !isChatWindowTarget) return false;

        // Flows and steps are independent — they cannot be linked to a chat window.
        if (att.type === 'flow' || att.type === 'step') return false;

        let success = false;
        if (att.type === 'role') {
          // If a role is already assigned, detach it first (respawns as attachable)
          const currentWin = get().windows.find(w => w.id === windowId);
          if (currentWin?.roleId) {
            state.detachFromWindow(windowId, 'role', currentWin.roleId);
          }
          success = state.assignRole(windowId, att.name);
        } else if (att.type === 'mod') {
          success = state.addModifier(windowId, att.name);
        }

        if (success) {
          // Remove the attachable from the canvas
          set((s) => ({ attachables: s.attachables.filter(a => a.id !== attachableId) }));
          // Trigger canvas wave centered on the window
          if (typeof window !== 'undefined') {
            const state = get();
            const pan = state.canvasPan;
            const zoom = state.canvasZoom;
            const screenX = pan.x + (win.position.x + win.size.width / 2) * zoom;
            const screenY = pan.y + (win.position.y + win.size.height / 2) * zoom;
            window.dispatchEvent(new CustomEvent('fluxor:canvas-wave', {
              detail: { x: screenX, y: screenY },
            }));
          }
        }
        return success;
      },

      detachFromWindow: (windowId, type, name) => {
        const state = get();
        const win = state.windows.find(w => w.id === windowId);
        if (!win) return;

        // Remove from window
        if (type === 'role') {
          state.removeRole(windowId);
        } else if (type === 'mod') {
          state.removeModifier(windowId, name);
        } else if (type === 'flow') {
          state.disconnectFlow(windowId);
        }

        // Respawn as attachable near the window
        const pos: WindowPosition = {
          x: win.position.x + win.size.width + 20,
          y: win.position.y + 30,
        };
        state.spawnAttachable(type, name, pos);
      },

      removeAttachedItem: (windowId, type, name) => {
        const state = get();
        const win = state.windows.find(w => w.id === windowId);
        if (!win) return;

        if (type === 'role') {
          state.removeRole(windowId);
        } else if (type === 'mod') {
          state.removeModifier(windowId, name);
        } else if (type === 'flow') {
          state.disconnectFlow(windowId);
        }
      },

      // ─── Desktop Grids (top-level layout containers) ────
      //
      // The grid is a "fixed coordinates" orchestrator (like legally-next snap):
      // - Windows assigned to cells are REPOSITIONED to cell coordinates
      // - They stay state:'normal' and render fully on the canvas with all styles/functionality
      // - The grid component itself only renders the frame + empty drop zones
      // - Moving/resizing the grid recalculates all child window positions

      grids: [],

      addGrid: (opts) => {
        const state = get();
        const id = `grid-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const position = opts?.position ?? getViewportCenteredSpawnPosition(state.canvasPan, state.canvasZoom);
        const cols = opts?.columns ?? 2;
        const rows = opts?.rows ?? 2;
        const grid: DesktopGrid = {
          id,
          position,
          size: opts?.size ?? { width: 640, height: 480 },
          zIndex: state.nextZIndex,
          columns: cols,
          rows: rows,
          cells: Array(cols * rows).fill(null),
          createdAt: Date.now(),
        };
        set({
          grids: [...state.grids, grid],
          nextZIndex: state.nextZIndex + 1,
        });
        return id;
      },

      removeGrid: (gridId) => set((s) => {
        const grid = s.grids.find(g => g.id === gridId);
        const childIds = grid?.cells.filter(Boolean) as string[] ?? [];
        return {
          grids: s.grids.filter(g => g.id !== gridId),
          windows: s.windows.map(w =>
            childIds.includes(w.id) ? {
              ...w,
              state: 'normal' as const,
              position: w.preGridRect?.position ?? { x: (grid?.position.x ?? 100) + 40, y: (grid?.position.y ?? 100) + 40 },
              size: w.preGridRect?.size ?? { width: 480, height: 420 },
              gridId: undefined,
              gridCellIndex: undefined,
              gridColSpan: undefined,
              gridRowSpan: undefined,
              preGridRect: undefined,
            } : w
          ),
        };
      }),

      updateGridTitle: (gridId, title) => set((s) => ({
        grids: s.grids.map(g => g.id === gridId ? { ...g, title } : g),
      })),

      moveGrid: (gridId, position) => set((s) => {
        const newGrids = s.grids.map(g => g.id === gridId ? { ...g, position } : g);
        const movedGrid = newGrids.find(g => g.id === gridId);
        return {
          grids: newGrids,
          windows: movedGrid ? repositionGridWindows(movedGrid, s.windows) : s.windows,
        };
      }),

      resizeGrid: (gridId, size, position) => set((s) => {
        const newGrids = s.grids.map(g => g.id === gridId ? {
          ...g,
          size: { width: Math.max(320, size.width), height: Math.max(240, size.height) },
          ...(position ? { position } : {}),
        } : g);
        const resizedGrid = newGrids.find(g => g.id === gridId);
        return {
          grids: newGrids,
          windows: resizedGrid ? repositionGridWindows(resizedGrid, s.windows) : s.windows,
        };
      }),

      focusGrid: (gridId) => set((s) => {
        const z = s.nextZIndex;
        return {
          grids: s.grids.map(g => g.id === gridId ? { ...g, zIndex: z } : g),
          nextZIndex: z + 1,
        };
      }),

      assignWindowToCell: (gridId, cellIndex, windowId) => {
        const state = get();
        const grid = state.grids.find(g => g.id === gridId);
        const win = state.windows.find(w => w.id === windowId);
        if (!grid || !win) return false;
        if (cellIndex < 0 || cellIndex >= grid.cells.length) return false;
        if (grid.cells[cellIndex] !== null) return false;
        if (win.type === 'grid' as any) return false;

        // Remove window from any other grid cell first
        const updatedGrids = state.grids.map(g => {
          if (g.cells.includes(windowId)) {
            return { ...g, cells: g.cells.map(c => c === windowId ? null : c) };
          }
          return g;
        });

        const newCells = [...grid.cells];
        newCells[cellIndex] = windowId;

        // Compute the absolute position/size for this cell
        const rect = computeCellRect(grid, cellIndex);

        set({
          grids: updatedGrids.map(g =>
            g.id === gridId ? { ...g, cells: newCells } : g
          ),
          // Reposition the window to the cell — keep it state:'normal' so it renders fully
          windows: state.windows.map(w =>
            w.id === windowId ? {
              ...w,
              state: 'normal' as const,
              gridId,
              gridCellIndex: cellIndex,
              gridColSpan: 1,
              gridRowSpan: 1,
              preGridRect: w.preGridRect ?? { position: { ...w.position }, size: { ...w.size } },
              position: rect.position,
              size: rect.size,
              zIndex: grid.zIndex + 1,
            } : w
          ),
        });
        return true;
      },

      removeWindowFromCell: (gridId, windowId) => {
        const state = get();
        const grid = state.grids.find(g => g.id === gridId);
        if (!grid?.cells.includes(windowId)) return;
        const newCells = grid.cells.map(c => c === windowId ? null : c);
        const win = state.windows.find(w => w.id === windowId);

        // Count how many windows are already ejected (no gridId) near the grid
        // to offset the restore position and prevent stacking
        const ejectedNearby = state.windows.filter(w =>
          w.id !== windowId && !w.gridId &&
          Math.abs(w.position.x - (grid.position.x + grid.size.width + 20)) < 60 &&
          Math.abs(w.position.y - grid.position.y) < 200
        ).length;

        const restorePos = win?.preGridRect?.position ?? {
          x: grid.position.x + grid.size.width + 20,
          y: grid.position.y + ejectedNearby * 40,
        };
        const restoreSize = win?.preGridRect?.size ?? { width: 480, height: 420 };
        set({
          grids: state.grids.map(g =>
            g.id === gridId ? { ...g, cells: newCells } : g
          ),
          windows: state.windows.map(w =>
            w.id === windowId ? {
              ...w,
              state: 'normal' as const,
              position: restorePos,
              size: restoreSize,
              gridId: undefined,
              gridCellIndex: undefined,
              gridColSpan: undefined,
              gridRowSpan: undefined,
              preGridRect: undefined,
            } : w
          ),
        });
      },

      addGridRow: (gridId) => set((s) => {
        const newGrids = s.grids.map(g => {
          if (g.id !== gridId) return g;
          const newCells = [...g.cells, ...Array(g.columns).fill(null)];
          const cellH = (g.size.height - GRID_PADDING * 2 - (g.rows - 1) * GRID_GAP) / g.rows;
          const newHeight = g.size.height + cellH + GRID_GAP;
          return { ...g, rows: g.rows + 1, cells: newCells, size: { ...g.size, height: Math.max(240, newHeight) } };
        });
        const updatedGrid = newGrids.find(g => g.id === gridId);
        // Row append does not shift cell indices — but reposition to new cell sizes
        return {
          grids: newGrids,
          windows: updatedGrid ? repositionGridWindows(updatedGrid, s.windows) : s.windows,
        };
      }),

      addGridColumn: (gridId) => set((s) => {
        const grid = s.grids.find(g => g.id === gridId);
        if (!grid) return s;

        // Rebuild cells with an extra column per row and remap window indices
        const oldCols = grid.columns;
        const newCols = oldCols + 1;
        const newCells: (string | null)[] = [];
        const indexRemap = new Map<string, number>(); // windowId → new cell index

        for (let r = 0; r < grid.rows; r++) {
          for (let c = 0; c < oldCols; c++) {
            const oldIdx = r * oldCols + c;
            const newIdx = r * newCols + c;
            const wid = grid.cells[oldIdx];
            newCells.push(wid);
            if (wid && !indexRemap.has(wid)) indexRemap.set(wid, newIdx);
          }
          newCells.push(null); // extra column cell for this row
        }

        const cellW = (grid.size.width - GRID_PADDING * 2 - (oldCols - 1) * GRID_GAP) / oldCols;
        const newWidth = grid.size.width + cellW + GRID_GAP;
        const updatedGrid = { ...grid, columns: newCols, cells: newCells, size: { ...grid.size, width: Math.max(320, newWidth) } };

        // Remap gridCellIndex on child windows, then reposition to new cell rects
        const remappedWindows = s.windows.map(w => {
          if (w.gridId === gridId && w.gridCellIndex != null && indexRemap.has(w.id)) {
            return { ...w, gridCellIndex: indexRemap.get(w.id)! };
          }
          return w;
        });

        return {
          grids: s.grids.map(g => g.id === gridId ? updatedGrid : g),
          windows: repositionGridWindows(updatedGrid, remappedWindows),
        };
      }),

      resizeWindowInGrid: (windowId, newOriginCell, colSpan, rowSpan) => {
        const state = get();
        const win = state.windows.find(w => w.id === windowId);
        if (!win?.gridId || win.gridCellIndex == null) return false;
        const grid = state.grids.find(g => g.id === win.gridId);
        if (!grid) return false;

        // Clamp spans
        const cs = Math.max(1, colSpan);
        const rs = Math.max(1, rowSpan);
        const originRow = Math.floor(newOriginCell / grid.columns);
        const originCol = newOriginCell % grid.columns;

        // Bounds check
        if (originRow < 0 || originCol < 0) return false;
        if (originRow + rs > grid.rows || originCol + cs > grid.columns) return false;

        // Collect all target cells
        const targetCells: number[] = [];
        for (let r = 0; r < rs; r++) {
          for (let c = 0; c < cs; c++) {
            targetCells.push((originRow + r) * grid.columns + (originCol + c));
          }
        }

        // All target cells must be empty or already owned by this window
        for (const ci of targetCells) {
          if (grid.cells[ci] !== null && grid.cells[ci] !== windowId) return false;
        }

        // Clear old cells owned by this window, then mark new region
        const newCells = grid.cells.map(c => c === windowId ? null : c);
        for (const ci of targetCells) newCells[ci] = windowId;

        const rect = computeCellRect(grid, newOriginCell, cs, rs);

        set({
          grids: state.grids.map(g => g.id === grid.id ? { ...g, cells: newCells } : g),
          windows: state.windows.map(w => w.id === windowId ? {
            ...w,
            gridCellIndex: newOriginCell,
            gridColSpan: cs,
            gridRowSpan: rs,
            position: rect.position,
            size: rect.size,
          } : w),
        });
        return true;
      },

      // Window-to-grid drag state (custom drag, replaces unreliable HTML5 native drag in Electron)
      draggingWindowId: null,
      setDraggingWindowId: (id) => set({ draggingWindowId: id }),

      // ─── Snap Guides (FIXED: pick best snap per axis) ─
      activeSnapGuides: [],
      setActiveSnapGuides: (guides) => set({ activeSnapGuides: guides }),

      calculateSnapGuides: (windowId, pos, size) => {
        const state = get();
        const others = state.windows.filter(w => w.id !== windowId && w.state !== 'minimized');
        const snappedPos = { ...pos };

        const edges = {
          left: pos.x, right: pos.x + size.width, centerX: pos.x + size.width / 2,
          top: pos.y, bottom: pos.y + size.height, centerY: pos.y + size.height / 2,
        };

        type Snap = { delta: number; snapTo: number; type: 'edge' | 'center'; guide: number };
        const findBest = (pairs: Array<[number, number, 'edge' | 'center']>, prev: Snap | null): Snap | null => {
          for (const [a, b, type] of pairs) {
            const delta = b - a;
            if (Math.abs(delta) < SNAP_THRESHOLD && (!prev || Math.abs(delta) < Math.abs(prev.delta)))
              prev = { delta, snapTo: b, type, guide: b };
          }
          return prev;
        };

        let bestX: Snap | null = null;
        let bestY: Snap | null = null;

        for (const other of others) {
          const o = {
            left: other.position.x, right: other.position.x + other.size.width, centerX: other.position.x + other.size.width / 2,
            top: other.position.y, bottom: other.position.y + other.size.height, centerY: other.position.y + other.size.height / 2,
          };
          bestX = findBest([[edges.left, o.left, 'edge'], [edges.left, o.right, 'edge'], [edges.right, o.left, 'edge'], [edges.right, o.right, 'edge'], [edges.centerX, o.centerX, 'center']], bestX);
          bestY = findBest([[edges.top, o.top, 'edge'], [edges.top, o.bottom, 'edge'], [edges.bottom, o.top, 'edge'], [edges.bottom, o.bottom, 'edge'], [edges.centerY, o.centerY, 'center']], bestY);
        }

        const guides: SnapGuide[] = [];
        if (bestX) { snappedPos.x += bestX.delta; guides.push({ axis: 'x', position: bestX.guide, type: bestX.type }); }
        if (bestY) { snappedPos.y += bestY.delta; guides.push({ axis: 'y', position: bestY.guide, type: bestY.type }); }

        return { guides, snappedPos };
      },

      // ─── CLI Theming ───────────────────────────────────
      cliProvider: 'opencode',
      setCliProvider: (p) => set({ cliProvider: p }),

      // ─── Canvas Pan + Zoom ─────────────────────────────
      canvasPan: { x: 0, y: 0 },
      setCanvasPan: (pan) => set({ canvasPan: pan }),
      canvasZoom: 1,
      setCanvasZoom: (zoom) => set({ canvasZoom: Math.max(0.25, Math.min(3, zoom)) }),
      mentalMode: 'off',
      setMentalMode: (mode) => set({ mentalMode: mode }),

      // ─── Boards (Figma-like multiple canvases) ──────────────────
      //
      // ACTIVE-SLICE PATTERN: the active board's graph/viewport ALWAYS lives
      // in the existing top-level mentalNodes/mentalEdges/canvasPan/canvasZoom
      // slices — every existing consumer (MentalGraphCanvas, NodeTree,
      // harness-store's compileCurrentCanvas, SeamlessCanvas) keeps reading
      // those slices untouched. boards[i].snapshot is written ONLY at switch
      // time. Windows/widgets/dock stay global — a board owns ONLY its graph
      // + viewport, never windows/attachables/grids.
      //
      // CRITICAL: this store must NOT import harness-store — harness-store
      // already imports desktop-store, so the reverse would be circular. The
      // "don't switch boards while a flow is running" guard is UI-level (a
      // later phase), not enforced here.
      //
      boards: [{ id: 'board-1', name: 'Board 1', createdAt: Date.now(), updatedAt: Date.now(), snapshot: null }],
      activeBoardId: 'board-1',

      createBoard: (name) => {
        const state = get();
        const id = `board-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const trimmed = name?.trim();
        const board: Board = {
          id,
          name: trimmed || `Board ${state.boards.length + 1}`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          snapshot: emptyBoardSnapshot(),
        };
        set((s) => ({ boards: [...s.boards, board] }));
        // Switch into the new (empty) board — captures the outgoing active
        // board's live canvas into its snapshot in the same motion.
        get().switchBoard(id);
        return id;
      },

      switchBoard: (targetId) => {
        const state = get();
        if (targetId === state.activeBoardId) return;
        if (!state.boards.some((b) => b.id === targetId)) return;
        set((s) => {
          const currentSnapshot: BoardSnapshot = {
            mentalNodes: s.mentalNodes,
            mentalEdges: s.mentalEdges,
            canvasPan: s.canvasPan,
            canvasZoom: s.canvasZoom,
          };
          const now = Date.now();
          const boards = s.boards.map((b) =>
            b.id === s.activeBoardId ? { ...b, snapshot: currentSnapshot, updatedAt: now } : b
          );
          const target = boards.find((b) => b.id === targetId)!;
          const nextSnapshot = target.snapshot ?? emptyBoardSnapshot();
          // Heal any link/loop misclassification the incoming board's edges
          // may carry from persisted data predating the orient-connection fix.
          const nextMentalEdges = normalizeEdgeTypes(nextSnapshot.mentalNodes, nextSnapshot.mentalEdges);
          return {
            boards,
            activeBoardId: targetId,
            mentalNodes: nextSnapshot.mentalNodes,
            mentalEdges: nextMentalEdges,
            canvasPan: nextSnapshot.canvasPan,
            canvasZoom: nextSnapshot.canvasZoom,
            selectedMentalNodeIds: [],
            mentalEditingNodeId: null,
            mentalZ: {},
          };
        });
        // Push the ENTERING board's camera (just written above) to the
        // engine — the bridge's own onChange reflects it back into this
        // mirror, so both end up consistent with the new active board.
        get()._pushCameraToEngine?.();
      },

      renameBoard: (id, name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        set((s) => ({
          boards: s.boards.map((b) => b.id === id ? { ...b, name: trimmed, updatedAt: Date.now() } : b),
        }));
      },

      deleteBoard: (id) => {
        const state = get();
        if (state.boards.length <= 1) return;
        if (!state.boards.some((b) => b.id === id)) return;

        if (id !== state.activeBoardId) {
          set((s) => ({ boards: s.boards.filter((b) => b.id !== id) }));
          return;
        }

        // Deleting the ACTIVE board: switch to a neighbor (prefer the
        // previous index, else the next one) and remove the deleted board,
        // all inside this one set() — mirrors switchBoard's mechanics above,
        // but skips writing a snapshot for the board that's being discarded.
        set((s) => {
          const deleteIdx = s.boards.findIndex((b) => b.id === id);
          const neighbor = s.boards[deleteIdx > 0 ? deleteIdx - 1 : deleteIdx + 1];
          const nextSnapshot = neighbor.snapshot ?? emptyBoardSnapshot();
          // Heal any link/loop misclassification the neighbor board's edges
          // may carry from persisted data predating the orient-connection fix.
          const nextMentalEdges = normalizeEdgeTypes(nextSnapshot.mentalNodes, nextSnapshot.mentalEdges);
          return {
            boards: s.boards.filter((b) => b.id !== id),
            activeBoardId: neighbor.id,
            mentalNodes: nextSnapshot.mentalNodes,
            mentalEdges: nextMentalEdges,
            canvasPan: nextSnapshot.canvasPan,
            canvasZoom: nextSnapshot.canvasZoom,
            selectedMentalNodeIds: [],
            mentalEditingNodeId: null,
            mentalZ: {},
          };
        });
        // Only this branch (deleting the ACTIVE board) changes canvasPan/
        // canvasZoom — the `id !== state.activeBoardId` branch above already
        // returned, so it never reaches here (it must NOT push: it never
        // touches the active camera). Same reasoning as switchBoard above.
        get()._pushCameraToEngine?.();
      },

      // duplicateBoard intentionally does NOT push to the engine: it never
      // changes activeBoardId/canvasPan/canvasZoom — it only clones a
      // snapshot into a NEW, inactive board entry (see sourceSnapshot below,
      // read-only against the active slice when id === activeBoardId).
      duplicateBoard: (id) => {
        const state = get();
        const orig = state.boards.find((b) => b.id === id);
        if (!orig) return '';

        // The ACTIVE board's snapshot is stale — its live graph/viewport
        // lives in the top-level slices (active-slice pattern above).
        // Inactive boards already hold their authoritative data in `snapshot`.
        const sourceSnapshot: BoardSnapshot = id === state.activeBoardId
          ? { mentalNodes: state.mentalNodes, mentalEdges: state.mentalEdges, canvasPan: state.canvasPan, canvasZoom: state.canvasZoom }
          : (orig.snapshot ?? emptyBoardSnapshot());

        const newId = `board-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const board: Board = {
          id: newId,
          name: `${orig.name} copy`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          // Deep clone: node ids are kept as-is (safe — only one board is
          // ever live at a time, and switchBoard resets mentalZ/selection).
          snapshot: structuredClone(sourceSnapshot),
        };
        set((s) => ({ boards: [...s.boards, board] }));
        return newId;
      },

      // ─── Mental Graph (xyflow source of truth) ─────────────
      mentalNodes: [],
      mentalEdges: [],
      mentalTool: 'select',
      mentalEditingNodeId: null,

      setMentalTool: (tool) => set({ mentalTool: tool }),
      setMentalEditingNodeId: (nodeId) => set({ mentalEditingNodeId: nodeId }),

      addMentalNode: (input) => {
        const id = input.id ?? `mn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const node: MentalGraphNode = {
          id,
          type: 'mental',
          position: input.position,
          width: input.width,
          height: input.height,
          text: input.text,
          color: input.color,
          shape: input.shape,
          createdAt: Date.now(),
        };
        set((s) => {
          const z = globalTopZ(s);
          return {
            mentalNodes: [...s.mentalNodes, node],
            mentalZ: { ...s.mentalZ, [id]: z },
            nextZIndex: z + 1,
          };
        });
        return id;
      },

      updateMentalNode: (nodeId, patch) => set((s) => ({
        mentalNodes: s.mentalNodes.map((n) => {
          if (n.id !== nodeId) return n;
          if (isStepGraphNode(n)) {
            const { position, width, height } = patch;
            return {
              ...n,
              ...(position ? { position } : {}),
              ...(width !== undefined ? { width } : {}),
              ...(height !== undefined ? { height } : {}),
            };
          }
          return { ...n, ...patch };
        }),
      })),

      addFrameNode: (input) => {
        const id = input.id ?? `frame-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const node: FrameGraphNode = {
          id,
          type: 'frame',
          position: input.position,
          width: input.width,
          height: input.height,
          text: input.title,
          color: 'rgba(255,255,255,0.04)',
          shape: 'square',
          data: {
            title: input.title,
            description: input.description,
            childIds: [...(input.childIds ?? [])],
            missingCapabilitiesRequested: [...(input.missingCapabilitiesRequested ?? [])],
          },
          createdAt: Date.now(),
        };
        set((s) => ({ mentalNodes: [...s.mentalNodes, node] }));
        return id;
      },

      addStepNode: (input = {}) => {
        const state = get();
        const id = input.id ?? `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const node: StepGraphNode = {
          id,
          type: 'step',
          ...(input.parentId ? { parentId: input.parentId } : {}),
          position: input.position ?? getViewportCenteredSpawnPosition(state.canvasPan, state.canvasZoom),
          width: input.width ?? DEFAULT_STEP_WIDTH,
          height: input.height ?? DEFAULT_STEP_HEIGHT,
          text: input.title ?? 'Pipeline step',
          color: '#1a1a1a',
          shape: 'square',
          data: {
            title: input.title ?? 'Pipeline step',
            description: input.description,
            prompt: input.prompt,
            roleId: input.roleId,
            modIds: [...(input.modIds ?? [])],
            mods: [...(input.mods ?? [])],
            roles: [...(input.roles ?? [])],
            stepType: input.stepType ?? 'llm_call',
          },
          createdAt: Date.now(),
        };
        set((s) => {
          const z = globalTopZ(s);
          return {
            mentalNodes: [...s.mentalNodes, node],
            mentalZ: { ...s.mentalZ, [id]: z },
            nextZIndex: z + 1,
          };
        });
        return id;
      },

      insertPipelineAssembly: ({ assembly, position, frameWidth, frameHeight }) => {
        const frameId = `frame-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const stepIdMap = new Map<string, string>();
        const stepIds = assembly.steps.map((step) => {
          const nodeId = `${frameId}-${step.id}`;
          stepIdMap.set(step.id, nodeId);
          return nodeId;
        });
        const frameNode: FrameGraphNode = {
          id: frameId,
          type: 'frame',
          position,
          width: frameWidth,
          height: frameHeight,
          text: assembly.frameTitle,
          color: 'rgba(255,255,255,0.04)',
          shape: 'square',
          data: {
            title: assembly.frameTitle,
            description: assembly.description,
            childIds: stepIds,
            missingCapabilitiesRequested: [...assembly.missingCapabilitiesRequested],
          },
          createdAt: Date.now(),
        };
        // Compute out-degree for each step to detect routers
        const outDegreeMap = new Map<string, number>();
        for (const step of assembly.steps) {
          for (const prevId of step.prevStepIds) {
            outDegreeMap.set(prevId, (outDegreeMap.get(prevId) ?? 0) + 1);
          }
        }
        const TOOL_MOD_PATTERN = /tool|browser|web|mcp/i;
        function inferStepType(step: (typeof assembly.steps)[number]): AgenticStepType {
          if ((outDegreeMap.get(step.id) ?? 0) > 1) return 'router';
          if (step.modIds.some((id) => TOOL_MOD_PATTERN.test(id))) return 'tool_call';
          return 'llm_call';
        }
        const stepNodes: StepGraphNode[] = assembly.steps.map((step, index) => ({
          id: stepIdMap.get(step.id)!,
          type: 'step',
          parentId: frameId,
          position: {
            x: 56 + index * 250,
            y: 96 + (index % 2) * 34,
          },
          width: DEFAULT_STEP_WIDTH,
          height: DEFAULT_STEP_HEIGHT,
          text: titleFromId(step.id),
          color: '#1a1a1a',
          shape: 'square',
          data: {
            title: titleFromId(step.id),
            description: step.prompt,
            prompt: step.prompt,
            roleId: step.roleId,
            modIds: [...step.modIds],
            mods: step.modIds.map(modFromId),
            roles: step.roleId ? [roleFromId(step.roleId)] : [],
            stepType: inferStepType(step),
          },
          createdAt: Date.now(),
        }));
        const edges: MentalGraphEdge[] = assembly.steps.flatMap((step) => (
          step.prevStepIds.flatMap((prevStepId) => {
            const sourceId = stepIdMap.get(prevStepId);
            const targetId = stepIdMap.get(step.id);
            if (!sourceId || !targetId || sourceId === targetId) return [];
            return [{
              id: `me-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              sourceId,
              targetId,
              sourceHandle: 'right',
              targetHandle: 'left',
              type: 'link',
              color: DEFAULT_MENTAL_EDGE_COLOR,
              createdAt: Date.now(),
            }];
          })
        ));
        // Bounded refinement loop-backs: source = the LATER step (the one
        // carrying loopBackTo), target = the earlier step it re-runs from —
        // same direction convention the harness compiler expects. Silently
        // skips a loopBackTo whose target didn't survive assembly (unknown
        // id) or resolves to the step itself.
        const loopEdges: MentalGraphEdge[] = assembly.steps.flatMap((step) => {
          if (!step.loopBackTo) return [];
          const sourceId = stepIdMap.get(step.id);
          const targetId = stepIdMap.get(step.loopBackTo.stepId);
          if (!sourceId || !targetId || sourceId === targetId) return [];
          return [{
            id: `me-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            sourceId,
            targetId,
            sourceHandle: 'bottom',
            targetHandle: 'top',
            type: 'loop',
            maxIterations: clampLoopIterations(step.loopBackTo.maxIterations),
            color: DEFAULT_MENTAL_EDGE_COLOR,
            createdAt: Date.now(),
          }];
        });

        set((s) => {
          const z = globalTopZ(s);
          const newMentalZ = { ...s.mentalZ, [frameId]: z };
          for (const sid of stepIds) newMentalZ[sid] = z;
          return {
            mentalNodes: [...s.mentalNodes, frameNode, ...stepNodes],
            mentalEdges: [...s.mentalEdges, ...edges, ...loopEdges],
            selectedMentalNodeIds: [frameId],
            mentalEditingNodeId: null,
            mentalZ: newMentalZ,
            nextZIndex: z + 1,
          };
        });

        return { frameId, stepIds };
      },

      addModToStep: (stepId, modData) => {
        const modId = marketEntityId(modData);

        // Validate compatibility against mods already on this step (mirrors
        // `addModifier`'s window-modifier check). `incompatibleWith` already
        // encodes exclusive-group siblings at load time (see market-loader),
        // so a bidirectional name check here is sufficient.
        const targetNode = get().mentalNodes.find((n) => n.id === stepId);
        if (targetNode && isStepGraphNode(targetNode)) {
          const conflict = targetNode.data.mods.some((existing) => {
            const existingId = marketEntityId(existing);
            return (
              modData.incompatibleWith?.includes(existingId) ||
              existing.incompatibleWith?.includes(modId)
            );
          });
          if (conflict) return false;
        }

        let didAdd = false;
        set((s) => ({
          mentalNodes: s.mentalNodes.map((node) => {
            if (node.id !== stepId || !isStepGraphNode(node)) return node;
            if (node.data.mods.some((mod) => marketEntityId(mod) === modId)) return node;
            didAdd = true;
            return {
              ...node,
              data: {
                ...node.data,
                mods: [...node.data.mods, { ...modData }],
              },
            };
          }),
        }));
        return didAdd;
      },

      removeModFromStep: (stepId, modId) => set((s) => ({
        mentalNodes: s.mentalNodes.map((node) => {
          if (node.id !== stepId || !isStepGraphNode(node)) return node;
          const nextMods = node.data.mods.filter((mod) => marketEntityId(mod) !== modId);
          if (nextMods.length === node.data.mods.length) return node;
          return {
            ...node,
            data: {
              ...node.data,
              mods: nextMods,
            },
          };
        }),
      })),

      addRoleToStep: (stepId, roleData) => {
        // One role per step — roles are mutually exclusive, so attaching a
        // new (different) role always replaces whatever was assigned before.
        // Re-attaching the exact same already-sole role is a no-op.
        let didAdd = false;
        const roleId = marketEntityId(roleData);
        set((s) => ({
          mentalNodes: s.mentalNodes.map((node) => {
            if (node.id !== stepId || !isStepGraphNode(node)) return node;
            const alreadySoleRole =
              node.data.roles.length === 1 && marketEntityId(node.data.roles[0]) === roleId;
            if (alreadySoleRole) return node;
            didAdd = true;
            return {
              ...node,
              data: {
                ...node.data,
                roles: [{ ...roleData }],
              },
            };
          }),
        }));
        return didAdd;
      },

      removeRoleFromStep: (stepId, roleId) => set((s) => ({
        mentalNodes: s.mentalNodes.map((node) => {
          if (node.id !== stepId || !isStepGraphNode(node)) return node;
          const nextRoles = node.data.roles.filter((role) => marketEntityId(role) !== roleId);
          if (nextRoles.length === node.data.roles.length) return node;
          return {
            ...node,
            data: {
              ...node.data,
              roles: nextRoles,
            },
          };
        }),
      })),

      updateStepData: (stepId, patch) => set((s) => ({
        mentalNodes: s.mentalNodes.map((node) => {
          if (node.id !== stepId || !isStepGraphNode(node)) return node;
          return {
            ...node,
            data: {
              ...node.data,
              ...patch,
            },
          };
        }),
      })),

      updateFrameData: (frameId, patch) => set((s) => ({
        mentalNodes: s.mentalNodes.map((node) => {
          if (node.id !== frameId || !isFrameGraphNode(node)) return node;
          return {
            ...node,
            data: {
              ...node.data,
              ...patch,
            },
          };
        }),
      })),

      removeMentalNode: (nodeId) => set((s) => {
        const target = s.mentalNodes.find((n) => n.id === nodeId);
        const idsToRemove = new Set<string>([nodeId]);
        if (target && isFrameGraphNode(target)) {
          for (const childId of target.data.childIds) idsToRemove.add(childId);
          for (const node of s.mentalNodes) {
            if ('parentId' in node && node.parentId === nodeId) idsToRemove.add(node.id);
          }
        }

        return {
          mentalNodes: s.mentalNodes
            .filter((n) => !idsToRemove.has(n.id))
            .map((n) => {
              if (!isFrameGraphNode(n)) return n;
              const nextChildIds = n.data.childIds.filter((childId) => !idsToRemove.has(childId));
              return nextChildIds.length === n.data.childIds.length
                ? n
                : { ...n, data: { ...n.data, childIds: nextChildIds } };
            }),
          mentalEdges: s.mentalEdges.filter((e) => !idsToRemove.has(e.sourceId) && !idsToRemove.has(e.targetId)),
          selectedMentalNodeIds: s.selectedMentalNodeIds.filter((id) => !idsToRemove.has(id)),
          mentalEditingNodeId: s.mentalEditingNodeId && idsToRemove.has(s.mentalEditingNodeId) ? null : s.mentalEditingNodeId,
        };
      }),

      addMentalEdge: (sourceId, targetId, edgeType = 'link', sourceHandle, targetHandle, maxIterations) => {
        if (!sourceId || !targetId || sourceId === targetId) return null;
        const state = get();
        const sourceExists = state.mentalNodes.some((n) => n.id === sourceId);
        const targetExists = state.mentalNodes.some((n) => n.id === targetId);
        if (!sourceExists || !targetExists) return null;
        // Directed duplicate check: same source → same target
        const duplicate = state.mentalEdges.some(
          (e) => e.sourceId === sourceId && e.targetId === targetId
        );
        if (duplicate) return null;
        const id = `me-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        set((s) => ({
          mentalEdges: [...s.mentalEdges, {
            id,
            sourceId,
            targetId,
            sourceHandle: sourceHandle || 'bottom',
            targetHandle: targetHandle || 'top',
            type: edgeType,
            ...(edgeType === 'loop' ? { maxIterations: clampLoopIterations(maxIterations) } : {}),
            color: DEFAULT_MENTAL_EDGE_COLOR,
            createdAt: Date.now(),
          }],
        }));
        return id;
      },

      removeMentalEdge: (edgeId) => set((s) => ({
        mentalEdges: s.mentalEdges.filter((e) => e.id !== edgeId),
      })),

      updateMentalEdgeColor: (edgeId, color) => set((s) => ({
        mentalEdges: s.mentalEdges.map((e) => e.id === edgeId ? { ...e, color } : e),
      })),

      updateMentalEdgeData: (edgeId, patch) => set((s) => ({
        mentalEdges: s.mentalEdges.map((e) => e.id === edgeId
          ? { ...e, ...(patch.maxIterations !== undefined ? { maxIterations: clampLoopIterations(patch.maxIterations) } : {}) }
          : e),
      })),

      invertMentalEdge: (edgeId) => set((s) => ({
        mentalEdges: s.mentalEdges.map((e) => {
          if (e.id !== edgeId) return e;
          const inverted = {
            ...e,
            sourceId: e.targetId,
            targetId: e.sourceId,
            sourceHandle: e.targetHandle,
            targetHandle: e.sourceHandle,
          };
          // Re-classify against the graph MINUS this edge (an edge must not
          // count itself when deciding whether its reversal closes a cycle).
          const others = s.mentalEdges.filter((x) => x.id !== edgeId);
          const isLoop = wouldCreateStepCycle(inverted.sourceId, inverted.targetId, s.mentalNodes, others);
          if (isLoop) {
            return { ...inverted, type: 'loop' as const, maxIterations: clampLoopIterations(inverted.maxIterations ?? LOOP_DEFAULT_MAX_ITERATIONS) };
          }
          const { maxIterations: _drop, ...rest } = inverted;
          return { ...rest, type: inverted.type === 'ramification' ? inverted.type : 'link' as const };
        }),
      })),

      createRamificationFromDrop: (sourceId, flowPosition) => {
        const state = get();
        const source = state.mentalNodes.find((n) => n.id === sourceId);
        if (!source) return null;
        const nodeId = `mn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const node: MentalGraphNode = {
          id: nodeId,
          type: 'mental',
          position: flowPosition,
          width: DEFAULT_MENTAL_WIDTH,
          height: DEFAULT_MENTAL_HEIGHT,
          text: '',
          color: source.color,
          shape: source.shape ?? 'square',
          createdAt: Date.now(),
        };
        const edgeId = `me-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const edge: MentalGraphEdge = {
          id: edgeId,
          sourceId,
          targetId: nodeId,
          sourceHandle: 'bottom',
          targetHandle: 'top',
          type: 'ramification',
          color: DEFAULT_MENTAL_EDGE_COLOR,
          createdAt: Date.now(),
        };
        set((s) => ({
          mentalNodes: [...s.mentalNodes, node],
          mentalEdges: [...s.mentalEdges, edge],
          mentalEditingNodeId: nodeId,
        }));
        return { nodeId, edgeId };
      },

      // ─── Mental Graph selection (mirrors xyflow) ───────
      selectedMentalNodeIds: [],
      setSelectedMentalNodeIds: (ids) => {
        // Avoid spurious re-renders when xyflow re-emits the same selection.
        const current = get().selectedMentalNodeIds;
        if (current.length === ids.length && current.every((v, i) => v === ids[i])) return;
        set({ selectedMentalNodeIds: ids });
      },

      // ─── Mental → Chat attachments ──────────────────────
      attachMentalToWindow: (windowId, nodeIds) => set((s) => ({
        windows: s.windows.map((w) => {
          if (w.id !== windowId) return w;
          const existing = w.mentalAttachments ?? [];
          // Skip if an attachment with the exact same membership already exists.
          const key = [...nodeIds].sort().join('|');
          const dup = existing.some(att => [...att.nodeIds].sort().join('|') === key);
          if (dup) return w;
          return {
            ...w,
            mentalAttachments: [
              ...existing,
              { nodeIds: [...nodeIds], attachedAt: Date.now() },
            ],
          };
        }),
      })),
      detachMentalAttachment: (windowId, index) => set((s) => ({
        windows: s.windows.map((w) => {
          if (w.id !== windowId) return w;
          const existing = w.mentalAttachments ?? [];
          if (index < 0 || index >= existing.length) return w;
          return {
            ...w,
            mentalAttachments: existing.filter((_, i) => i !== index),
          };
        }),
      })),
      clearMentalAttachments: (windowId) => set((s) => ({
        windows: s.windows.map((w) => w.id === windowId ? { ...w, mentalAttachments: [] } : w),
      })),

      // ─── Notifications ─────────────────────────────────
      notifications: [],
      unreadCount: 0,
      showNotifications: false,
      setShowNotifications: (v) => set({ showNotifications: v }),
      addNotification: (message, sessionId) => set((s) => {
        const notif: DesktopNotification = {
          id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 4)}`,
          message,
          timestamp: Date.now(),
          sessionId,
          read: false,
        };
        return {
          notifications: [notif, ...s.notifications].slice(0, 100),
          unreadCount: s.unreadCount + 1,
        };
      }),
      markAllRead: () => set((s) => ({
        notifications: s.notifications.map(n => ({ ...n, read: true })),
        unreadCount: 0,
      })),
      clearNotifications: () => set({ notifications: [], unreadCount: 0 }),

      // ─── Auto-chat panel — lightweight intent history (NOT persisted,
      // deliberately absent from `partialize` below — see the
      // AutoChatHistoryEntry doc comment) ─────────────────────
      autoChatHistory: [],
      addAutoChatHistoryEntry: (entry) => set((s) => {
        const full: AutoChatHistoryEntry = {
          id: `auto-chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: Date.now(),
          ...entry,
        };
        // Capped like `notifications` above — a lightweight log, not an
        // ever-growing transcript.
        return { autoChatHistory: [full, ...s.autoChatHistory].slice(0, 20) };
      }),
      clearAutoChatHistory: () => set({ autoChatHistory: [] }),

      // ─── Mono-step gesture (W2) — see the interface doc comment above ──
      pendingStepFocusId: null,
      setPendingStepFocusId: (id) => set({ pendingStepFocusId: id }),

      // Navigator highlight
      hoveredWindowId: null,
      setHoveredWindowId: (id) => set({ hoveredWindowId: id }),

      // Active drag state
      activeDragId: null,
      setActiveDragId: (id) => set({ activeDragId: id }),

      // Selected attachable
      selectedAttachableId: null,
      setSelectedAttachableId: (id) => set({ selectedAttachableId: id }),
      focusAttachable: (attachableId) => {
        const z = get().nextZIndex;
        set((s) => ({
          attachables: s.attachables.map(a => a.id === attachableId ? { ...a, zIndex: z } : a),
          nextZIndex: z + 1,
          selectedAttachableId: attachableId,
        }));
      },

      // Settings
      settings: {
        canvasClickAnimation: true,
        tourCompleted: false,
        tutorialCompleted: {},
        modelPolicy: { mode: 'fixed' },
        showInspector: true,
      },
      updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      setModelPolicy: (policy) => set((s) => ({ settings: { ...s.settings, modelPolicy: policy } })),

      // Tutorial engine
      activeTutorial: null,
      setActiveTutorial: (id) => set({ activeTutorial: id }),

      navigateToWindow: (windowId) => {
        const state = get();
        const win = state.windows.find(w => w.id === windowId);
        if (!win) return;
        state.focusWindow(windowId);
        const vpW = typeof window !== 'undefined' ? window.innerWidth : 1200;
        const vpH = typeof window !== 'undefined' ? window.innerHeight : 800;
        const zoom = state.canvasZoom;
        const centerX = -(win.position.x * zoom) + (vpW / 2) - (win.size.width * zoom / 2);
        const centerY = -(win.position.y * zoom) + (vpH / 2) - (win.size.height * zoom / 2);
        // Was a raw set({canvasPan:...}) — bypassed setCanvasPan entirely,
        // which would have silently desynced canvasPan (this mirror) from
        // the engine's actual camera post-Task-12 (found while auditing every
        // canvasPan/canvasZoom write site for the bridge; not one of the
        // call-sites the scout/decisions docs named — see final report).
        // Routing through the action keeps this a single delegation point.
        get().setCanvasPan({ x: centerX, y: centerY });
      },

      // Project picker
      showProjectPicker: false,
      pendingChatPosition: null,
      setShowProjectPicker: (v, position) => set({ showProjectPicker: v, pendingChatPosition: position ?? null }),

      // Canvas-level backlog card modal
      canvasModalCard: null,
      openCanvasModal: (card) => set({ canvasModalCard: card }),
      closeCanvasModal: () => set({ canvasModalCard: null }),

      // File explorer persistent state
      fileExplorerStates: {},
      setFileExplorerState: (windowId, state) => set((s) => ({
        fileExplorerStates: { ...s.fileExplorerStates, [windowId]: state },
      })),
      clearFileExplorerState: (windowId) => set((s) => {
        const { [windowId]: _, ...rest } = s.fileExplorerStates;
        return { fileExplorerStates: rest };
      }),

      // ─── HUD Widgets ───────────────────────────────────────────────
      // Positions are stored already-resolved (Phase 4: callers must call
      // resolveHudWidgetPlacement — logic/hud-widget-policy.ts, which itself snaps +
      // clamps + dodges the top-right safe zone and other widgets — before
      // moveHudWidget; this setter persists verbatim and does no snapping,
      // clamping, or collision avoidance of its own). HudWidgetLayer is the
      // one caller and resolves on drag-release, resize-release, and
      // widget spawn/reopen — see its DraggableWidget mount effect.
      hudWidgets: DEFAULT_HUD_WIDGETS,

      setHudWidgetVisible: (type, visible) => set((s) => ({
        hudWidgets: s.hudWidgets.map(w => w.type === type ? { ...w, visible } : w),
      })),

      moveHudWidget: (type, position) => set((s) => ({
        hudWidgets: s.hudWidgets.map(w => w.type === type ? { ...w, position } : w),
      })),

      // Clamp to a sane minimum (readable content) and the current viewport
      // (a widget can never be resized larger than the screen that hosts it).
      // Note: this only clamps SIZE, never position — if growing a widget in
      // place now overlaps a neighbour or the safe zone, the caller
      // (HudWidgetLayer) re-resolves position via resolveHudWidgetPlacement
      // and calls moveHudWidget separately; resizeHudWidget never touches it.
      resizeHudWidget: (type, size) => set((s) => {
        const maxWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
        const maxHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
        const clamped = {
          width: Math.min(Math.max(size.width, MIN_WIDGET_WIDTH), maxWidth),
          height: Math.min(Math.max(size.height, MIN_WIDGET_HEIGHT), maxHeight),
        };
        return {
          hudWidgets: s.hudWidgets.map(w => w.type === type ? { ...w, size: clamped } : w),
        };
      }),

      toggleHudWidget: (type) => set((s) => ({
        hudWidgets: s.hudWidgets.map(w => w.type === type ? { ...w, visible: !w.visible } : w),
      })),
    }),
    {
      name: 'fluxor-desktop',
      version: 20,
      // Debounce localStorage writes: `partialize` below now includes
      // `boards[]` (the full mental graph of EVERY board, not just the one
      // on screen), so persist's default synchronous stringify-and-write on
      // every single set() — including per-frame drag (updateMentalNode) and
      // pan/zoom ticks — scales with the whole multi-board session instead
      // of just what's visible. DebouncedStorage (src/renderer/logic/
      // debounced-storage.ts) collapses bursts of writes into one trailing
      // write per key every ~500ms while still flushing on unload/hide.
      storage: createJSONStorage(() => debouncedLocalStorage),
      partialize: (state) => ({
        windows: state.windows,
        connections: state.connections,
        grids: state.grids,
        dockItems: state.dockItems,
        installedPlugins: state.installedPlugins,
        attachables: state.attachables,
        cliProvider: state.cliProvider,
        canvasPan: state.canvasPan,
        canvasZoom: state.canvasZoom,
        // mentalMode intentionally NOT persisted — always boots as 'off'
        mentalNodes: state.mentalNodes,
        mentalEdges: state.mentalEdges,
        mentalTool: state.mentalTool,
        settings: state.settings,
        fileExplorerStates: state.fileExplorerStates,
        hudWidgets: state.hudWidgets,
        boards: state.boards,
        activeBoardId: state.activeBoardId,
      }),
      // Migrate old persisted data (v1 had icon: emoji, v2 has iconName)
      migrate: (persisted: any, version: number) => {
        if (version < 2 && persisted) {
          // Migrate v1 windows: convert emoji `icon` field to `iconName`
          if (Array.isArray(persisted.windows)) {
            persisted.windows = persisted.windows.map((w: any) => ({
              ...w,
              iconName: w.iconName || 'Blocks',
              modifierIds: w.modifierIds || [],
            }));
          }
          // Migrate v1 dock items
          if (Array.isArray(persisted.dockItems)) {
            persisted.dockItems = persisted.dockItems.map((d: any) => ({
              ...d,
              iconName: d.iconName || 'Terminal',
            }));
          }
          // Set default zoom if missing
          if (persisted.canvasZoom === undefined) {
            persisted.canvasZoom = 1;
          }
        }
        // v2 → v3: inject Grid dock item and initialize grids array
        if (version < 3 && persisted) {
          if (!persisted.grids) persisted.grids = [];
          if (Array.isArray(persisted.dockItems)) {
            const hasGrid = persisted.dockItems.some((d: any) => d.action === 'grid');
            if (!hasGrid) {
              // Insert after backlog, before mind draw toggle
              const backlogIdx = persisted.dockItems.findIndex((d: any) => d.action === 'backlog');
              const insertAt = backlogIdx >= 0 ? backlogIdx + 1 : persisted.dockItems.length;
              persisted.dockItems.splice(insertAt, 0, {
                id: 'dock-grid', type: 'action', label: 'Grid', iconName: 'LayoutGrid', action: 'grid',
              });
            }
          }
        }
        // v3 → v4: restore missing core dock actions in legacy persisted sessions
        if (version < 4 && persisted && Array.isArray(persisted.dockItems)) {
          type DockAction = NonNullable<DockItem['action']>;
          const actionOrder = DEFAULT_DOCK_ITEMS
            .map((item) => item.action)
            .filter((action): action is DockAction => Boolean(action));
          const persistedActions = new Set<DockAction>(
            persisted.dockItems
              .map((item: any) => item?.action)
              .filter((action: unknown): action is DockAction => actionOrder.includes(action as DockAction))
          );

          const insertAction = (action: DockAction) => {
            if (persistedActions.has(action)) return;
            const defaultItem = DEFAULT_DOCK_ITEMS.find((item) => item.action === action);
            if (!defaultItem) return;

            const desiredIndex = actionOrder.indexOf(action);
            const insertAt = persisted.dockItems.findIndex((item: any) => {
              const itemAction = item?.action;
              if (!actionOrder.includes(itemAction)) return false;
              const itemIndex = actionOrder.indexOf(itemAction);
              return itemIndex > desiredIndex;
            });

            if (insertAt >= 0) persisted.dockItems.splice(insertAt, 0, { ...defaultItem });
            else persisted.dockItems.push({ ...defaultItem });
            persistedActions.add(action);
          };

          insertAction('backlog');
          insertAction('mental-draw-toggle');
        }
        // v4 → v5: remove legacy Mind Map app surfaces and map dock item to draw toggle
        if (version < 5 && persisted) {
          if (Array.isArray(persisted.dockItems)) {
            persisted.dockItems = persisted.dockItems
              .filter((item: any) => item?.action !== 'mind-map')
              .filter((item: any, index: number, arr: any[]) => {
                const action = item?.action;
                if (!action) return true;
                return arr.findIndex((candidate) => candidate?.action === action) === index;
              });

            const hasMentalToggle = persisted.dockItems.some((item: any) => item?.action === 'mental-draw-toggle');
            if (!hasMentalToggle) {
              const defaultMentalToggle = DEFAULT_DOCK_ITEMS.find((item) => item.action === 'mental-draw-toggle');
              if (defaultMentalToggle) {
                const gridIndex = persisted.dockItems.findIndex((item: any) => item?.action === 'grid');
                const insertAt = gridIndex >= 0 ? gridIndex + 1 : persisted.dockItems.length;
                persisted.dockItems.splice(insertAt, 0, { ...defaultMentalToggle });
              }
            }
          }

          if (Array.isArray(persisted.installedPlugins)) {
            persisted.installedPlugins = persisted.installedPlugins.filter((plugin: any) =>
              plugin?.id !== 'tool-mind-map' && plugin?.componentKey !== 'mind-map'
            );
          }

          if (Array.isArray(persisted.windows)) {
            persisted.windows = persisted.windows.filter((w: any) =>
              !(w?.type === 'plugin' && w?.pluginId === 'tool-mind-map')
            );
          }
        }

        // v5 → v6: migrate boolean draw mode + mental payload/connection defaults
        if (version < 6 && persisted) {
          if (persisted.mentalMode !== 'off' && persisted.mentalMode !== 'shapes' && persisted.mentalMode !== 'lines') {
            persisted.mentalMode = 'off';
          }
          if (typeof persisted.isMentalDrawMode === 'boolean') {
            persisted.mentalMode = persisted.isMentalDrawMode ? 'shapes' : 'off';
            delete persisted.isMentalDrawMode;
          }
          if (!Array.isArray(persisted.mentalConnections)) {
            persisted.mentalConnections = [];
          }
        }

        // v6 → v7: introduce React Flow mental graph (clean reset of mental data)
        if (version < 7 && persisted) {
          if (!Array.isArray(persisted.mentalNodes)) {
            persisted.mentalNodes = [];
          }
          if (!Array.isArray(persisted.mentalEdges)) {
            persisted.mentalEdges = [];
          }
          if (persisted.mentalTool !== 'select' && persisted.mentalTool !== 'ramification') {
            persisted.mentalTool = 'select';
          }
        }

        // v7 → v8: no-op (store-clock fields removed)

        // v8 → v9: migrate MentalMode shapes/lines → square/circle/triangle;
        // mentalMode is no longer persisted (always boots as 'off'), so just
        // strip it. Migrate node shapes from 'rectangle' to 'square'.
        if (version < 9 && persisted) {
          delete persisted.mentalMode;
          if (Array.isArray(persisted.mentalNodes)) {
            persisted.mentalNodes = persisted.mentalNodes.map((n: any) => ({
              ...n,
              shape: (n.shape === 'rectangle' || !n.shape) ? 'square' : n.shape,
            }));
          }
        }

        // v9 → v10: add tutorialCompleted map; seed workspace from tourCompleted
        if (version < 10 && persisted) {
          if (!persisted.settings) persisted.settings = {};
          if (!persisted.settings.tutorialCompleted) {
            persisted.settings.tutorialCompleted = {};
          }
          if (persisted.settings.tourCompleted) {
            persisted.settings.tutorialCompleted.workspace = true;
          }
        }

        // v10 → v11: xyflow is now the only mental source of truth.
        // Strip every legacy attachable of type 'mental', remove the
        // undirected `mentalConnections` array, and clear `mentalLineSourceId`.
        // Existing mentalNodes / mentalEdges (xyflow) are preserved.
        if (version < 11 && persisted) {
          if (Array.isArray(persisted.attachables)) {
            persisted.attachables = persisted.attachables.filter(
              (a: any) => a?.type !== 'mental',
            );
          }
          delete persisted.mentalConnections;
          delete persisted.mentalLineSourceId;
        }

        // v11 → v12: introduce DesktopWindow.mentalAttachments (matrix of
        // attached subgraphs per chat). Default to undefined for older windows;
        // store treats missing as zero attachments. Nothing else to migrate.
        if (version < 12 && persisted) {
          if (Array.isArray(persisted.windows)) {
            persisted.windows = persisted.windows.map((w: any) =>
              w?.mentalAttachments === undefined ? w : { ...w, mentalAttachments: w.mentalAttachments }
            );
          }
        }

        // v12 → v13: mentalNodes now hosts both legacy mental cards and
        // StepNode containers. Existing nodes are marked as mental; any
        // pre-release step nodes get normalized data arrays.
        if (version < 13 && persisted) {
          if (Array.isArray(persisted.mentalNodes)) {
            persisted.mentalNodes = persisted.mentalNodes.map((n: any) => {
              if (n?.type === 'step') {
                return {
                  ...n,
                  width: typeof n.width === 'number' ? n.width : DEFAULT_STEP_WIDTH,
                  height: typeof n.height === 'number' ? n.height : DEFAULT_STEP_HEIGHT,
                  text: typeof n.text === 'string' ? n.text : n?.data?.title ?? 'Pipeline step',
                  color: typeof n.color === 'string' ? n.color : '#1a1a1a',
                  shape: n.shape ?? 'square',
                  data: {
                    title: n?.data?.title ?? n.text ?? 'Pipeline step',
                    description: n?.data?.description,
                    mods: Array.isArray(n?.data?.mods) ? n.data.mods : [],
                    roles: Array.isArray(n?.data?.roles) ? n.data.roles : [],
                  },
                };
              }
              return {
                ...n,
                type: 'mental',
              };
            });
          }
        }

        // v13 → v14: drop stale zoom, strip arena + design-system dock items/windows (Req1, Req7, Req10)
        if (version < 14 && persisted) {
          // Req1: never restore a stale zoom — always boot at 100%
          delete persisted.canvasZoom;
          // Req7 + Req10: strip legacy arena + design-system/guideline dock items
          if (Array.isArray(persisted.dockItems)) {
            persisted.dockItems = persisted.dockItems.filter((d: any) =>
              d?.action !== 'arena' &&
              d?.action !== 'design-system' &&
              !/design.?system|guideline/i.test(`${d?.id ?? ''} ${d?.label ?? ''} ${d?.action ?? ''}`)
            );
          }
          // Req7: drop persisted Arena windows
          if (Array.isArray(persisted.windows)) {
            persisted.windows = persisted.windows.filter((w: any) => w?.type !== 'arena');
          }
        }

        // v14 → v15: remove Grid dock item and clear stale grid data so old
        // sessions don't show orphaned grid containers. Window-to-window snap
        // (calculateSnapGuides / SnapGuides) is the new implicit "grid".
        if (version < 15 && persisted) {
          persisted.grids = [];
          if (Array.isArray(persisted.dockItems)) {
            persisted.dockItems = persisted.dockItems.filter((d: any) => d?.action !== 'grid');
          }
          if (Array.isArray(persisted.windows)) {
            persisted.windows = persisted.windows.map((w: any) => {
              if (w && w.gridId) {
                // Destructure to omit grid fields; prefixed with _ to satisfy no-unused-vars
                const { gridId: _gridId, gridCellIndex: _gridCellIndex, gridColSpan: _gridColSpan, gridRowSpan: _gridRowSpan, ...rest } = w;
                return rest;
              }
              return w;
            });
          }
        }

        // v15 → v16: inject new-step and new-flow dock actions for existing
        // users who don't have them. Reuses the same ordered-insert pattern
        // as the v3→v4 migration block above.
        if (version < 16 && persisted && Array.isArray(persisted.dockItems)) {
          type DockAction = NonNullable<DockItem['action']>;
          const actionOrder = DEFAULT_DOCK_ITEMS
            .map((item) => item.action)
            .filter((action): action is DockAction => Boolean(action));
          const persistedActions = new Set<DockAction>(
            persisted.dockItems
              .map((item: any) => item?.action)
              .filter((action: unknown): action is DockAction => actionOrder.includes(action as DockAction))
          );
          const insertAction = (action: DockAction) => {
            if (persistedActions.has(action)) return;
            const defaultItem = DEFAULT_DOCK_ITEMS.find((item) => item.action === action);
            if (!defaultItem) return;
            const desiredIndex = actionOrder.indexOf(action);
            const insertAt = persisted.dockItems.findIndex((item: any) => {
              const itemAction = item?.action;
              if (!actionOrder.includes(itemAction)) return false;
              return actionOrder.indexOf(itemAction) > desiredIndex;
            });
            if (insertAt >= 0) persisted.dockItems.splice(insertAt, 0, { ...defaultItem });
            else persisted.dockItems.push({ ...defaultItem });
            persistedActions.add(action);
          };
          insertAction('new-step');
          insertAction('new-flow');
        }

        // v16 → v17: rename the 'text-to-pipeline' HUD widget to 'text-to-flow'
        if (version < 17 && persisted && Array.isArray(persisted.hudWidgets)) {
          persisted.hudWidgets = persisted.hudWidgets.map((w: any) =>
            w?.type === 'text-to-pipeline' ? { ...w, type: 'text-to-flow' } : w,
          );
        }

        // v17 → v18: introduce multi-board canvases ("pizarras"). The pre-v18
        // single canvas becomes Board 1 losslessly via the active-slice
        // pattern — its snapshot stays null, meaning its data keeps living in
        // the top-level mentalNodes/mentalEdges/canvasPan/canvasZoom slices
        // exactly as before (see the ACTIVE-SLICE PATTERN comment on the
        // `boards` field above). canvasZoom is now persisted (see
        // partialize) — default it to 1 for sessions that never had one.
        // Note: v14's `delete persisted.canvasZoom` above only fires for
        // version < 14, so for a very old session both blocks run in this
        // same migration pass (in file order) and this default still applies.
        if (version < 18 && persisted) {
          persisted.boards = [
            { id: 'board-1', name: 'Board 1', createdAt: Date.now(), updatedAt: Date.now(), snapshot: null },
          ];
          persisted.activeBoardId = 'board-1';
          if (typeof persisted.canvasZoom !== 'number') persisted.canvasZoom = 1;
        }

        // v18 → v19: retire the 'chat' window type (chats→steps
        // re-architecture, F0 decision 2, 2026-07-10) — general chat is no
        // longer a window surface; code-editing work happens through
        // launched steps, and the single automation chat lives outside the
        // window system (HudAutoChatPanel, a fixed HUD panel — see the v20
        // migration below for its own HUD-widget-slot rename). Two
        // migrations bundled here (same idiom as v13→v14's unrelated
        // zoom+arena bundle above):
        // (a) Tombstone: any persisted 'chat' window is dropped rather than
        //     left to hydrate with a type DesktopWindow['type'] no longer
        //     declares (which would crash the render switch) — mirrors the
        //     v14 arena-window drop and v5 mind-map-window drop above.
        //     Never a silent surprise: a notification tells the user what
        //     happened and where their new "start work" affordances are.
        //     Stashed directly onto `persisted.notifications` (not part of
        //     `partialize`, so merge()'s `{ ...currentState, ...persisted }`
        //     spread is what actually seeds it — see merge() below).
        // (b) The Dock's "New Chat" item is relabeled in place to reflect
        //     its new behavior (reveals the Auto-Chat HUD panel instead of
        //     spawning a chat window) — `id`/`action` stay 'new-chat' (see
        //     DEFAULT_DOCK_ITEMS's own comment), only `label` changes, same
        //     ordered-patch idiom the v3→v4/v15→v16 dock migrations use.
        if (version < 19 && persisted) {
          if (Array.isArray(persisted.windows)) {
            const retiredChatWindows = persisted.windows.filter((w: any) => w?.type === 'chat');
            if (retiredChatWindows.length > 0) {
              persisted.windows = persisted.windows.filter((w: any) => w?.type !== 'chat');
              const n = retiredChatWindows.length;
              const notice = {
                id: `notif-migration-chat-retired-${Date.now()}`,
                message: `${n} chat window${n === 1 ? '' : 's'} from an older version ${n === 1 ? 'was' : 'were'} removed — start new work from the Auto-Chat panel or by double-clicking the canvas.`,
                timestamp: Date.now(),
                read: false,
              };
              persisted.notifications = [notice, ...(Array.isArray(persisted.notifications) ? persisted.notifications : [])];
              // `unreadCount` isn't in `partialize` either, but the same
              // direct-stash-onto-`persisted` trick applies — keeps the
              // widget-launcher's unread badge honest for this notice
              // (mirrors `addNotification`'s own +1 bump).
              persisted.unreadCount = (typeof persisted.unreadCount === 'number' ? persisted.unreadCount : 0) + 1;
            }
          }
          if (Array.isArray(persisted.dockItems)) {
            persisted.dockItems = persisted.dockItems.map((d: any) =>
              d?.action === 'new-chat' ? { ...d, label: 'Auto-Chat' } : d
            );
          }
        }

        // v19 → v20: rename the 'text-to-flow' HUD widget to 'auto-chat'.
        // Same rename idiom as v16→v17's 'text-to-pipeline' → 'text-to-flow'
        // just above it in this same function — the one-shot intent→flow
        // widget IS the auto-chat panel the F0 spec calls for (evolved in
        // place with an intent-history list, not duplicated as a second
        // overlapping HUD widget). merge()'s alias below is the defensive
        // backstop for this rename, mirroring the existing 'text-to-pipeline'
        // alias.
        if (version < 20 && persisted && Array.isArray(persisted.hudWidgets)) {
          persisted.hudWidgets = persisted.hudWidgets.map((w: any) =>
            w?.type === 'text-to-flow' ? { ...w, type: 'auto-chat' } : w,
          );
        }

        return persisted ?? {};
      },
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Partial<DesktopStore>;
        const savedWidgets = Array.isArray(persisted.hudWidgets) ? persisted.hudWidgets : [];
        // Reconcile HUD widgets against the canonical defaults: drop unknown/removed
        // types and carry persisted visibility/position by type (aliasing the legacy
        // 'text-to-pipeline' → 'text-to-flow' → 'auto-chat' chain), so no invalid
        // type can ever hydrate and crash the Desktop via WIDGET_META[type].
        const hudWidgets = DEFAULT_HUD_WIDGETS.map((def) => {
          const saved = savedWidgets.find((w) =>
            w?.type === def.type ||
            (def.type === 'auto-chat' && ((w?.type as string) === 'text-to-flow' || (w?.type as string) === 'text-to-pipeline')),
          );
          return saved
            ? {
                ...def,
                visible: saved.visible ?? def.visible,
                position: saved.position ?? def.position,
                ...(saved.size ? { size: saved.size } : {}),
              }
            : def;
        });
        const merged = { ...currentState, ...persisted, hudWidgets };
        // Heal any link/loop misclassification the active board's edges may
        // carry from persisted data predating the orient-connection fix (see
        // normalize-edge-types.ts). Reference-stable when nothing changed.
        merged.mentalEdges = normalizeEdgeTypes(merged.mentalNodes, merged.mentalEdges);
        // Re-seed the (un-persisted) z-index counter above the highest persisted z
        // so newly-focused/created windows always stack on top across sessions.
        const persistedZ = [
          ...merged.windows.map((w) => w.zIndex ?? 0),
          ...merged.attachables.map((a) => a.zIndex ?? 0),
          ...merged.grids.map((g) => g.zIndex ?? 0),
        ];
        merged.nextZIndex = Math.max(merged.nextZIndex, ...persistedZ, 0) + 1;
        return merged;
      },
    }
  )
);

// ─── Step mental attachment selector ─────────────────────────────────────────
//
// Returns the ids of mental nodes (type: 'mental') directly connected to a given
// step node via any mentalEdge (either direction: mental→step or step→mental).
//
// This is the read-side of the "attach mental map to step via xyflow edge" model
// introduced in Req6 Phase 3b. The write-side is the existing onConnect handler
// in MentalGraphCanvas, which calls addMentalEdge for all cross-type connections.
//
// Separate from the chat-window mentalAttachments matrix (attachMentalToWindow /
// DesktopWindow.mentalAttachments), which remains the send-time injection path
// for attaching context to chat messages.
//
export function getStepMentalAttachments(stepId: string): string[] {
  const { mentalNodes, mentalEdges } = useDesktopStore.getState();
  const mentalIdSet = new Set(
    mentalNodes.filter((n) => n.type === 'mental').map((n) => n.id),
  );
  return mentalEdges
    .filter(
      (e) =>
        (e.sourceId === stepId && mentalIdSet.has(e.targetId)) ||
        (e.targetId === stepId && mentalIdSet.has(e.sourceId)),
    )
    .map((e) => (e.sourceId === stepId ? e.targetId : e.sourceId));
}

// ─── M2 selector — agent-linked surface (RENDERER-ONLY) ───────────────────────
//
// Returns the Electron webContentsId of the currently agent-linked web-preview
// window, or null if none is linked. For RENDERER UI use only (e.g. indicating
// which preview is linked).
//
// IMPORTANT: M3's browser toolset runs in the MAIN process and must NOT import
// this store (separate process — it would read empty state). The main-side
// source of truth is `browserController.getActiveAgentSurfaceId()`, kept in sync
// by the 'browser:set-agent-surface' IPC that the link toggle sends.
//
export function getAgentSurfaceWebContentsId(): number | null {
  const { windows } = useDesktopStore.getState();
  const linked = windows.find(
    (w) => w.type === 'web-preview' && w.agentLinked && w.webContentsId != null,
  );
  return linked?.webContentsId ?? null;
}
