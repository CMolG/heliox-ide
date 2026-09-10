/**
 * IPC Boundary (Main Process)
 *
 * This module is the single integration boundary between renderer intents and
 * privileged Node/Electron capabilities (filesystem, git, process execution,
 * desktop notifications, and agent orchestration).
 *
 * Architectural conventions:
 *  - Handlers return typed success/failure payloads instead of throwing to UI
 *  - Side effects remain in main process; renderer receives normalized events
 *  - Event names are mapped through `EVENT_TYPE_MAP` to keep UI contracts stable
 */
import { ipcMain, BrowserWindow, dialog, app, Notification, shell } from 'electron';
import type { OpenDialogOptions, SaveDialogOptions } from 'electron';
import { AgentManager } from './agent-manager';
import { Flow, FileEntry, CliStatus, RunAgentParams, errMsg } from '../types';
import type { AgenticFlow } from '../types/harness';
import type {
  ModelPolicy, SelectionStrategy, ConnectionTestRequest,
  ProviderConnectionInput, ProviderConnectionUpdate, ConnectionResolver,
} from '../types/ipc-events';
import { execFile } from 'child_process';
import { readdir, stat, readFile, writeFile, mkdir, unlink, rm, rename, access } from 'fs/promises';
import { join, basename, relative } from 'path';
import { promisify } from 'util';
import { createHash } from 'crypto';
import { log } from './logger';
import { readBrandEnv } from './lib/env-compat';
import {
  listProviders, listModels as opencodeListModels, saveProviderCredential,
  removeProviderCredential, opencodeStatus,
} from './opencode-providers';
import {
  listConnections, createConnection, updateConnection, deleteConnection,
  getDecryptedToken, setModelEnabled, mergeModelList,
} from './provider-connections';
import { testConnection } from './provider-connection-tester';
import { executeAgenticFlow } from './harness-engine/executor';
import { exportFlow } from './flow-export/fluxor-flow';
import { setHarnessEventWindow } from './harness-engine/event-bus';
import { assemblePipeline } from './meta-agent/pipeline-generator';
import { registerCheckpointIpcHandlers } from './harness-engine/checkpoint-ipc';
import { registerMcpCommandPolicyIpcHandlers } from './harness-engine/mcp-command-policy';
import { registerScorecardIpc, registerArenaIpc } from './performance-frontier/ipc';
import { registerTelemetryIpcHandlers } from './telemetry-ping';
import { parseBacklogCard, renderBody, serializeBacklogCard } from './backlog/frontmatter';
import type { BacklogCard } from '../types/market';

const execFileAsync = promisify(execFile);

async function gitOp(args: string[], cwd: string, timeout = 10000): Promise<{ success: boolean; error?: string }> {
  try {
    await execFileAsync('git', args, { cwd, timeout });
    return { success: true };
  } catch (err) {
    return { success: false, error: errMsg(err) };
  }
}

const agentManager = new AgentManager();
let ipcHandlersRegistered = false;
let currentIpcWindow: BrowserWindow | null = null;

const IGNORED_DIRS = new Set([
  'node_modules', 'dist', '.vite', '.git', '.DS_Store', '__pycache__',
  '.next', '.cache', 'coverage', '.turbo', '.svn', 'bower_components',
  '.idea', '.vscode',
]);

const MARKET_PROMPT_CATEGORIES = new Set(['flows', 'roles', 'mods', 'steps']);

/**
 * Where a project's Fluxor-owned config lives — in userData, keyed by a hash of
 * its path, never inside the project itself.
 *
 * Exported since Cockpit F2: `ipc-worktrees.ts` reads and writes `cockpit.json`
 * (the per-project bootstrap override) through the same directory the
 * `read-project-config`/`write-project-config` handlers below use, so the two
 * cannot end up pointing at two different places.
 */
export function getProjectConfigDir(projectPath: string): string {
  const hash = createHash('md5').update(projectPath).digest('hex').slice(0, 12);
  const safeName = basename(projectPath);
  return join(app.getPath('userData'), 'projects', `${safeName}-${hash}`);
}

function isSafeMarketPromptName(name: string): boolean {
  return !name.includes('..') && !name.includes('/') && !name.includes('\\');
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractMarkdownSection(content: string, heading: string): string | null {
  const escapedHeading = escapeForRegExp(heading);
  const sectionRegex = new RegExp(`(?:^|\\n)##\\s+${escapedHeading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, 'i');
  const match = content.match(sectionRegex);
  return match?.[1]?.trim() ?? null;
}

async function readMarketPromptFromDisk(
  projectPath: string,
  category: string,
  name: string,
): Promise<string | null> {
  if (!MARKET_PROMPT_CATEGORIES.has(category)) return null;
  if (!isSafeMarketPromptName(name)) return null;

  const fileName = `${name}.md`;

  // Try projectPath first.
  try {
    const promptPath = join(projectPath, 'market', category, fileName);
    return await readFile(promptPath, 'utf-8');
  } catch { /* not found in project */ }

  // Fallback: IDE app root.
  try {
    const appRoot = app.getAppPath();
    const promptPath = join(appRoot, 'market', category, fileName);
    return await readFile(promptPath, 'utf-8');
  } catch {
    return null;
  }
}

const AGENT_EVENTS = [
  'agent-started',
  'agent-file-changed',
  'agent-running-e2e',
  'agent-autocorrecting',
  'agent-thinking-delta',
  'agent-message-delta',
  'agent-message',
  'agent-tool-use',
  'agent-tool-result',
  'agent-result',
  'agent-raw-output',
  'diffs-ready',
  'patch-applied',
  'patch-failed',
] as const;

type AgentEventName = typeof AGENT_EVENTS[number];

const EVENT_TYPE_MAP: Record<AgentEventName, string> = {
  'agent-started': 'started',
  'agent-file-changed': 'file-changed',
  'agent-running-e2e': 'running-e2e',
  'agent-autocorrecting': 'autocorrecting',
  'agent-thinking-delta': 'thinking-delta',
  'agent-message-delta': 'message-delta',
  'agent-message': 'message',
  'agent-tool-use': 'tool-use',
  'agent-tool-result': 'tool-result',
  'agent-result': 'result',
  'agent-raw-output': 'raw-output',
  'diffs-ready': 'diffs-ready',
  'patch-applied': 'file-changed',
  'patch-failed': 'file-changed',
};

const VALID_MODEL_POLICY_MODES = new Set(['fixed', 'smart-local', 'smart-external']);
const VALID_SELECTION_STRATEGIES = new Set(['best-score', 'cheapest', 'fastest', 'best-value']);

/**
 * Loose IPC-boundary validation for `fluxor:start-harness`'s `options.modelPolicy`.
 * Renderer input is `unknown` by construction (crossed the context bridge) —
 * anything that doesn't shape up as a real `ModelPolicy` is dropped back to
 * `undefined` rather than thrown on, matching this IPC layer's convention of
 * normalized, non-throwing handlers. `executeAgenticFlow` treats a missing
 * policy exactly like `{mode:'fixed'}` (no router), so "ignore" is always safe.
 */
function sanitizeModelPolicy(value: unknown): ModelPolicy | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const mode = (value as { mode?: unknown }).mode;
  if (typeof mode !== 'string' || !VALID_MODEL_POLICY_MODES.has(mode)) return undefined;

  if (mode === 'smart-local') {
    const strategy = (value as { strategy?: unknown }).strategy;
    if (typeof strategy !== 'string' || !VALID_SELECTION_STRATEGIES.has(strategy)) return undefined;
    return { mode: 'smart-local', strategy: strategy as SelectionStrategy };
  }

  return { mode } as ModelPolicy;
}

/**
 * Build the synchronous `ConnectionResolver` a harness run needs to resolve
 * `conn:<connectionId>/<modelId>` model ids (see llm-runner.ts#resolveHarnessModel).
 * Reads every saved connection + its decrypted token ONCE, up front, so the
 * resolver itself never touches disk mid-run. Never throws — a failure here
 * (e.g. a corrupt provider-connections.json) degrades to an empty resolver
 * rather than blocking the whole flow, matching this module's convention of
 * normalized, non-throwing handlers.
 */
async function buildConnectionResolver(): Promise<ConnectionResolver> {
  try {
    const connections = await listConnections();
    const entries = await Promise.all(connections.map(async (c) => {
      const token = await getDecryptedToken(c.id);
      return [c.id, { protocol: c.protocol, baseUrl: c.baseUrl, token }] as const;
    }));
    const byId = new Map(entries);
    return (id: string) => byId.get(id);
  } catch (err) {
    log.warn('[Fluxor Harness] failed to load provider connections for model resolution:', errMsg(err));
    return () => undefined;
  }
}

function getIpcWindow(): BrowserWindow | null {
  if (currentIpcWindow && !currentIpcWindow.isDestroyed()) {
    return currentIpcWindow;
  }

  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) {
    currentIpcWindow = focused;
    return focused;
  }

  const anyOpenWindow = BrowserWindow.getAllWindows().find((win) => !win.isDestroyed()) ?? null;
  if (anyOpenWindow) {
    currentIpcWindow = anyOpenWindow;
  }
  return anyOpenWindow;
}

function sendToRenderer(channel: string, payload: unknown): void {
  const win = getIpcWindow();
  if (!win) return;
  win.webContents.send(channel, payload);
}

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  currentIpcWindow = mainWindow;
  setHarnessEventWindow(mainWindow);
  if (ipcHandlersRegistered) return;
  ipcHandlersRegistered = true;

  // ── Agent lifecycle and streaming bridge ─────────────────────────────────────
  ipcMain.handle('fluxor:init-baselines', async (_event, flows: Flow[]) => {
    // Audit 1.7 — surfaces the one-time "downloading Chromium" progress (if
    // any) emitted from AgentManager#initialize while baselines are computed.
    const onProgress = (data: { message: string }) => {
      sendToRenderer('fluxor:agent-event', { type: 'snapshot-browser-progress', ...data });
    };
    agentManager.on('snapshot-browser-progress', onProgress);
    try {
      await agentManager.initialize(flows);
      return { success: true };
    } finally {
      agentManager.removeListener('snapshot-browser-progress', onProgress);
    }
  });

  ipcMain.handle('fluxor:run-agent', async (_event, params: RunAgentParams) => {
    const listeners = new Map<AgentEventName, (...args: any[]) => void>();

    for (const eventName of AGENT_EVENTS) {
      const handler = (data: any) => {
        sendToRenderer('fluxor:agent-event', {
          type: EVENT_TYPE_MAP[eventName],
          ...data,
        });
      };
      listeners.set(eventName, handler);
      agentManager.on(eventName, handler);
    }

    try {
      await agentManager.runAgent(params);
      return { success: true };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    } finally {
      for (const [eventName, handler] of listeners) {
        agentManager.removeListener(eventName, handler);
      }
    }
  });

  ipcMain.handle('fluxor:start-harness', async (
    _event,
    flow: AgenticFlow,
    options?: { modelPolicy?: unknown; modelId?: unknown },
  ) => {
    if (!flow || typeof flow !== 'object') {
      return { success: false, error: 'Invalid AgenticFlow payload.' };
    }

    const modelPolicy = sanitizeModelPolicy(options?.modelPolicy);
    const modelId = typeof options?.modelId === 'string' ? options.modelId : undefined;
    // Pre-fetch every saved connection's decrypted token ONCE per run and
    // close over a plain synchronous map — resolveHarnessModel (and anything
    // that threads a `conn:<connectionId>/<modelId>` modelId down to it) never
    // touches disk itself. A lookup failure here (e.g. a corrupt store file)
    // degrades to "no connections resolvable" rather than blocking the run —
    // any step that isn't actually using a `conn:` model is unaffected.
    const resolveConnection = await buildConnectionResolver();

    setTimeout(() => {
      void executeAgenticFlow(flow, { modelPolicy, modelId, resolveConnection }).catch((err) => {
        const message = errMsg(err);
        log.error(`[Fluxor Harness] execution failed: ${message}`);
      });
    }, 0);

    return { success: true };
  });

  ipcMain.handle('fluxor:assemble-pipeline', async (_event, userIntent: string) => {
    if (typeof userIntent !== 'string' || userIntent.trim().length === 0) {
      return { success: false, error: 'A non-empty user intent is required.' };
    }

    try {
      const data = await assemblePipeline(userIntent.trim());
      return { success: true, data };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  });

  ipcMain.handle('fluxor:approve-diff', async (_event, diffId: string) => {
    try {
      agentManager.emit('diff-approved', { diffId });
      sendToRenderer('fluxor:agent-event', {
        type: 'file-changed',
        agentId: 'system',
        path: `approved:${diffId}`,
        patch: 'Baseline updated — after snapshot is now the new baseline',
      });
      return { success: true, diffId };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  });

  ipcMain.handle('fluxor:reject-diff', async (_event, diffId: string, feedback: string) => {
    try {
      agentManager.emit('diff-rejected', { diffId, feedback });
      sendToRenderer('fluxor:agent-event', {
        type: 'file-changed',
        agentId: 'system',
        path: `rejected:${diffId}`,
        patch: `Rejected: ${feedback}`,
      });
      return { success: true, diffId, feedback };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  });

  ipcMain.handle('fluxor:shutdown', async () => {
    await agentManager.shutdown();
    return { success: true };
  });

  // ── Project and filesystem helpers ──────────────────────────────────────────
  ipcMain.handle('fluxor:open-folder-dialog', async () => {
    const options: OpenDialogOptions = {
      properties: ['openDirectory'],
      title: 'Open Project',
    };
    const win = getIpcWindow();
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    return result.filePaths[0] ?? null;
  });

  ipcMain.handle('fluxor:read-dir', async (_event, dirPath: string): Promise<FileEntry[]> => {
    try {
      const entries = await readdir(dirPath);
      const results: FileEntry[] = [];
      for (const name of entries) {
        if (IGNORED_DIRS.has(name)) continue;
        try {
          const fullPath = join(dirPath, name);
          const s = await stat(fullPath);
          results.push({ name, path: fullPath, isDirectory: s.isDirectory() });
        } catch { /* skip inaccessible entries */ }
      }
      results.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      return results;
    } catch {
      return [];
    }
  });

  ipcMain.handle('fluxor:check-cli', async (): Promise<CliStatus> => {
    const NONE: CliStatus = { opencodeInstalled: false, opencodeVersion: null, nodeInstalled: false, gitInstalled: false };
    const check = async (cmd: string, args: string[]): Promise<boolean> => {
      try {
        await execFileAsync(cmd, args, { timeout: 5000 });
        return true;
      } catch {
        return false;
      }
    };

    try {
      const [oc, nodeInstalled, gitInstalled] = await Promise.all([
        opencodeStatus(),
        check('node', ['--version']),
        check('git', ['--version']),
      ]);
      return {
        opencodeInstalled: oc.installed,
        opencodeVersion: oc.version,
        nodeInstalled,
        gitInstalled,
      };
    } catch {
      return NONE;
    }
  });

  // ── OpenCode provider catalog & credentials ────────────────────────────────
  ipcMain.handle('opencode:list-providers', async () => listProviders());

  ipcMain.handle('opencode:list-provider-models', async (_e, providerId: string) =>
    opencodeListModels(providerId)
  );

  ipcMain.handle('opencode:save-credential', async (_e, providerId: string, key: string) => {
    try {
      await saveProviderCredential(providerId, key);
      return { success: true };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  });

  ipcMain.handle('opencode:remove-credential', async (_e, providerId: string) => {
    try {
      await removeProviderCredential(providerId);
      return { success: true };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  });

  ipcMain.handle('opencode:status', async () => opencodeStatus());

  // ── Provider Connections (DBeaver-style, Phase 6) ──────────────────────────
  // Replaces the old opencode-backed provider-picker UI (see ConnectionsSection.tsx).
  // Tokens never cross this boundary in plaintext — profiles only carry
  // `hasToken`; `getDecryptedToken` is called main-side only, here and from
  // the `resolveConnection` closure built for `fluxor:start-harness` below.
  ipcMain.handle('provider-connections:list', async () => {
    try {
      return { success: true, data: await listConnections() };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  });

  ipcMain.handle('provider-connections:create', async (_e, input: ProviderConnectionInput) => {
    try {
      return { success: true, data: await createConnection(input) };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  });

  ipcMain.handle('provider-connections:update', async (_e, id: string, patch: ProviderConnectionUpdate) => {
    try {
      const data = await updateConnection(id, patch);
      if (!data) return { success: false, error: `No connection with id "${id}".` };
      return { success: true, data };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  });

  ipcMain.handle('provider-connections:delete', async (_e, id: string) => {
    try {
      await deleteConnection(id);
      return { success: true };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  });

  ipcMain.handle('provider-connections:set-model-enabled', async (_e, id: string, modelId: string, enabled: boolean) => {
    try {
      const data = await setModelEnabled(id, modelId, enabled);
      if (!data) return { success: false, error: `No connection with id "${id}".` };
      return { success: true, data };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  });

  ipcMain.handle('provider-connections:test', async (_e, request: ConnectionTestRequest) => {
    try {
      // Draft profile (pre-save testing) — no persistence, no model merge.
      if (!('connectionId' in request)) {
        const result = await testConnection(request);
        return { success: true, data: { result } };
      }

      // Saved connection — resolve its decrypted token main-side, run the
      // probe, and on success merge the fetched model list into the profile
      // (new models arrive enabled, vanished models are dropped) so the UI
      // gets a fully refreshed card in one round trip.
      const [connections, token] = await Promise.all([
        listConnections(),
        getDecryptedToken(request.connectionId),
      ]);
      const conn = connections.find((c) => c.id === request.connectionId);
      if (!conn) return { success: false, error: `No connection with id "${request.connectionId}".` };

      const result = await testConnection({ protocol: conn.protocol, baseUrl: conn.baseUrl, token });
      const patch: ProviderConnectionUpdate = {
        lastTestedAt: Date.now(),
        lastTestOk: result.ok,
        ...(result.ok && result.models ? { models: mergeModelList(conn.models, result.models) } : {}),
      };
      const connection = await updateConnection(request.connectionId, patch);
      return { success: true, data: { result, connection } };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  });

  ipcMain.handle('fluxor:get-project-name', async (_event, projectPath: string): Promise<string> => {
    try {
      return basename(projectPath);
    } catch {
      return 'unknown';
    }
  });

  // Project config file I/O (stored in user data directory, not project)
  ipcMain.handle('fluxor:read-project-config', async (_event, projectPath: string, filename: string): Promise<string | null> => {
    try {
      const configDir = getProjectConfigDir(projectPath);
      const configPath = join(configDir, filename);
      return await readFile(configPath, 'utf-8');
    } catch {
      return null;
    }
  });

  ipcMain.handle('fluxor:write-project-config', async (_event, projectPath: string, filename: string, content: string): Promise<boolean> => {
    try {
      const configDir = getProjectConfigDir(projectPath);
      await mkdir(configDir, { recursive: true });
      await writeFile(join(configDir, filename), content, 'utf-8');
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('fluxor:get-config-dir', async (_event, projectPath: string): Promise<string> => {
    return getProjectConfigDir(projectPath);
  });

  // File content reading (for center panel file viewer)
  ipcMain.handle('fluxor:read-file', async (_event, filePath: string): Promise<string | null> => {
    try {
      const s = await stat(filePath);
      if (s.size > 1024 * 1024) return null;
      return await readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  });

  // TSV result logging
  ipcMain.handle('fluxor:log-result', async (_event, projectPath: string, row: {
    commit: string;
    target: string;
    status: string;
    lcpDelta: string;
    visualDiffPct: string;
    description: string;
  }) => {
    try {
      const tsvPath = join(projectPath, 'fluxor-results.tsv');
      const line = `${row.commit}\t${row.target}\t${row.status}\t${row.lcpDelta}\t${row.visualDiffPct}\t${row.description}\n`;
      try {
        await stat(tsvPath);
      } catch {
        // Create TSV with header if it doesn't exist
        await writeFile(tsvPath, 'commit\ttarget\tstatus\tlcp_delta\tvisual_diff_%\tdescription\n', 'utf-8');
      }
      const { appendFile } = await import('fs/promises');
      await appendFile(tsvPath, line, 'utf-8');
      return true;
    } catch {
      return false;
    }
  });

  // Git operations
  // ── Git operations and user actions ─────────────────────────────────────────
  ipcMain.handle('fluxor:git-status', async (_event, cwd: string): Promise<{ clean: boolean; files: string[] }> => {
    try {
      const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd, timeout: 10000 });
      const files = stdout.trim().split('\n').filter(Boolean).map(line => line.trim());
      return { clean: files.length === 0, files };
    } catch {
      return { clean: true, files: [] };
    }
  });

  ipcMain.handle('fluxor:git-status-info', async (_event, cwd: string): Promise<{ branch: string; modified: number; staged: number; untracked: number }> => {
    try {
      const [branchResult, statusResult] = await Promise.all([
        execFileAsync('git', ['branch', '--show-current'], { cwd, timeout: 10000 }).catch(() => ({ stdout: '' })),
        execFileAsync('git', ['status', '--porcelain'], { cwd, timeout: 10000 }).catch(() => ({ stdout: '' })),
      ]);
      const branch = branchResult.stdout.trim() || 'HEAD';
      const lines = statusResult.stdout.trim().split('\n').filter(Boolean);
      let modified = 0;
      let staged = 0;
      let untracked = 0;
      for (const line of lines) {
        const x = line[0]; // staging area status
        const y = line[1]; // working tree status
        if (x === '?') {
          untracked++;
        } else {
          if (x !== ' ' && x !== '?') staged++;
          if (y !== ' ' && y !== '?') modified++;
        }
      }
      return { branch, modified, staged, untracked };
    } catch {
      return { branch: '', modified: 0, staged: 0, untracked: 0 };
    }
  });

  ipcMain.handle('fluxor:git-diff-summary', async (_event, cwd: string): Promise<string> => {
    try {
      const { stdout } = await execFileAsync('git', ['diff', '--stat'], { cwd, timeout: 10000 });
      return stdout.trim();
    } catch {
      return '';
    }
  });

  ipcMain.handle('fluxor:git-commit', async (_event, cwd: string, message: string): Promise<{ success: boolean; hash?: string; error?: string }> => {
    try {
      await execFileAsync('git', ['add', '-A'], { cwd, timeout: 10000 });
      const { stdout } = await execFileAsync('git', ['commit', '-m', message], { cwd, timeout: 15000 });
      // Extract short hash from commit output
      const hashMatch = stdout.match(/\[[\w-]+ ([a-f0-9]+)\]/);
      return { success: true, hash: hashMatch?.[1] ?? 'unknown' };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  });

  ipcMain.handle('fluxor:git-reset', async (_event, cwd: string): Promise<boolean> => {
    try {
      await execFileAsync('git', ['reset', '--hard', 'HEAD~1'], { cwd, timeout: 10000 });
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('fluxor:stop-agent', async (_event, agentId: string): Promise<boolean> => {
    return agentManager.stopAgent(agentId);
  });

  ipcMain.handle('fluxor:show-notification', async (_event, opts: { title: string; body: string }): Promise<void> => {
    if (Notification.isSupported()) {
      new Notification({ title: opts.title, body: opts.body }).show();
    }
  });

  ipcMain.handle('fluxor:open-file-dialog', async (_event, cwd: string): Promise<string | null> => {
    const options: OpenDialogOptions = {
      properties: ['openFile'],
      title: 'Select File',
      defaultPath: cwd,
    };
    const win = getIpcWindow();
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    return result.filePaths[0] ?? null;
  });

  // ── Model list (delegated to opencode CLI) ─────────────────────────────────
  // Disk cache lives in opencode-providers; this IPC handler is a thin wrapper.
  ipcMain.handle('fluxor:list-models', async (): Promise<string[]> => {
    const envModels = readBrandEnv('FLUXOR_MODELS');
    if (envModels) {
      return envModels.split(',').map(m => m.trim()).filter(Boolean);
    }
    const models = await opencodeListModels();
    if (models.length === 0) {
      log.warn('[Fluxor] opencode returned no models — verify a provider is authorized');
    }
    return models;
  });

  ipcMain.handle('fluxor:invalidate-models-cache', async (): Promise<void> => {
    // Force a refresh on the next call by passing { refresh: true }.
    await opencodeListModels(undefined, { refresh: true });
  });

  ipcMain.handle('fluxor:list-project-files', async (_event, projectPath: string): Promise<string[]> => {
    const MAX_FILES = 500;
    const results: string[] = [];

    // Depth-first traversal with a hard cap to protect UI responsiveness.
    async function walk(dir: string): Promise<void> {
      if (results.length >= MAX_FILES) return;
      try {
        const entries = await readdir(dir);
        for (const name of entries) {
          if (results.length >= MAX_FILES) return;
          if (name.startsWith('.') || IGNORED_DIRS.has(name)) continue;
          const fullPath = join(dir, name);
          try {
            const s = await stat(fullPath);
            if (s.isDirectory()) {
              await walk(fullPath);
            } else {
              results.push(relative(projectPath, fullPath));
            }
          } catch { /* skip inaccessible */ }
        }
      } catch { /* skip unreadable dirs */ }
    }

    await walk(projectPath);
    results.sort();
    return results;
  });

  ipcMain.handle('fluxor:save-file', async (_event, defaultPath: string, content: string): Promise<boolean> => {
    try {
      const options: SaveDialogOptions = {
        title: 'Save File',
        defaultPath,
        filters: [
          { name: 'Markdown', extensions: ['md'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      };
      const win = getIpcWindow();
      const result = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) return false;
      await writeFile(result.filePath, content, 'utf-8');
      return true;
    } catch {
      return false;
    }
  });

  // Export a canvas-compiled AgenticFlow to the portable fluxor-flow.json
  // interchange format (src/main/flow-export/fluxor-flow.ts) — the format the
  // Java/Python runtimes and the SDK conformance suite consume. Clones the
  // fluxor:save-file dialog pattern above.
  ipcMain.handle('fluxor:export-flow', async (_event, flow: AgenticFlow): Promise<{ success: boolean; path?: string; canceled?: boolean; error?: string }> => {
    try {
      const exported = exportFlow(flow);
      const options: SaveDialogOptions = {
        title: 'Export Flow',
        defaultPath: `${flow.id}.flow.json`,
        filters: [
          { name: 'Fluxor Flow', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      };
      const win = getIpcWindow();
      const { canceled, filePath } = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options);
      if (canceled || !filePath) return { success: false, canceled: true };
      await writeFile(filePath, JSON.stringify(exported, null, 2), 'utf-8');
      return { success: true, path: filePath };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  });

  // Direct file write (no dialog) — for inline code editing
  ipcMain.handle('fluxor:write-file', async (_event, filePath: string, content: string): Promise<boolean> => {
    try {
      await writeFile(filePath, content, 'utf-8');
      return true;
    } catch {
      return false;
    }
  });

  // Create a new empty file
  ipcMain.handle('fluxor:create-file', async (_event, filePath: string): Promise<boolean> => {
    try {
      await access(filePath).then(() => { throw new Error('exists'); }).catch(e => {
        if (e.message === 'exists') throw e;
      });
      const dir = join(filePath, '..');
      await mkdir(dir, { recursive: true });
      await writeFile(filePath, '', 'utf-8');
      return true;
    } catch {
      return false;
    }
  });

  // Create a new directory
  ipcMain.handle('fluxor:create-directory', async (_event, dirPath: string): Promise<boolean> => {
    try {
      await mkdir(dirPath, { recursive: true });
      return true;
    } catch {
      return false;
    }
  });

  // Delete a file
  ipcMain.handle('fluxor:delete-file', async (_event, filePath: string): Promise<boolean> => {
    try {
      await unlink(filePath);
      return true;
    } catch {
      return false;
    }
  });

  // Delete a directory (recursive)
  ipcMain.handle('fluxor:delete-directory', async (_event, dirPath: string): Promise<boolean> => {
    try {
      await rm(dirPath, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  });

  // Rename / move a file or directory
  ipcMain.handle('fluxor:rename-path', async (_event, oldPath: string, newPath: string): Promise<boolean> => {
    try {
      await rename(oldPath, newPath);
      return true;
    } catch {
      return false;
    }
  });

  // Reveal a file or directory in the OS file manager. Introduced by the
  // agent-session window's "Log" control (Cockpit F1) — a session's PTY
  // transcript lives outside the tree, under userData/sessions/, so a path
  // string alone is useless to the user. Generic on purpose: it lives here
  // with the other shell/fs handlers rather than in the pty module, because
  // nothing about it is specific to terminals.
  ipcMain.handle('fluxor:reveal-path', async (_event, targetPath: string): Promise<boolean> => {
    try {
      shell.showItemInFolder(targetPath);
      return true;
    } catch {
      return false;
    }
  });

  // Full git diff output (includes both staged and unstaged changes)
  const gitDiff = async (cwd: string, extra: string[] = []): Promise<string> => {
    try {
      const [unstaged, staged] = await Promise.all([
        execFileAsync('git', ['diff', '--unified=3', ...extra], { cwd, timeout: 15000 }).then(r => r.stdout).catch(() => ''),
        execFileAsync('git', ['diff', '--cached', '--unified=3', ...extra], { cwd, timeout: 15000 }).then(r => r.stdout).catch(() => ''),
      ]);
      return (unstaged + staged).trim();
    } catch {
      return '';
    }
  };

  ipcMain.handle('fluxor:git-diff', async (_event, cwd: string) => gitDiff(cwd));

  ipcMain.handle('fluxor:git-show-file', async (_event, cwd: string, filePath: string): Promise<string | null> => {
    try {
      const { stdout } = await execFileAsync('git', ['show', `HEAD:${filePath}`], { cwd, timeout: 10000 });
      return stdout;
    } catch {
      return null;
    }
  });

  ipcMain.handle('fluxor:git-diff-files', async (_event, cwd: string, files: string[]) =>
    files.length ? gitDiff(cwd, ['--', ...files]) : ''
  );

  // Git branch operations
  ipcMain.handle('fluxor:git-branches', async (_event, cwd: string): Promise<{ current: string; branches: string[] }> => {
    try {
      const { stdout } = await execFileAsync('git', ['branch', '-a', '--format=%(refname:short)'], { cwd, timeout: 10000 });
      const all = stdout.trim().split('\n').filter(Boolean).map(b => b.replace(/^origin\//, '').trim());
      const unique = [...new Set(all)];
      const { stdout: currentOut } = await execFileAsync('git', ['branch', '--show-current'], { cwd, timeout: 5000 });
      return { current: currentOut.trim(), branches: unique };
    } catch {
      return { current: '', branches: [] };
    }
  });

  ipcMain.handle('fluxor:git-checkout', async (_event, cwd: string, branch: string, create = false) => {
    return gitOp(create ? ['checkout', '-b', branch] : ['checkout', branch], cwd, 15000);
  });

  ipcMain.handle('fluxor:git-fetch', async (_event, cwd: string) => {
    return gitOp(['fetch', '--all', '--prune'], cwd, 30000);
  });

  ipcMain.handle('fluxor:git-pull', async (_event, cwd: string) => {
    return gitOp(['pull'], cwd, 30000);
  });

  // Git file statuses for diff view (M=modified, A=added, D=deleted, R=renamed, ?=untracked)
  ipcMain.handle('fluxor:git-file-statuses', async (_event, cwd: string): Promise<Array<{ path: string; status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' }>> => {
    const STATUS_MAP: Record<string, 'untracked' | 'added' | 'deleted' | 'renamed'> = {
      '?': 'untracked', 'A': 'added', 'D': 'deleted', 'R': 'renamed',
    };
    try {
      const { stdout } = await execFileAsync('git', ['status', '--porcelain', '-u'], { cwd, timeout: 10000 });
      return stdout.trim().split('\n').filter(Boolean).map(line => {
        const xy = line.slice(0, 2);
        const filePath = line.slice(3).trim().replace(/^"(.*)"$/, '$1');
        const status = Object.keys(STATUS_MAP).find(k => xy.includes(k));
        return { path: filePath, status: status ? STATUS_MAP[status] : 'modified' };
      });
    } catch {
      return [];
    }
  });

  // ─── Market Inventory ──────────────────────────────────────────

  ipcMain.handle('fluxor:read-market-inventory', async (_event, projectPath: string) => {
    const loadInventory = async (inventoryPath: string): Promise<any | null> => {
      try {
        const content = await readFile(inventoryPath, 'utf-8');
        return JSON.parse(content);
      } catch {
        return null;
      }
    };

    // Try projectPath first (user projects may have their own market/inventory.json).
    const projectInventoryPath = join(projectPath, 'market', 'inventory.json');
    const projectInventory = await loadInventory(projectInventoryPath);
    if (projectInventory) {
      return projectInventory;
    }

    // Fallback: read from the IDE's own app root (market/ lives alongside the app).
    const appRoot = app.getAppPath();
    const appInventoryPath = join(appRoot, 'market', 'inventory.json');
    const appInventory = await loadInventory(appInventoryPath);
    if (appInventory) {
      return appInventory;
    }

    return null;
  });

  ipcMain.handle('fluxor:read-market-prompt', async (_event, projectPath: string, category: string, name: string) => {
    const promptContent = await readMarketPromptFromDisk(projectPath, category, name);
    if (!promptContent) return null;

    return promptContent;
  });

  // ─── Backlog Cards ─────────────────────────────────────────────

  ipcMain.handle('fluxor:read-backlog', async (_event, projectPath: string) => {
    const backlogDir = join(projectPath, '.backlog');
    try {
      const entries = await readdir(backlogDir);
      const cards: BacklogCard[] = [];
      for (const entry of entries) {
        if (!entry.endsWith('.md')) continue;
        try {
          const filePath = join(backlogDir, entry);
          const content = await readFile(filePath, 'utf-8');
          const card = await parseBacklogCard(filePath, content, { projectRoot: projectPath });
          if (card) cards.push(card);
        } catch { /* skip unreadable cards */ }
      }
      cards.sort((a, b) => a.order - b.order);
      return cards;
    } catch {
      return [];
    }
  });

  // ─── Scan Projects Folder for Backlogs ───────────────────────────

  ipcMain.handle('fluxor:scan-backlogs', async (_event, projectsPath: string) => {
    const results: Array<{
      projectPath: string;
      projectName: string;
      backlogPath: string;
      cardCount: number;
      isExternal: boolean;
    }> = [];

    try {
      const entries = await readdir(projectsPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (IGNORED_DIRS.has(entry.name)) continue;

        const projPath = join(projectsPath, entry.name);

        // Check in-project .backlog
        const inProjectBacklog = join(projPath, '.backlog');
        let found = false;
        try {
          await access(inProjectBacklog);
          const mdFiles = (await readdir(inProjectBacklog)).filter(f => f.endsWith('.md'));
          results.push({
            projectPath: projPath,
            projectName: entry.name,
            backlogPath: inProjectBacklog,
            cardCount: mdFiles.length,
            isExternal: false,
          });
          found = true;
        } catch { /* no in-project backlog */ }

        // Check external backlog in IDE config dir
        if (!found) {
          const configDir = getProjectConfigDir(projPath);
          const extBacklog = join(configDir, '.backlog');
          try {
            await access(extBacklog);
            const mdFiles = (await readdir(extBacklog)).filter(f => f.endsWith('.md'));
            results.push({
              projectPath: projPath,
              projectName: entry.name,
              backlogPath: extBacklog,
              cardCount: mdFiles.length,
              isExternal: true,
            });
          } catch { /* no external backlog either */ }
        }
      }
    } catch { /* can't read projects dir */ }

    return results;
  });

  // ─── List Projects Without Backlogs ──────────────────────────────

  ipcMain.handle('fluxor:list-projects-without-backlog', async (_event, projectsPath: string) => {
    const result: Array<{ projectPath: string; projectName: string }> = [];
    try {
      const entries = await readdir(projectsPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (IGNORED_DIRS.has(entry.name)) continue;

        const projPath = join(projectsPath, entry.name);
        const configDir = getProjectConfigDir(projPath);

        // Check both locations
        let hasBacklog = false;
        try { await access(join(projPath, '.backlog')); hasBacklog = true; } catch {}
        if (!hasBacklog) {
          try { await access(join(configDir, '.backlog')); hasBacklog = true; } catch {}
        }

        if (!hasBacklog) {
          result.push({ projectPath: projPath, projectName: entry.name });
        }
      }
    } catch {}
    return result;
  });

  // ─── Initialize Backlog (in IDE AppData) ─────────────────────────

  ipcMain.handle('fluxor:init-backlog', async (_event, projectPath: string) => {
    try {
      const configDir = getProjectConfigDir(projectPath);
      const backlogDir = join(configDir, '.backlog');
      await mkdir(backlogDir, { recursive: true });
      return { success: true, backlogPath: backlogDir };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  });

  // ─── Update Backlog Card Status ──────────────────────────────────

  ipcMain.handle('fluxor:update-backlog-card-status', async (
    _event,
    backlogDir: string,
    filename: string,
    newStatus?: string,
    newOrder?: number,
    newRunState?: string,
  ) => {
    try {
      const filePath = join(backlogDir, filename);
      const content = await readFile(filePath, 'utf-8');
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!frontmatterMatch) return { success: false, error: 'No frontmatter found' };

      let fm = frontmatterMatch[1];
      const rest = content.slice(frontmatterMatch[0].length);

      if (newStatus !== undefined) {
        fm = /^status:\s*.+$/m.test(fm)
          ? fm.replace(/^status:\s*.+$/m, `status: ${newStatus}`)
          : fm.trimEnd() + `\nstatus: ${newStatus}`;
      }
      if (newOrder !== undefined) {
        fm = /^order:\s*.+$/m.test(fm)
          ? fm.replace(/^order:\s*.+$/m, `order: ${newOrder}`)
          : fm.trimEnd() + `\norder: ${newOrder}`;
      }
      if (newRunState !== undefined) {
        fm = /^runState:\s*.+$/m.test(fm)
          ? fm.replace(/^runState:\s*.+$/m, `runState: ${newRunState}`)
          : fm.trimEnd() + `\nrunState: ${newRunState}`;
      }

      const updatedContent = `---\n${fm}\n---${rest}`;
      await writeFile(filePath, updatedContent, 'utf-8');
      return { success: true };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  });

  // ─── Update Backlog Card Content (title/description/new comment) ──
  //
  // F2 Task 9 — the modal's edit-save and comment-submit both funnel through
  // this one generalized read-modify-write path (mirrors
  // update-backlog-card-status's file-read-modify-write shape, but rebuilds
  // the whole body via the v2 serializer instead of a frontmatter-only regex
  // patch, since title/description/comments all live in the body, not
  // frontmatter). New comments append at the end (F0 spec §1.2).
  ipcMain.handle('fluxor:update-backlog-card-content', async (
    _event,
    backlogDir: string,
    filename: string,
    changes: { title?: string; description?: string; newComment?: { author: string; text: string } },
  ) => {
    try {
      const filePath = join(backlogDir, filename);
      const content = await readFile(filePath, 'utf-8');
      const card = await parseBacklogCard(filePath, content, { projectRoot: backlogDir });
      if (!card) return { success: false, error: 'Could not parse card' };

      const nextTitle = changes.title ?? card.title;
      const nextDescription = changes.description ?? card.description;
      const nextComments = changes.newComment
        ? [...card.comments, { author: changes.newComment.author, date: new Date().toISOString(), text: changes.newComment.text }]
        : card.comments;

      const updatedCard: BacklogCard = {
        ...card,
        title: nextTitle,
        description: nextDescription,
        comments: nextComments,
        updatedAt: new Date().toISOString(),
      };

      const body = renderBody(nextTitle, nextDescription, nextComments, card.attachments);
      const updatedContent = serializeBacklogCard(updatedCard, body);
      await writeFile(filePath, updatedContent, 'utf-8');
      return { success: true };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  });

  // ─── Read Backlog from Specific Directory ────────────────────────

  ipcMain.handle('fluxor:read-backlog-dir', async (_event, backlogDir: string, projectRoot?: string) => {
    try {
      const entries = await readdir(backlogDir);
      const cards: BacklogCard[] = [];
      for (const entry of entries) {
        if (!entry.endsWith('.md')) continue;
        try {
          const filePath = join(backlogDir, entry);
          const content = await readFile(filePath, 'utf-8');
          const card = await parseBacklogCard(filePath, content, { projectRoot: projectRoot ?? backlogDir });
          if (card) cards.push(card);
        } catch { /* skip unreadable cards */ }
      }
      cards.sort((a, b) => a.order - b.order);
      return cards;
    } catch {
      return [];
    }
  });

  // ─── Batch Update Backlog Cards (status + order) ──────────────────

  ipcMain.handle('fluxor:update-backlog-cards', async (
    _event,
    backlogDir: string,
    updates: Array<{ filename: string; status?: string; order?: number; runState?: string }>,
  ) => {
    try {
      for (const update of updates) {
        const filePath = join(backlogDir, update.filename);
        const content = await readFile(filePath, 'utf-8');
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (!frontmatterMatch) continue;

        let fm = frontmatterMatch[1];
        const rest = content.slice(frontmatterMatch[0].length);

        if (update.status !== undefined) {
          if (/^status:\s*.+$/m.test(fm)) {
            fm = fm.replace(/^status:\s*.+$/m, `status: ${update.status}`);
          } else {
            fm = fm.trimEnd() + `\nstatus: ${update.status}`;
          }
        }

        if (update.order !== undefined) {
          if (/^order:\s*.+$/m.test(fm)) {
            fm = fm.replace(/^order:\s*.+$/m, `order: ${update.order}`);
          } else {
            fm = fm.trimEnd() + `\norder: ${update.order}`;
          }
        }

        if (update.runState !== undefined) {
          if (/^runState:\s*.+$/m.test(fm)) {
            fm = fm.replace(/^runState:\s*.+$/m, `runState: ${update.runState}`);
          } else {
            fm = fm.trimEnd() + `\nrunState: ${update.runState}`;
          }
        }

        const updatedContent = `---\n${fm}\n---${rest}`;
        await writeFile(filePath, updatedContent, 'utf-8');
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  });

  // ── Bridge (Remote Control) ───────────────────────────────────────────────────

  ipcMain.handle('bridge:start', async () => {
    try {
      const { startBridgeServer, isBridgeRunning, generateBridgeQR, getPairingToken } = await import('./bridge');
      if (isBridgeRunning()) {
        return { success: true, message: 'Bridge already running' };
      }

      const getState = () => {
        const win = BrowserWindow.getAllWindows()[0];
        if (!win) return { projectPath: null, activeFile: null, isRunningAgent: false, gitBranch: null, windowCount: 0 };
        return { projectPath: null, activeFile: null, isRunningAgent: false, gitBranch: null, windowCount: BrowserWindow.getAllWindows().length };
      };

      const result = startBridgeServer(getState);
      // The QR encodes the one-time pairing token (fragment-carried), never the PIN.
      const pairingToken = getPairingToken();
      const qr = pairingToken
        ? await generateBridgeQR(result.port, '0.0.0.0', pairingToken)
        : { url: '', qrDataUrl: '', localIp: '' };
      return { success: true, port: result.port, pin: result.pin, ...qr };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  });

  ipcMain.handle('bridge:stop', async () => {
    try {
      const { stopBridgeServer } = await import('./bridge');
      stopBridgeServer();
      return { success: true };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  });

  ipcMain.handle('bridge:status', async () => {
    try {
      const { isBridgeRunning, getBridgeConfig, getConnectedClientCount, getActiveSessionCount } = await import('./bridge');
      const running = isBridgeRunning();
      const config = getBridgeConfig();
      return {
        running,
        port: config?.port ?? null,
        pin: config?.pin ?? null,
        connectedClients: running ? getConnectedClientCount() : 0,
        activeSessions: running ? getActiveSessionCount() : 0,
      };
    } catch (err) {
      return { running: false, error: errMsg(err) };
    }
  });

  ipcMain.handle('bridge:get-qr', async () => {
    try {
      const { getBridgeConfig, getPairingToken, generateBridgeQR } = await import('./bridge');
      const config = getBridgeConfig();
      const pairingToken = getPairingToken();
      if (!config || !pairingToken) {
        return { success: false, error: 'Bridge not running or pairing token expired — refresh PIN for a new QR' };
      }
      const qr = await generateBridgeQR(config.port, config.host, pairingToken);
      return { success: true, ...qr };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  });

  // ── Time-travel checkpoint IPC (ARCH-073) ─────────────────────────────────
  // Delegated to a dedicated module to keep this file additive.
  registerCheckpointIpcHandlers();

  // ── MCP command allowlist + consent (audit 1.4) ───────────────────────────
  // mcp:listApprovedCommands / mcp:approveCommand / mcp:revokeCommand.
  registerMcpCommandPolicyIpcHandlers();

  // ── Anonymous opt-in telemetry (audit 1.8b) ───────────────────────────────
  // telemetry:getOptIn / telemetry:setOptIn.
  registerTelemetryIpcHandlers();

  // ── Performance Frontier Scorecard + Arena IPC (ARCH-079) ─────────────────
  // Registers pf:run-scorecard / pf:scorecard-progress and
  // pf:run-arena / pf:arena-progress so the renderer panels can invoke them.
  registerScorecardIpc(mainWindow);
  registerArenaIpc(mainWindow);

  // ─── Arena leaderboard ────────────────────────────────────────────────────
  // Reads the JSON file written by `npm run pf:arena`. ENOENT is not an error —
  // it simply means no Arena run has been executed yet for this project.

  ipcMain.handle('arena:read-leaderboard', async (_e, projectPath: string) => {
    const leaderboardPath = join(
      projectPath, '.fluxor', 'performance-frontier', 'fluxor-leaderboard.json',
    );
    try {
      const raw = await readFile(leaderboardPath, 'utf-8');
      const entries = JSON.parse(raw) as import('../types/arena').ArenaLeaderboardEntry[];
      return { success: true, data: entries };
    } catch (err) {
      // ENOENT → no Arena run yet; return an empty list rather than an error
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { success: true, data: [] };
      }
      return { success: false, error: errMsg(err) };
    }
  });
}
