/**
 * socket-relay.ts — Bridge WebSocket Relay
 *
 * Responsibility:
 * - Manages authenticated WebSocket connections from companion devices.
 * - Relays IDE events to connected clients.
 * - Handles command messages from clients back to the IDE.
 *
 * Boundaries:
 * - Owns: WS connection lifecycle, message routing, broadcast
 * - Does NOT own: HTTP transport (→ server.ts), auth (→ auth.ts)
 */
import { WebSocket, type RawData } from 'ws';
import type { IncomingMessage } from 'http';
import { validateToken } from './auth';
import type { BridgeMessage, BridgeStatePayload, BridgeCommandPayload } from './types';

interface ConnectedClient {
  ws: WebSocket;
  sessionId: string;
  deviceName: string;
  connectedAt: number;
}

const clients: Map<string, ConnectedClient> = new Map();
let commandCallback: ((action: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null;

/** Set the command callback for handling session commands from mobile clients */
export function setCommandCallback(cb: (action: string, args?: Record<string, unknown>) => Promise<unknown>): void {
  commandCallback = cb;
}

/** Handle a new WebSocket connection */
export function handleSocketConnection(
  ws: WebSocket,
  _req: IncomingMessage,
  getState: () => BridgeStatePayload
): void {
  // Token travels as a negotiated WebSocket subprotocol, not a query string —
  // browsers can't set custom headers on the WS handshake, but `ws.protocol`
  // (Sec-WebSocket-Protocol) never appears in a URL, so it doesn't hit logs,
  // browser history, or Referer headers the way a query param would.
  const token = ws.protocol || null;

  if (!token) {
    ws.close(4001, 'Missing token');
    return;
  }

  const session = validateToken(token);
  if (!session) {
    ws.close(4003, 'Invalid or expired token');
    return;
  }

  const client: ConnectedClient = {
    ws,
    sessionId: session.id,
    deviceName: session.deviceName,
    connectedAt: Date.now(),
  };

  clients.set(session.id, client);
  console.log(`[Bridge] Client connected: ${session.deviceName} (${session.id})`);

  // Send initial state
  sendMessage(ws, {
    type: 'state-sync',
    id: `init-${Date.now()}`,
    timestamp: Date.now(),
    payload: getState(),
  });

  // Handle incoming messages
  ws.on('message', (data: RawData) => {
    try {
      const msg: BridgeMessage = JSON.parse(data.toString());
      handleClientMessage(client, msg, getState);
    } catch (err) {
      console.error('[Bridge] Invalid message:', err);
    }
  });

  ws.on('close', () => {
    clients.delete(session.id);
    console.log(`[Bridge] Client disconnected: ${session.deviceName}`);
  });

  ws.on('error', (err: Error) => {
    console.error(`[Bridge] WebSocket error (${session.deviceName}):`, err.message);
    clients.delete(session.id);
  });
}

/** Handle a message from a connected client */
async function handleClientMessage(
  client: ConnectedClient,
  msg: BridgeMessage,
  getState: () => BridgeStatePayload
): Promise<void> {
  switch (msg.type) {
    case 'ping':
      sendMessage(client.ws, {
        type: 'pong',
        id: msg.id,
        timestamp: Date.now(),
        payload: null,
      });
      break;

    case 'command': {
      const payload = msg.payload as BridgeCommandPayload;
      console.log(`[Bridge] Command from ${client.deviceName}:`, payload.action);
      try {
        const result = await commandCallback?.(payload.action, payload.args);
        sendMessage(client.ws, {
          type: 'event',
          id: `cmd-result-${Date.now()}`,
          timestamp: Date.now(),
          payload: { event: 'command-result', data: { action: payload.action, result, success: true } },
        });
      } catch (err) {
        sendMessage(client.ws, {
          type: 'event',
          id: `cmd-error-${Date.now()}`,
          timestamp: Date.now(),
          payload: { event: 'command-result', data: { action: payload.action, success: false, error: String(err) } },
        });
      }
      // Send updated state after command
      sendMessage(client.ws, {
        type: 'state-sync',
        id: `cmd-ack-${Date.now()}`,
        timestamp: Date.now(),
        payload: getState(),
      });
      break;
    }

    default:
      console.log(`[Bridge] Unknown message type: ${msg.type}`);
  }
}

/** Send a message to a specific WebSocket client */
function sendMessage(ws: WebSocket, msg: BridgeMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

/** Broadcast an event to all connected clients */
export function broadcastEvent(event: string, data: unknown): void {
  const msg: BridgeMessage = {
    type: 'event',
    id: `evt-${Date.now()}`,
    timestamp: Date.now(),
    payload: { event, data },
  };
  const payload = JSON.stringify(msg);

  for (const client of clients.values()) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}

/** Broadcast state to all connected clients */
export function broadcastState(state: BridgeStatePayload): void {
  const msg: BridgeMessage = {
    type: 'state-sync',
    id: `sync-${Date.now()}`,
    timestamp: Date.now(),
    payload: state,
  };
  const payload = JSON.stringify(msg);

  for (const client of clients.values()) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}

/** Broadcast session updates to all connected clients */
export function broadcastSessions(sessions: unknown[]): void {
  const msg: BridgeMessage = {
    type: 'sessions-sync',
    id: `sessions-${Date.now()}`,
    timestamp: Date.now(),
    payload: { sessions },
  };
  const payload = JSON.stringify(msg);

  for (const client of clients.values()) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}

/** Get count of connected clients */
export function getConnectedClientCount(): number {
  return clients.size;
}

/** Shut down all connections */
export function shutdownRelay(): void {
  for (const client of clients.values()) {
    client.ws.close(1001, 'Bridge shutting down');
  }
  clients.clear();
}
