/**
 * provider-connections.test.ts — Unit tests for the DBeaver-style connection-profile store
 *
 * `electron`'s `app` and `safeStorage` are mocked so this suite never touches
 * a real userData directory or a real OS keychain: `app.getPath('userData')`
 * points at a real temp directory (created/torn down per test, mirroring
 * snapshot-browser-installer.test.ts's fake-app pattern) and `safeStorage`
 * does a base64-passthrough "encryption" (a real Buffer round-trip, just not
 * cryptographically opaque) so the on-disk JSON round-trip is exercised for
 * real without depending on a platform keyring being available in CI.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

// ─── electron `app` + `safeStorage` fakes ──────────────────────────────────

const { fakeApp, fakeSafeStorage, setUserDataDir, setEncryptionAvailable } = vi.hoisted(() => {
  const state = { userDataDir: '/nonexistent', encryptionAvailable: true };
  const fakeApp = {
    getPath: (name: string) => {
      if (name === 'userData') return state.userDataDir;
      throw new Error(`unexpected getPath name in test: ${name}`);
    },
  };
  const fakeSafeStorage = {
    isEncryptionAvailable: () => state.encryptionAvailable,
    // Base64-passthrough "encryption": a real Buffer round-trip so the JSON
    // file genuinely never contains the plaintext token as a substring, but
    // deterministic and keychain-free for CI.
    encryptString: (plain: string) => Buffer.from(plain, 'utf-8'),
    decryptString: (buf: Buffer) => buf.toString('utf-8'),
  };
  return {
    fakeApp,
    fakeSafeStorage,
    setUserDataDir: (dir: string) => { state.userDataDir = dir; },
    setEncryptionAvailable: (value: boolean) => { state.encryptionAvailable = value; },
  };
});

vi.mock('electron', () => ({ app: fakeApp, safeStorage: fakeSafeStorage }));

import {
  createConnection,
  listConnections,
  updateConnection,
  deleteConnection,
  getDecryptedToken,
  setModelEnabled,
  mergeModelList,
} from './provider-connections';

describe('provider-connections', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'fluxor-provider-connections-test-'));
    setUserDataDir(tempDir);
    setEncryptionAvailable(true);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('createConnection', () => {
    it('persists and returns a profile with a generated id, hasToken:true, and empty models', async () => {
      const created = await createConnection({
        name: 'My OpenAI',
        protocol: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        token: 'sk-super-secret-token',
      });

      expect(created.id).toEqual(expect.any(String));
      expect(created.id.length).toBeGreaterThan(0);
      expect(created.name).toBe('My OpenAI');
      expect(created.protocol).toBe('openai');
      expect(created.baseUrl).toBe('https://api.openai.com/v1');
      expect(created.hasToken).toBe(true);
      expect(created.models).toEqual([]);
      expect((created as { token?: unknown }).token).toBeUndefined();
    });

    it('sets hasToken:false when no token is provided (tokenless/local endpoint)', async () => {
      const created = await createConnection({
        name: 'Local proxy',
        protocol: 'openai',
        baseUrl: 'http://localhost:8080/v1',
      });
      expect(created.hasToken).toBe(false);
    });
  });

  describe('listConnections', () => {
    it('round-trips a created connection and never leaks the token — in the returned object or the JSON file on disk', async () => {
      const created = await createConnection({
        name: 'Anthropic direct',
        protocol: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        token: 'sk-ant-do-not-leak-me',
      });

      const listed = await listConnections();
      expect(listed).toHaveLength(1);
      expect(listed[0]).toEqual(created);
      expect((listed[0] as { token?: unknown }).token).toBeUndefined();

      const raw = readFileSync(path.join(tempDir, 'provider-connections.json'), 'utf-8');
      expect(raw).not.toContain('sk-ant-do-not-leak-me');
    });

    it('returns an empty array when no connections have been created', async () => {
      expect(await listConnections()).toEqual([]);
    });
  });

  describe('updateConnection', () => {
    it('merges a partial patch (name/baseUrl) without disturbing other fields', async () => {
      const created = await createConnection({
        name: 'Original name',
        protocol: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        token: 'sk-1',
      });

      const updated = await updateConnection(created.id, { name: 'Renamed' });

      expect(updated?.name).toBe('Renamed');
      expect(updated?.baseUrl).toBe('https://api.openai.com/v1');
      expect(updated?.protocol).toBe('openai');
      expect(updated?.hasToken).toBe(true);
    });

    it('replaces the token when patched, and the new token decrypts correctly', async () => {
      const created = await createConnection({
        name: 'Rotate me',
        protocol: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        token: 'sk-old',
      });

      await updateConnection(created.id, { token: 'sk-new' });

      expect(await getDecryptedToken(created.id)).toBe('sk-new');
    });

    it('replaces the models array when patched (used by set-model-enabled and test-merge)', async () => {
      const created = await createConnection({
        name: 'Models patch',
        protocol: 'openai',
        baseUrl: 'https://api.openai.com/v1',
      });

      const updated = await updateConnection(created.id, {
        models: [{ id: 'gpt-4o', enabled: true }, { id: 'gpt-4o-mini', enabled: false }],
      });

      expect(updated?.models).toEqual([
        { id: 'gpt-4o', enabled: true },
        { id: 'gpt-4o-mini', enabled: false },
      ]);
    });

    it('returns undefined for an unknown connection id (no-op, does not throw)', async () => {
      expect(await updateConnection('does-not-exist', { name: 'x' })).toBeUndefined();
    });
  });

  describe('deleteConnection', () => {
    it('removes the profile (and its token) so it no longer appears in listConnections', async () => {
      const created = await createConnection({
        name: 'Temp',
        protocol: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        token: 'sk-temp',
      });
      const other = await createConnection({
        name: 'Keep me',
        protocol: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
      });

      await deleteConnection(created.id);

      const remaining = await listConnections();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(other.id);
      expect(await getDecryptedToken(created.id)).toBeUndefined();
    });

    it('is a no-op for an unknown id (never throws)', async () => {
      await expect(deleteConnection('never-existed')).resolves.toBeUndefined();
    });
  });

  describe('getDecryptedToken', () => {
    it('returns the original plaintext token for a connection created with one', async () => {
      const created = await createConnection({
        name: 'Round trip',
        protocol: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        token: 'sk-round-trip-me',
      });

      expect(await getDecryptedToken(created.id)).toBe('sk-round-trip-me');
    });

    it('returns undefined for a connection with no token', async () => {
      const created = await createConnection({
        name: 'No token',
        protocol: 'openai',
        baseUrl: 'http://localhost:1234',
      });
      expect(await getDecryptedToken(created.id)).toBeUndefined();
    });

    it('returns undefined for an unknown connection id', async () => {
      expect(await getDecryptedToken('nope')).toBeUndefined();
    });

    it('falls back to storing (and returning) the token in plaintext when safeStorage.isEncryptionAvailable() is false', async () => {
      setEncryptionAvailable(false);
      const created = await createConnection({
        name: 'No keyring available',
        protocol: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        token: 'sk-degraded-path',
      });

      expect(created.hasToken).toBe(true);
      expect(await getDecryptedToken(created.id)).toBe('sk-degraded-path');
    });
  });

  describe('setModelEnabled', () => {
    it('toggles a single model\'s enabled flag, leaving the others untouched', async () => {
      const created = await createConnection({
        name: 'Toggle test',
        protocol: 'openai',
        baseUrl: 'https://api.openai.com/v1',
      });
      await updateConnection(created.id, {
        models: [{ id: 'gpt-4o', enabled: true }, { id: 'gpt-4o-mini', enabled: true }],
      });

      const updated = await setModelEnabled(created.id, 'gpt-4o-mini', false);

      expect(updated?.models).toEqual([
        { id: 'gpt-4o', enabled: true },
        { id: 'gpt-4o-mini', enabled: false },
      ]);
    });

    it('returns undefined for an unknown connection id', async () => {
      expect(await setModelEnabled('nope', 'gpt-4o', true)).toBeUndefined();
    });
  });

  describe('mergeModelList (pure)', () => {
    it('marks brand-new models enabled:true', () => {
      expect(mergeModelList([], ['gpt-4o'])).toEqual([{ id: 'gpt-4o', enabled: true }]);
    });

    it('preserves an existing model\'s enabled flag', () => {
      const existing = [{ id: 'gpt-4o', enabled: false }];
      expect(mergeModelList(existing, ['gpt-4o'])).toEqual([{ id: 'gpt-4o', enabled: false }]);
    });

    it('drops models that vanished from the fetched list', () => {
      const existing = [{ id: 'gpt-4o', enabled: true }, { id: 'gpt-3.5-turbo', enabled: true }];
      expect(mergeModelList(existing, ['gpt-4o'])).toEqual([{ id: 'gpt-4o', enabled: true }]);
    });

    it('handles a mix of new, existing, and vanished models in one call', () => {
      const existing = [{ id: 'gpt-4o', enabled: false }, { id: 'old-model', enabled: true }];
      const result = mergeModelList(existing, ['gpt-4o', 'gpt-4.5']);
      expect(result).toEqual([
        { id: 'gpt-4o', enabled: false },
        { id: 'gpt-4.5', enabled: true },
      ]);
    });
  });
});
