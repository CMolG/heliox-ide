/**
 * desktop.ts — Shared types
 *
 * Architecture note:
 * This file follows the explanatory style used across the codebase:
 * explicit intent, clear boundaries, and behavior-preserving structure.
 */
// src/types/desktop.ts — Types for the seamless desktop window system

// ─── CLI Provider Theming ────────────────────────────────────────

export type CliProvider = 'copilot' | 'claude' | 'google' | 'openai' | 'custom';

export const CLI_THEME_COLORS: Record<CliProvider, { accent: string; accentRgb: string; label: string }> = {
  copilot: { accent: '#000000', accentRgb: '0,0,0', label: 'GitHub Copilot' },
  claude:  { accent: '#E87040', accentRgb: '232,112,64', label: 'Claude' },
  google:  { accent: '#4285F4', accentRgb: '66,133,244', label: 'Google' },
  openai:  { accent: '#FFFFFF', accentRgb: '255,255,255', label: 'OpenAI' },
  custom:  { accent: '#888888', accentRgb: '136,136,136', label: 'Custom' },
};

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
  type: 'chat' | 'plugin' | 'file-explorer' | 'backlog' | 'file-viewer' | 'diff-viewer' | 'prompt-dev-zone' | 'design-system-editor';
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
  /** Connected design system (max 1 per window, name from inventory) */
  designSystemId?: string;
  /** For chat windows — the child project path (cwd for agent) */
  childProjectPath?: string;
  /** For file-viewer windows — the absolute file path to display */
  filePath?: string;
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
    | 'mental-shapes-mode'
    | 'mental-lines-mode'
    | 'mental-select-tool'
    | 'mental-ramification-tool'
    | 'prompt-dev-zone'
    | 'design-system-editor'
    | 'grid';
  /** For plugin items — the plugin ID to spawn */
  pluginId?: string;
}

// ─── Plugin / Marketplace ────────────────────────────────────────

export type PluginCategory = 'roles' | 'modifiers' | 'tools' | 'flows' | 'design-systems';

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
  /** For design-systems — micro-preview spec for visual sampling */
  designSystemPreview?: import('./market').MarketDesignSystemPreview;
  /** For design-systems — primary accent color (hex) */
  accentColor?: string;
  /** For design-systems — brand identity card data for rich preview */
  brandIdentityCard?: import('./market').MarketBrandIdentityCard;
}

// ─── Canvas Pan State ────────────────────────────────────────────

export interface CanvasPan {
  x: number;
  y: number;
}

// ─── Desktop Attachable (draggable market items on the canvas) ───

export type AttachableType = 'role' | 'mod' | 'flow' | 'design-system' | 'mental';

export type MentalShape = 'square' | 'circle' | 'triangle';
export type MentalMode = 'off' | MentalShape;
export type MentalTool = 'select' | 'ramification';
export const DEFAULT_MENTAL_COLOR = '#EDE9FE';

export interface MentalAttachableData {
  text: string;
  color: string;
  shape: MentalShape;
  width: number;
  height: number;
}

/** Legacy undirected connection (kept for v6 migration compat). */
export interface MentalConnection {
  id: string;
  fromAttachableId: string;
  toAttachableId: string;
  color: string;
  createdAt: number;
}

// ─── Mental Graph (React Flow surface) ──────────────────────────

export interface MentalGraphNode {
  id: string;
  position: { x: number; y: number };
  width: number;
  height: number;
  text: string;
  color: string;
  shape: MentalShape;
  createdAt: number;
}

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
  mental?: MentalAttachableData;
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
