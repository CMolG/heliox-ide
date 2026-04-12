/**
 * types.ts — Bridge Shared Types
 *
 * Responsibility:
 * - Canonical data model for the Remote Control Bridge subsystem.
 * - Shared by bridge server and companion PWA client.
 *
 * Boundaries:
 * - Owns: message shapes, auth types, session state
 * - Does NOT own: transport, storage, or IPC logic
 */

export interface BridgeConfig {
  port: number;
  host: string;
  pin: string;
  sessionId: string;
  createdAt: number;
  expiresAt: number;
}

export interface BridgeAuthRequest {
  pin: string;
  deviceName?: string;
}

export interface BridgeAuthResponse {
  success: boolean;
  token?: string;
  sessionId?: string;
  error?: string;
}

export type BridgeMessageType =
  | 'ping'
  | 'pong'
  | 'auth'
  | 'auth-result'
  | 'command'
  | 'event'
  | 'state-sync'
  | 'sessions-sync'
  | 'session-update'
  | 'session-message'
  | 'file-list'
  | 'terminal-output'
  | 'agent-status';

export interface BridgeMessage {
  type: BridgeMessageType;
  id: string;
  timestamp: number;
  payload: unknown;
}

export interface BridgeCommandPayload {
  action: 'open-file' | 'run-terminal' | 'toggle-agent' | 'get-files' | 'get-state'
    | 'create-session' | 'stop-session' | 'send-message' | 'get-sessions';
  args?: Record<string, unknown>;
}

export interface BridgeEventPayload {
  event: string;
  data: unknown;
}

export interface BridgeStatePayload {
  projectPath: string | null;
  activeFile: string | null;
  isRunningAgent: boolean;
  gitBranch: string | null;
  windowCount: number;
}

export interface BridgeSession {
  id: string;
  token: string;
  deviceName: string;
  connectedAt: number;
  lastPing: number;
  authenticated: boolean;
}

export interface BridgeQRData {
  host: string;
  port: number;
  pin: string;
  sessionId: string;
}

/** Lightweight session representation for the bridge companion */
export interface BridgeSessionInfo {
  id: string;
  number: number;
  status: string;
  description: string;
  model: string;
  createdAt: number;
  messageCount: number;
  lastMessage?: {
    role: string;
    content: string;
    timestamp: number;
  };
}

/** Full session detail for session view */
export interface BridgeSessionDetail extends BridgeSessionInfo {
  messages: Array<{
    id: string;
    role: string;
    content: string;
    timestamp: number;
  }>;
}
