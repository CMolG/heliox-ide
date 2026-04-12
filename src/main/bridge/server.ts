/**
 * server.ts — Bridge HTTP + WebSocket Server
 *
 * Responsibility:
 * - Runs an HTTP server on a local port for the companion PWA.
 * - Upgrades connections to WebSocket for real-time relay.
 * - Routes REST endpoints for auth, state, and QR data.
 *
 * Boundaries:
 * - Owns: HTTP server lifecycle, route dispatch, WS upgrade
 * - Does NOT own: auth logic (→ auth.ts), IPC relay (→ socket-relay.ts)
 */
import { createServer, IncomingMessage, ServerResponse } from 'http';
import type { Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { readFile as fsReadFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, extname } from 'path';
import { app } from 'electron';
import {
  initBridgeAuth,
  getBridgeConfig,
  getBridgeQRData,
  authenticateBridge,
  validateToken,
  shutdownAuth,
  cleanupSessions,
} from './auth';
import { handleSocketConnection, broadcastEvent, shutdownRelay } from './socket-relay';
import type { BridgeAuthRequest, BridgeStatePayload, BridgeSessionInfo, BridgeSessionDetail } from './types';

const DEFAULT_PORT = 18420;
const DEFAULT_HOST = '0.0.0.0';

let httpServer: Server | null = null;
let wss: WebSocketServer | null = null;
let cleanupInterval: ReturnType<typeof setInterval> | null = null;
let stateProvider: (() => BridgeStatePayload) | null = null;
let sessionsProvider: (() => BridgeSessionInfo[]) | null = null;
let sessionDetailProvider: ((id: string) => BridgeSessionDetail | null) | null = null;
let commandHandler: ((action: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null;

// ─── CORS helpers ────────────────────────────────────────────────

function setCors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  setCors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => resolve(body));
  });
}

// ─── Route handler ───────────────────────────────────────────────

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const method = req.method?.toUpperCase() ?? 'GET';

  // CORS preflight
  if (method === 'OPTIONS') {
    setCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (url.pathname === '/health' && method === 'GET') {
    sendJson(res, 200, { status: 'ok', bridge: true });
    return;
  }

  // QR data (public — used before auth)
  if (url.pathname === '/bridge/qr' && method === 'GET') {
    const qr = getBridgeQRData();
    if (!qr) {
      sendJson(res, 503, { error: 'Bridge not initialized' });
      return;
    }
    sendJson(res, 200, qr);
    return;
  }

  // Auth endpoint
  if (url.pathname === '/bridge/auth' && method === 'POST') {
    const body = await readBody(req);
    try {
      const authReq: BridgeAuthRequest = JSON.parse(body);
      const result = authenticateBridge(authReq);
      sendJson(res, result.success ? 200 : 401, result);
    } catch {
      sendJson(res, 400, { error: 'Invalid request body' });
    }
    return;
  }

  // State endpoint (requires auth)
  if (url.pathname === '/bridge/state' && method === 'GET') {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token || !validateToken(token)) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }
    const state = stateProvider?.() ?? { projectPath: null, activeFile: null, isRunningAgent: false, gitBranch: null, windowCount: 0 };
    sendJson(res, 200, state);
    return;
  }

  // Session list (requires auth)
  if (url.pathname === '/bridge/sessions' && method === 'GET') {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token || !validateToken(token)) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }
    const sessions = sessionsProvider?.() ?? [];
    sendJson(res, 200, { sessions });
    return;
  }

  // Session detail (requires auth)
  const sessionDetailMatch = url.pathname.match(/^\/bridge\/sessions\/([^/]+)$/);
  if (sessionDetailMatch && method === 'GET') {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token || !validateToken(token)) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }
    const session = sessionDetailProvider?.(sessionDetailMatch[1]) ?? null;
    if (!session) {
      sendJson(res, 404, { error: 'Session not found' });
      return;
    }
    sendJson(res, 200, session);
    return;
  }

  // Session commands (requires auth)
  const sessionCommandMatch = url.pathname.match(/^\/bridge\/sessions\/([^/]+)\/(stop|message)$/);
  if (sessionCommandMatch && method === 'POST') {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token || !validateToken(token)) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }
    const [, sessionId, action] = sessionCommandMatch;
    const body = await readBody(req);
    try {
      const args = body ? JSON.parse(body) : {};
      const result = await commandHandler?.(`${action}-session`, { sessionId, ...args });
      sendJson(res, 200, { success: true, result });
    } catch (err) {
      sendJson(res, 500, { error: 'Command failed' });
    }
    return;
  }

  // Create session (requires auth)
  if (url.pathname === '/bridge/sessions' && method === 'POST') {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token || !validateToken(token)) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }
    try {
      const result = await commandHandler?.('create-session', {});
      sendJson(res, 201, { success: true, result });
    } catch {
      sendJson(res, 500, { error: 'Failed to create session' });
    }
    return;
  }

  // Serve companion PWA — try built files first, fallback to inline HTML
  await serveStaticPWA(url.pathname, res);
}

// ─── Static PWA file serving ────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function getBridgeAppDir(): string | null {
  // In dev, check for dist-bridge next to the project root
  const devPath = join(process.cwd(), 'dist-bridge');
  if (existsSync(devPath)) return devPath;

  // In production, check resources directory
  try {
    const prodPath = join(app.getAppPath(), '..', 'bridge-app');
    if (existsSync(prodPath)) return prodPath;
  } catch { /* app may not be ready */ }

  return null;
}

async function serveStaticPWA(pathname: string, res: ServerResponse): Promise<void> {
  const bridgeDir = getBridgeAppDir();

  if (bridgeDir) {
    // Try to serve a static file
    const filePath = pathname === '/' || pathname === '/bridge'
      ? join(bridgeDir, 'index.html')
      : join(bridgeDir, pathname);

    try {
      const content = await fsReadFile(filePath);
      const ext = extname(filePath);
      setCors(res);
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      res.end(content);
      return;
    } catch {
      // File not found in dist — try index.html for SPA routing
      if (pathname !== '/' && !pathname.startsWith('/bridge/')) {
        try {
          const indexContent = await fsReadFile(join(bridgeDir, 'index.html'));
          setCors(res);
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(indexContent);
          return;
        } catch { /* fall through to inline HTML */ }
      }
    }
  }

  // Fallback: serve inline HTML
  if (pathname === '/' || pathname === '/bridge' || pathname === '/manifest.json') {
    setCors(res);
    if (pathname === '/manifest.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        name: 'Heliox Remote',
        short_name: 'Heliox',
        start_url: '/',
        display: 'standalone',
        background_color: '#0a0a0f',
        theme_color: '#0a0a0f',
      }));
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(getCompanionHTML());
    }
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
}

// ─── Server lifecycle ────────────────────────────────────────────

export function startBridgeServer(
  getState: () => BridgeStatePayload,
  port: number = DEFAULT_PORT,
  host: string = DEFAULT_HOST,
  options?: {
    getSessions?: () => BridgeSessionInfo[];
    getSessionDetail?: (id: string) => BridgeSessionDetail | null;
    handleCommand?: (action: string, args?: Record<string, unknown>) => Promise<unknown>;
  }
): { port: number; pin: string } {
  if (httpServer) {
    throw new Error('Bridge server already running');
  }

  stateProvider = getState;
  sessionsProvider = options?.getSessions ?? null;
  sessionDetailProvider = options?.getSessionDetail ?? null;
  commandHandler = options?.handleCommand ?? null;

  // Initialize auth
  const config = initBridgeAuth(port, host);

  // Create HTTP server
  httpServer = createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error('[Bridge] Request error:', err);
      sendJson(res, 500, { error: 'Internal server error' });
    });
  });

  // Create WebSocket server
  wss = new WebSocketServer({ server: httpServer });
  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    handleSocketConnection(ws, req, getState);
  });

  // Start listening
  httpServer.listen(port, host, () => {
    console.log(`[Bridge] Server listening on ${host}:${port} (PIN: ${config.pin})`);
  });

  // Periodic session cleanup
  cleanupInterval = setInterval(cleanupSessions, 60_000);

  return { port, pin: config.pin };
}

export function stopBridgeServer(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }

  shutdownRelay();
  shutdownAuth();

  if (wss) {
    wss.close();
    wss = null;
  }

  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }

  stateProvider = null;
  sessionsProvider = null;
  sessionDetailProvider = null;
  commandHandler = null;
  console.log('[Bridge] Server stopped');
}

export function isBridgeRunning(): boolean {
  return httpServer !== null;
}

export { broadcastEvent };

// ─── Companion PWA HTML ──────────────────────────────────────────

function getCompanionHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#0a0a0f" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <title>Heliox Remote</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #0a0a0f;
      --surface: #141419;
      --border: #1e1e28;
      --text: #e0e0e8;
      --text-muted: #6b6b80;
      --accent: #6366f1;
      --accent-glow: rgba(99, 102, 241, 0.2);
      --radius: 12px;
      --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      --mono: 'SF Mono', 'Fira Code', monospace;
    }
    body {
      font-family: var(--font);
      background: var(--bg);
      color: var(--text);
      min-height: 100dvh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
      -webkit-font-smoothing: antialiased;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 24px;
      width: 100%;
      max-width: 380px;
    }
    h1 { font-size: 18px; font-weight: 600; margin-bottom: 4px; }
    .subtitle { font-size: 12px; color: var(--text-muted); margin-bottom: 20px; }
    .pin-input {
      width: 100%;
      height: 48px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      font-family: var(--mono);
      font-size: 24px;
      text-align: center;
      letter-spacing: 8px;
      outline: none;
      margin-bottom: 12px;
    }
    .pin-input:focus { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-glow); }
    .btn {
      width: 100%;
      height: 44px;
      background: var(--accent);
      color: white;
      border: none;
      border-radius: 8px;
      font-family: var(--font);
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s;
    }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn:hover:not(:disabled) { opacity: 0.9; }
    .error { color: #f87171; font-size: 12px; margin-top: 8px; text-align: center; }
    .status { font-size: 11px; color: var(--text-muted); margin-top: 16px; text-align: center; }
    .connected-view { display: none; }
    .connected-view.active { display: block; }
    .state-item {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid var(--border);
      font-size: 13px;
    }
    .state-label { color: var(--text-muted); }
    .state-value { font-family: var(--mono); font-size: 12px; }
    .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
    .dot.green { background: #4ade80; }
    .dot.red { background: #f87171; }
  </style>
</head>
<body>
  <!-- Auth View -->
  <div class="card" id="auth-view">
    <h1>🔗 Heliox Remote</h1>
    <p class="subtitle">Enter the PIN shown in your IDE</p>
    <input
      class="pin-input"
      id="pin-input"
      type="text"
      inputmode="numeric"
      maxlength="6"
      placeholder="······"
      autocomplete="off"
      data-testid="bridge-pin-input"
    />
    <button class="btn" id="connect-btn" data-testid="bridge-connect-btn">Connect</button>
    <div class="error" id="error-msg"></div>
    <div class="status" id="status-msg">Waiting for PIN...</div>
  </div>

  <!-- Connected View -->
  <div class="card connected-view" id="connected-view">
    <h1><span class="dot green"></span>Connected</h1>
    <p class="subtitle" id="device-info">Heliox Remote Session</p>
    <div id="state-container">
      <div class="state-item">
        <span class="state-label">Project</span>
        <span class="state-value" id="state-project">—</span>
      </div>
      <div class="state-item">
        <span class="state-label">Branch</span>
        <span class="state-value" id="state-branch">—</span>
      </div>
      <div class="state-item">
        <span class="state-label">Agent</span>
        <span class="state-value" id="state-agent">—</span>
      </div>
      <div class="state-item">
        <span class="state-label">Windows</span>
        <span class="state-value" id="state-windows">—</span>
      </div>
    </div>
    <div class="status" id="ws-status">WebSocket: connecting...</div>
  </div>

  <script>
    const API = location.origin;
    let token = null;
    let ws = null;

    const authView = document.getElementById('auth-view');
    const connView = document.getElementById('connected-view');
    const pinInput = document.getElementById('pin-input');
    const connectBtn = document.getElementById('connect-btn');
    const errorMsg = document.getElementById('error-msg');
    const statusMsg = document.getElementById('status-msg');

    connectBtn.addEventListener('click', doAuth);
    pinInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAuth(); });

    async function doAuth() {
      const pin = pinInput.value.trim();
      if (pin.length !== 6) { errorMsg.textContent = 'PIN must be 6 digits'; return; }
      connectBtn.disabled = true;
      errorMsg.textContent = '';
      statusMsg.textContent = 'Authenticating...';
      try {
        const res = await fetch(API + '/bridge/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin, deviceName: navigator.userAgent.slice(0, 40) }),
        });
        const data = await res.json();
        if (data.success) {
          token = data.token;
          authView.style.display = 'none';
          connView.classList.add('active');
          connectWebSocket();
          pollState();
        } else {
          errorMsg.textContent = data.error || 'Auth failed';
        }
      } catch (err) {
        errorMsg.textContent = 'Connection failed';
      }
      connectBtn.disabled = false;
      statusMsg.textContent = '';
    }

    function connectWebSocket() {
      const wsUrl = API.replace('http', 'ws') + '/?token=' + token;
      ws = new WebSocket(wsUrl);
      ws.onopen = () => { document.getElementById('ws-status').textContent = 'WebSocket: connected'; };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'state-sync') updateState(msg.payload);
          if (msg.type === 'pong') { /* keep-alive ack */ }
        } catch {}
      };
      ws.onclose = () => { document.getElementById('ws-status').textContent = 'WebSocket: disconnected'; };
      // Keep alive
      setInterval(() => { if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'ping', id: Date.now().toString(), timestamp: Date.now() })); }, 15000);
    }

    async function pollState() {
      try {
        const res = await fetch(API + '/bridge/state', { headers: { Authorization: 'Bearer ' + token } });
        if (res.ok) updateState(await res.json());
      } catch {}
      setTimeout(pollState, 5000);
    }

    function updateState(s) {
      document.getElementById('state-project').textContent = s.projectPath ? s.projectPath.split('/').pop() : '—';
      document.getElementById('state-branch').textContent = s.gitBranch || '—';
      document.getElementById('state-agent').textContent = s.isRunningAgent ? '🟢 Running' : '⚪ Idle';
      document.getElementById('state-windows').textContent = String(s.windowCount ?? 0);
    }
  </script>
</body>
</html>`;
}
