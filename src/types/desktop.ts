/**
 * desktop.ts — Shared types
 *
 * Architecture note:
 * This file follows the explanatory style used across the codebase:
 * explicit intent, clear boundaries, and behavior-preserving structure.
 */
// src/types/desktop.ts — Types for the seamless desktop window system
import type { MarketMod, MarketRole } from './market';
import type { AgenticStepType } from './harness';

// ─── OpenCode Provider Theming ───────────────────────────────────
//
// `CliProvider` is now an opaque string id matching the provider keys in
// `~/.local/share/opencode/auth.json` (e.g. 'opencode', 'openrouter',
// 'xiaomi-token-plan-ams', 'anthropic'). We keep a small table for theming
// the chat windows; unknown ids fall back to a neutral gray.

export type CliProvider = string;

export interface CliThemeColors { accent: string; accentRgb: string; label: string }

export const CLI_THEME_COLORS: Record<string, CliThemeColors> = {
  opencode:                 { accent: '#FF6B35', accentRgb: '255,107,53',  label: 'OpenCode Zen' },
  'xiaomi-token-plan-ams':  { accent: '#FF5A1F', accentRgb: '255,90,31',   label: 'Xiaomi MiMo (EU)' },
  'xiaomi-token-plan-cn':   { accent: '#E04F2E', accentRgb: '224,79,46',   label: 'Xiaomi MiMo (CN)' },
  openrouter:               { accent: '#7C3AED', accentRgb: '124,58,237',  label: 'OpenRouter' },
  anthropic:                { accent: '#E87040', accentRgb: '232,112,64',  label: 'Anthropic' },
  openai:                   { accent: '#10A37F', accentRgb: '16,163,127',  label: 'OpenAI' },
  google:                   { accent: '#4285F4', accentRgb: '66,133,244',  label: 'Google Gemini' },
  groq:                     { accent: '#F55036', accentRgb: '245,80,54',   label: 'Groq' },
  deepseek:                 { accent: '#1F77FF', accentRgb: '31,119,255',  label: 'DeepSeek' },
  xai:                      { accent: '#0EA5E9', accentRgb: '14,165,233',  label: 'xAI Grok' },
};

export const DEFAULT_CLI_THEME: CliThemeColors = {
  accent: '#9CA3AF', accentRgb: '156,163,175', label: 'Provider',
};

export function getCliTheme(provider: CliProvider | undefined): CliThemeColors {
  if (!provider) return DEFAULT_CLI_THEME;
  return CLI_THEME_COLORS[provider] ?? DEFAULT_CLI_THEME;
}

// ─── Window System ───────────────────────────────────────────────

export interface WindowPosition {
  x: number;
  y: number;
}

export interface WindowSize {
  width: number;
  height: number;
}

export type WindowState = 'normal' | 'minimized' | 'maximized';

export interface DesktopWindow {
  id: string;
  type: 'chat' | 'plugin' | 'file-explorer' | 'backlog' | 'file-viewer' | 'diff-viewer' | 'prompt-dev-zone' | 'web-preview' | 'arena';
  title: string;
  /** Lucide icon name (e.g. 'MessageSquare', 'Terminal') */
  iconName: string;
  position: WindowPosition;
  size: WindowSize;
  zIndex: number;
  state: WindowState;
  /** For chat windows — the associated session ID */
  sessionId?: string;
  /** For chat windows — which CLI provider this window uses */
  cliProvider?: CliProvider;
  /** For plugin windows — the plugin ID */
  pluginId?: string;
  /** Connected market flow (max 1 per window, name from inventory) */
  flowId?: string;
  /** Connected market role (max 1 per window, name from inventory) */
  roleId?: string;
  /** Connected market modifier names (stackable, compatibility-checked) */
  modifierIds: string[];
  /** For chat windows — the child project path (cwd for agent) */
  childProjectPath?: string;
  /** For file-viewer windows — the absolute file path to display */
  filePath?: string;
  /** For web-preview windows — the URL currently loaded in the webview */
  url?: string;
  /** For web-preview windows — the dev-server port this preview is bound to */
  boundPort?: number;
  /** For web-preview windows — true once an agent has been linked for M2 CDP control */
  agentLinked?: boolean;
  /** For web-preview windows — the Electron WebContents id of the guest webview (set post dom-ready, used by M2) */
  webContentsId?: number;
  /** Stored position/size before maximize for restore */
  preMaximizeRect?: { position: WindowPosition; size: WindowSize };
  /** When assigned to a grid cell — the grid ID (window is positioned by the grid) */
  gridId?: string;
  /** When assigned to a grid cell — the origin cell index (row-major, top-left of span) */
  gridCellIndex?: number;
  /** Number of columns this window spans in the grid (default 1) */
  gridColSpan?: number;
  /** Number of rows this window spans in the grid (default 1) */
  gridRowSpan?: number;
  /** Stored position/size before grid-snap for restore on eject */
  preGridRect?: { position: WindowPosition; size: WindowSize };
  /** Creation timestamp */
  createdAt: number;
  /**
   * For chat windows — subgraphs of the mental map attached as context.
   * Each entry is one attachment (list of node ids at attach-time).
   * An empty `nodeIds` array means "the entire mental graph at send-time".
   * Serialized live on each send; we keep only ids, not snapshots.
   */
  mentalAttachments?: MentalAttachment[];
}

export interface MentalAttachment {
  nodeIds: string[];
  attachedAt: number;
}

// ─── Snap Guides ─────────────────────────────────────────────────

export interface SnapGuide {
  axis: 'x' | 'y';
  position: number; // px coordinate on the axis
  type: 'edge' | 'center';
}

// ─── Connections (Automation Arrows) ─────────────────────────────

export type ConnectionPort = 'top' | 'right' | 'bottom' | 'left';

export interface WindowConnection {
  id: string;
  sourceWindowId: string;
  sourcePort: ConnectionPort;
  targetWindowId: string;
  targetPort: ConnectionPort;
}

// ─── Dock ────────────────────────────────────────────────────────

export interface DockItem {
  id: string;
  type: 'action' | 'plugin';
  label: string;
  /** Lucide icon name */
  iconName: string;
  /** For action items — what happens on click */
  action?:
    | 'new-chat'
    | 'marketplace'
    | 'settings'
    | 'file-explorer'
    | 'backlog'
    | 'mental-draw-toggle'
    | 'mental-select-tool'
    | 'mental-ramification-tool'
    | 'prompt-dev-zone'
    | 'grid'
    | 'arena';
  /** For plugin items — the plugin ID to spawn */
  pluginId?: string;
}

// ─── Plugin / Marketplace ────────────────────────────────────────

export type PluginCategory = 'roles' | 'modifiers' | 'tools' | 'flows';

export interface Plugin {
  id: string;
  name: string;
  description: string;
  /** Lucide icon name */
  iconName: string;
  category: PluginCategory;
  author: string;
  /** Whether the plugin is currently installed */
  installed: boolean;
  /** The React component key to render (for built-in plugins) */
  componentKey?: string;
  /** For roles — the role configuration */
  roleConfig?: {
    systemPrompt: string;
    model: string;
    temperature: number;
    maxTokens: number;
  };
  /** For modifiers — behavioral modification description */
  modifierConfig?: {
    promptPrefix: string;
    promptSuffix: string;
    overrides?: Record<string, unknown>;
  };
}

// ─── Canvas Pan State ────────────────────────────────────────────

export interface CanvasPan {
  x: number;
  y: number;
}

// ─── Desktop Attachable (draggable market items on the canvas) ───

export type AttachableType = 'role' | 'mod' | 'flow';

// ─── Mental Graph (xyflow source of truth) ──────────────────────
//
// Mental nodes/edges are first-class entities backed by @xyflow/react.
// The previous "attachable mental card + undirected line" path has been
// removed — everything mental flows through MentalGraphNode/Edge.

export type MentalShape = 'square' | 'circle' | 'triangle';
/** 'off' = read-only mode. Any shape value = authoring with that shape as default. */
export type MentalMode = 'off' | MentalShape;
export type MentalTool = 'select' | 'ramification';
export const DEFAULT_MENTAL_COLOR = '#EDE9FE';

// ─── Mental Graph (React Flow surface) ──────────────────────────

export interface MentalGraphNode {
  id: string;
  type?: 'mental';
  position: { x: number; y: number };
  width: number;
  height: number;
  text: string;
  color: string;
  shape: MentalShape;
  createdAt: number;
}

export interface StepNodeData {
  title: string;
  description?: string;
  prompt?: string;
  roleId?: string;
  modIds?: string[];
  mods: MarketMod[];
  roles: MarketRole[];
  stepType?: AgenticStepType;
  [key: string]: unknown;
}

export interface FrameNodeData {
  title: string;
  description?: string;
  childIds: string[];
  missingCapabilitiesRequested?: string[];
  [key: string]: unknown;
}

export interface StepGraphNode {
  id: string;
  type: 'step';
  parentId?: string;
  position: { x: number; y: number };
  width: number;
  height: number;
  /**
   * Compatibility fields keep existing mental graph consumers stable while
   * StepNode reads from `data`.
   */
  text: string;
  color: string;
  shape: MentalShape;
  data: StepNodeData;
  createdAt: number;
}

export interface FrameGraphNode {
  id: string;
  type: 'frame';
  position: { x: number; y: number };
  width: number;
  height: number;
  text: string;
  color: string;
  shape: MentalShape;
  data: FrameNodeData;
  createdAt: number;
}

export type CanvasGraphNode = MentalGraphNode | StepGraphNode | FrameGraphNode;

export interface MentalGraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  sourceHandle?: string;
  targetHandle?: string;
  type: 'ramification' | 'link';
  color: string;
  createdAt: number;
}

export interface DesktopAttachable {
  id: string;
  type: AttachableType;
  /** Name matching the inventory.json item (e.g. 'frontend-engineer') */
  name: string;
  position: WindowPosition;
  zIndex: number;
}

// ─── Desktop Grid (top-level layout container on the canvas) ─────

export interface DesktopGrid {
  id: string;
  /** Optional user-defined title. Defaults to "Grid {columns}×{rows}" if empty. */
  title?: string;
  position: WindowPosition;
  size: WindowSize;
  zIndex: number;
  /** Number of columns in the grid layout */
  columns: number;
  /** Number of rows in the grid layout */
  rows: number;
  /** Ordered cell assignments — each element is a window ID or null (empty cell).
   *  Length = columns × rows. Index maps to row-major order. */
  cells: (string | null)[];
  /** Creation timestamp */
  createdAt: number;
}

// ─── Desktop Store State ─────────────────────────────────────────
