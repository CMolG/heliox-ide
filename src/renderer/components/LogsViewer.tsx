/**
 * LogsViewer.tsx — Renderer Composite Component
 *
 * Responsibility:
 * - Renders the LogsViewer surface in the renderer layer.
 * - Encapsulates Feature-level composition used by the renderer shell and panels.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/LogsViewer.tsx — Structured event log viewer
import React, { useRef, useEffect, useState } from 'react';
import { useHelioxStore } from '../store';
import type { LogEntry } from '@/types';
import { formatTimestamp } from '@/types';
import { theme } from '../logic/theme';

const LEVEL_CONFIG: Record<LogEntry['level'], { color: string; bg: string }> = {
  info: { color: theme.textDim, bg: 'rgba(115,115,115,0.1)' },
  warn: { color: theme.warning, bg: 'rgba(245,158,11,0.1)' },
  error: { color: theme.danger, bg: 'rgba(248,113,113,0.1)' },
  system: { color: theme.textSecondary, bg: 'rgba(214,211,209,0.1)' },
};

export function LogsViewer() {
  const { logEntries, clearLogs } = useHelioxStore();
  const [levelFilter, setLevelFilter] = useState<LogEntry['level'] | 'all'>('all');
  const [searchFilter, setSearchFilter] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const filtered = logEntries.filter(entry => {
    if (levelFilter !== 'all' && entry.level !== levelFilter) return false;
    if (searchFilter && !entry.message.toLowerCase().includes(searchFilter.toLowerCase())) return false;
    return true;
  });

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filtered.length, autoScroll]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 50);
  };

  return (
    <div className="flex flex-col overflow-hidden h-full" style={{ background: theme.bgApp }}>
      {/* Header */}
      <div className="h-16 px-8 flex items-center justify-between shrink-0" style={{ borderBottom: '1px solid rgba(63,63,70,0.1)' }}>
        <div className="flex items-center gap-6">
          <span className="text-sm font-medium leading-5" style={{ fontFamily: theme.fontGrotesk, color: theme.textSecondary }}>
            EVENT LOG
          </span>
          <div className="flex items-center gap-1">
            {(['all', 'info', 'warn', 'error', 'system'] as const).map(level => (
              <button
                key={level}
                onClick={() => setLevelFilter(level)}
                className="px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider transition"
                aria-pressed={levelFilter === level}
                style={{
                  fontFamily: theme.fontInter,
                  color: levelFilter === level ? theme.textPrimary : theme.textFaint,
                  background: levelFilter === level ? 'rgba(214,211,209,0.1)' : 'transparent',
                }}
              >
                {level}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <input
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder="Search logs..."
            className="bg-black text-xs rounded-lg px-3 py-1.5 outline-none w-40"
            aria-label="Search logs"
            style={{ fontFamily: theme.fontManrope, color: theme.textMuted, border: '1px solid rgba(63,63,70,0.15)' }}
          />
          {logEntries.length > 0 && (
            <button
              onClick={clearLogs}
              className="px-3 py-1.5 rounded-full text-[10px] font-semibold uppercase tracking-wider transition hover:bg-red-500/10"
              style={{ fontFamily: theme.fontInter, color: theme.danger }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Log entries */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-4 font-mono text-xs" role="log" aria-live="polite" style={{ color: theme.textMuted }}>
        {filtered.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none" className="mx-auto mb-3">
                <rect x="4" y="6" width="24" height="20" rx="2" stroke="#3f3f46" strokeWidth="1.5"/>
                <path d="M4 12h24" stroke="#3f3f46" strokeWidth="1.5"/>
                <path d="M8 17h8M8 21h12" stroke="#3f3f46" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <span className="text-sm" style={{ fontFamily: theme.fontGrotesk, color: theme.textGhost }}>
                {logEntries.length === 0 ? 'No events yet' : 'No matching entries'}
              </span>
              <p className="text-xs mt-1" style={{ fontFamily: theme.fontManrope, color: theme.textFaint }}>
                {logEntries.length === 0 ? 'Events will appear as agents run' : 'Try adjusting the filters'}
              </p>
            </div>
          </div>
        )}
        <div className="flex flex-col gap-0.5">
          {filtered.map(entry => {
            const cfg = LEVEL_CONFIG[entry.level];
            return (
              <div key={entry.id} className="flex items-start gap-3 py-0.5 px-2 rounded hover:bg-white/[0.02] transition">
                <span className="shrink-0 w-16 text-right" style={{ color: theme.textFaint, fontFamily: theme.fontMono }}>
                  {formatTimestamp(entry.timestamp)}
                </span>
                <span
                  className="shrink-0 w-14 text-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase"
                  style={{ color: cfg.color, background: cfg.bg, fontFamily: theme.fontInter }}
                >
                  {entry.level}
                </span>
                {entry.sessionId && (
                  <span className="shrink-0 text-[10px]" style={{ color: theme.textFaint, fontFamily: theme.fontInter }}>
                    #{entry.sessionId.replace('session-', '')}
                  </span>
                )}
                <span style={{ color: theme.textMuted, fontFamily: theme.fontMono }}>
                  {entry.message}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom stats */}
      <div className="h-12 px-8 flex items-center gap-6 shrink-0" style={{ background: 'rgba(23,23,23,0.5)', borderTop: '1px solid rgba(63,63,70,0.1)' }}>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-normal uppercase tracking-wide" style={{ fontFamily: theme.fontInter, color: theme.textFaint }}>Total</span>
          <span className="text-xs font-bold" style={{ fontFamily: theme.fontGrotesk, color: theme.textPrimary }}>{logEntries.length}</span>
        </div>
        {levelFilter !== 'all' && (
          <>
            <div className="w-px h-4" style={{ background: 'rgba(63,63,70,0.2)' }} />
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-normal uppercase tracking-wide" style={{ fontFamily: theme.fontInter, color: theme.textFaint }}>Showing</span>
              <span className="text-xs font-bold" style={{ fontFamily: theme.fontGrotesk, color: theme.textPrimary }}>{filtered.length}</span>
            </div>
          </>
        )}
        {!autoScroll && (
          <button
            onClick={() => { setAutoScroll(true); scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }}
            className="ml-auto px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider"
            style={{ fontFamily: theme.fontInter, color: theme.textSecondary, background: 'rgba(214,211,209,0.1)' }}
            aria-label="Scroll to bottom"
          >
            ↓ Scroll to bottom
          </button>
        )}
      </div>
    </div>
  );
}
