/**
 * index.ts — Bridge Module Entry Point
 *
 * Responsibility:
 * - Re-exports all bridge subsystem public APIs.
 *
 * Boundaries:
 * - Owns: module aggregation
 * - Does NOT own: any logic
 */
export { startBridgeServer, stopBridgeServer, isBridgeRunning, broadcastEvent } from './server';
export { getBridgeConfig, getPairingToken, getActiveSessionCount } from './auth';
export { broadcastState, getConnectedClientCount, setCommandCallback } from './socket-relay';
export { generateBridgeQR, getLocalIPAddress } from './qr';
export type { BridgeConfig, BridgeStatePayload, BridgeSession, BridgeSessionInfo, BridgeSessionDetail } from './types';
