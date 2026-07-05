/**
 * index.ts — Shared types
 *
 * Architecture note:
 * This file follows the explanatory style used across the codebase:
 * explicit intent, clear boundaries, and behavior-preserving structure.
 */
// src/types/index.ts — Heliox IDE shared types
import type { AgenticFlow } from './harness';
import type { HarnessEventPayload, ModelPolicy } from './ipc-events';
import type { PipelineAssembly } from './meta-agent';

export interface PerformanceMetrics {
  lcp: number;            // Largest Contentful Paint (ms)
  inp: number;            // Interaction to Next Paint (ms)
  cls: number;            // Cumulative Layout Shift (score 0-1)
  tbt: number;            // Total Blocking Time (ms)
  ttfb: number;           // Time to First Byte (ms)
  jsHeapMB: number;       // JS heap usage in MB
  requestCount: number;   // Number of network requests
  transferKB: number;     // Total transfer size in KB
  renderBlockingCount: number; // Render-blocking resources
}

export interface SnapshotArtifact {
  id: string;
  stepId: string;
  flowId: string;
  timestamp: number;
  screenshotBase64: string;
  metrics: PerformanceMetrics;
  url: string;
  domHash: string;        // SHA-256 of serialized DOM
}

export interface SnapshotDiff {
  stepId: string;
  before: SnapshotArtifact;
  after: SnapshotArtifact;
  visualDiffBase64: string;
  visualDiffPercent: number;
  metricsDelta: MetricsDelta;
  impactScore: number;    // -100 to +100
  severity: 'ok' | 'warning' | 'block' | 'escalate';
}

export interface MetricsDelta {
  lcp: MetricChange;
  inp: MetricChange;
  cls: MetricChange;
  tbt: MetricChange;
  jsHeapMB: MetricChange;
  requestCount: MetricChange;
}

export interface MetricChange {
  before: number;
  after: number;
  deltaPct: number;
  status: 'improved' | 'neutral' | 'degraded' | 'critical';
}

export interface FlowStep {
  id: string;
  name: string;
  action: 'navigate' | 'click' | 'type' | 'screenshot' | 'wait' | 'scroll';
  target?: string;      // CSS selector or URL
  value?: string;
  snapshot?: SnapshotArtifact;
}

export interface DiffDecision {
  stepId: string;
  action: 'approved' | 'rejected';
  timestamp: number;
  impactScore: number;
  severity: SeverityLevel;
  rejectionReason?: string;
}

export interface DiffRecord {
  flowId: string;
  stepId: string;
  before: string;   // base64 screenshot
  after: string;     // base64 screenshot
  approved: boolean;
  timestamp: number;
  beforeThumb?: string; // lightweight thumbnail (future use)
  afterThumb?: string;  // lightweight thumbnail (future use)
}

export interface Flow {
  id: string;
  name: string;
  baseUrl: string;
  steps: FlowStep[];
  diffHistory?: DiffDecision[];
}

// AI adapter structured output (JSONL)
// Raw event from any AI adapter's output stream
export interface AiOutputEvent {
  type: string;
  data?: Record<string, unknown>;
  id?: string;
  timestamp?: string;
  parentId?: string;
  ephemeral?: boolean;
  sessionId?: string;
  exitCode?: number;
  usage?: Record<string, unknown>;
}

/** The only supported AI adapter — OpenCode handles every provider. */
export type AiAdapterName = 'opencode';

// Normalized event types we care about
// Feedback payload sent back to the agent for auto-correction
export interface AgentFeedbackPayload {
  snapshotDiff: SnapshotDiff;
  violations: MetricViolation[];
  instruction: string;
  attemptNumber: number;
}

export interface MetricViolation {
  metric: keyof PerformanceMetrics;
  before: number;
  after: number;
  deltaPct: number;
  threshold: number;
  likelyCause: string;
}

// ─── App Settings ───────────────────────────────────────────────

export interface AppSettings {
  /** Pinned to 'opencode' — kept on the schema so callers can stay generic. */
  aiAdapter: AiAdapterName;
  /** Provider id selected in the picker (matches auth.json key). */
  selectedProvider: string;
  /** Full `provider/model` string passed to `opencode run --model`. */
  selectedModel: string;
  autoCommit: boolean;
  runE2E: boolean;
  sendOnEnter: boolean;
  onboardingDone: boolean;
  effort: 'low' | 'medium' | 'high' | 'xhigh';
  /** When true (default), wraps prompts with the Gaussian bell-curve quality override */
  stupidityMode: boolean;
}

// ─── Session & UI Types ─────────────────────────────────────────

export type SessionStatus = 'running' | 'waiting' | 'completed' | 'error' | 'stopped';
export type NavTab = 'sessions' | 'flows' | 'roles' | 'actions' | 'logs';
export type BottomPanel = 'none' | 'terminal' | 'logs';
export type DiffViewMode = 'visual' | 'code' | 'history' | 'files';

export interface Role {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  model: string;
  temperature: number;
  maxTokens: number;
  icon: string;
  createdAt: number;
}

export interface LogEntry {
  id: string;
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'system';
  sessionId?: string;
  message: string;
}

export interface Session {
  id: string;
  number: number;
  status: SessionStatus;
  description: string;
  model: string;
  roleId?: string;
  projectId?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  endedAt?: number;
  messages: ChatMessage[];
  /** OpenCode session id used to resume a conversation (`--session`). */
  opencodeSessionId?: string;
  tokenUsage?: {
    premiumRequests?: number;
    totalTokens?: number;
    totalApiDurationMs?: number;
  };
  effort?: 'low' | 'medium' | 'high' | 'xhigh';
}

export interface AgentConfig {
  id: string;
  role: string;
  instruction: string;
  status: 'idle' | 'running' | 'autocorrecting' | 'done' | 'failed';
  currentAttempt: number;
  maxAttempts: number;
}

export type SeverityLevel = 'ok' | 'warning' | 'block' | 'escalate';

// ─── IPC Contract ────────────────────────────────────────────────

export interface RunAgentParams {
  agentId: string;
  instruction: string;
  flows: Flow[];
  cwd: string;
  /** Project path used by context-map persistence/injection (defaults to cwd) */
  contextProjectPath?: string;
  model?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh';
  resumeSessionId?: string;
  /** Reserved for the IPC contract — only 'opencode' is honored. */
  aiAdapter?: AiAdapterName;
  autoCommit?: boolean;
  runE2E?: boolean;
  /** Role system prompt content (injected by renderer from market/store) */
  rolePrompt?: string;
  /** Modifier prompt contents (injected by renderer from market/store) */
  modPrompts?: string[];
  /** Session role id used for context-map digest ranking */
  roleId?: string;
  /** Active directives to inject by mode */
  attachedDirectives?: {
    system?: string;
    prefix?: string;
    suffix?: string;
  };
  /** Context map digest to inject in prompt constraints */
  contextDigest?: string;
}

export interface IpcResult {
  success: boolean;
  diffId?: string;
  feedback?: string;
  error?: string;
}

export type AgentEventType = 'started' | 'file-changed' | 'running-e2e' | 'autocorrecting' | 'message-delta' | 'thinking-delta' | 'message' | 'tool-use' | 'tool-result' | 'result' | 'diffs-ready' | 'raw-output' | 'error';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

let _sysMsgCounter = 0;

export function sysMsg(prefix: string, content: string): ChatMessage {
  return {
    id: `sys-${prefix}-${Date.now()}-${++_sysMsgCounter}`,
    role: 'system',
    content,
    timestamp: Date.now(),
  };
}

export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export interface AgentEvent {
  type: AgentEventType;
  agentId: string;
  attempt?: number;
  diffs?: SnapshotDiff[];
  violations?: MetricViolation[];
  path?: string;
  patch?: string;
  error?: string;
  content?: string;
  tool?: string;
  args?: unknown;
  result?: string;
  messageId?: string;
  outputTokens?: number;
  exitCode?: number;
  usage?: unknown;
  sessionId?: string;
  premiumRequests?: number;
  totalApiDurationMs?: number;
  linesAdded?: number;
  linesRemoved?: number;
  rawLine?: string;
}

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface CliStatus {
  opencodeInstalled: boolean;
  opencodeVersion: string | null;
  nodeInstalled: boolean;
  gitInstalled: boolean;
}

/** Provider metadata exposed to the renderer for the picker. */
export interface OpencodeProvider {
  id: string;
  label: string;
  description: string;
  accent: string;
  authorized: boolean;
  authHint?: string;
  keyPrefix?: string;
}

export interface GitStatusInfo {
  branch: string;
  modified: number;
  staged: number;
  untracked: number;
}

export interface HelioxAPI {
  initBaselines: (flows: Flow[]) => Promise<IpcResult>;
  runAgent: (params: RunAgentParams) => Promise<IpcResult>;
  /**
   * Dispatch an `AgenticFlow` for execution. `options.modelPolicy` opts the run
   * into WS2 smart routing (`smart-local` / `smart-external`); omitted or
   * `{mode:'fixed'}` keeps today's behavior. `options.modelId` is the flow's
   * own already-resolved model (e.g. the Arena "deploy" choice) — the router
   * outranks it, which itself is outranked by any step's own manual override.
   */
  startHarness: (flow: AgenticFlow, options?: { modelPolicy?: ModelPolicy; modelId?: string }) => Promise<IpcResult>;
  exportFlow: (flow: AgenticFlow) => Promise<{ success: boolean; path?: string; canceled?: boolean; error?: string }>;
  assemblePipeline: (userIntent: string) => Promise<{ success: boolean; data?: PipelineAssembly; error?: string }>;
  readMarketInventory: (projectPath: string) => Promise<import('./market').MarketInventory | null>;
  readMarketPrompt: (projectPath: string, category: string, name: string) => Promise<string | null>;
  readBacklog: (projectPath: string) => Promise<import('./market').BacklogCard[]>;
  scanBacklogs: (projectsPath: string) => Promise<Array<{
    projectPath: string;
    projectName: string;
    backlogPath: string;
    cardCount: number;
    isExternal: boolean;
  }>>;
  listProjectsWithoutBacklog: (projectsPath: string) => Promise<Array<{
    projectPath: string;
    projectName: string;
  }>>;
  initBacklog: (projectPath: string) => Promise<{ success: boolean; backlogPath?: string; error?: string }>;
  updateBacklogCardStatus: (backlogDir: string, filename: string, newStatus: string) => Promise<{ success: boolean; error?: string }>;
  updateBacklogCards: (backlogDir: string, updates: Array<{ filename: string; status?: string; order?: number }>) => Promise<{ success: boolean; error?: string }>;
  readBacklogDir: (backlogDir: string) => Promise<import('./market').BacklogCard[]>;
  approveDiff: (diffId: string) => Promise<IpcResult>;
  rejectDiff: (diffId: string, feedback: string) => Promise<IpcResult>;
  shutdown: () => Promise<IpcResult>;
  onAgentEvent: (callback: (event: AgentEvent) => void) => () => void;
  onHarnessEvent: (callback: (event: HarnessEventPayload) => void) => () => void;
  openFolderDialog: () => Promise<string | null>;
  readDirectory: (dirPath: string) => Promise<FileEntry[]>;
  checkCli: () => Promise<CliStatus>;
  getProjectName: (projectPath: string) => Promise<string>;
  readProjectConfig: (projectPath: string, filename: string) => Promise<string | null>;
  writeProjectConfig: (projectPath: string, filename: string, content: string) => Promise<boolean>;
  readFile: (filePath: string) => Promise<string | null>;
  logResult: (projectPath: string, row: {
    commit: string;
    target: string;
    status: string;
    lcpDelta: string;
    visualDiffPct: string;
    description: string;
  }) => Promise<boolean>;
  gitStatus: (cwd: string) => Promise<{ clean: boolean; files: string[] }>;
  gitStatusInfo: (cwd: string) => Promise<GitStatusInfo>;
  gitDiffSummary: (cwd: string) => Promise<string>;
  gitDiff: (cwd: string) => Promise<string>;
  gitDiffFiles: (cwd: string, files: string[]) => Promise<string>;
  gitShowFile: (cwd: string, filePath: string) => Promise<string | null>;
  gitBranches: (cwd: string) => Promise<{ current: string; branches: string[] }>;
  gitCheckout: (cwd: string, branch: string, create?: boolean) => Promise<{ success: boolean; error?: string }>;
  gitFetch: (cwd: string) => Promise<{ success: boolean; error?: string }>;
  gitPull: (cwd: string) => Promise<{ success: boolean; error?: string }>;
  gitFileStatuses: (cwd: string) => Promise<Array<{ path: string; status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' }>>;
  gitCommit: (cwd: string, message: string) => Promise<{ success: boolean; hash?: string; error?: string }>;
  gitReset: (cwd: string) => Promise<boolean>;
  stopAgent: (agentId: string) => Promise<boolean>;
  showNotification: (opts: { title: string; body: string }) => Promise<void>;
  openFileDialog: (cwd: string) => Promise<string | null>;
  listModels: () => Promise<string[]>;
  invalidateModelsCache: () => Promise<void>;
  // ── OpenCode providers ─────────────────────────────────────────
  opencodeListProviders: () => Promise<OpencodeProvider[]>;
  opencodeListProviderModels: (providerId: string) => Promise<string[]>;
  opencodeSaveCredential: (providerId: string, key: string) => Promise<{ success: boolean; error?: string }>;
  opencodeRemoveCredential: (providerId: string) => Promise<{ success: boolean; error?: string }>;
  opencodeStatus: () => Promise<{ installed: boolean; version: string | null; path: string | null }>;

  // ── Provider Connections (DBeaver-style, Phase 6) ───────────────
  // Replaces the old opencode-backed provider-picker UI (see ConnectionsSection.tsx).
  providerConnectionsList: () => Promise<{ success: boolean; data?: import('./ipc-events').ProviderConnection[]; error?: string }>;
  providerConnectionsCreate: (
    input: import('./ipc-events').ProviderConnectionInput,
  ) => Promise<{ success: boolean; data?: import('./ipc-events').ProviderConnection; error?: string }>;
  providerConnectionsUpdate: (
    id: string,
    patch: import('./ipc-events').ProviderConnectionUpdate,
  ) => Promise<{ success: boolean; data?: import('./ipc-events').ProviderConnection; error?: string }>;
  providerConnectionsDelete: (id: string) => Promise<{ success: boolean; error?: string }>;
  providerConnectionsSetModelEnabled: (
    id: string,
    modelId: string,
    enabled: boolean,
  ) => Promise<{ success: boolean; data?: import('./ipc-events').ProviderConnection; error?: string }>;
  providerConnectionsTest: (
    request: import('./ipc-events').ConnectionTestRequest,
  ) => Promise<import('./ipc-events').ConnectionTestResponse>;

  getConfigDir: (projectPath: string) => Promise<string>;
  listProjectFiles: (projectPath: string) => Promise<string[]>;
  saveFile: (defaultPath: string, content: string) => Promise<boolean>;
  writeFile: (filePath: string, content: string) => Promise<boolean>;
  createFile: (filePath: string) => Promise<boolean>;
  createDirectory: (dirPath: string) => Promise<boolean>;
  deleteFile: (filePath: string) => Promise<boolean>;
  deleteDirectory: (dirPath: string) => Promise<boolean>;
  renamePath: (oldPath: string, newPath: string) => Promise<boolean>;

  // Context Map
  contextMapGetAll: (projectPath: string) => Promise<import('./context-map').ContextMap>;
  contextMapUpsertNode: (
    projectPath: string,
    node: Partial<import('./context-map').ContextMapNode> & Pick<import('./context-map').ContextMapNode, 'label' | 'type'>,
  ) => Promise<import('./context-map').ContextMapNode>;
  contextMapDeleteNode: (projectPath: string, nodeId: string) => Promise<void>;
  contextMapUpsertEdge: (
    projectPath: string,
    edge: Partial<import('./context-map').ContextMapEdge> & Pick<import('./context-map').ContextMapEdge, 'from' | 'to'>,
  ) => Promise<import('./context-map').ContextMapEdge>;
  contextMapDeleteEdge: (projectPath: string, edgeId: string) => Promise<void>;
  contextMapSearch: (projectPath: string, query: string) => Promise<import('./context-map').ContextMapNode[]>;
  contextMapExportText: (
    projectPath: string,
    opts?: { roleId?: string; sessionId?: string; limit?: number },
  ) => Promise<string>;
  contextMapUpsertSessionNode: (
    projectPath: string,
    payload: { sessionId: string; label: string; status: 'running' | 'completed' | 'stopped'; roleId?: string },
  ) => Promise<import('./context-map').ContextMapNode>;
  contextMapPresetAttachables: () => Promise<import('./context-map').AttachablePreset[]>;

  attachableAttach: (
    projectPath: string,
    req: { attachableId: string; sessionId: string; injectMode?: 'system' | 'prefix' | 'suffix'; priority?: import('./context-map').ContextMapPriority },
  ) => Promise<void>;
  attachableDetach: (projectPath: string, attachableId: string, sessionId: string) => Promise<void>;
  attachableUpdate: (projectPath: string, attachableId: string, body: string) => Promise<void>;
  attachableList: (sessionId: string) => Promise<import('./context-map').ContextMapNode[]>;
  attachableListActive: () => Promise<Record<string, import('./context-map').ContextMapNode[]>>;
  onAttachableUpdated: (
    callback: (event: {
      type: 'attached' | 'detached' | 'updated';
      attachableId: string;
      sessionId?: string;
      affectedSessions?: string[];
    }) => void,
  ) => () => void;

  // ── M1 Dev-server watcher ──────────────────────────────────────────────────
  /** Start polling candidate ports for the given project path. */
  startDevServerWatch: (projectPath: string) => Promise<{ success: boolean; error?: string }>;
  /** Stop polling (all watchers if no arg, or just the one for the given project). */
  stopDevServerWatch: () => Promise<{ success: boolean; error?: string }>;
  /** Subscribe to dev-server-detected push events. Returns unsubscribe fn. */
  onDevServerDetected: (callback: (payload: DevServerDetectedPayload) => void) => () => void;

  // ── M2 Browser control (native CDP via webContents.debugger) ──────────────
  /** Attach a CDP debugger session to the webview identified by webContentsId. Idempotent. */
  browserAttach: (id: number) => Promise<{ success: boolean; error?: string }>;
  /** Navigate the webview to url and return the resulting AOM snapshot. */
  browserGoto: (id: number, url: string) => Promise<{ success: boolean; data?: import('./browser').AomSnapshot; error?: string }>;
  /** Return a fresh AOM snapshot of the current page without navigating. */
  browserObserve: (id: number) => Promise<{ success: boolean; data?: import('./browser').AomSnapshot; error?: string }>;
  /** Perform a DOM action on an AOM element by its numeric id. Returns a fresh AOM snapshot. */
  browserAct: (id: number, elementId: number, action: import('./browser').BrowserAction, value?: string) => Promise<{ success: boolean; data?: import('./browser').AomSnapshot; error?: string }>;
  /** Extract SEO metadata + Core Web Vitals from the current page (navigates to url first if provided). */
  browserExtractSeo: (id: number, url?: string) => Promise<{ success: boolean; data?: import('./browser').SeoReport; error?: string }>;
  /** Detach the CDP debugger. Idempotent — never throws on already-detached sessions. */
  browserDetach: (id: number) => Promise<{ success: boolean; error?: string }>;
  /** Set (or clear with null) which webview is the active agent surface (main-side; read by M3). */
  browserSetAgentSurface: (id: number | null) => Promise<{ success: boolean; error?: string }>;

  // ── Arena leaderboard ──────────────────────────────────────────────────────
  /**
   * Read the Arena leaderboard JSON for the given project.
   * Returns `{ success: true, data: [] }` when no Arena run exists yet —
   * ENOENT is treated as "no data" rather than an error at the IPC layer.
   */
  readArenaLeaderboard(projectPath: string): Promise<{
    success: boolean;
    data?: import('./arena').ArenaLeaderboardEntry[];
    error?: string;
  }>;

  // ── Time-travel checkpoints (ARCH-073) ─────────────────────────────────────
  /** List all checkpoints for a run in chronological order. */
  listCheckpoints(runId: string): Promise<import('./ipc-events').ListCheckpointsResponse>;
  /** Fork a run from a checkpoint, optionally with an edited step output. */
  harnessReplayFrom(
    flow: import('./harness').AgenticFlow,
    checkpointId: string,
    editedOutput?: string,
  ): Promise<import('./ipc-events').ReplayFromResponse>;

  // ── Performance Frontier Scorecard + Arena (ARCH-079) ──────────────────────
  /** Invoke pf:run-scorecard; returns the full structured scorecard or an error. */
  runScorecard(opts?: import('./ipc-events').ScorecardRunOptions): Promise<{
    success: boolean;
    data?: import('./ipc-events').ScorecardResult;
    error?: string;
  }>;
  /**
   * Subscribe to incremental progress events streamed on pf:scorecard-progress
   * while a scorecard run is in flight.  Returns an unsubscribe function.
   */
  onScorecardProgress(cb: (event: import('./ipc-events').ScorecardProgressEvent) => void): () => void;
  /** Invoke pf:run-arena; returns the full leaderboard + recommendations or an error. */
  runArena(opts?: import('./ipc-events').ArenaRunOptions): Promise<{
    success: boolean;
    data?: import('./ipc-events').ArenaResult;
    error?: string;
  }>;
  /**
   * Subscribe to per-model progress events streamed on pf:arena-progress
   * while an Arena run is in flight.  Returns an unsubscribe function.
   */
  onArenaProgress(cb: (event: import('./ipc-events').ArenaProgressEvent) => void): () => void;

  // ── MCP command allowlist + consent (audit 1.4) ────────────────────────────
  /** List stdio MCP commands the user has explicitly approved. */
  mcpListApprovedCommands(): Promise<{
    success: boolean;
    data?: Array<{ command: string; args: string[]; approvedAt: string }>;
    error?: string;
  }>;
  /** Approve an exact command+args pair so future spawns of it are allowed. */
  mcpApproveCommand(command: string, args?: string[]): Promise<{
    success: boolean;
    data?: Array<{ command: string; args: string[]; approvedAt: string }>;
    error?: string;
  }>;
  /** Revoke a previously approved command+args pair. */
  mcpRevokeCommand(command: string, args?: string[]): Promise<{
    success: boolean;
    data?: Array<{ command: string; args: string[]; approvedAt: string }>;
    error?: string;
  }>;

  // ── Anonymous opt-in telemetry (audit 1.8b) ────────────────────────────────
  /** Read the current anonymous-telemetry opt-in flag (default false). */
  telemetryGetOptIn(): Promise<{ success: boolean; data?: boolean; error?: string }>;
  /** Set the anonymous-telemetry opt-in flag. */
  telemetrySetOptIn(optIn: boolean): Promise<{ success: boolean; data?: boolean; error?: string }>;
}

/** Payload emitted by the main-process dev-server watcher when a new port comes up. */
export interface DevServerDetectedPayload {
  url: string;
  port: number;
}

// ─── Storage Layer Types ────────────────────────────────────────────────────

/**
 * Standardized response shape for all storage IPC handlers.
 * Renderer should always check `success` before accessing `data`.
 */
export interface IpcStorageResult<T = unknown> {
  success: boolean;
  data: T | null;
  error: string | null;
}

export interface DbQueryResult {
  rows: Record<string, unknown>[];
  changes?: number;
  lastInsertRowid?: number | bigint;
}

export interface FsDirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
}

/**
 * Storage API exposed on window.helioxAPI for renderer → main storage operations.
 * Follows the {layer}:{action} IPC naming convention.
 */
export interface StorageAPI {
  // ── Settings (electron-store) ─────────────────────────────────
  settingsGet: (key: string) => Promise<IpcStorageResult>;
  settingsSet: (key: string, value: unknown) => Promise<IpcStorageResult>;
  settingsDelete: (key: string) => Promise<IpcStorageResult>;
  settingsReset: () => Promise<IpcStorageResult>;
  appHardReset: () => Promise<IpcStorageResult>;

  // ── Database (better-sqlite3) ─────────────────────────────────
  dbQuery: (sql: string, params?: unknown[]) => Promise<IpcStorageResult<DbQueryResult>>;
  dbInsert: (sql: string, params?: unknown[]) => Promise<IpcStorageResult<DbQueryResult>>;
  dbUpdate: (sql: string, params?: unknown[]) => Promise<IpcStorageResult<DbQueryResult>>;
  dbDelete: (sql: string, params?: unknown[]) => Promise<IpcStorageResult<DbQueryResult>>;
  dbMigrate: (options?: { dryRun?: boolean }) => Promise<IpcStorageResult<{ applied: string[]; skipped: string[]; errors: string[]; currentVersion: number }>>;
  dbRollback: (count?: number) => Promise<IpcStorageResult<{ applied: string[]; skipped: string[]; errors: string[]; currentVersion: number }>>;
  dbStatus: () => Promise<IpcStorageResult<Array<{ id: string; version: number; description: string; state: string; checksum: string; appliedAt?: string }>>>;

  // ── File System (Node.js fs via IPC) ──────────────────────────
  fsReadFile: (filePath: string) => Promise<IpcStorageResult<string | null>>;
  fsWriteFile: (filePath: string, content: string) => Promise<IpcStorageResult>;
  fsDeleteFile: (filePath: string) => Promise<IpcStorageResult>;
  fsListDir: (dirPath: string) => Promise<IpcStorageResult<FsDirectoryEntry[]>>;
  fsRegisterRoot: (dirPath: string) => Promise<IpcStorageResult>;

  // Bridge (remote control)
  bridgeStart: () => Promise<{ success: boolean; port?: number; pin?: string; url?: string; qrDataUrl?: string; localIp?: string; error?: string }>;
  bridgeStop: () => Promise<{ success: boolean }>;
  bridgeStatus: () => Promise<{ running: boolean; port?: number | null; pin?: string | null; connectedClients?: number; activeSessions?: number; error?: string }>;
  bridgeGetQR: () => Promise<{ success: boolean; url?: string; qrDataUrl?: string; localIp?: string; error?: string }>;
}

// Global Window augmentation — single source of truth
declare global {
  interface Window {
    helioxAPI?: HelioxAPI & StorageAPI;
  }
}
