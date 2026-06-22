/**
 * opencode-providers.ts — Main process
 *
 * Responsibility:
 * - Discover which OpenCode providers are configured (reads opencode's own
 *   `auth.json`) and enumerate their available models (`opencode models …`).
 * - Persist or remove provider credentials by writing back to `auth.json` so
 *   the OpenCode CLI sees them on the next spawn.
 *
 * Boundaries:
 * - Owns: filesystem I/O against `~/.local/share/opencode/auth.json` and
 *   shelling out to the `opencode` binary for model discovery.
 * - Does NOT own: IPC transport (lives in ipc-handlers).
 *
 * Source of truth: `auth.json` is the OpenCode CLI's own credential store.
 * Mirroring credentials inside electron-store would create drift, so we read
 * and write that file directly.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile, mkdir, access } from 'fs/promises';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { log } from './logger';

const execFileAsync = promisify(execFile);

// ─── Auth file location ────────────────────────────────────────────────────

function authPath(): string {
  const xdg = process.env.XDG_DATA_HOME;
  const base = xdg && xdg.trim() ? xdg : join(homedir(), '.local', 'share');
  return join(base, 'opencode', 'auth.json');
}

// ─── Provider catalog (display metadata) ───────────────────────────────────

export interface OpencodeProviderEntry {
  /** Stable id used as `--model {id}/…` prefix and as the key in `auth.json`. */
  id: string;
  /** Human label rendered in the picker. */
  label: string;
  /** Single-line description shown under the label. */
  description: string;
  /** Hex accent color for the provider card. */
  accent: string;
  /** Whether a credential is currently configured (read from auth.json). */
  authorized: boolean;
  /** Free-form auth hint shown when not authorized. */
  authHint?: string;
  /** Format hint for an API key (e.g. `tp-…`, `sk-…`). */
  keyPrefix?: string;
}

/**
 * Curated catalog of well-known providers. New entries surface automatically
 * for any provider id we don't recognize that shows up in auth.json.
 */
const KNOWN_PROVIDERS: Omit<OpencodeProviderEntry, 'authorized'>[] = [
  {
    id: 'opencode',
    label: 'OpenCode Zen',
    description: 'Subscription — Claude, GPT, Gemini, GLM, Kimi and more in one plan.',
    accent: '#FF6B35',
    authHint: 'Paste your Zen token from opencode.ai/zen',
    keyPrefix: 'tp-',
  },
  {
    id: 'xiaomi-token-plan-ams',
    label: 'Xiaomi MiMo (EU)',
    description: 'MiMo V2 Pro / Omni / TTS via the Amsterdam token-plan endpoint.',
    accent: '#FF5A1F',
    authHint: 'Paste your token-plan key (starts with tp-).',
    keyPrefix: 'tp-',
  },
  {
    id: 'xiaomi-token-plan-cn',
    label: 'Xiaomi MiMo (CN)',
    description: 'Same MiMo V2 family routed through the China region.',
    accent: '#E04F2E',
    authHint: 'Paste your token-plan key (starts with tp-).',
    keyPrefix: 'tp-',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    description: 'Universal gateway — every major model behind one API key.',
    accent: '#7C3AED',
    authHint: 'Paste your OpenRouter API key.',
    keyPrefix: 'sk-or-',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    description: 'Direct Claude API (Opus, Sonnet, Haiku).',
    accent: '#E87040',
    authHint: 'Paste your Anthropic console key.',
    keyPrefix: 'sk-ant-',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    description: 'Direct OpenAI API (GPT family + Codex).',
    accent: '#10A37F',
    authHint: 'Paste your OpenAI key.',
    keyPrefix: 'sk-',
  },
  {
    id: 'google',
    label: 'Google Gemini',
    description: 'Direct Gemini API (Pro, Flash).',
    accent: '#4285F4',
    authHint: 'Paste your AI Studio key.',
    keyPrefix: 'AI',
  },
  {
    id: 'groq',
    label: 'Groq',
    description: 'Ultra-low-latency inference on Llama, Mixtral, GPT-OSS.',
    accent: '#F55036',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    description: 'DeepSeek-V3 and reasoning models direct from the source.',
    accent: '#1F77FF',
  },
  {
    id: 'xai',
    label: 'xAI Grok',
    description: 'Grok 4 family — fast, witty, tool-using.',
    accent: '#0EA5E9',
  },
];

function lookupKnown(id: string): Omit<OpencodeProviderEntry, 'authorized'> | undefined {
  return KNOWN_PROVIDERS.find(p => p.id === id);
}

function fallbackEntry(id: string): Omit<OpencodeProviderEntry, 'authorized'> {
  // Title-case the id for an at-least-readable label when we don't know it.
  const label = id.split(/[-_]/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
  return {
    id,
    label,
    description: 'Custom provider configured in auth.json.',
    accent: '#9CA3AF',
  };
}

// ─── Auth file I/O ─────────────────────────────────────────────────────────

interface AuthRecord {
  type: 'api' | 'oauth' | string;
  key?: string;
  [k: string]: unknown;
}

type AuthFile = Record<string, AuthRecord>;

async function readAuth(): Promise<AuthFile> {
  try {
    const raw = await readFile(authPath(), 'utf-8');
    const parsed = JSON.parse(raw) as AuthFile;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeAuth(auth: AuthFile): Promise<void> {
  const path = authPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(auth, null, 2), 'utf-8');
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Returns every provider that we know about plus every additional provider
 * already configured in `auth.json` (so custom providers still appear).
 */
export async function listProviders(): Promise<OpencodeProviderEntry[]> {
  const auth = await readAuth();
  const ids = new Set<string>([
    ...KNOWN_PROVIDERS.map(p => p.id),
    ...Object.keys(auth),
  ]);
  const entries: OpencodeProviderEntry[] = [];
  for (const id of ids) {
    const meta = lookupKnown(id) ?? fallbackEntry(id);
    entries.push({ ...meta, authorized: Boolean(auth[id]?.key) });
  }
  // Authorized providers first, then known catalog order, then the rest.
  const knownIndex = (id: string) => {
    const idx = KNOWN_PROVIDERS.findIndex(p => p.id === id);
    return idx < 0 ? KNOWN_PROVIDERS.length : idx;
  };
  entries.sort((a, b) => {
    if (a.authorized !== b.authorized) return a.authorized ? -1 : 1;
    return knownIndex(a.id) - knownIndex(b.id);
  });
  return entries;
}

/**
 * Persist a provider credential. Writing through to opencode's auth.json keeps
 * the CLI in sync on the very next invocation — no env-var plumbing needed.
 */
export async function saveProviderCredential(id: string, key: string): Promise<void> {
  const trimmed = key.trim();
  if (!trimmed) throw new Error('API key is empty');
  const auth = await readAuth();
  auth[id] = { type: 'api', key: trimmed };
  await writeAuth(auth);
}

/** Remove a stored credential. */
export async function removeProviderCredential(id: string): Promise<void> {
  const auth = await readAuth();
  if (id in auth) {
    delete auth[id];
    await writeAuth(auth);
  }
}

// ─── Model discovery ───────────────────────────────────────────────────────

let modelsCache: { fetchedAt: number; models: string[] } | null = null;
const MODELS_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Run `opencode models [provider]` and parse the `provider/model` lines.
 * Cached for 30 minutes (per-process) so the picker stays snappy.
 */
export async function listModels(providerId?: string, opts?: { refresh?: boolean }): Promise<string[]> {
  if (!opts?.refresh && !providerId && modelsCache && Date.now() - modelsCache.fetchedAt < MODELS_TTL_MS) {
    return modelsCache.models;
  }
  const args = ['models'];
  if (providerId) args.push(providerId);
  if (opts?.refresh) args.push('--refresh');
  try {
    const { stdout } = await execFileAsync('opencode', args, {
      timeout: 30_000,
      env: { ...process.env, PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin:${homedir()}/.opencode/bin` },
    });
    const models = stdout
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.includes('/') && !line.startsWith('Error') && !line.startsWith('['));
    if (!providerId) {
      modelsCache = { fetchedAt: Date.now(), models };
    }
    return models;
  } catch (err) {
    log.warn('[opencode-providers] models fetch failed:', (err as Error).message);
    return [];
  }
}

// ─── CLI presence + version ────────────────────────────────────────────────

export async function opencodeStatus(): Promise<{ installed: boolean; version: string | null; path: string | null }> {
  try {
    const { stdout } = await execFileAsync('opencode', ['--version'], { timeout: 5000 });
    return { installed: true, version: stdout.trim(), path: 'opencode' };
  } catch {
    // Try the default install location explicitly.
    const local = join(homedir(), '.opencode', 'bin', 'opencode');
    try {
      await access(local);
      const { stdout } = await execFileAsync(local, ['--version'], { timeout: 5000 });
      return { installed: true, version: stdout.trim(), path: local };
    } catch {
      return { installed: false, version: null, path: null };
    }
  }
}
