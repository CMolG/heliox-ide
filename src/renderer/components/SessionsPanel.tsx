/**
 * SessionsPanel.tsx — Renderer Composite Component
 *
 * Responsibility:
 * - Renders the SessionsPanel surface in the renderer layer.
 * - Encapsulates Feature-level composition used by the renderer shell and panels.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/SessionsPanel.tsx — Left sessions panel with real state
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useHelioxStore } from '../store';
import type { Session, SessionStatus } from '@/types';
import { RoleIcon } from './ui/RoleIcon';
import { theme } from '../logic/theme';

const STATUS_CONFIG: Record<SessionStatus, {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
}> = {
  running: {
    label: 'Running',
    color: theme.textSecondary,
    bgColor: theme.border,
    borderColor: theme.borderLight,
  },
  waiting: {
    label: 'Waiting',
    color: '#a3a3a3',
    bgColor: 'rgba(64,64,64,0.5)',
    borderColor: 'transparent',
  },
  completed: {
    label: 'Completed',
    color: theme.success,
    bgColor: 'rgba(160,246,149,0.1)',
    borderColor: 'transparent',
  },
  error: {
    label: 'Error',
    color: '#fb923c',
    bgColor: 'rgba(234,88,12,0.15)',
    borderColor: 'transparent',
  },
  stopped: {
    label: 'Stopped',
    color: theme.danger,
    bgColor: 'rgba(240,37,37,0.1)',
    borderColor: 'transparent',
  },
};

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return `${min}m ${sec}s`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return `${hr}h ${remMin}m`;
}

function computeElapsed(session: Session, now: number): string {
  if (session.status === 'running') {
    const start = session.startedAt ?? session.createdAt;
    const elapsed = Math.max(0, now - start);
    const min = Math.floor(elapsed / 60000).toString().padStart(2, '0');
    const sec = Math.floor((elapsed % 60000) / 1000).toString().padStart(2, '0');
    return `${min}:${sec} elapsed`;
  }
  if (session.status === 'waiting') return 'Awaiting input';
  if (session.status === 'completed' || session.status === 'error') {
    if (session.startedAt && session.completedAt) {
      return formatDuration(session.completedAt - session.startedAt);
    }
    const ago = now - (session.endedAt ?? session.createdAt);
    if (ago < 60000) return 'Just now';
    if (ago < 3600000) return `${Math.floor(ago / 60000)}m ago`;
    return `${Math.floor(ago / 3600000)}h ago`;
  }
  return 'Stopped';
}

interface ContextMenu {
  x: number;
  y: number;
  sessionId: string;
}

export function SessionsPanel() {
  const {
    sessions, selectedSessionId, setSelectedSessionId,
    sessionFilter, setSessionFilter, addSession, removeSession,
    updateSessionStatus, addToast, addLogEntry, roles,
    updateSessionDescription, projectPath,
  } = useHelioxStore();

  // Tick every second for elapsed time on running sessions
  const [now, setNow] = useState(Date.now());
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Only show sessions for the current project
  const projectSessions = sessions.filter(s =>
    s.projectId === projectPath || (!s.projectId && !projectPath)
  );

  const hasRunning = projectSessions.some(s => s.status === 'running');
  useEffect(() => {
    if (!hasRunning) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [hasRunning]);

  // Auto-select appropriate session when project changes
  useEffect(() => {
    if (!projectPath) return;
    const currentSession = sessions.find(s => s.id === selectedSessionId);
    if (!currentSession || currentSession.projectId !== projectPath) {
      const projectSession = sessions.find(s => s.projectId === projectPath);
      setSelectedSessionId(projectSession?.id ?? null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath]);

  // Listen for global new-session shortcut
  useEffect(() => {
    const handler = () => {
      addSession();
      window.dispatchEvent(new CustomEvent('heliox:focus-chat'));
    };
    window.addEventListener('heliox:new-session', handler);
    return () => window.removeEventListener('heliox:new-session', handler);
  }, [addSession]);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [contextMenu]);

  const handleDeleteSession = useCallback((sessionId: string) => {
    if (confirmDeleteId === sessionId) {
      removeSession(sessionId);
      setConfirmDeleteId(null);
      setContextMenu(null);
    } else {
      setConfirmDeleteId(sessionId);
      setTimeout(() => setConfirmDeleteId((cur) => cur === sessionId ? null : cur), 3000);
    }
  }, [confirmDeleteId, removeSession]);

  const filteredSessions = projectSessions.filter((s) =>
    !sessionFilter || s.description.toLowerCase().includes(sessionFilter.toLowerCase())
    || `${s.number}: ${s.model ?? 'copilot'}`.toLowerCase().includes(sessionFilter.toLowerCase())
  );

  const handleNewSession = useCallback(() => {
    addSession();
    window.dispatchEvent(new CustomEvent('heliox:focus-chat'));
  }, [addSession]);

  const handleStartRename = useCallback((session: Session, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingSessionId(session.id);
    setEditingName(session.description || `${session.number}: ${session.model ?? 'copilot'}`);
    requestAnimationFrame(() => renameInputRef.current?.select());
  }, []);

  const handleFinishRename = useCallback((sessionId: string) => {
    const trimmed = editingName.trim();
    if (trimmed) {
      updateSessionDescription(sessionId, trimmed);
    }
    setEditingSessionId(null);
  }, [editingName, updateSessionDescription]);

  const handleCancelRename = useCallback(() => {
    setEditingSessionId(null);
  }, []);

  const handleExportSession = useCallback(async (session: Session) => {
    setContextMenu(null);
    if (!window.helioxAPI) return;

    const role = session.roleId ? roles.find(r => r.id === session.roleId) : null;
    const lines: string[] = [
      `# Session ${session.number}: ${session.model ?? 'copilot'} — ${session.description || '(untitled)'}`,
      `Model: ${session.model ?? 'copilot'} | Effort: ${session.effort ?? 'medium'} | Role: ${role ? `${role.icon} ${role.name}` : 'None'}`,
      `Started: ${new Date(session.createdAt).toLocaleString()}`,
      '',
      '---',
      '',
    ];

    for (const msg of session.messages) {
      const time = new Date(msg.timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const sender = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Heliox Agent' : 'System';
      lines.push(`**${sender}** (${time})`);
      lines.push(msg.content);
      lines.push('');
    }

    const content = lines.join('\n');
    const defaultPath = `session-${session.number}.md`;

    const saved = await window.helioxAPI.saveFile(defaultPath, content);
    if (saved) {
      addToast('Session exported', 'success');
    }
  }, [roles, addToast]);

  const handleContextMenu = useCallback((e: React.MouseEvent, sessionId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, sessionId });
  }, []);

  return (
    <div
      className="heliox-sessions flex flex-col overflow-hidden h-full"
      style={{ background: theme.surfaceMid, borderRight: `1px solid ${theme.borderMedium}` }}
    >
      {/* Header */}
      <div
        className="p-6 flex flex-col gap-6"
        style={{ borderBottom: `1px solid ${theme.border}` }}
      >
        <div className="flex items-center justify-between">
          <span
            className="text-lg font-bold leading-7"
            style={{ fontFamily: theme.fontGrotesk, color: theme.textPrimary }}
          >
            Active Sessions
          </span>
          <button
            onClick={handleNewSession}
            className="w-8 h-8 rounded-full flex items-center justify-center transition hover:brightness-125"
            style={{ background: '#262626' }}
            aria-label="Create new session"
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
              <path d="M4 0v8M0 4h8" stroke="#d6d3d1" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Filter */}
        <div className="p-2 rounded-sm flex items-center gap-3" style={{ background: '#000000' }}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <circle cx="4.5" cy="4.5" r="3.5" stroke={theme.textDim} strokeWidth="1" />
            <path d="M7 7l2.5 2.5" stroke={theme.textDim} strokeWidth="1" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            value={sessionFilter}
            onChange={(e) => setSessionFilter(e.target.value)}
            placeholder="Filter agents..."
            className="flex-1 bg-transparent outline-none text-xs font-normal"
            style={{ fontFamily: theme.fontManrope, color: theme.textPrimary }}
            aria-label="Filter sessions"
          />
          {sessionFilter && (
            <button
              onClick={() => setSessionFilter('')}
              className="text-neutral-500 hover:text-neutral-300 transition"
              aria-label="Clear filter"
            >
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                <path d="M1 1l6 6M7 1l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 p-3 overflow-y-auto flex flex-col gap-2">
        {filteredSessions.map((session) => {
          const isSelected = selectedSessionId === session.id;
          const cfg = STATUS_CONFIG[session.status];
          const elapsed = computeElapsed(session, now);
          const sessionTitle = `${session.number}: ${session.model ?? 'copilot'}`;

          return (
            <div key={session.id} className="relative group">
              <button
                onClick={() => setSelectedSessionId(session.id)}
                onContextMenu={(e) => handleContextMenu(e, session.id)}
                className={`w-full text-left p-4 rounded-2xl flex flex-col gap-2 transition-colors duration-150 ${isSelected ? 'border-l-2 border-stone-300' : 'border-l-2 border-transparent hover:bg-[#1a1a1a]'}`}
                style={{
                  background: isSelected ? theme.surfaceHover : undefined,
                  outline: isSelected ? `1px solid ${theme.border}` : '1px solid transparent',
                  outlineOffset: '-1px',
                }}
                aria-pressed={isSelected}
                aria-label={`${sessionTitle} — ${cfg.label}`}
              >
                {/* Title + Status */}
                <div className="flex items-start justify-between">
                  {editingSessionId === session.id ? (
                    <input
                      ref={renameInputRef}
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') handleFinishRename(session.id);
                        if (e.key === 'Escape') handleCancelRename();
                      }}
                      onBlur={() => handleFinishRename(session.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="bg-transparent border-b border-stone-300/30 text-zinc-200 text-sm font-['Space_Grotesk'] outline-none"
                      autoFocus
                    />
                  ) : (
                    <span
                      className="text-sm font-medium leading-5"
                      style={{ fontFamily: theme.fontGrotesk, color: theme.textPrimary }}
                      onDoubleClick={(e) => handleStartRename(session, e)}
                    >
                      {sessionTitle}
                    </span>
                  )}
                  <span
                    className="px-2 py-0.5 rounded-full flex items-center gap-1.5 shrink-0"
                    style={{
                      background: cfg.bgColor,
                      outline: cfg.borderColor !== 'transparent' ? `1px solid ${cfg.borderColor}` : 'none',
                      outlineOffset: '-1px',
                    }}
                  >
                    {session.status === 'running' ? (
                      <span className="w-1.5 h-1.5 rounded-full dot-pulse" style={{ background: cfg.color }} />
                    ) : (
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        {session.status === 'waiting' && <circle cx="5" cy="5" r="3" fill={cfg.color} />}
                        {session.status === 'completed' && <path d="M3 5l1.5 1.5L7 4" stroke={cfg.color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />}
                        {session.status === 'error' && <circle cx="5" cy="5" r="3.5" stroke={cfg.color} strokeWidth="1.5" fill="none" />}
                        {session.status === 'stopped' && <path d="M3 3l4 4M7 3l-4 4" stroke={cfg.color} strokeWidth="1.5" strokeLinecap="round" />}
                      </svg>
                    )}
                    <span
                      className="text-[10px] font-bold uppercase leading-4"
                      style={{ fontFamily: theme.fontInter, color: cfg.color }}
                    >
                      {cfg.label}
                    </span>
                  </span>
                </div>

                {/* Description */}
                {session.description && (
                  <span
                    className="text-xs font-normal leading-4"
                    style={{ fontFamily: theme.fontManrope, color: theme.textMuted }}
                  >
                    {session.description}
                  </span>
                )}

                {/* Role badge */}
                {(() => {
                  const sessionRole = session.roleId ? roles.find(r => r.id === session.roleId) : null;
                  return sessionRole ? (
                    <div className="pt-1">
                      <span
                        className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded inline-flex items-center gap-1"
                        style={{ fontFamily: theme.fontInter, color: theme.textSecondary, background: theme.border }}
                      >
                        <RoleIcon icon={sessionRole.icon} size={10} color={theme.textSecondary} /> {sessionRole.name}
                      </span>
                    </div>
                  ) : null;
                })()}
                {/* Token usage + elapsed time in same row */}
                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-2">
                    {session.tokenUsage?.premiumRequests !== undefined && (
                      <span
                        className="text-[9px] font-normal leading-3"
                        style={{ fontFamily: theme.fontInter, color: theme.textFaint }}
                      >
                        {session.tokenUsage.premiumRequests} req
                      </span>
                    )}
                    {session.tokenUsage?.totalApiDurationMs !== undefined && (
                      <span
                        className="text-[9px] font-normal leading-3"
                        style={{ fontFamily: theme.fontInter, color: theme.textFaint }}
                      >
                        {(session.tokenUsage.totalApiDurationMs / 1000).toFixed(1)}s
                      </span>
                    )}
                  </div>
                  <span
                    className="text-[10px] font-normal uppercase leading-4 tracking-wide"
                    style={{ fontFamily: theme.fontInter, color: theme.textDim }}
                  >
                    {elapsed}
                  </span>
                </div>
                {/* Stop button — only visible on hover for running sessions */}
                {session.status === 'running' && (
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition pt-1">
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (window.helioxAPI) {
                          try {
                            await window.helioxAPI.stopAgent(session.id);
                          } catch { /* ignore */ }
                          updateSessionStatus(session.id, 'stopped', Date.now());
                          addToast('Agent stopped', 'info');
                          addLogEntry({ timestamp: Date.now(), level: 'warn', sessionId: session.id, message: 'Agent stopped by user' });
                        }
                      }}
                      className="p-1 rounded hover:bg-red-500/10 transition"
                      aria-label={`Stop session ${session.number}`}
                      title="Stop agent"
                    >
                      <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                        <rect x="1" y="1" width="6" height="6" rx="0.5" fill="#F02525" />
                      </svg>
                    </button>
                  </div>
                )}
              </button>
            </div>
          );
        })}

        {filteredSessions.length === 0 && (
          <div className="text-center py-8">
            <span className="text-xs" style={{ fontFamily: theme.fontManrope, color: theme.textDim }}>
              {sessionFilter ? `No sessions match "${sessionFilter}"` : 'No sessions yet'}
            </span>
          </div>
        )}
      </div>

      {/* Right-click context menu */}
      {contextMenu && (() => {
        const session = sessions.find(s => s.id === contextMenu.sessionId);
        if (!session) return null;
        return (
          <div
            ref={contextMenuRef}
            role="menu"
            className="fixed z-50 py-1 rounded-xl overflow-hidden"
            style={{
              left: contextMenu.x,
              top: contextMenu.y,
              background: theme.surfaceCard,
              border: `1px solid ${theme.borderMedium}`,
              boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
              minWidth: '160px',
            }}
          >
            <button
              role="menuitem"
              onClick={() => handleExportSession(session)}
              className="w-full text-left px-4 py-2.5 flex items-center gap-3 transition hover:bg-white/5"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M6 1v8M3 6l3 3 3-3M1 11h10" stroke={theme.textMuted} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="text-xs font-normal" style={{ fontFamily: theme.fontManrope, color: theme.textMuted }}>
                Export as Markdown
              </span>
            </button>
            <div style={{ height: '1px', background: theme.border, margin: '2px 0' }} />
            <button
              role="menuitem"
              onClick={() => handleDeleteSession(session.id)}
              className="w-full text-left px-4 py-2.5 flex items-center gap-3 transition hover:bg-red-500/10"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M1 1l8 8M9 1l-8 8" stroke={confirmDeleteId === session.id ? '#f87171' : theme.textMuted} strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <span
                className="text-xs font-normal"
                style={{ fontFamily: theme.fontManrope, color: confirmDeleteId === session.id ? theme.danger : theme.textMuted }}
              >
                {confirmDeleteId === session.id ? 'Confirm Delete' : 'Delete Session'}
              </span>
            </button>
          </div>
        );
      })()}
    </div>
  );
}
