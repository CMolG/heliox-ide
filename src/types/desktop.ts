/**
 * desktop.ts — Shared types
 *
 * Architecture note:
 * This file follows the explanatory style used across the codebase:
 * explicit intent, clear boundaries, and behavior-preserving structure.
 */
// src/types/desktop.ts — Types for the seamless desktop window system
import type { MarketMod, MarketRole } from './market';
import type { AgenticStepType, StepContract } from './harness';

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
  /**
   * 'chat' retired (chats→steps re-architecture, F0 decision 2, 2026-07-10):
   * general chat is no longer a window surface — code-editing work happens
   * through launched steps, and the single automation chat lives outside the
   * window system entirely (HudAutoChatPanel, a fixed HUD panel). Boards
   * persisted before this change may still contain serialized 'chat'
   * windows; desktop-store's v19 migration drops them (tombstone + user
   * notification) before they ever reach this type, so no live window can
   * have this shape — see the migrate() comment for the full contract.
   */
  type: 'plugin' | 'file-explorer' | 'backlog' | 'file-viewer' | 'diff-viewer' | 'prompt-dev-zone' | 'web-preview' | 'arena' | 'agent-session';
  title: string;
  /** Lucide icon name (e.g. 'MessageSquare', 'Terminal') */
  iconName: string;
  position: WindowPosition;
  size: WindowSize;
  zIndex: number;
  state: WindowState;
  /** Legacy — was chat windows' associated session ID ('chat' type retired above). Vestigial; no surviving window type sets this. */
  sessionId?: string;
  /** Legacy — was which CLI provider a chat window used ('chat' type retired above). Vestigial; no surviving window type sets this. */
  cliProvider?: CliProvider;
  /** For plugin windows — the plugin ID */
  pluginId?: string;
  /** Connected market flow (max 1 per window, name from inventory) */
  flowId?: string;
  /** Connected market role (max 1 per window, name from inventory) */
  roleId?: string;
  /** Connected market modifier names (stackable, compatibility-checked) */
  modifierIds: string[];
  /** Legacy — was chat windows' child project path/cwd ('chat' type retired above). Vestigial; no surviving window type sets this. */
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
   * Legacy — was chat windows' subgraphs of the mental map attached as
   * context ('chat' type retired above). Vestigial; no surviving window
   * type sets this. Each entry is one attachment (list of node ids at
   * attach-time); an empty `nodeIds` array meant "the entire mental graph
   * at send-time".
   */
  mentalAttachments?: MentalAttachment[];
  /**
   * For 'agent-session' windows — everything the Cockpit knows about the
   * vendor CLI running in this window's terminal. Additive and optional, so a
   * board persisted before F1 rehydrates untouched (no store migration).
   *
   * NOT to be confused with the vestigial `sessionId`/`cliProvider`/
   * `childProjectPath` above: those are dead fields from the retired 'chat'
   * type and stay dead — an agent session's identity lives in here.
   */
  agentSession?: AgentSessionMeta;
}

// ─── Agent sessions (Cockpit F1) ─────────────────────────────────

/** The four vendor CLIs an agent session can host. Mirrors `src/main/pty/vendors.ts`. */
export type AgentVendorId = 'claude' | 'codex' | 'opencode' | 'gemini';

/**
 * What the session window is doing, in a word. Rendered as TEXT, never as
 * colour alone — a badge whose only channel is hue says nothing to a colour
 * blind reader and nothing at all in a screenshot.
 *
 *  - 'preparing'    — F2: creating the git worktree and its branch
 *  - 'bootstrapping'— F2: installing dependencies inside that worktree
 *  - 'starting'     — spawned, no output yet
 *  - 'running'      — producing output
 *  - 'waiting'      — declared here for F4's attention signal (Stop/Notification
 *                     hooks); nothing sets it yet
 *  - 'ended'        — the process exited; `exitCode` says how
 */
export type AgentSessionAttention =
  | 'preparing' | 'bootstrapping' | 'starting' | 'running' | 'waiting' | 'ended';

export interface AgentSessionMeta {
  /** Correlates the window with its PTY in the main process, and names its log file. */
  sessionId: string;
  vendor: AgentVendorId;
  /**
   * Working directory the CLI is spawned in. For an attached session this is
   * `projectRoot`; for a worktree session it becomes the worktree's path once
   * the worktree exists.
   */
  cwd: string;
  /**
   * The PROJECT this session belongs to, whatever directory it ends up running
   * in. Required: the "one attached session per project" rule is counted per
   * project, and a session that cannot say which project it is in cannot be
   * counted. Windows persisted by F1 get `projectRoot = cwd` in the v21 → v22
   * migration, which is exactly right for them — F1 only opened attached
   * sessions.
   */
  projectRoot: string;
  /** 'attached' = the main tree; 'worktree' = a dedicated git worktree (F2). */
  mode: 'attached' | 'worktree';
  // ── F2 (worktrees) fills these ──
  worktreePath?: string;
  /** Directory name under `.claude/worktrees/`, kept so a retry rebuilds the same one. */
  worktreeName?: string;
  branch?: string;
  /** The ref the branch was actually cut from — `origin/main`, or a local fallback. */
  baseRef?: string;
  /** True once the worktree exists AND its bootstrap is settled: the gate the PTY waits on. */
  worktreeReady?: boolean;
  /** `0` clean, non-zero failed, `null`/absent not run. Not the AGENT's exit code. */
  bootstrapExitCode?: number | null;
  // ── F3 (card → session) fills these ──
  cardId?: string;
  backlogDir?: string;
  cardFilename?: string;
  /** First prompt handed to the agent (by argv or typed — see the vendor registry). */
  prompt?: string;
  launchedAt: number;
  /**
   * True once a PTY has been spawned for this window. It is the single guard
   * against a double spawn under React 19 StrictMode's double mount and under
   * HMR, and it is also why a REHYDRATED window (persisted, app restarted)
   * reads `true` with no live PTY: the component reconciles that against
   * `ptyList()` on mount and renders the ended state.
   */
  ptyStarted: boolean;
  exitCode?: number | null;
  logPath?: string;
  attention: AgentSessionAttention;
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
    | 'arena'
    | 'new-step'
    | 'new-flow'
    | 'new-agent-session';
  /** For plugin items — the plugin ID to spawn */
  pluginId?: string;
}

// ─── Plugin / Marketplace ────────────────────────────────────────

export type PluginCategory = 'roles' | 'modifiers' | 'tools' | 'flows' | 'steps';

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

export type AttachableType = 'role' | 'mod' | 'flow' | 'step';

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
  /** Optional free-form labels for search/organization; flows through to AgenticFlow.tags. */
  tags?: string[];
  /** Optional flow author; flows through to AgenticFlow.author. */
  author?: string;
  /** Optional user-defined flow version; flows through to AgenticFlow.version. */
  version?: string;
  /**
   * Per-flow execution mode for the Rosetta context system; flows through to
   * AgenticFlow.contextMode. Absent (today's default) or `'blind'` means zero
   * cross-step context awareness and zero side effects — see
   * `AgenticFlow.contextMode`'s doc (src/types/harness.ts) for the full
   * contract and docs/superpowers/specs/2026-07-10-rosetta-context-manifest.md
   * for the spec.
   */
  contextMode?: 'blind' | 'feedback';
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

/**
 * Canvas data for a Phase node — the second nesting level, frame > phase >
 * step (spec docs/superpowers/specs/2026-07-21-agentic-phase-model.md §3.2).
 * `exitContract`/`onError` mirror AgenticPhase 1:1 but have no dedicated
 * visual editor yet in this spike (F2) — same status quo as AgenticStep's
 * own `contract` field, which also has no canvas UI today; both are
 * authorable via import/programmatic construction and simply travel through
 * this shape once set.
 */
export interface PhaseNodeData {
  title: string;
  description?: string;
  exitContract?: StepContract;
  onError?: 'halt';
  /** Member step ids — mirrors FrameNodeData.childIds; the authoritative membership list the compiler reads (Task 4), not derived from scanning every step's parentId. */
  childIds: string[];
  [key: string]: unknown;
}

export interface PhaseGraphNode {
  id: string;
  type: 'phase';
  /** The owning Frame — SIEMPRE presente, a phase never floats (spec §3.2). */
  parentId: string;
  position: { x: number; y: number };
  width: number;
  height: number;
  text: string;
  color: string;
  shape: MentalShape;
  data: PhaseNodeData;
  createdAt: number;
}

export type CanvasGraphNode = MentalGraphNode | StepGraphNode | FrameGraphNode | PhaseGraphNode;

export interface MentalGraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  sourceHandle?: string;
  targetHandle?: string;
  type: 'ramification' | 'link' | 'loop';
  /** Loop-back edges only: total passes of the loop body (clamped 1..50 by the compiler). */
  maxIterations?: number;
  color: string;
  createdAt: number;
}

// ─── Boards (Figma-like multiple canvases) ────────────────────────
//
// Each Board is an independent "pizarra": its own mental graph + viewport.
// Windows, attachables, grids, and the dock are NOT board-scoped — they stay
// global across every board. See the "ACTIVE-SLICE PATTERN" section comment
// above the `boards` field in desktop-store.ts for how `snapshot` relates to
// the store's top-level mentalNodes/mentalEdges/canvasPan/canvasZoom slices.

/** The graph + viewport state owned by one board. */
export interface BoardSnapshot {
  mentalNodes: CanvasGraphNode[];
  mentalEdges: MentalGraphEdge[];
  canvasPan: CanvasPan;
  canvasZoom: number;
}

export interface Board {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /**
   * Authoritative ONLY while this board is inactive; null/stale for the
   * active board (see active-slice pattern). Written only at switch time
   * (createBoard/switchBoard/deleteBoard), from the live top-level slices
   * of the board being deactivated.
   */
  snapshot: BoardSnapshot | null;
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
