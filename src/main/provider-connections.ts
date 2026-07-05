/**
 * provider-connections.ts — Main process
 *
 * Responsibility:
 * - Persist DBeaver-style "connection profiles" (protocol + base URL + API
 *   token + per-model enable flags) to a single JSON file under the app's
 *   userData directory.
 * - Encrypt tokens at rest via Electron's `safeStorage` so the JSON file
 *   never holds a plaintext secret. Falls back to storing the token in
 *   plaintext (with a loud warning) when `safeStorage.isEncryptionAvailable()`
 *   is false — e.g. some minimal Linux containers lack a keyring backend —
 *   mirroring how the codebase already degrades gracefully rather than
 *   hard-failing when an optional security primitive is unavailable (see
 *   `market/market-trust.ts`'s empty `TRUSTED_MARKET_KEYS` bootstrap mode).
 * - NEVER returns a decrypted token to callers outside this module except via
 *   the explicitly-named `getDecryptedToken` (main-only: the connection
 *   tester and the harness model resolver call it at the ipc/executor
 *   boundary). Every other reader gets `hasToken: boolean` only.
 *
 * Boundaries:
 * - Owns: connection-profile file I/O + encryption.
 * - Does NOT own: IPC transport (ipc-handlers.ts), network calls to test a
 *   connection (provider-connection-tester.ts), or AI SDK model resolution
 *   (harness-engine/llm-runner.ts).
 */
import { app, safeStorage } from 'electron';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { randomUUID } from 'node:crypto';
import { log } from './logger';
import type {
  ConnectionModel,
  ConnectionProtocol,
  ProviderConnection,
  ProviderConnectionInput,
  ProviderConnectionUpdate,
} from '../types/ipc-events';

// ─── Storage location ───────────────────────────────────────────────────────

function storeFilePath(): string {
  return join(app.getPath('userData'), 'provider-connections.json');
}

// ─── On-disk record shape (internal — the encrypted/plaintext token never
// leaves this module as a return value; only `hasToken` does) ──────────────

interface StoredToken {
  /** Base64 ciphertext from `safeStorage.encryptString`, OR plaintext when encryption is unavailable. */
  value: string;
  /** False only when `safeStorage.isEncryptionAvailable()` was false at write time. */
  encrypted: boolean;
}

interface StoredConnection {
  id: string;
  name: string;
  protocol: ConnectionProtocol;
  baseUrl: string;
  token?: StoredToken;
  models: ConnectionModel[];
  lastTestedAt?: number;
  lastTestOk?: boolean;
}

interface StoreFile {
  connections: StoredConnection[];
}

const EMPTY_STORE: StoreFile = { connections: [] };

async function readStore(): Promise<StoreFile> {
  try {
    const raw = await readFile(storeFilePath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<StoreFile>;
    return { connections: Array.isArray(parsed.connections) ? parsed.connections : [] };
  } catch {
    // Missing file (first run) or corrupt JSON — start fresh rather than throw.
    return { ...EMPTY_STORE, connections: [] };
  }
}

async function writeStore(store: StoreFile): Promise<void> {
  const filePath = storeFilePath();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(store, null, 2), 'utf-8');
}

// ─── Token encryption ───────────────────────────────────────────────────────

function encryptToken(token: string): StoredToken {
  if (!safeStorage.isEncryptionAvailable()) {
    log.warn(
      '[provider-connections] safeStorage encryption is unavailable on this machine — ' +
      'storing the connection token in PLAINTEXT as a degraded fallback (expected on some ' +
      'minimal Linux containers without a keyring backend; a real security reduction on a user machine).',
    );
    return { value: token, encrypted: false };
  }
  return { value: safeStorage.encryptString(token).toString('base64'), encrypted: true };
}

function decryptToken(stored: StoredToken | undefined): string | undefined {
  if (!stored) return undefined;
  if (!stored.encrypted) return stored.value;
  try {
    return safeStorage.decryptString(Buffer.from(stored.value, 'base64'));
  } catch (err) {
    log.warn('[provider-connections] failed to decrypt a stored connection token:', (err as Error).message);
    return undefined;
  }
}

function toPublic(stored: StoredConnection): ProviderConnection {
  return {
    id: stored.id,
    name: stored.name,
    protocol: stored.protocol,
    baseUrl: stored.baseUrl,
    hasToken: Boolean(stored.token),
    models: stored.models,
    ...(stored.lastTestedAt !== undefined ? { lastTestedAt: stored.lastTestedAt } : {}),
    ...(stored.lastTestOk !== undefined ? { lastTestOk: stored.lastTestOk } : {}),
  };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/** List every saved connection profile. Tokens are never included — only `hasToken`. */
export async function listConnections(): Promise<ProviderConnection[]> {
  const store = await readStore();
  return store.connections.map(toPublic);
}

/** Create and persist a new connection profile. Returns the public (token-free) profile. */
export async function createConnection(input: ProviderConnectionInput): Promise<ProviderConnection> {
  const store = await readStore();
  const stored: StoredConnection = {
    id: randomUUID(),
    name: input.name,
    protocol: input.protocol,
    baseUrl: input.baseUrl,
    ...(input.token ? { token: encryptToken(input.token) } : {}),
    models: [],
  };
  store.connections.push(stored);
  await writeStore(store);
  return toPublic(stored);
}

/**
 * Merge a partial patch into an existing connection profile.
 * `patch.token`, when present, REPLACES the stored token entirely (re-encrypted).
 * `patch.models`, when present, REPLACES the models array entirely (callers
 * that want a partial model change — e.g. one checkbox toggle — should read
 * the current list first; see `setModelEnabled` / `mergeModelList`).
 *
 * @returns The updated public profile, or `undefined` if no connection has `id`.
 */
export async function updateConnection(
  id: string,
  patch: ProviderConnectionUpdate,
): Promise<ProviderConnection | undefined> {
  const store = await readStore();
  const idx = store.connections.findIndex((c) => c.id === id);
  if (idx === -1) return undefined;

  const current = store.connections[idx];
  const next: StoredConnection = {
    ...current,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.baseUrl !== undefined ? { baseUrl: patch.baseUrl } : {}),
    ...(patch.token !== undefined ? { token: encryptToken(patch.token) } : {}),
    ...(patch.models !== undefined ? { models: patch.models } : {}),
    ...(patch.lastTestedAt !== undefined ? { lastTestedAt: patch.lastTestedAt } : {}),
    ...(patch.lastTestOk !== undefined ? { lastTestOk: patch.lastTestOk } : {}),
  };
  store.connections[idx] = next;
  await writeStore(store);
  return toPublic(next);
}

/** Delete a connection profile (and its token). No-op — never throws — for an unknown id. */
export async function deleteConnection(id: string): Promise<void> {
  const store = await readStore();
  const next = store.connections.filter((c) => c.id !== id);
  if (next.length === store.connections.length) return; // nothing to remove
  await writeStore({ connections: next });
}

/**
 * Main-only: resolve a connection's DECRYPTED token. Never expose this
 * through IPC directly — only the connection tester and the harness model
 * resolver (via an injected `ConnectionResolver` callback) may call it.
 */
export async function getDecryptedToken(id: string): Promise<string | undefined> {
  const store = await readStore();
  const found = store.connections.find((c) => c.id === id);
  return decryptToken(found?.token);
}

/** Toggle a single model's `enabled` flag, leaving every other model untouched. */
export async function setModelEnabled(
  id: string,
  modelId: string,
  enabled: boolean,
): Promise<ProviderConnection | undefined> {
  const store = await readStore();
  const idx = store.connections.findIndex((c) => c.id === id);
  if (idx === -1) return undefined;

  const current = store.connections[idx];
  const models = current.models.map((m) => (m.id === modelId ? { ...m, enabled } : m));
  const next = { ...current, models };
  store.connections[idx] = next;
  await writeStore(store);
  return toPublic(next);
}

/**
 * Merge a freshly-fetched model list into a connection's existing models:
 * brand-new models arrive `enabled: true`, existing models keep whatever
 * enabled flag they already had, and models that vanished from the fetched
 * list are dropped. Pure function — no I/O — so the IPC layer can call it
 * synchronously after a successful `provider-connections:test` of a saved
 * connection, then persist the result via `updateConnection`.
 */
export function mergeModelList(existing: ConnectionModel[], fetched: string[]): ConnectionModel[] {
  const existingById = new Map(existing.map((m) => [m.id, m]));
  return fetched.map((modelId) => ({
    id: modelId,
    enabled: existingById.get(modelId)?.enabled ?? true,
  }));
}
