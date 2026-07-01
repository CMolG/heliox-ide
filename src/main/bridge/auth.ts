/**
 * auth.ts — Bridge Auth Module
 *
 * Responsibility:
 * - Generates a one-time pairing challenge (PIN + pairing token) for bridge auth.
 * - Validates pairing exchanges and issues session tokens.
 * - Manages active bridge sessions, per-IP/global brute-force lockout.
 *
 * Boundaries:
 * - Owns: pairing generation, token issuance, session lifecycle, attempt accounting
 * - Does NOT own: HTTP transport, WebSocket relay, IPC
 *
 * Pairing model:
 * - `initBridgeAuth` issues ONE pairing challenge: a 6-digit PIN (manual entry)
 *   and a high-entropy pairing token (QR, carried in the URL fragment by the
 *   caller). Either credential redeems the same challenge.
 * - The pairing token is single-use: consumed on the first exchange attempt
 *   that references it, success or failure (it's machine-read and auto-submitted,
 *   so a failure means expired/replay — not a typo to retry).
 * - The PIN tolerates repeated wrong entries (humans mistype) up to the
 *   brute-force cap below, but is single-use on success (one session per PIN).
 * - A successful exchange via either credential consumes the whole challenge.
 */
import { randomBytes, randomInt, createHash, timingSafeEqual } from 'crypto';
import type { BridgeConfig, BridgeSession, BridgeAuthRequest, BridgeAuthResponse } from './types';

const PIN_LENGTH = 6;
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_SESSIONS = 3;

// One-time pairing challenge: short-lived, single-use (see model note above).
const PAIRING_TTL_MS = 120 * 1000; // 2 minutes

// Brute-force resistance on the exchange endpoint.
const MAX_AUTH_ATTEMPTS = 5;
const LOCKOUT_MS = 60 * 1000;
const ATTEMPT_STATE_IDLE_MS = 15 * 60 * 1000; // GC per-IP entries that went quiet

const GENERIC_AUTH_ERROR = 'Authentication failed'; // constant shape — never reveals *why*
const DUMMY_COMPARAND = '0'.repeat(64); // pads timing on short-circuited (locked) paths

interface PairingChallenge {
  pin: string;
  pairingToken: string;
  expiresAt: number;
  consumed: boolean;
}

interface AttemptState {
  count: number;
  lockedUntil: number;
  lastSeen: number;
}

let currentConfig: BridgeConfig | null = null;
let pairing: PairingChallenge | null = null;
const activeSessions: Map<string, BridgeSession> = new Map();
const ipAttempts: Map<string, AttemptState> = new Map();
const globalAttempts: AttemptState = { count: 0, lockedUntil: 0, lastSeen: 0 };

/** Generate a numeric PIN of PIN_LENGTH digits (unbiased — crypto.randomInt, not modulo) */
function generatePin(): string {
  const num = randomInt(0, Math.pow(10, PIN_LENGTH));
  return num.toString().padStart(PIN_LENGTH, '0');
}

/** Generate a one-time pairing token for the QR (URL-fragment-safe alphabet) */
function generatePairingToken(): string {
  return randomBytes(24).toString('base64url');
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

/**
 * Constant-time string comparison. Hashes both sides to a fixed-length digest
 * first so: (a) attacker-controlled length never throws inside timingSafeEqual
 * (it requires equal-length buffers), and (b) there's no length-based branch
 * before the comparison.
 */
function secureCompare(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}

function getAttemptState(ip: string): AttemptState {
  let state = ipAttempts.get(ip);
  if (!state) {
    state = { count: 0, lockedUntil: 0, lastSeen: Date.now() };
    ipAttempts.set(ip, state);
  }
  return state;
}

function isLockedOut(state: AttemptState, now: number): boolean {
  return state.lockedUntil > now;
}

function recordFailure(state: AttemptState, now: number): void {
  // A fully-elapsed lockout starts a fresh window rather than staying pinned
  // at >= MAX_AUTH_ATTEMPTS forever.
  if (state.lockedUntil !== 0 && state.lockedUntil <= now) {
    state.count = 0;
    state.lockedUntil = 0;
  }
  state.count += 1;
  state.lastSeen = now;
  if (state.count >= MAX_AUTH_ATTEMPTS) {
    state.lockedUntil = now + LOCKOUT_MS;
  }
}

function recordSuccess(state: AttemptState, now: number): void {
  state.count = 0;
  state.lockedUntil = 0;
  state.lastSeen = now;
}

/** Initialize or refresh the bridge config with a new pairing challenge */
export function initBridgeAuth(port: number, host: string): BridgeConfig {
  const now = Date.now();
  pairing = {
    pin: generatePin(),
    pairingToken: generatePairingToken(),
    expiresAt: now + PAIRING_TTL_MS,
    consumed: false,
  };
  // A freshly generated QR/PIN revokes any sessions issued under a prior
  // pairing epoch — defensive even though stop()→shutdownAuth() already
  // clears these on the normal restart path.
  activeSessions.clear();

  currentConfig = {
    port,
    host,
    pin: pairing.pin,
    sessionId: generateSessionId(),
    createdAt: now,
    expiresAt: pairing.expiresAt,
  };
  return currentConfig;
}

/** Get current bridge config */
export function getBridgeConfig(): BridgeConfig | null {
  return currentConfig;
}

/** Get the live pairing token for QR generation — null once consumed or expired */
export function getPairingToken(): string | null {
  if (!pairing) return null;
  if (pairing.consumed || Date.now() > pairing.expiresAt) return null;
  return pairing.pairingToken;
}

/** Attempt authentication with a pairing token (QR) or PIN (manual), rate-limited per-IP + globally */
export function authenticateBridge(req: BridgeAuthRequest, clientIp: string): BridgeAuthResponse {
  const now = Date.now();
  const ip = clientIp || 'unknown';
  const ipState = getAttemptState(ip);

  // Always pay the comparison cost, even on the paths below that short-circuit,
  // so locked-out and not-locked-out requests take comparable time.
  const providedToken = req && typeof req.pairingToken === 'string' ? req.pairingToken : null;
  const providedPin = req && typeof req.pin === 'string' ? req.pin : null;
  secureCompare(providedToken ?? providedPin ?? '', DUMMY_COMPARAND);

  if (isLockedOut(ipState, now) || isLockedOut(globalAttempts, now)) {
    return { success: false, error: GENERIC_AUTH_ERROR };
  }

  if (!currentConfig || !pairing || pairing.consumed || now > pairing.expiresAt) {
    recordFailure(ipState, now);
    recordFailure(globalAttempts, now);
    return { success: false, error: GENERIC_AUTH_ERROR };
  }

  let matched = false;
  if (providedToken !== null) {
    // Pairing token is burned on this first exchange regardless of outcome.
    matched = secureCompare(providedToken, pairing.pairingToken);
    pairing.consumed = true;
  } else if (providedPin !== null) {
    matched = secureCompare(providedPin, pairing.pin);
  }

  if (!matched) {
    recordFailure(ipState, now);
    recordFailure(globalAttempts, now);
    return { success: false, error: GENERIC_AUTH_ERROR };
  }

  // Success via either credential burns the whole challenge (single-session PIN too).
  pairing.consumed = true;
  recordSuccess(ipState, now);
  recordSuccess(globalAttempts, now);

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
    deviceName: String(req.deviceName ?? 'Unknown device').slice(0, 60),
    connectedAt: now,
    lastPing: now,
    expiresAt: now + SESSION_TTL_MS,
    authenticated: true,
  };

  activeSessions.set(session.id, session);

  return {
    success: true,
    token: session.token,
    sessionId: session.id,
  };
}

/** Validate a session token — expiry is enforced here, on every call, not just at issuance */
export function validateToken(token: string): BridgeSession | null {
  const now = Date.now();
  for (const [id, session] of activeSessions) {
    if (!session.authenticated) continue;
    if (!secureCompare(token, session.token)) continue;
    if (now > session.expiresAt) {
      activeSessions.delete(id);
      return null;
    }
    session.lastPing = now;
    session.expiresAt = now + SESSION_TTL_MS; // sliding renewal on activity
    return session;
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

/** Clean up expired sessions and stale attempt-tracking state */
export function cleanupSessions(): void {
  const now = Date.now();
  for (const [id, session] of activeSessions) {
    if (now > session.expiresAt) {
      activeSessions.delete(id);
    }
  }
  for (const [ip, state] of ipAttempts) {
    if (!isLockedOut(state, now) && state.lastSeen < now - ATTEMPT_STATE_IDLE_MS) {
      ipAttempts.delete(ip);
    }
  }
}

/** Shut down auth — clear all sessions */
export function shutdownAuth(): void {
  activeSessions.clear();
  pairing = null;
  currentConfig = null;
}
