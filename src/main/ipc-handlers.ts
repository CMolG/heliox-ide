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
import { ipcMain, BrowserWindow, dialog, app, Notification } from 'electron';
import type { OpenDialogOptions, SaveDialogOptions } from 'electron';
import { AgentManager } from './agent-manager';
import { Flow, FileEntry, CliStatus, RunAgentParams, errMsg } from '../types';
import { execFile } from 'child_process';
import { readdir, stat, readFile, writeFile, mkdir, unlink, rm, rename, access } from 'fs/promises';
import { join, basename, relative } from 'path';
import { promisify } from 'util';
import { createHash } from 'crypto';
import { log } from './logger';

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

const MARKET_PROMPT_CATEGORIES = new Set(['flows', 'roles', 'mods', 'design-systems']);

function getProjectConfigDir(projectPath: string): string {
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
  if (ipcHandlersRegistered) return;
  ipcHandlersRegistered = true;

  // ── Agent lifecycle and streaming bridge ─────────────────────────────────────
  ipcMain.handle('heliox:init-baselines', async (_event, flows: Flow[]) => {
    await agentManager.initialize(flows);
    return { success: true };
  });

  ipcMain.handle('heliox:run-agent', async (_event, params: RunAgentParams) => {
    const listeners = new Map<AgentEventName, (...args: any[]) => void>();

    for (const eventName of AGENT_EVENTS) {
      const handler = (data: any) => {
        sendToRenderer('heliox:agent-event', {
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

  ipcMain.handle('heliox:approve-diff', async (_event, diffId: string) => {
    try {
      agentManager.emit('diff-approved', { diffId });
      sendToRenderer('heliox:agent-event', {
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

  ipcMain.handle('heliox:reject-diff', async (_event, diffId: string, feedback: string) => {
    try {
      agentManager.emit('diff-rejected', { diffId, feedback });
      sendToRenderer('heliox:agent-event', {
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

  ipcMain.handle('heliox:shutdown', async () => {
    await agentManager.shutdown();
    return { success: true };
  });

  // ── Project and filesystem helpers ──────────────────────────────────────────
  ipcMain.handle('heliox:open-folder-dialog', async () => {
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

  ipcMain.handle('heliox:read-dir', async (_event, dirPath: string): Promise<FileEntry[]> => {
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

  ipcMain.handle('heliox:check-cli', async (): Promise<CliStatus> => {
    const NONE: CliStatus = { copilotInstalled: false, ghInstalled: false, ghCopilotInstalled: false, nodeInstalled: false, gitInstalled: false };
    // Process checks are best-effort and isolated so one missing executable
    // doesn't prevent reporting the others.
    const check = async (cmd: string, args: string[]): Promise<boolean> => {
      try {
        await execFileAsync(cmd, args, { timeout: 5000 });
        return true;
      } catch {
        return false;
      }
    };

    try {
      const [copilotInstalled, ghInstalled, nodeInstalled, gitInstalled] = await Promise.all([
        check('copilot', ['--version']),
        check('gh', ['--version']),
        check('node', ['--version']),
        check('git', ['--version']),
      ]);

      let ghCopilotInstalled = false;
      if (ghInstalled) {
        ghCopilotInstalled = await check('gh', ['copilot', '--help']);
      }

      return {
        copilotInstalled,
        ghInstalled,
        ghCopilotInstalled: copilotInstalled || ghCopilotInstalled,
        nodeInstalled,
        gitInstalled,
      };
    } catch {
      return NONE;
    }
  });

  ipcMain.handle('heliox:get-project-name', async (_event, projectPath: string): Promise<string> => {
    try {
      return basename(projectPath);
    } catch {
      return 'unknown';
    }
  });

  // Project config file I/O (stored in user data directory, not project)
  ipcMain.handle('heliox:read-project-config', async (_event, projectPath: string, filename: string): Promise<string | null> => {
    try {
      const configDir = getProjectConfigDir(projectPath);
      const configPath = join(configDir, filename);
      return await readFile(configPath, 'utf-8');
    } catch {
      return null;
    }
  });

  ipcMain.handle('heliox:write-project-config', async (_event, projectPath: string, filename: string, content: string): Promise<boolean> => {
    try {
      const configDir = getProjectConfigDir(projectPath);
      await mkdir(configDir, { recursive: true });
      await writeFile(join(configDir, filename), content, 'utf-8');
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('heliox:get-config-dir', async (_event, projectPath: string): Promise<string> => {
    return getProjectConfigDir(projectPath);
  });

  // File content reading (for center panel file viewer)
  ipcMain.handle('heliox:read-file', async (_event, filePath: string): Promise<string | null> => {
    try {
      const s = await stat(filePath);
      if (s.size > 1024 * 1024) return null;
      return await readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  });

  // TSV result logging
  ipcMain.handle('heliox:log-result', async (_event, projectPath: string, row: {
    commit: string;
    target: string;
    status: string;
    lcpDelta: string;
    visualDiffPct: string;
    description: string;
  }) => {
    try {
      const tsvPath = join(projectPath, 'heliox-results.tsv');
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
  ipcMain.handle('heliox:git-status', async (_event, cwd: string): Promise<{ clean: boolean; files: string[] }> => {
    try {
      const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd, timeout: 10000 });
      const files = stdout.trim().split('\n').filter(Boolean).map(line => line.trim());
      return { clean: files.length === 0, files };
    } catch {
      return { clean: true, files: [] };
    }
  });

  ipcMain.handle('heliox:git-status-info', async (_event, cwd: string): Promise<{ branch: string; modified: number; staged: number; untracked: number }> => {
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

  ipcMain.handle('heliox:git-diff-summary', async (_event, cwd: string): Promise<string> => {
    try {
      const { stdout } = await execFileAsync('git', ['diff', '--stat'], { cwd, timeout: 10000 });
      return stdout.trim();
    } catch {
      return '';
    }
  });

  ipcMain.handle('heliox:git-commit', async (_event, cwd: string, message: string): Promise<{ success: boolean; hash?: string; error?: string }> => {
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

  ipcMain.handle('heliox:git-reset', async (_event, cwd: string): Promise<boolean> => {
    try {
      await execFileAsync('git', ['reset', '--hard', 'HEAD~1'], { cwd, timeout: 10000 });
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('heliox:stop-agent', async (_event, agentId: string): Promise<boolean> => {
    return agentManager.stopAgent(agentId);
  });

  ipcMain.handle('heliox:show-notification', async (_event, opts: { title: string; body: string }): Promise<void> => {
    if (Notification.isSupported()) {
      new Notification({ title: opts.title, body: opts.body }).show();
    }
  });

  ipcMain.handle('heliox:open-file-dialog', async (_event, cwd: string): Promise<string | null> => {
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

  // ── Models cache (disk-backed, 24 h TTL) ────────────────────────────────────
  const MODELS_CACHE_PATH = join(app.getPath('userData'), 'models-cache.json');
  const MODELS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  // Cheapest model available — used only for the listModels query (near-zero cost).
  // Users can override with HELIOX_LIST_MODEL env var.
  const LIST_MODEL = process.env.HELIOX_LIST_MODEL ?? 'gpt-4.1';

  const FALLBACK_MODELS = [
    'claude-sonnet-4.6', 'claude-sonnet-4.5', 'claude-haiku-4.5',
    'claude-opus-4.6', 'claude-opus-4.6-fast', 'claude-opus-4.5', 'claude-sonnet-4',
    'gemini-3-pro-preview',
    'gpt-5.4', 'gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.2',
    'gpt-5.1-codex-max', 'gpt-5.1-codex', 'gpt-5.1',
    'gpt-5.4-mini', 'gpt-5.1-codex-mini', 'gpt-5-mini', 'gpt-4.1',
  ];

  interface ModelsCache { models: string[]; fetchedAt: number; }

  async function readModelsCache(): Promise<ModelsCache | null> {
    try {
      const raw = await readFile(MODELS_CACHE_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as ModelsCache;
      if (Array.isArray(parsed.models) && typeof parsed.fetchedAt === 'number') return parsed;
    } catch { /* missing or corrupt */ }
    return null;
  }

  async function writeModelsCache(models: string[]): Promise<void> {
    try {
      await writeFile(MODELS_CACHE_PATH, JSON.stringify({ models, fetchedAt: Date.now() }), 'utf-8');
    } catch (err) {
      log.warn('[Heliox] Could not write models cache:', (err as Error).message);
    }
  }

  async function fetchModelsFromCli(): Promise<string[] | null> {
    try {
      const { stdout } = await execFileAsync('copilot', [
        '-p', 'Respond ONLY with a JSON array of all available model IDs. No markdown, no explanation, just the raw JSON array.',
        '--output-format', 'json',
        '--model', LIST_MODEL,
      ], { timeout: 30_000, env: { ...process.env, PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin` } });

      // CLI emits JSONL events; aggregate assistant deltas then extract the
      // first JSON array payload produced by the prompt contract.
      let content = '';
      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === 'assistant.message_delta' && event.data?.deltaContent) {
            content += event.data.deltaContent;
          }
        } catch { /* non-JSON line */ }
      }

      const jsonMatch = content.match(/\[[\s\S]*?\]/);
      if (jsonMatch) {
        const models = JSON.parse(jsonMatch[0]) as string[];
        if (Array.isArray(models) && models.length > 0 && models.every(m => typeof m === 'string')) {
          return models;
        }
      }
    } catch (err) {
      log.warn('[Heliox] Failed to fetch models from copilot CLI:', (err as Error).message);
    }
    return null;
  }

  ipcMain.handle('heliox:list-models', async (): Promise<string[]> => {
    // HELIOX_MODELS env var: bypass everything (used in E2E tests and custom setups)
    const envModels = process.env.HELIOX_MODELS;
    if (envModels) {
      const models = envModels.split(',').map(m => m.trim()).filter(Boolean);
      log.info('[Heliox] Using HELIOX_MODELS env override:', models);
      return models;
    }

    // Check disk cache — use it if still fresh (< 24 h)
    const cached = await readModelsCache();
    if (cached && Date.now() - cached.fetchedAt < MODELS_CACHE_TTL_MS) {
      log.info('[Heliox] Using cached models (age:', Math.round((Date.now() - cached.fetchedAt) / 60_000), 'min)');
      return cached.models;
    }

    // Cache missing or stale — fetch from CLI with the cheap model
    log.info('[Heliox] Fetching model list via copilot CLI with model:', LIST_MODEL);
    const fetched = await fetchModelsFromCli();
    if (fetched) {
      await writeModelsCache(fetched);
      return fetched;
    }

    // Keep serving stale cache rather than showing hardcoded fallback
    if (cached) {
      log.warn('[Heliox] CLI fetch failed — serving stale cache');
      return cached.models;
    }

    log.warn('[Heliox] No cache and CLI fetch failed — using built-in fallback list');
    return FALLBACK_MODELS;
  });

  // Called when an agent fails with a model error — forces a fresh fetch next time
  ipcMain.handle('heliox:invalidate-models-cache', async (): Promise<void> => {
    try {
      const { unlink } = await import('fs/promises');
      await unlink(MODELS_CACHE_PATH);
      log.info('[Heliox] Models cache invalidated');
    } catch { /* file may not exist */ }
  });

  ipcMain.handle('heliox:list-project-files', async (_event, projectPath: string): Promise<string[]> => {
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

  ipcMain.handle('heliox:save-file', async (_event, defaultPath: string, content: string): Promise<boolean> => {
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

  // Direct file write (no dialog) — for inline code editing
  ipcMain.handle('heliox:write-file', async (_event, filePath: string, content: string): Promise<boolean> => {
    try {
      await writeFile(filePath, content, 'utf-8');
      return true;
    } catch {
      return false;
    }
  });

  // Create a new empty file
  ipcMain.handle('heliox:create-file', async (_event, filePath: string): Promise<boolean> => {
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
  ipcMain.handle('heliox:create-directory', async (_event, dirPath: string): Promise<boolean> => {
    try {
      await mkdir(dirPath, { recursive: true });
      return true;
    } catch {
      return false;
    }
  });

  // Delete a file
  ipcMain.handle('heliox:delete-file', async (_event, filePath: string): Promise<boolean> => {
    try {
      await unlink(filePath);
      return true;
    } catch {
      return false;
    }
  });

  // Delete a directory (recursive)
  ipcMain.handle('heliox:delete-directory', async (_event, dirPath: string): Promise<boolean> => {
    try {
      await rm(dirPath, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  });

  // Rename / move a file or directory
  ipcMain.handle('heliox:rename-path', async (_event, oldPath: string, newPath: string): Promise<boolean> => {
    try {
      await rename(oldPath, newPath);
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

  ipcMain.handle('heliox:git-diff', async (_event, cwd: string) => gitDiff(cwd));

  ipcMain.handle('heliox:git-show-file', async (_event, cwd: string, filePath: string): Promise<string | null> => {
    try {
      const { stdout } = await execFileAsync('git', ['show', `HEAD:${filePath}`], { cwd, timeout: 10000 });
      return stdout;
    } catch {
      return null;
    }
  });

  ipcMain.handle('heliox:git-diff-files', async (_event, cwd: string, files: string[]) =>
    files.length ? gitDiff(cwd, ['--', ...files]) : ''
  );

  // Git branch operations
  ipcMain.handle('heliox:git-branches', async (_event, cwd: string): Promise<{ current: string; branches: string[] }> => {
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

  ipcMain.handle('heliox:git-checkout', async (_event, cwd: string, branch: string, create = false) => {
    return gitOp(create ? ['checkout', '-b', branch] : ['checkout', branch], cwd, 15000);
  });

  ipcMain.handle('heliox:git-fetch', async (_event, cwd: string) => {
    return gitOp(['fetch', '--all', '--prune'], cwd, 30000);
  });

  ipcMain.handle('heliox:git-pull', async (_event, cwd: string) => {
    return gitOp(['pull'], cwd, 30000);
  });

  // Git file statuses for diff view (M=modified, A=added, D=deleted, R=renamed, ?=untracked)
  ipcMain.handle('heliox:git-file-statuses', async (_event, cwd: string): Promise<Array<{ path: string; status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' }>> => {
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

  ipcMain.handle('heliox:read-market-inventory', async (_event, projectPath: string) => {
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

  ipcMain.handle('heliox:read-market-prompt', async (_event, projectPath: string, category: string, name: string) => {
    const promptContent = await readMarketPromptFromDisk(projectPath, category, name);
    if (!promptContent) return null;

    return promptContent;
  });

  // ─── Backlog Cards ─────────────────────────────────────────────

  ipcMain.handle('heliox:read-backlog', async (_event, projectPath: string) => {
    try {
      const backlogDir = join(projectPath, '.backlog');
      const entries = await readdir(backlogDir);
      const cards: Array<{
        filename: string;
        taskId: string;
        targetAgent: string;
        targetModule: string;
        priority: string;
        status: string;
        order: number;
        title: string;
        body: string;
      }> = [];

      for (const entry of entries) {
        if (!entry.endsWith('.md')) continue;
        try {
          const content = await readFile(join(backlogDir, entry), 'utf-8');
          const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
          if (!frontmatterMatch) continue;

          const fm = frontmatterMatch[1];
          const parseField = (key: string): string => {
            const match = fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
            return match?.[1]?.trim() ?? '';
          };

          const body = content.slice(frontmatterMatch[0].length).trim();
          const firstLine = body.split('\n')[0] ?? '';
          const title = firstLine.replace(/^#+\s*/, '') || entry.replace('.md', '');

          cards.push({
            filename: entry,
            taskId: parseField('task_id'),
            targetAgent: parseField('target_agent'),
            targetModule: parseField('target_module'),
            priority: parseField('priority') || 'medium',
            status: parseField('status') || 'pending',
            order: parseInt(parseField('order'), 10) || 0,
            title,
            body,
          });
        } catch { /* skip unreadable cards */ }
      }

      cards.sort((a, b) => a.order - b.order);
      return cards;
    } catch {
      return [];
    }
  });

  // ─── Scan Projects Folder for Backlogs ───────────────────────────

  ipcMain.handle('heliox:scan-backlogs', async (_event, projectsPath: string) => {
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

  ipcMain.handle('heliox:list-projects-without-backlog', async (_event, projectsPath: string) => {
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

  ipcMain.handle('heliox:init-backlog', async (_event, projectPath: string) => {
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

  ipcMain.handle('heliox:update-backlog-card-status', async (
    _event,
    backlogDir: string,
    filename: string,
    newStatus: string,
    newOrder?: number,
  ) => {
    try {
      const filePath = join(backlogDir, filename);
      const content = await readFile(filePath, 'utf-8');
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!frontmatterMatch) return { success: false, error: 'No frontmatter found' };

      let fm = frontmatterMatch[1];
      const rest = content.slice(frontmatterMatch[0].length);

      // Replace or add status field
      if (/^status:\s*.+$/m.test(fm)) {
        fm = fm.replace(/^status:\s*.+$/m, `status: ${newStatus}`);
      } else {
        fm = fm.trimEnd() + `\nstatus: ${newStatus}`;
      }

      // Replace or add order field when provided
      if (newOrder !== undefined) {
        if (/^order:\s*.+$/m.test(fm)) {
          fm = fm.replace(/^order:\s*.+$/m, `order: ${newOrder}`);
        } else {
          fm = fm.trimEnd() + `\norder: ${newOrder}`;
        }
      }

      const updatedContent = `---\n${fm}\n---${rest}`;
      await writeFile(filePath, updatedContent, 'utf-8');
      return { success: true };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  });

  // ─── Read Backlog from Specific Directory ────────────────────────

  ipcMain.handle('heliox:read-backlog-dir', async (_event, backlogDir: string) => {
    try {
      const entries = await readdir(backlogDir);
      const cards: Array<{
        filename: string;
        taskId: string;
        targetAgent: string;
        targetModule: string;
        priority: string;
        status: string;
        order: number;
        title: string;
        body: string;
      }> = [];

      for (const entry of entries) {
        if (!entry.endsWith('.md')) continue;
        try {
          const content = await readFile(join(backlogDir, entry), 'utf-8');
          const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
          if (!frontmatterMatch) continue;

          const fm = frontmatterMatch[1];
          const parseField = (key: string): string => {
            const match = fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
            return match?.[1]?.trim() ?? '';
          };

          const body = content.slice(frontmatterMatch[0].length).trim();
          const firstLine = body.split('\n')[0] ?? '';
          const title = firstLine.replace(/^#+\s*/, '') || entry.replace('.md', '');

          cards.push({
            filename: entry,
            taskId: parseField('task_id'),
            targetAgent: parseField('target_agent'),
            targetModule: parseField('target_module'),
            priority: parseField('priority') || 'medium',
            status: parseField('status') || 'pending',
            order: parseInt(parseField('order'), 10) || 0,
            title,
            body,
          });
        } catch { /* skip unreadable cards */ }
      }

      cards.sort((a, b) => a.order - b.order);
      return cards;
    } catch {
      return [];
    }
  });

  // ─── Batch Update Backlog Cards (status + order) ──────────────────

  ipcMain.handle('heliox:update-backlog-cards', async (
    _event,
    backlogDir: string,
    updates: Array<{ filename: string; status?: string; order?: number }>,
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
      const { startBridgeServer, isBridgeRunning, generateBridgeQR } = await import('./bridge');
      if (isBridgeRunning()) {
        return { success: true, message: 'Bridge already running' };
      }

      const getState = () => {
        const win = BrowserWindow.getAllWindows()[0];
        if (!win) return { projectPath: null, activeFile: null, isRunningAgent: false, gitBranch: null, windowCount: 0 };
        return { projectPath: null, activeFile: null, isRunningAgent: false, gitBranch: null, windowCount: BrowserWindow.getAllWindows().length };
      };

      const result = startBridgeServer(getState);
      const qr = await generateBridgeQR(result.port, '0.0.0.0', result.pin);
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
      const { getBridgeConfig, generateBridgeQR } = await import('./bridge');
      const config = getBridgeConfig();
      if (!config) return { success: false, error: 'Bridge not running' };
      const qr = await generateBridgeQR(config.port, config.host, config.pin);
      return { success: true, ...qr };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  });
}
