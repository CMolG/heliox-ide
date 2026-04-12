/**
 * App.tsx — Bridge Companion PWA Root
 *
 * Responsibility:
 * - Orchestrates the mobile companion app screens.
 * - Manages auth state and WebSocket connection.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ConnectScreen } from './components/ConnectScreen';
import { SessionList } from './components/SessionList';
import { SessionDetail } from './components/SessionDetail';
import { useWebSocket } from './components/useWebSocket';
import './styles.css';

type Screen = 'connect' | 'sessions' | 'detail';

interface SessionInfo {
  id: string;
  number: number;
  status: string;
  description: string;
  model: string;
  createdAt: number;
  messageCount: number;
  lastMessage?: { role: string; content: string; timestamp: number };
}

interface SessionMessage {
  id: string;
  role: string;
  content: string;
  timestamp: number;
}

const API = location.origin;

export function App() {
  const [screen, setScreen] = useState<Screen>('connect');
  const [token, setToken] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [sessionMessages, setSessionMessages] = useState<SessionMessage[]>([]);
  const [stateInfo, setStateInfo] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);

  // Auto-fill PIN from URL
  const urlPin = new URLSearchParams(location.search).get('pin') ?? '';

  // WebSocket connection
  const { connected, lastMessage, sendCommand } = useWebSocket(
    token ? `${API.replace('http', 'ws')}/?token=${token}` : null
  );

  // Handle incoming WebSocket messages
  useEffect(() => {
    if (!lastMessage) return;
    if (lastMessage.type === 'state-sync') {
      setStateInfo(lastMessage.payload as Record<string, unknown>);
    }
    if (lastMessage.type === 'sessions-sync') {
      const payload = lastMessage.payload as { sessions: SessionInfo[] };
      setSessions(payload.sessions);
    }
    if (lastMessage.type === 'session-update') {
      const payload = lastMessage.payload as { session: SessionInfo };
      setSessions(prev =>
        prev.map(s => s.id === payload.session.id ? payload.session : s)
      );
    }
    if (lastMessage.type === 'event') {
      const payload = lastMessage.payload as { event: string; data: unknown };
      if (payload.event === 'command-result') {
        // Refresh sessions after command
        fetchSessions();
      }
    }
  }, [lastMessage]);

  const fetchSessions = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API}/bridge/sessions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions);
      }
    } catch { /* ignore */ }
  }, [token]);

  const fetchSessionDetail = useCallback(async (id: string) => {
    if (!token) return;
    try {
      const res = await fetch(`${API}/bridge/sessions/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSessionMessages(data.messages ?? []);
      }
    } catch { /* ignore */ }
  }, [token]);

  // Auth handler
  const handleAuth = useCallback(async (pin: string) => {
    setError(null);
    try {
      const res = await fetch(`${API}/bridge/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, deviceName: navigator.userAgent.slice(0, 40) }),
      });
      const data = await res.json();
      if (data.success && data.token) {
        setToken(data.token);
        setScreen('sessions');
      } else {
        setError(data.error || 'Authentication failed');
      }
    } catch {
      setError('Connection failed — check WiFi');
    }
  }, []);

  // Load sessions when authenticated
  useEffect(() => {
    if (token && screen === 'sessions') {
      fetchSessions();
      const interval = setInterval(fetchSessions, 5000);
      return () => clearInterval(interval);
    }
  }, [token, screen, fetchSessions]);

  // Load session detail
  useEffect(() => {
    if (token && selectedSessionId && screen === 'detail') {
      fetchSessionDetail(selectedSessionId);
      const interval = setInterval(() => fetchSessionDetail(selectedSessionId), 3000);
      return () => clearInterval(interval);
    }
  }, [token, selectedSessionId, screen, fetchSessionDetail]);

  // Session actions
  const handleCreateSession = useCallback(async () => {
    if (!token) return;
    try {
      await fetch(`${API}/bridge/sessions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      await fetchSessions();
    } catch { /* ignore */ }
  }, [token, fetchSessions]);

  const handleStopSession = useCallback(async (sessionId: string) => {
    if (!token) return;
    try {
      await fetch(`${API}/bridge/sessions/${sessionId}/stop`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      await fetchSessions();
      if (selectedSessionId === sessionId) {
        await fetchSessionDetail(sessionId);
      }
    } catch { /* ignore */ }
  }, [token, selectedSessionId, fetchSessions, fetchSessionDetail]);

  const handleSendMessage = useCallback(async (sessionId: string, content: string) => {
    if (!token) return;
    try {
      await fetch(`${API}/bridge/sessions/${sessionId}/message`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      await fetchSessionDetail(sessionId);
    } catch { /* ignore */ }
  }, [token, fetchSessionDetail]);

  const handleSelectSession = useCallback((id: string) => {
    setSelectedSessionId(id);
    setScreen('detail');
  }, []);

  const handleBack = useCallback(() => {
    setScreen('sessions');
    setSelectedSessionId(null);
    setSessionMessages([]);
  }, []);

  const handleDisconnect = useCallback(() => {
    setToken(null);
    setSessions([]);
    setSessionMessages([]);
    setSelectedSessionId(null);
    setScreen('connect');
  }, []);

  return (
    <div className="bridge-app">
      {screen === 'connect' && (
        <ConnectScreen
          defaultPin={urlPin}
          error={error}
          onConnect={handleAuth}
        />
      )}
      {screen === 'sessions' && (
        <SessionList
          sessions={sessions}
          connected={connected}
          stateInfo={stateInfo}
          onSelect={handleSelectSession}
          onCreate={handleCreateSession}
          onStop={handleStopSession}
          onDisconnect={handleDisconnect}
        />
      )}
      {screen === 'detail' && selectedSessionId && (
        <SessionDetail
          session={sessions.find(s => s.id === selectedSessionId) ?? null}
          messages={sessionMessages}
          connected={connected}
          onBack={handleBack}
          onStop={() => handleStopSession(selectedSessionId)}
          onSend={(content) => handleSendMessage(selectedSessionId, content)}
        />
      )}
    </div>
  );
}
