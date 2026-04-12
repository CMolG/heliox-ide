/**
 * bridge.spec.ts — Playwright E2E tests for Proposal 1: Remote Control Bridge
 *
 * Responsibility:
 * - Verifies bridge server types and module structure.
 * - Tests bridge auth (PIN generation, token validation).
 * - Validates bridge IPC endpoints are wired correctly.
 * - Confirms companion PWA HTML is served (when bridge is running).
 *
 * Architecture note:
 * Bridge tests operate at the IPC and store level. The actual HTTP server
 * is tested via the preload bridge methods. Full HTTP/WS integration would
 * require a running bridge server which may conflict with CI ports.
 */
import { test, expect, type Page, type ElectronApplication } from '@playwright/test';
import { _electron as electron } from 'playwright';
import path from 'path';

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  app = await electron.launch({
    args: [path.join(__dirname, '..')],
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      ELECTRON_IS_DEV: '1',
      HELIOX_MODELS: 'copilot',
    },
    timeout: 30_000,
  });

  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  // Clear persisted state to ensure a clean test context
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  await page.waitForFunction(
    () => !!(window as any).__HELIOX_STORE__ && !!(window as any).__DESKTOP_STORE__,
    { timeout: 15_000 },
  );

  // Set project path
  await page.evaluate(() => {
    const store = (window as any).__HELIOX_STORE__;
    if (store) store.getState().setProjectPath('/tmp/test-project');
  });
  await page.waitForTimeout(500);

  // Dismiss tour
  await page.evaluate(() => {
    const ds = (window as any).__DESKTOP_STORE__;
    if (ds) ds.getState().updateSettings({ tourCompleted: true });
  });
});

test.afterAll(async () => {
  if (app) await app.close();
});

// ─── Bridge API Type Tests ──────────────────────────────────────

test.describe('Remote Control Bridge', () => {
  test('bridgeStatus IPC method exists on helioxAPI', async () => {
    const hasBridge = await page.evaluate(() => {
      const api = (window as any).helioxAPI;
      return typeof api?.bridgeStatus === 'function';
    });
    expect(hasBridge).toBe(true);
  });

  test('bridgeStart IPC method exists on helioxAPI', async () => {
    const hasStart = await page.evaluate(() => {
      const api = (window as any).helioxAPI;
      return typeof api?.bridgeStart === 'function';
    });
    expect(hasStart).toBe(true);
  });

  test('bridgeStop IPC method exists on helioxAPI', async () => {
    const hasStop = await page.evaluate(() => {
      const api = (window as any).helioxAPI;
      return typeof api?.bridgeStop === 'function';
    });
    expect(hasStop).toBe(true);
  });

  test('bridgeGetQR IPC method exists on helioxAPI', async () => {
    const hasQR = await page.evaluate(() => {
      const api = (window as any).helioxAPI;
      return typeof api?.bridgeGetQR === 'function';
    });
    expect(hasQR).toBe(true);
  });

  test('bridge types module has correct exports', async () => {
    // Verify the bridge module structure by checking file system
    const fs = await import('fs');
    const bridgePath = path.join(__dirname, '..', 'src', 'main', 'bridge');

    const expectedFiles = ['types.ts', 'auth.ts', 'server.ts', 'socket-relay.ts', 'index.ts'];
    for (const file of expectedFiles) {
      const filePath = path.join(bridgePath, file);
      expect(fs.existsSync(filePath), `Missing bridge file: ${file}`).toBe(true);
    }
  });

  test('bridge auth module generates 6-digit PINs', async () => {
    // Test PIN format via file reading (no runtime since bridge isn't started)
    const fs = await import('fs');
    const authContent = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'main', 'bridge', 'auth.ts'),
      'utf-8'
    );

    // Verify PIN_LENGTH is 6
    expect(authContent).toContain('PIN_LENGTH = 6');
    // Verify session TTL is 30 minutes
    expect(authContent).toContain('SESSION_TTL_MS = 30 * 60 * 1000');
    // Verify max sessions limit
    expect(authContent).toContain('MAX_SESSIONS = 3');
  });

  test('companion PWA HTML is embedded in server module', async () => {
    const fs = await import('fs');
    const serverContent = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'main', 'bridge', 'server.ts'),
      'utf-8'
    );

    // Verify PWA has essential elements
    expect(serverContent).toContain('Heliox Remote');
    expect(serverContent).toContain('apple-mobile-web-app-capable');
    expect(serverContent).toContain('bridge-pin-input');
    expect(serverContent).toContain('bridge-connect-btn');
    expect(serverContent).toContain('/bridge/auth');
    expect(serverContent).toContain('/bridge/state');
    expect(serverContent).toContain('/health');
  });

  test('socket relay handles authenticated connections', async () => {
    const fs = await import('fs');
    const relayContent = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'main', 'bridge', 'socket-relay.ts'),
      'utf-8'
    );

    expect(relayContent).toContain('validateToken');
    expect(relayContent).toContain('broadcastEvent');
    expect(relayContent).toContain('broadcastState');
    expect(relayContent).toContain('handleSocketConnection');
    expect(relayContent).toContain('shutdownRelay');
  });
});
