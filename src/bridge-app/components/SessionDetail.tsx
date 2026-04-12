/**
 * SessionDetail — Real-time message stream with input bar
 */
import React, { useRef, useEffect, useState } from 'react';
import { InputBar } from './InputBar';

interface SessionInfo {
  id: string;
  number: number;
  status: string;
  description: string;
  model: string;
  createdAt: number;
  messageCount: number;
}

interface Message {
  id: string;
  role: string;
  content: string;
  timestamp: number;
}

interface Props {
  session: SessionInfo | null;
  messages: Message[];
  connected: boolean;
  onBack: () => void;
  onStop: () => void;
  onSend: (content: string) => void;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function SessionDetail({ session, messages, connected, onBack, onStop, onSend }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Auto-scroll on new messages
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, autoScroll]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 60);
  };

  if (!session) {
    return (
      <div className="detail-view">
        <div className="header-bar">
          <button className="header-back" onClick={onBack}>← Back</button>
        </div>
        <div className="messages-empty">Session not found</div>
      </div>
    );
  }

  const isRunning = session.status === 'running';

  return (
    <div className="detail-view">
      <div className="header-bar">
        <button className="header-back" onClick={onBack}>← Back</button>
        <div className="header-title">
          #{session.number}
          <span className={`conn-badge ${connected ? 'online' : 'offline'}`}>
            <span className="conn-dot" />
          </span>
        </div>
        <div className="header-actions">
          {isRunning && (
            <button className="stop-btn" onClick={onStop}>Stop</button>
          )}
        </div>
      </div>

      <div className="detail-status-bar">
        <span className={`session-status ${session.status}`}>
          {session.status}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {session.description || `Session #${session.number}`}
        </span>
      </div>

      <div
        className="messages-container"
        ref={scrollRef}
        onScroll={handleScroll}
      >
        {messages.length === 0 ? (
          <div className="messages-empty">
            <div>
              <div style={{ fontSize: 28, marginBottom: 8 }}>💬</div>
              <div>No messages yet</div>
              <div style={{ fontSize: 12, marginTop: 4, color: 'var(--text-dim)' }}>
                Send a prompt to start the conversation
              </div>
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={`message-bubble ${msg.role}`}>
              <div>{msg.content}</div>
              <div className="message-time">{formatTime(msg.timestamp)}</div>
            </div>
          ))
        )}
        {isRunning && messages.length > 0 && messages[messages.length - 1].role === 'user' && (
          <div className="thinking-indicator">
            <div className="thinking-dots">
              <span /><span /><span />
            </div>
            Thinking...
          </div>
        )}
      </div>

      <InputBar
        onSend={onSend}
        disabled={isRunning}
        placeholder={isRunning ? 'Agent is running...' : 'Type a message...'}
      />
    </div>
  );
}
