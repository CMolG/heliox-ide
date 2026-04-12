/**
 * SessionStatusDock.tsx — Renderer Plugin Surface Component
 *
 * Responsibility:
 * - Renders the SessionStatusDock surface in the renderer layer.
 * - Encapsulates Plugin-facing UI surface rendered inside the desktop shell.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useHelioxStore } from '../../../store';
import { useDesktopStore } from '../../../store/desktop-store';
import { RunningBars } from './RunningBars';
import { TickSvg } from './TickSvg';
import { CrossSvg } from './CrossSvg';
import type { SessionStatus } from '@/types';

interface SessionDockItem {
  sessionId: string;
  sessionNumber: number;
  status: SessionStatus;
  description: string;
  startedAt: number;
  endedAt?: number;
  model?: string;
  premiumRequests?: number;
  totalApiDurationMs?: number;
  // Attachments from the associated window
  roleId?: string;
  modifierIds: string[];
  flowId?: string;
  designSystemId?: string;
}

function formatDuration(startMs: number, endMs?: number): string {
  const elapsed = (endMs ?? Date.now()) - startMs;
  const secs = Math.floor(elapsed / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function StatusIcon({ status }: { status: SessionStatus }) {
  if (status === 'running') return <RunningBars />;
  if (status === 'completed') return <TickSvg />;
  if (status === 'error' || status === 'stopped') return <CrossSvg />;
  // waiting
  return (
    <div style={{
      width: 8, height: 8, borderRadius: '50%',
      background: 'rgba(255,255,255,0.4)',
    }} />
  );
}

export function SessionStatusDock() {
  const sessions = useHelioxStore(s => s.sessions);
  const projectPath = useHelioxStore(s => s.projectPath);
  const updateSessionStatus = useHelioxStore(s => s.updateSessionStatus);
  const setSelectedSessionId = useHelioxStore(s => s.setSelectedSessionId);
  const addWindow = useDesktopStore(s => s.addWindow);
  const focusWindow = useDesktopStore(s => s.focusWindow);
  const windows = useDesktopStore(s => s.windows);

  // Hide dock when any window is maximized
  const hasMaximized = useMemo(() => windows.some(w => w.state === 'maximized'), [windows]);

  // Track which sessions have been finished (dismissed) via context menu
  const [finishedIds, setFinishedIds] = useState<Set<string>>(new Set());

  // Filter visible sessions: include all active/terminal statuses until manually dismissed.
  const visibleSessions: SessionDockItem[] = useMemo(() => {
    return sessions
      .filter(s =>
        (s.projectId === (projectPath ?? undefined) || (!s.projectId && !projectPath)) &&
        (s.status === 'running' || s.status === 'completed' || s.status === 'error' || s.status === 'stopped' || s.status === 'waiting') &&
        !finishedIds.has(s.id)
      )
      .map(s => {
        // Find the associated window to get attachments
        const win = windows.find(w => w.sessionId === s.id);
        return {
          sessionId: s.id,
          sessionNumber: s.number,
          status: s.status,
          description: s.description || `Session #${s.number}`,
          startedAt: s.startedAt ?? s.createdAt,
          endedAt: s.endedAt,
          model: s.model,
          premiumRequests: s.tokenUsage?.premiumRequests,
          totalApiDurationMs: s.tokenUsage?.totalApiDurationMs,
          roleId: win?.roleId ?? s.roleId,
          modifierIds: win?.modifierIds ?? [],
          flowId: win?.flowId,
          designSystemId: win?.designSystemId,
        };
      });
  }, [sessions, projectPath, finishedIds, windows]);

  // Scroll state
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollUp(el.scrollTop > 0);
    setCanScrollDown(el.scrollTop + el.clientHeight < el.scrollHeight - 1);
  }, []);

  useEffect(() => {
    updateScrollState();
  }, [visibleSessions.length, updateScrollState]);

  const scrollBy = useCallback((delta: number) => {
    scrollRef.current?.scrollBy({ top: delta, behavior: 'smooth' });
    setTimeout(updateScrollState, 300);
  }, [updateScrollState]);

  // Hover popover state
  const [hoveredSession, setHoveredSession] = useState<string | null>(null);
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = useCallback((sessionId: string, e: React.MouseEvent) => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPopoverPos({ top: rect.top, left: rect.right + 8 });
    setHoveredSession(sessionId);
  }, []);

  const handleMouseLeave = useCallback(() => {
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredSession(null);
    }, 200);
  }, []);

  const handlePopoverEnter = useCallback(() => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
  }, []);

  const handlePopoverLeave = useCallback(() => {
    setHoveredSession(null);
  }, []);

  // Right-click context menu state
  const [contextMenu, setContextMenu] = useState<{ sessionId: string; x: number; y: number } | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent, sessionId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ sessionId, x: e.clientX, y: e.clientY });
  }, []);

  const handleFinishSession = useCallback(() => {
    if (!contextMenu) return;
    const session = sessions.find(s => s.id === contextMenu.sessionId);
    if (session && session.status === 'running') {
      updateSessionStatus(contextMenu.sessionId, 'stopped', Date.now());
    }
    setFinishedIds(prev => new Set(prev).add(contextMenu.sessionId));
    setContextMenu(null);
  }, [contextMenu, sessions, updateSessionStatus]);

  const handleSessionActivate = useCallback((sessionId: string) => {
    // Session selection should never re-center/pan the canvas.
    const panBefore = useDesktopStore.getState().canvasPan;
    setSelectedSessionId(sessionId);
    const existing = windows.find(w => w.sessionId === sessionId);
    if (existing) {
      focusWindow(existing.id);
      requestAnimationFrame(() => {
        const state = useDesktopStore.getState();
        if (state.canvasPan.x !== panBefore.x || state.canvasPan.y !== panBefore.y) {
          state.setCanvasPan(panBefore);
        }
      });
      return;
    }
    const session = sessions.find(s => s.id === sessionId);
    const title = session?.description.trim() || (session ? `Session #${session.number}` : 'Chat');
    addWindow('chat', { title, sessionId });
    requestAnimationFrame(() => {
      const state = useDesktopStore.getState();
      if (state.canvasPan.x !== panBefore.x || state.canvasPan.y !== panBefore.y) {
        state.setCanvasPan(panBefore);
      }
    });
  }, [setSelectedSessionId, windows, focusWindow, sessions, addWindow]);

  // Close context menu on click elsewhere or ESC
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setContextMenu(null); };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [contextMenu]);

  // Re-render running sessions every second for elapsed time
  const [, setTick] = useState(0);
  useEffect(() => {
    const hasRunning = visibleSessions.some(s => s.status === 'running');
    if (!hasRunning) return;
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [visibleSessions]);

  if (visibleSessions.length === 0 || hasMaximized) return null;

  const hoveredData = hoveredSession ? visibleSessions.find(s => s.sessionId === hoveredSession) : null;

  return (
    <>
      <div
        className="absolute left-2 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1 px-1 py-1.5 rounded-[14px] bg-[rgba(20,20,20,0.88)] backdrop-blur-[16px] border border-white/[0.06] shadow-[0_2px_16px_rgba(0,0,0,0.4)] z-[150] max-h-[calc(100%-120px)] animate-[session-dock-enter_0.3s_ease-out] motion-reduce:animate-none"
        data-testid="session-status-dock"
        role="complementary"
        aria-label="Agentic session status"
      >
        {/* Scroll up arrow */}
        {canScrollUp && (
          <button
            className="flex items-center justify-center w-7 h-[18px] border-none bg-white/[0.04] text-white/40 rounded-md cursor-pointer shrink-0 transition-colors duration-150 hover:bg-white/[0.08] hover:text-white/70"
            data-testid="session-dock-scroll-up"
            onClick={() => scrollBy(-60)}
            aria-label="Scroll sessions up"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 15l-6-6-6 6" />
            </svg>
          </button>
        )}

        {/* Session icons list */}
        <div
          ref={scrollRef}
          className="flex flex-col items-center gap-1.5 overflow-y-auto overflow-x-hidden max-h-[calc(100%-40px)] py-0.5 scrollbar-hidden"
          onScroll={updateScrollState}
        >
          {visibleSessions.map(s => (
            <button
              type="button"
              key={s.sessionId}
              className="session-dock-item flex flex-col items-center cursor-pointer border-none bg-transparent p-0"
              data-testid={`session-dock-${s.sessionId}`}
              data-status={s.status}
              onClick={() => handleSessionActivate(s.sessionId)}
              onMouseEnter={(e) => handleMouseEnter(s.sessionId, e)}
              onMouseLeave={handleMouseLeave}
              onContextMenu={(e) => handleContextMenu(e, s.sessionId)}
              aria-label={`Open session #${s.sessionNumber}, status ${s.status}`}
            >
              <div className="session-dock-icon-inner" aria-hidden="true">
                <StatusIcon status={s.status} />
                <span className="session-dock-number-badge">{s.sessionNumber}</span>
              </div>
            </button>
          ))}
        </div>

        {/* Scroll down arrow */}
        {canScrollDown && (
          <button
            className="flex items-center justify-center w-7 h-[18px] border-none bg-white/[0.04] text-white/40 rounded-md cursor-pointer shrink-0 transition-colors duration-150 hover:bg-white/[0.08] hover:text-white/70"
            data-testid="session-dock-scroll-down"
            onClick={() => scrollBy(60)}
            aria-label="Scroll sessions down"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        )}
      </div>

      {/* Hover popover (to the right of the dock) */}
      {hoveredData && (
        <div
          className="fixed w-[260px] px-3.5 py-3 rounded-[10px] bg-[rgba(22,22,22,0.95)] backdrop-blur-[20px] border border-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.5)] z-[160] animate-[session-popover-in_0.15s_ease-out] motion-reduce:animate-none"
          data-testid="session-dock-popover"
          style={{ top: Math.max(60, popoverPos.top - 10), left: popoverPos.left }}
          onMouseEnter={handlePopoverEnter}
          onMouseLeave={handlePopoverLeave}
        >
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[13px] font-semibold text-zinc-200 font-['Manrope',sans-serif]">Session #{hoveredData.sessionNumber}</span>
            <span className={`session-popover-badge session-popover-badge-${hoveredData.status}`}>
              {hoveredData.status}
            </span>
          </div>
          <p className="text-[11px] text-zinc-400 mb-2 leading-snug overflow-hidden text-ellipsis whitespace-nowrap">{hoveredData.description}</p>
          <div className="flex flex-col gap-1">
            <div className="flex justify-between items-center">
              <span className="text-[10px] text-[#636363] font-['Manrope',sans-serif]">Duration</span>
              <span className="text-[11px] text-zinc-300 font-['Liberation_Mono',monospace]">
                {hoveredData.status === 'running'
                  ? formatDuration(hoveredData.startedAt)
                  : hoveredData.endedAt
                    ? formatDuration(hoveredData.startedAt, hoveredData.endedAt)
                    : formatTimeAgo(hoveredData.startedAt)
                }
              </span>
            </div>
            {hoveredData.model && (
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-[#636363] font-['Manrope',sans-serif]">Model</span>
                <span className="text-[11px] text-zinc-300 font-['Liberation_Mono',monospace]">{hoveredData.model}</span>
              </div>
            )}
            {hoveredData.premiumRequests != null && hoveredData.premiumRequests > 0 && (
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-[#636363] font-['Manrope',sans-serif]">Requests</span>
                <span className="text-[11px] text-zinc-300 font-['Liberation_Mono',monospace]">{hoveredData.premiumRequests}</span>
              </div>
            )}
            {hoveredData.roleId && (
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-[#636363] font-['Manrope',sans-serif]">Role</span>
                <span className="text-[11px] text-zinc-300 font-['Liberation_Mono',monospace] truncate max-w-[140px]">{hoveredData.roleId}</span>
              </div>
            )}
            {hoveredData.flowId && (
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-[#636363] font-['Manrope',sans-serif]">Flow</span>
                <span className="text-[11px] text-zinc-300 font-['Liberation_Mono',monospace] truncate max-w-[140px]">{hoveredData.flowId}</span>
              </div>
            )}
            {hoveredData.designSystemId && (
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-[#636363] font-['Manrope',sans-serif]">Design System</span>
                <span className="text-[11px] text-zinc-300 font-['Liberation_Mono',monospace] truncate max-w-[110px]">{hoveredData.designSystemId}</span>
              </div>
            )}
            {hoveredData.modifierIds.length > 0 && (
              <div className="flex justify-between items-start">
                <span className="text-[10px] text-[#636363] font-['Manrope',sans-serif] pt-px">Modifiers</span>
                <div className="flex flex-col items-end gap-0.5">
                  {hoveredData.modifierIds.map(m => (
                    <span key={m} className="text-[11px] text-zinc-300 font-['Liberation_Mono',monospace] truncate max-w-[140px]">{m}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Right-click context menu */}
      {contextMenu && (
        <div
          className="fixed z-[500] min-w-[160px] p-1 rounded-lg bg-[#1a1a1a] border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.6)]"
          data-testid="session-dock-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className="block w-full px-3 py-2 border-none bg-transparent text-zinc-200 text-xs font-['Manrope',sans-serif] text-left rounded-[5px] cursor-pointer transition-colors duration-100 hover:bg-white/[0.06]"
            data-testid="session-dock-finish"
            onClick={handleFinishSession}
          >
            Finish session
          </button>
        </div>
      )}
    </>
  );
}
