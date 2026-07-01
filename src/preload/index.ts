/**
 * index.ts — Preload bridge
 *
 * Architecture note:
 * This file follows the explanatory style used across the codebase:
 * explicit intent, clear boundaries, and behavior-preserving structure.
 */
// src/preload/index.ts — Secure IPC bridge between main and renderer
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import type { Flow, RunAgentParams, AgentEvent, HelioxAPI } from '../types';
import type { ContextMapNode, ContextMapEdge } from '../types/context-map';
import type { AgenticFlow } from '../types/harness';
import type {
  HarnessEventPayload,
  ListCheckpointsResponse,
  ReplayFromResponse,
  ScorecardRunOptions,
  ScorecardProgressEvent,
  ScorecardResult,
  ArenaRunOptions,
  ArenaProgressEvent,
  ArenaResult,
} from '../types/ipc-events';
import type { BrowserAction } from '../types/browser';

const helioxAPI: HelioxAPI = {
  initBaselines: (flows: Flow[]) =>
    ipcRenderer.invoke('heliox:init-baselines', flows),

  runAgent: (params: RunAgentParams) =>
    ipcRenderer.invoke('heliox:run-agent', params),

  startHarness: (flow: AgenticFlow) =>
    ipcRenderer.invoke('heliox:start-harness', flow),

  assemblePipeline: (userIntent: string) =>
    ipcRenderer.invoke('heliox:assemble-pipeline', userIntent),

  approveDiff: (diffId: string) =>
    ipcRenderer.invoke('heliox:approve-diff', diffId),

  rejectDiff: (diffId: string, feedback: string) =>
    ipcRenderer.invoke('heliox:reject-diff', diffId, feedback),

  shutdown: () =>
    ipcRenderer.invoke('heliox:shutdown'),

  onAgentEvent: (callback: (event: AgentEvent) => void) => {
    const handler = (_event: IpcRendererEvent, data: AgentEvent) => callback(data);
    ipcRenderer.on('heliox:agent-event', handler);
    return () => { ipcRenderer.removeListener('heliox:agent-event', handler); };
  },

  onHarnessEvent: (callback: (event: HarnessEventPayload) => void) => {
    const handler = (_event: IpcRendererEvent, data: HarnessEventPayload) => callback(data);
    ipcRenderer.on('heliox:harness-event', handler);
    return () => { ipcRenderer.removeListener('heliox:harness-event', handler); };
  },

  openFolderDialog: () =>
    ipcRenderer.invoke('heliox:open-folder-dialog'),

  readDirectory: (dirPath: string) =>
    ipcRenderer.invoke('heliox:read-dir', dirPath),

  checkCli: () =>
    ipcRenderer.invoke('heliox:check-cli'),

  getProjectName: (projectPath: string) =>
    ipcRenderer.invoke('heliox:get-project-name', projectPath),

  readProjectConfig: (projectPath: string, filename: string) =>
    ipcRenderer.invoke('heliox:read-project-config', projectPath, filename),

  writeProjectConfig: (projectPath: string, filename: string, content: string) =>
    ipcRenderer.invoke('heliox:write-project-config', projectPath, filename, content),

  readFile: (filePath: string) =>
    ipcRenderer.invoke('heliox:read-file', filePath),

  logResult: (projectPath: string, row: {
    commit: string;
    target: string;
    status: string;
    lcpDelta: string;
    visualDiffPct: string;
    description: string;
  }) =>
    ipcRenderer.invoke('heliox:log-result', projectPath, row),

  gitStatus: (cwd: string) =>
    ipcRenderer.invoke('heliox:git-status', cwd),

  gitStatusInfo: (cwd: string) =>
    ipcRenderer.invoke('heliox:git-status-info', cwd),

  gitDiffSummary: (cwd: string) =>
    ipcRenderer.invoke('heliox:git-diff-summary', cwd),

  gitCommit: (cwd: string, message: string) =>
    ipcRenderer.invoke('heliox:git-commit', cwd, message),

  gitReset: (cwd: string) =>
    ipcRenderer.invoke('heliox:git-reset', cwd),

  stopAgent: (agentId: string) =>
    ipcRenderer.invoke('heliox:stop-agent', agentId),

  showNotification: (opts: { title: string; body: string }) =>
    ipcRenderer.invoke('heliox:show-notification', opts),

  openFileDialog: (cwd: string) =>
    ipcRenderer.invoke('heliox:open-file-dialog', cwd),

  listModels: () =>
    ipcRenderer.invoke('heliox:list-models'),

  invalidateModelsCache: () =>
    ipcRenderer.invoke('heliox:invalidate-models-cache'),

  // ── OpenCode providers ──────────────────────────────────────────
  opencodeListProviders: () =>
    ipcRenderer.invoke('opencode:list-providers'),
  opencodeListProviderModels: (providerId: string) =>
    ipcRenderer.invoke('opencode:list-provider-models', providerId),
  opencodeSaveCredential: (providerId: string, key: string) =>
    ipcRenderer.invoke('opencode:save-credential', providerId, key),
  opencodeRemoveCredential: (providerId: string) =>
    ipcRenderer.invoke('opencode:remove-credential', providerId),
  opencodeStatus: () =>
    ipcRenderer.invoke('opencode:status'),

  getConfigDir: (projectPath: string) =>
    ipcRenderer.invoke('heliox:get-config-dir', projectPath),

  listProjectFiles: (projectPath: string) =>
    ipcRenderer.invoke('heliox:list-project-files', projectPath),

  saveFile: (defaultPath: string, content: string) =>
    ipcRenderer.invoke('heliox:save-file', defaultPath, content),

  gitDiff: (cwd: string) =>
    ipcRenderer.invoke('heliox:git-diff', cwd),

  gitDiffFiles: (cwd: string, files: string[]) =>
    ipcRenderer.invoke('heliox:git-diff-files', cwd, files),

  gitShowFile: (cwd: string, filePath: string) =>
    ipcRenderer.invoke('heliox:git-show-file', cwd, filePath),

  gitBranches: (cwd: string) =>
    ipcRenderer.invoke('heliox:git-branches', cwd),

  gitCheckout: (cwd: string, branch: string, create?: boolean) =>
    ipcRenderer.invoke('heliox:git-checkout', cwd, branch, create),

  gitFetch: (cwd: string) =>
    ipcRenderer.invoke('heliox:git-fetch', cwd),

  gitPull: (cwd: string) =>
    ipcRenderer.invoke('heliox:git-pull', cwd),

  gitFileStatuses: (cwd: string) =>
    ipcRenderer.invoke('heliox:git-file-statuses', cwd),

  readMarketInventory: (projectPath: string) =>
    ipcRenderer.invoke('heliox:read-market-inventory', projectPath),

  readMarketPrompt: (projectPath: string, category: string, name: string) =>
    ipcRenderer.invoke('heliox:read-market-prompt', projectPath, category, name),

  readBacklog: (projectPath: string) =>
    ipcRenderer.invoke('heliox:read-backlog', projectPath),

  scanBacklogs: (projectsPath: string) =>
    ipcRenderer.invoke('heliox:scan-backlogs', projectsPath),

  listProjectsWithoutBacklog: (projectsPath: string) =>
    ipcRenderer.invoke('heliox:list-projects-without-backlog', projectsPath),

  initBacklog: (projectPath: string) =>
    ipcRenderer.invoke('heliox:init-backlog', projectPath),

  updateBacklogCardStatus: (backlogDir: string, filename: string, newStatus: string) =>
    ipcRenderer.invoke('heliox:update-backlog-card-status', backlogDir, filename, newStatus),

  updateBacklogCards: (backlogDir: string, updates: Array<{ filename: string; status?: string; order?: number }>) =>
    ipcRenderer.invoke('heliox:update-backlog-cards', backlogDir, updates),

  readBacklogDir: (backlogDir: string) =>
    ipcRenderer.invoke('heliox:read-backlog-dir', backlogDir),

  writeFile: (filePath: string, content: string) =>
    ipcRenderer.invoke('heliox:write-file', filePath, content),

  createFile: (filePath: string) =>
    ipcRenderer.invoke('heliox:create-file', filePath),

  createDirectory: (dirPath: string) =>
    ipcRenderer.invoke('heliox:create-directory', dirPath),

  deleteFile: (filePath: string) =>
    ipcRenderer.invoke('heliox:delete-file', filePath),

  deleteDirectory: (dirPath: string) =>
    ipcRenderer.invoke('heliox:delete-directory', dirPath),

  renamePath: (oldPath: string, newPath: string) =>
    ipcRenderer.invoke('heliox:rename-path', oldPath, newPath),

  // Context Map
  contextMapGetAll: (projectPath: string) =>
    ipcRenderer.invoke('context-map:get-all', projectPath),

  contextMapUpsertNode: (
    projectPath: string,
    node: Partial<ContextMapNode> & Pick<ContextMapNode, 'label' | 'type'>,
  ) =>
    ipcRenderer.invoke('context-map:upsert-node', projectPath, node),

  contextMapDeleteNode: (projectPath: string, nodeId: string) =>
    ipcRenderer.invoke('context-map:delete-node', projectPath, nodeId),

  contextMapUpsertEdge: (
    projectPath: string,
    edge: Partial<ContextMapEdge> & Pick<ContextMapEdge, 'from' | 'to'>,
  ) =>
    ipcRenderer.invoke('context-map:upsert-edge', projectPath, edge),

  contextMapDeleteEdge: (projectPath: string, edgeId: string) =>
    ipcRenderer.invoke('context-map:delete-edge', projectPath, edgeId),

  contextMapSearch: (projectPath: string, query: string) =>
    ipcRenderer.invoke('context-map:search', projectPath, query),

  contextMapExportText: (projectPath: string, opts?: { roleId?: string; sessionId?: string; limit?: number }) =>
    ipcRenderer.invoke('context-map:export-text', projectPath, opts),

  contextMapUpsertSessionNode: (
    projectPath: string,
    payload: { sessionId: string; label: string; status: 'running' | 'completed' | 'stopped'; roleId?: string },
  ) => ipcRenderer.invoke('context-map:upsert-session-node', projectPath, payload),

  contextMapPresetAttachables: () =>
    ipcRenderer.invoke('context-map:preset-attachables'),

  attachableAttach: (
    projectPath: string,
    req: { attachableId: string; sessionId: string; injectMode?: 'system' | 'prefix' | 'suffix'; priority?: 'critical' | 'high' | 'normal' },
  ) => ipcRenderer.invoke('attachable:attach', projectPath, req),

  attachableDetach: (projectPath: string, attachableId: string, sessionId: string) =>
    ipcRenderer.invoke('attachable:detach', projectPath, attachableId, sessionId),

  attachableUpdate: (projectPath: string, attachableId: string, body: string) =>
    ipcRenderer.invoke('attachable:update', projectPath, attachableId, body),

  attachableList: (sessionId: string) =>
    ipcRenderer.invoke('attachable:list', sessionId),

  attachableListActive: () =>
    ipcRenderer.invoke('attachable:list-active'),

  onAttachableUpdated: (
    callback: (event: {
      type: 'attached' | 'detached' | 'updated';
      attachableId: string;
      sessionId?: string;
      affectedSessions?: string[];
    }) => void,
  ) => {
    const handler = (
      _event: IpcRendererEvent,
      data: {
        type: 'attached' | 'detached' | 'updated';
        attachableId: string;
        sessionId?: string;
        affectedSessions?: string[];
      },
    ) => callback(data);
    ipcRenderer.on('heliox:attachable-updated', handler);
    return () => {
      ipcRenderer.removeListener('heliox:attachable-updated', handler);
    };
  },

  // ── M1 Dev-server watcher ───────────────────────────────────────
  // Renderer calls startDevServerWatch when a project opens; the main process
  // polls candidate ports and pushes 'heliox:dev-server-detected' events back.

  startDevServerWatch: (projectPath: string) =>
    ipcRenderer.invoke('devserver:start-watch', projectPath),

  stopDevServerWatch: () =>
    ipcRenderer.invoke('devserver:stop-watch'),

  onDevServerDetected: (callback: (payload: { url: string; port: number }) => void) => {
    const handler = (_event: IpcRendererEvent, data: { url: string; port: number }) =>
      callback(data);
    ipcRenderer.on('heliox:dev-server-detected', handler);
    return () => { ipcRenderer.removeListener('heliox:dev-server-detected', handler); };
  },

  // ── M2 Browser control (native CDP via webContents.debugger) ────────────
  // All channels follow the {success, data?, error?} return convention.
  // The `id` argument is the Electron webContentsId stored in the desktop store
  // after the <webview> fires dom-ready (DesktopWindow.webContentsId).

  browserAttach: (id: number) =>
    ipcRenderer.invoke('browser:attach', id),

  browserGoto: (id: number, url: string) =>
    ipcRenderer.invoke('browser:goto', id, url),

  browserObserve: (id: number) =>
    ipcRenderer.invoke('browser:observe', id),

  browserAct: (id: number, elementId: number, action: BrowserAction, value?: string) =>
    ipcRenderer.invoke('browser:act', id, elementId, action, value),

  browserExtractSeo: (id: number, url?: string) =>
    ipcRenderer.invoke('browser:extract-seo', id, url),

  browserDetach: (id: number) =>
    ipcRenderer.invoke('browser:detach', id),

  browserSetAgentSurface: (id: number | null) =>
    ipcRenderer.invoke('browser:set-agent-surface', id),

  // ── Arena leaderboard ───────────────────────────────────────────
  // Reads the leaderboard JSON produced by `npm run pf:arena`.
  // Returns { success, data } — data is [] when no run exists yet.
  readArenaLeaderboard: (projectPath: string) =>
    ipcRenderer.invoke('arena:read-leaderboard', projectPath),

  // ── Time-travel checkpoints (ARCH-073) ─────────────────────────
  // List all checkpoints for a run. Returns { success, data, error }.
  listCheckpoints: (runId: string): Promise<ListCheckpointsResponse> =>
    ipcRenderer.invoke('harness:list-checkpoints', runId),

  // Fork a run from a checkpoint (optionally with an edited step output).
  // Returns { success, data: { forkRunId, seededStepIds, isDeterministicReplay }, error }.
  harnessReplayFrom: (
    flow: import('../types/harness').AgenticFlow,
    checkpointId: string,
    editedOutput?: string,
  ): Promise<ReplayFromResponse> =>
    ipcRenderer.invoke('harness:replay-from', flow, checkpointId, editedOutput),

  // ── Performance Frontier Scorecard + Arena (ARCH-079) ──────────────────────
  // Invoke channels match ipc.ts exactly (pf:run-scorecard / pf:run-arena).
  // Progress channels match the constants in ipc.ts (pf:scorecard-progress /
  // pf:arena-progress). Each `on*` method returns an unsubscribe fn.

  runScorecard: (opts?: ScorecardRunOptions): Promise<{ success: boolean; data?: ScorecardResult; error?: string }> =>
    ipcRenderer.invoke('pf:run-scorecard', opts),

  onScorecardProgress: (cb: (event: ScorecardProgressEvent) => void): () => void => {
    const handler = (_event: IpcRendererEvent, data: ScorecardProgressEvent) => cb(data);
    ipcRenderer.on('pf:scorecard-progress', handler);
    return () => { ipcRenderer.removeListener('pf:scorecard-progress', handler); };
  },

  runArena: (opts?: ArenaRunOptions): Promise<{ success: boolean; data?: ArenaResult; error?: string }> =>
    ipcRenderer.invoke('pf:run-arena', opts),

  onArenaProgress: (cb: (event: ArenaProgressEvent) => void): () => void => {
    const handler = (_event: IpcRendererEvent, data: ArenaProgressEvent) => cb(data);
    ipcRenderer.on('pf:arena-progress', handler);
    return () => { ipcRenderer.removeListener('pf:arena-progress', handler); };
  },

  // ── MCP command allowlist + consent (audit 1.4) ─────────────────
  mcpListApprovedCommands: () =>
    ipcRenderer.invoke('mcp:listApprovedCommands'),
  mcpApproveCommand: (command: string, args?: string[]) =>
    ipcRenderer.invoke('mcp:approveCommand', command, args ?? []),
  mcpRevokeCommand: (command: string, args?: string[]) =>
    ipcRenderer.invoke('mcp:revokeCommand', command, args ?? []),

  // ── Anonymous opt-in telemetry (audit 1.8b) ──────────────────────
  telemetryGetOptIn: () =>
    ipcRenderer.invoke('telemetry:getOptIn'),
  telemetrySetOptIn: (optIn: boolean) =>
    ipcRenderer.invoke('telemetry:setOptIn', optIn),
};

// Menu events from main process
ipcRenderer.on('heliox:menu-open-project', () => {
  window.dispatchEvent(new CustomEvent('heliox:open-project'));
});
ipcRenderer.on('heliox:menu-close-project', () => {
  window.dispatchEvent(new CustomEvent('heliox:close-project'));
});
ipcRenderer.on('heliox:menu-switch-project', () => {
  window.dispatchEvent(new CustomEvent('heliox:switch-project'));
});

// ─── Storage API ─────────────────────────────────────────────────────────────
// Follows the {layer}:{action} IPC naming convention.
// All handlers return { success: boolean, data: any | null, error: string | null }.

const storageAPI = {
  // Settings layer (electron-store in main process)
  settingsGet: (key: string) =>
    ipcRenderer.invoke('settings:get', key),
  settingsSet: (key: string, value: unknown) =>
    ipcRenderer.invoke('settings:set', key, value),
  settingsDelete: (key: string) =>
    ipcRenderer.invoke('settings:delete', key),
  settingsReset: () =>
    ipcRenderer.invoke('settings:reset'),
  appHardReset: () =>
    ipcRenderer.invoke('app:hard-reset'),

  // Database layer (better-sqlite3 in main process)
  dbQuery: (sql: string, params?: unknown[]) =>
    ipcRenderer.invoke('db:query', sql, params),
  dbInsert: (sql: string, params?: unknown[]) =>
    ipcRenderer.invoke('db:insert', sql, params),
  dbUpdate: (sql: string, params?: unknown[]) =>
    ipcRenderer.invoke('db:update', sql, params),
  dbDelete: (sql: string, params?: unknown[]) =>
    ipcRenderer.invoke('db:delete', sql, params),
  dbMigrate: (options?: { dryRun?: boolean }) =>
    ipcRenderer.invoke('db:migrate', options),
  dbRollback: (count?: number) =>
    ipcRenderer.invoke('db:rollback', count),
  dbStatus: () =>
    ipcRenderer.invoke('db:status'),

  // File system layer (Node.js fs in main process)
  fsReadFile: (filePath: string) =>
    ipcRenderer.invoke('fs:readFile', filePath),
  fsWriteFile: (filePath: string, content: string) =>
    ipcRenderer.invoke('fs:writeFile', filePath, content),
  fsDeleteFile: (filePath: string) =>
    ipcRenderer.invoke('fs:deleteFile', filePath),
  fsListDir: (dirPath: string) =>
    ipcRenderer.invoke('fs:listDir', dirPath),
  fsRegisterRoot: (dirPath: string) =>
    ipcRenderer.invoke('fs:registerRoot', dirPath),

  // Bridge (remote control)
  bridgeStart: () =>
    ipcRenderer.invoke('bridge:start'),
  bridgeStop: () =>
    ipcRenderer.invoke('bridge:stop'),
  bridgeStatus: () =>
    ipcRenderer.invoke('bridge:status'),
  bridgeGetQR: () =>
    ipcRenderer.invoke('bridge:get-qr'),
};

contextBridge.exposeInMainWorld('helioxAPI', { ...helioxAPI, ...storageAPI });
