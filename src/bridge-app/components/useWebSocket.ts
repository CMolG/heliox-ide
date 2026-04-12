/**
 * useWebSocket — Auto-reconnecting WebSocket hook for real-time state sync
 */
import { useState, useEffect, useRef, useCallback } from 'react';

interface WsMessage {
  type: string;
  id: string;
  timestamp: number;
  payload: unknown;
}

interface UseWebSocketReturn {
  connected: boolean;
  lastMessage: WsMessage | null;
  sendCommand: (action: string, args?: Record<string, unknown>) => void;
}

export function useWebSocket(url: string | null): UseWebSocketReturn {
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WsMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const pingTimer = useRef<number | null>(null);

  const connect = useCallback(() => {
    if (!url) return;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      // Keep-alive ping every 15s
      pingTimer.current = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping', id: `p-${Date.now()}`, timestamp: Date.now() }));
        }
      }, 15000);
    };

    ws.onmessage = (e) => {
      try {
        const msg: WsMessage = JSON.parse(e.data);
        if (msg.type !== 'pong') {
          setLastMessage(msg);
        }
      } catch { /* ignore malformed messages */ }
    };

    ws.onclose = () => {
      setConnected(false);
      cleanup();
      // Auto-reconnect after 3s
      reconnectTimer.current = window.setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [url]);

  const cleanup = useCallback(() => {
    if (pingTimer.current) {
      clearInterval(pingTimer.current);
      pingTimer.current = null;
    }
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
  }, []);

  useEffect(() => {
    if (!url) return;
    connect();
    return () => {
      cleanup();
      if (wsRef.current) {
        wsRef.current.onclose = null; // Prevent reconnect on intentional close
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [url, connect, cleanup]);

  const sendCommand = useCallback((action: string, args?: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'command',
        id: `cmd-${Date.now()}`,
        timestamp: Date.now(),
        payload: { action, args },
      }));
    }
  }, []);

  return { connected, lastMessage, sendCommand };
}
