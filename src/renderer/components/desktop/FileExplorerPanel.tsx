/**
 * FileExplorerPanel.tsx — Renderer Desktop Surface Component
 *
 * Responsibility:
 * - Renders the FileExplorerPanel surface in the renderer layer.
 * - Encapsulates Desktop canvas/window composition within the renderer workspace.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/desktop/FileExplorerPanel.tsx — Left panel with sessions + file tree
import React, { useState, useCallback } from 'react';
import { useHelioxStore } from '../../store';
import { useDesktopStore } from '../../store/desktop-store';
import { FileTree } from '../FileTree';
import { theme } from '../../logic/theme';

export function FileExplorerPanel() {
  const projectPath = useHelioxStore(s => s.projectPath);
  const sessions = useHelioxStore(s => s.sessions);
  const selectedSessionId = useHelioxStore(s => s.selectedSessionId);
  const setSelectedSessionId = useHelioxStore(s => s.setSelectedSessionId);
  const addSession = useHelioxStore(s => s.addSession);
  const removeSession = useHelioxStore(s => s.removeSession);

  const windows = useDesktopStore(s => s.windows);
  const focusWindow = useDesktopStore(s => s.focusWindow);
  const addWindow = useDesktopStore(s => s.addWindow);

  const [sessionsCollapsed, setSessionsCollapsed] = useState(false);

  // Filter sessions for current project
  const projectSessions = sessions.filter(s =>
    s.projectId === (projectPath ?? undefined) || (!s.projectId && !projectPath)
  );

  const handleSessionClick = useCallback((sessionId: string) => {
    setSelectedSessionId(sessionId);
    // Focus existing window for this session, or create one
    const existing = windows.find(w => w.sessionId === sessionId);
    if (existing) {
      focusWindow(existing.id);
    } else {
      addWindow('chat', {
        title: sessions.find(s => s.id === sessionId)?.description || 'Chat',
        iconName: 'MessageSquare',
        sessionId,
      });
    }
  }, [windows, sessions, setSelectedSessionId, focusWindow, addWindow]);

  const handleNewSession = useCallback(() => {
    const sessionId = addSession();
    addWindow('chat', { title: 'New Chat', iconName: 'MessageSquare', sessionId });
    const session = useHelioxStore.getState().sessions.find(s => s.id === sessionId);
    if (window.helioxAPI && projectPath && session) {
      window.helioxAPI.contextMapUpsertSessionNode(projectPath, {
        sessionId,
        label: `Session #${session.number}`,
        status: 'stopped',
        roleId: session.roleId,
      }).catch(() => {});
    }
  }, [addSession, addWindow]);

  const statusColors: Record<string, string> = {
    running: '#4285F4',
    waiting: theme.textDim,
    completed: theme.success,
    error: theme.danger,
    stopped: theme.danger,
  };

  return (
    <div
      className="panel-border-r"
      data-testid="file-explorer"
      style={{
        height: '100%', display: 'flex', flexDirection: 'column',
        background: theme.bgDeep, overflow: 'hidden',
      }}
    >
      {/* Sessions section */}
      <div style={{ flexShrink: 0 }}>
        <button
          onClick={() => setSessionsCollapsed(!sessionsCollapsed)}
          aria-expanded={!sessionsCollapsed}
          aria-label="Toggle sessions"
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 12px', background: 'none', border: 'none',
            color: theme.textMuted, fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
            letterSpacing: '0.05em', cursor: 'pointer',
          }}
        >
          <span style={{ transform: sessionsCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s', fontSize: 10 }}>▼</span>
          Sessions ({projectSessions.length})
          <button
            onClick={(e) => { e.stopPropagation(); handleNewSession(); }}
            title="New session"
            aria-label="Create new session"
            style={{
              marginLeft: 'auto', background: 'none', border: 'none',
              color: theme.textDim, fontSize: 14, cursor: 'pointer', padding: 0, lineHeight: 1,
            }}
          >+</button>
        </button>

        {!sessionsCollapsed && (
          <div style={{ maxHeight: 200, overflow: 'auto', paddingBottom: 4 }}>
            {projectSessions.length === 0 && (
              <div style={{ padding: '8px 16px', fontSize: 11, color: theme.textGhost }}>
                No sessions yet
              </div>
            )}
            {projectSessions.map(s => {
              const isActive = windows.some(w => w.sessionId === s.id);
              return (
                <button
                  key={s.id}
                  onClick={() => handleSessionClick(s.id)}
                  aria-label={`Session #${s.number} ${s.description || 'Untitled'}, ${s.status}`}
                  data-testid={`session-${s.id}`}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                    padding: '5px 12px 5px 20px', background: selectedSessionId === s.id ? 'rgba(255,255,255,0.04)' : 'transparent',
                    border: 'none', color: theme.textSecondary, fontSize: 12, cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                    background: statusColors[s.status] ?? theme.textGhost,
                    ...(s.status === 'running' ? { animation: 'pulse-dot 1.5s infinite' } : {}),
                  }} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    #{s.number} {s.description || 'Untitled'}
                  </span>
                  {isActive && (
                    <span style={{ fontSize: 9, color: 'var(--cli-accent)', opacity: 0.6 }}>●</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Separator */}
      <div style={{ height: 1, background: theme.borderLight, flexShrink: 0 }} />

      {/* File tree */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{
          padding: '8px 12px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
          letterSpacing: '0.05em', color: theme.textMuted,
        }}>
          Files
        </div>
        <FileTree />
      </div>
    </div>
  );
}
