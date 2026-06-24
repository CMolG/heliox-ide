/**
 * desktop-store.ts — Renderer UI
 *
 * Architecture note:
 * This file follows the explanatory style used across the codebase:
 * explicit intent, clear boundaries, and behavior-preserving structure.
 */
// src/renderer/store/desktop-store.ts — Zustand store for seamless desktop state
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { CLI_THEME_COLORS } from '@/types/desktop';
import type {
  DesktopWindow, WindowPosition, WindowSize, WindowConnection,
  DockItem, Plugin, PluginCategory, SnapGuide, CliProvider, ConnectionPort, CanvasPan,
  DesktopAttachable, AttachableType, DesktopGrid, MentalMode, MentalShape,
  MentalTool, MentalGraphNode, MentalGraphEdge, StepGraphNode, CanvasGraphNode, FrameGraphNode,
} from '@/types/desktop';
import type { MarketInventory, MarketMod, MarketRole, BacklogCard } from '@/types/market';
import type { TutorialScenarioId, TutorialProgress } from '@/types/tutorial';
import type { PipelineAssembly } from '@/types/meta-agent';


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
  { id: 'dock-new-chat', type: 'action', label: 'New Chat', iconName: 'MessageSquare', action: 'new-chat' },
  { id: 'dock-file-explorer', type: 'action', label: 'Files', iconName: 'FileText', action: 'file-explorer' },
  { id: 'dock-backlog', type: 'action', label: 'Backlog', iconName: 'KanbanSquare', action: 'backlog' },
  { id: 'dock-grid', type: 'action', label: 'Grid', iconName: 'LayoutGrid', action: 'grid' },
  { id: 'dock-mental-draw-toggle', type: 'action', label: 'Mental', iconName: 'PenTool', action: 'mental-draw-toggle' },
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
    author: 'Heliox', installed: true, componentKey: 'flows-editor',
  },
  {
    id: 'tool-actions', name: 'Actions', iconName: 'Zap', category: 'tools',
    description: 'Predefined orchestration prompts for systematic analysis',
    author: 'Heliox', installed: true, componentKey: 'actions-panel',
  },
  {
    id: 'tool-logs', name: 'Logs Viewer', iconName: 'ScrollText', category: 'tools',
    description: 'View application and agent logs',
    author: 'Heliox', installed: true, componentKey: 'logs-panel',
  },
  {
    id: 'tool-terminal', name: 'Terminal Output', iconName: 'Terminal', category: 'tools',
    description: 'Agent reasoning, tool calls, and raw CLI output',
    author: 'Heliox', installed: true, componentKey: 'terminal-panel',
  },
];

// ─── Constants ───────────────────────────────────────────────────

const DEFAULT_WINDOW_SIZE: WindowSize = { width: 480, height: 500 };
const MIN_WINDOW_SIZE: WindowSize = { width: 320, height: 250 };
const SNAP_THRESHOLD = 8; // px
const DEFAULT_MENTAL_WIDTH = 220;
const DEFAULT_MENTAL_HEIGHT = 120;
const DEFAULT_MENTAL_EDGE_COLOR = '#7C3AED';
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

  // Flow connectors (max 1 per window)
  connectFlow: (windowId: string, flowName: string) => boolean;
  disconnectFlow: (windowId: string) => void;

  // Market Inventory
  marketInventory: MarketInventory | null;
  setMarketInventory: (inventory: MarketInventory) => void;
  getModIncompatibilities: (modName: string) => string[];

  // Backlog
  backlogCards: BacklogCard[];
  setBacklogCards: (cards: BacklogCard[]) => void;

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
  /** Drop an attachable onto a chat window — attaches and removes from canvas */
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

  // Canvas pan + zoom
  canvasPan: CanvasPan;
  setCanvasPan: (pan: CanvasPan) => void;
  canvasZoom: number;
  setCanvasZoom: (zoom: number) => void;
  /** xyflow authoring gate — 'off' = read-only; otherwise the default shape for new nodes. */
  mentalMode: MentalMode;
  setMentalMode: (mode: MentalMode) => void;

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
  removeMentalNode: (nodeId: string) => void;
  addMentalEdge: (sourceId: string, targetId: string, edgeType?: MentalGraphEdge['type'], sourceHandle?: string, targetHandle?: string) => string | null;
  removeMentalEdge: (edgeId: string) => void;
  updateMentalEdgeColor: (edgeId: string, color: string) => void;
  createRamificationFromDrop: (sourceId: string, flowPosition: { x: number; y: number }) => { nodeId: string; edgeId: string } | null;

  // ─── Mental Graph selection (mirrors xyflow's selected nodes) ─
  selectedMentalNodeIds: string[];
  setSelectedMentalNodeIds: (ids: string[]) => void;

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

  // Design Guidelines
  designGuidelineId: number | null;
  setDesignGuideline: (id: number | null) => void;

  // Settings
  settings: {
    canvasClickAnimation: boolean;
    tourCompleted: boolean;
    tutorialCompleted: TutorialProgress;
  };
  updateSettings: (patch: Partial<DesktopStore['settings']>) => void;

  // Tutorial engine state (not persisted — active scenario lives in-memory)
  activeTutorial: TutorialScenarioId | null;
  setActiveTutorial: (id: TutorialScenarioId | null) => void;

  /** Pan the canvas so a given window is centered in the viewport */
  navigateToWindow: (windowId: string) => void;

  // Project picker modal (for new chat creation)
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

      addWindow: (type, opts) => {
        const state = get();
        const id = `win-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const position = opts?.position ?? getViewportCenteredSpawnPosition(state.canvasPan, state.canvasZoom);
        const size = opts?.size ?? DEFAULT_WINDOW_SIZE;
        const zIndex = state.nextZIndex;
        const cliProv = opts?.cliProvider ?? state.cliProvider;
        const defaultTitle = type === 'chat'
          ? (CLI_THEME_COLORS[cliProv]?.label ?? cliProv)
          : type === 'file-explorer' ? 'Files'
          : type === 'backlog' ? 'Backlog'
          : type === 'file-viewer' ? (opts?.title ?? 'File')
          : type === 'diff-viewer' ? (opts?.title ?? 'Diff Viewer')
          : type === 'prompt-dev-zone' ? 'Prompt Dev Zone'
          : type === 'web-preview' ? (opts?.title ?? 'Preview')
          : 'Plugin';
        const defaultIcon = type === 'chat'
          ? CLI_ICON_NAMES[cliProv]
          : type === 'file-explorer' ? 'FileText'
          : type === 'backlog' ? 'KanbanSquare'
          : type === 'file-viewer' ? 'FileCode2'
          : type === 'diff-viewer' ? 'GitCompareArrows'
          : type === 'prompt-dev-zone' ? 'FlaskConical'
          : type === 'web-preview' ? 'Globe'
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
          cliProvider: type === 'chat' ? cliProv : undefined,
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
        const z = s.nextZIndex;
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
      connectFlow: (windowId, flowName) => {
        const win = get().windows.find(w => w.id === windowId);
        if (!win || win.type !== 'chat') return false;
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
            author: 'Heliox Market',
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
            author: 'Heliox Market',
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
            author: 'Heliox Market',
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
        };
        const attachableType = typeMap[plugin.category];
        if (attachableType) {
          // Extract inventory name from plugin id (e.g. 'inv-role-frontend-engineer' → 'frontend-engineer')
          let inventoryName = pluginId;
          if (pluginId.startsWith('inv-role-')) inventoryName = pluginId.replace('inv-role-', '');
          else if (pluginId.startsWith('inv-mod-')) inventoryName = pluginId.replace('inv-mod-', '');
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
        if (!att || !win || win.type !== 'chat') return false;

        // Flows are independent — they cannot be linked to windows.
        if (att.type === 'flow') return false;

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
            window.dispatchEvent(new CustomEvent('heliox:canvas-wave', {
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
        set((s) => ({ mentalNodes: [...s.mentalNodes, node] }));
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
          },
          createdAt: Date.now(),
        };
        set((s) => ({ mentalNodes: [...s.mentalNodes, node] }));
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

        set((s) => ({
          mentalNodes: [...s.mentalNodes, frameNode, ...stepNodes],
          mentalEdges: [...s.mentalEdges, ...edges],
          selectedMentalNodeIds: [frameId],
          mentalEditingNodeId: null,
        }));

        return { frameId, stepIds };
      },

      addModToStep: (stepId, modData) => {
        let didAdd = false;
        const modId = marketEntityId(modData);
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
        let didAdd = false;
        const roleId = marketEntityId(roleData);
        set((s) => ({
          mentalNodes: s.mentalNodes.map((node) => {
            if (node.id !== stepId || !isStepGraphNode(node)) return node;
            if (node.data.roles.some((role) => marketEntityId(role) === roleId)) return node;
            didAdd = true;
            return {
              ...node,
              data: {
                ...node.data,
                roles: [...node.data.roles, { ...roleData }],
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

      addMentalEdge: (sourceId, targetId, edgeType = 'link', sourceHandle, targetHandle) => {
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

      // Design Guidelines
      designGuidelineId: null,
      setDesignGuideline: (id) => set({ designGuidelineId: id }),

      // Settings
      settings: {
        canvasClickAnimation: true,
        tourCompleted: false,
        tutorialCompleted: {},
      },
      updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

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
        set({ canvasPan: { x: centerX, y: centerY } });
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
    }),
    {
      name: 'heliox-desktop',
      version: 13,
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
        designGuidelineId: state.designGuidelineId,
        settings: state.settings,
        fileExplorerStates: state.fileExplorerStates,
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

        return persisted ?? {};
      },
    }
  )
);

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
