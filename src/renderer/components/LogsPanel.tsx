/**
 * LogsPanel.tsx — Renderer Composite Component
 *
 * Responsibility:
 * - Renders the LogsPanel surface in the renderer layer.
 * - Encapsulates Feature-level composition used by the renderer shell and panels.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/LogsPanel.tsx — Bottom panel log viewer
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useHelioxStore } from '../store';
import type { LogEntry } from '@/types';
import { formatTimestamp } from '@/types';
import { theme } from '../logic/theme';
import { HelioxDropdown } from './ui/HelioxDropdown';

type LogLevel = LogEntry['level'];
type FilterLevel = LogLevel | 'all';

const LEVEL_STYLES: Record<LogLevel, string> = {
  info: 'text-blue-400',
  warn: 'text-amber-400',
  error: 'text-red-400',
  system: 'text-zinc-500',
};

export function LogsPanel() {
  const logEntries = useHelioxStore((s) => s.logEntries);
  const clearLogs = useHelioxStore((s) => s.clearLogs);
  const [filter, setFilter] = useState<FilterLevel>('all');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const prevCountRef = useRef(logEntries.length);

  const filtered = filter === 'all'
    ? logEntries
    : logEntries.filter(e => e.level === filter);

  // Auto-scroll on new entries
  useEffect(() => {
    if (autoScroll && scrollRef.current && logEntries.length > prevCountRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    prevCountRef.current = logEntries.length;
  }, [logEntries.length, autoScroll]);

  {/* TODO duplicate, solve it */}
  // Scroll to bottom on mount (when panel is first opened)
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 40);
  }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: theme.bg }}>
      {/* Header */}
      <div
        className="px-4 py-2 flex items-center justify-between shrink-0"
        style={{ background: theme.surfaceLight, borderBottom: `1px solid ${theme.border}` }}
      >
        <div className="flex items-center gap-3">
          <span
            className="text-[10px] font-bold uppercase tracking-wider"
            style={{ fontFamily: theme.fontInter, color: theme.textDim }}
          >
            Logs
          </span>
          <HelioxDropdown
            value={filter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'info', label: 'Info' },
              { value: 'warn', label: 'Warn' },
              { value: 'error', label: 'Error' },
              { value: 'system', label: 'Debug' },
            ]}
            onChange={(v) => setFilter(v as FilterLevel)}
            fontSize={10}
            ariaLabel="Filter logs by level"
          />
        </div>
        <button
          onClick={clearLogs}
          className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded transition hover:bg-white/5"
          style={{ fontFamily: theme.fontInter, color: theme.textFaint }}
          aria-label="Clear all logs"
        >
          Clear
        </button>
      </div>

      {/* Log entries */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-1"
      >
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <span className="text-xs" style={{ fontFamily: theme.fontInter, color: theme.textGhost }}>
              No log entries
            </span>
          </div>
        ) : (
          <div className="flex flex-col" role="log" aria-live="polite">
            {filtered.map((entry) => (
              <div
                key={entry.id}
                className="flex items-start gap-2 py-px hover:bg-white/[0.02]"
              >
                <span
                  className="shrink-0 text-neutral-500/50 text-[9px] font-mono pt-px"
                  style={{ minWidth: 52 }}
                >
                  {formatTimestamp(entry.timestamp)}
                </span>
                <span
                  className={`shrink-0 text-[9px] font-bold uppercase font-mono ${LEVEL_STYLES[entry.level]}`}
                  style={{ minWidth: 36 }}
                >
                  {entry.level === 'system' ? 'dbg' : entry.level.slice(0, 4)}
                </span>
                <span className="text-zinc-300 text-xs font-mono break-all">
                  {entry.message}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
