/**
 * auth.ts — Bridge Auth Module
 *
 * Responsibility:
 * - Generates time-limited PINs for bridge authentication.
 * - Validates auth requests and issues session tokens.
 * - Manages active bridge sessions.
 *
 * Boundaries:
 * - Owns: PIN generation, token issuance, session lifecycle
 * - Does NOT own: HTTP transport, WebSocket relay, IPC
 */
import { randomBytes, createHash } from 'crypto';
import type { BridgeConfig, BridgeSession, BridgeAuthRequest, BridgeAuthResponse, BridgeQRData } from './types';

const PIN_LENGTH = 6;
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_SESSIONS = 3;

let currentConfig: BridgeConfig | null = null;
const activeSessions: Map<string, BridgeSession> = new Map();

/** Generate a numeric PIN of PIN_LENGTH digits */
function generatePin(): string {
  const bytes = randomBytes(4);
  const num = bytes.readUInt32BE(0) % Math.pow(10, PIN_LENGTH);
  return num.toString().padStart(PIN_LENGTH, '0');
}

/** Generate a session token */
function generateToken(): string {
  return randomBytes(32).toString('hex');
}

/** Generate a session ID */
function generateSessionId(): string {
  return createHash('sha256')
    .update(randomBytes(16))
    .digest('hex')
    .slice(0, 16);
}

/** Initialize or refresh the bridge config with a new PIN */
export function initBridgeAuth(port: number, host: string): BridgeConfig {
  currentConfig = {
    port,
    host,
    pin: generatePin(),
    sessionId: generateSessionId(),
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  return currentConfig;
}

/** Get current bridge config */
export function getBridgeConfig(): BridgeConfig | null {
  return currentConfig;
}

/** Get QR-encodable data */
export function getBridgeQRData(): BridgeQRData | null {
  if (!currentConfig) return null;
  return {
    host: currentConfig.host,
    port: currentConfig.port,
    pin: currentConfig.pin,
    sessionId: currentConfig.sessionId,
  };
}

/** Attempt authentication with a PIN */
export function authenticateBridge(req: BridgeAuthRequest): BridgeAuthResponse {
  if (!currentConfig) {
    return { success: false, error: 'Bridge not initialized' };
  }

  if (Date.now() > currentConfig.expiresAt) {
    return { success: false, error: 'PIN expired' };
  }

  if (req.pin !== currentConfig.pin) {
    return { success: false, error: 'Invalid PIN' };
  }

  if (activeSessions.size >= MAX_SESSIONS) {
    // Evict oldest session
    const oldest = [...activeSessions.entries()].sort(
      (a, b) => a[1].connectedAt - b[1].connectedAt
    )[0];
    if (oldest) activeSessions.delete(oldest[0]);
  }

  const session: BridgeSession = {
    id: generateSessionId(),
    token: generateToken(),
    deviceName: req.deviceName ?? 'Unknown device',
    connectedAt: Date.now(),
    lastPing: Date.now(),
    authenticated: true,
  };

  activeSessions.set(session.id, session);

  return {
    success: true,
    token: session.token,
    sessionId: session.id,
  };
}

/** Validate a session token */
export function validateToken(token: string): BridgeSession | null {
  for (const session of activeSessions.values()) {
    if (session.token === token && session.authenticated) {
      session.lastPing = Date.now();
      return session;
    }
  }
  return null;
}

/** Disconnect a session */
export function disconnectSession(sessionId: string): void {
  activeSessions.delete(sessionId);
}

/** Get active session count */
export function getActiveSessionCount(): number {
  return activeSessions.size;
}

/** Clean up expired sessions */
export function cleanupSessions(): void {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, session] of activeSessions) {
    if (session.lastPing < cutoff) {
      activeSessions.delete(id);
    }
  }
}

/** Shut down auth — clear all sessions */
export function shutdownAuth(): void {
  activeSessions.clear();
  currentConfig = null;
}
