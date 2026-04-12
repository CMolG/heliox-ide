/**
 * SessionList — Scrollable list of all IDE sessions
 */
import React from 'react';

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

interface Props {
  sessions: SessionInfo[];
  connected: boolean;
  stateInfo: Record<string, unknown>;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onStop: (id: string) => void;
  onDisconnect: () => void;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export function SessionList({ sessions, connected, stateInfo, onSelect, onCreate, onStop, onDisconnect }: Props) {
  return (
    <>
      <div className="header-bar">
        <div className="header-title">
          ⚡ Sessions
          <span className={`conn-badge ${connected ? 'online' : 'offline'}`}>
            <span className="conn-dot" />
            {connected ? 'Live' : 'Offline'}
          </span>
        </div>
        <div className="header-actions">
          <button className="header-btn" onClick={onDisconnect}>
            Disconnect
          </button>
        </div>
      </div>

      <div className="session-list">
        {sessions.length === 0 ? (
          <div className="session-empty">
            <div style={{ fontSize: 32, marginBottom: 12 }}>📭</div>
            <div>No sessions yet</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>Tap + to create one</div>
          </div>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              className="session-card"
              onClick={() => onSelect(session.id)}
            >
              <div className="session-card-header">
                <span className="session-number">Session #{session.number}</span>
                <span className={`session-status ${session.status}`}>
                  {session.status}
                </span>
              </div>
              <div className="session-desc">
                {session.description || 'New session'}
              </div>
              <div className="session-meta">
                <span>{session.messageCount} messages</span>
                <span>{formatRelative(session.createdAt)}</span>
                {session.model && <span>{session.model}</span>}
              </div>
              {session.lastMessage && (
                <div className="session-desc" style={{ marginTop: 6, fontSize: 12 }}>
                  {session.lastMessage.role === 'user' ? '→ ' : '← '}
                  {session.lastMessage.content.slice(0, 80)}
                  {session.lastMessage.content.length > 80 ? '...' : ''}
                </div>
              )}
              {session.status === 'running' && (
                <button
                  className="stop-btn"
                  style={{ marginTop: 8 }}
                  onClick={(e) => { e.stopPropagation(); onStop(session.id); }}
                >
                  Stop
                </button>
              )}
            </div>
          ))
        )}
      </div>

      <button className="fab-create" onClick={onCreate} aria-label="New session">
        +
      </button>
    </>
  );
}
