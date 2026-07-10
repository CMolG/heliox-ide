/**
 * TerminalPanel.tsx — Renderer Composite Component
 *
 * Responsibility:
 * - Renders the TerminalPanel surface in the renderer layer.
 * - Encapsulates Feature-level composition used by the renderer shell and panels.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/TerminalPanel.tsx — Agent conversation / reasoning viewer
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useFluxorStore } from '../store';
import { theme } from '../logic/theme';

export function TerminalPanel() {
  const rawOutputLines = useFluxorStore((s) => s.rawOutputLines);
  const clearRawOutput = useFluxorStore((s) => s.clearRawOutput);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const prevCountRef = useRef(rawOutputLines.length);

  // Auto-scroll on new lines
  useEffect(() => {
    if (autoScroll && scrollRef.current && rawOutputLines.length > prevCountRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    prevCountRef.current = rawOutputLines.length;
  }, [rawOutputLines.length, autoScroll]);

  {/* TODO duplicate, solve it */}
  // Scroll to bottom on mount
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

  // Merge consecutive thinking deltas into blocks for readable display
  const blocks = React.useMemo(() => {
    const result: Array<{ type: 'thinking' | 'event'; content: string }> = [];
    let thinkingBuffer = '';

    for (const line of rawOutputLines) {
      // Thinking deltas are now just plain text fragments (no JSON wrapping)
      // They arrive as short text chunks that should be concatenated
      const isEvent = line.startsWith('[');

      if (!isEvent && !line.startsWith('{')) {
        // Plain text = thinking content
        thinkingBuffer += line;
      } else {
        // Flush thinking buffer if we have one
        if (thinkingBuffer) {
          result.push({ type: 'thinking', content: thinkingBuffer });
          thinkingBuffer = '';
        }
        result.push({ type: 'event', content: line });
      }
    }
    // Flush remaining thinking
    if (thinkingBuffer) {
      result.push({ type: 'thinking', content: thinkingBuffer });
    }
    return result;
  }, [rawOutputLines]);

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: theme.bg }}>
      {/* Header */}
      <div
        className="px-4 py-2 flex items-center justify-between shrink-0"
        style={{ background: theme.surfaceLight, borderBottom: `1px solid ${theme.border}` }}
      >
        <span
          className="text-[10px] font-bold uppercase tracking-wider"
          style={{ fontFamily: theme.fontInter, color: theme.textDim }}
        >
          Agent Reasoning
        </span>
        <button
          onClick={clearRawOutput}
          aria-label="Clear agent output"
          className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded transition hover:bg-white/5"
          style={{ fontFamily: theme.fontInter, color: theme.textFaint }}
        >
          Clear
        </button>
      </div>

      {/* Conversation-style output */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        role="log"
        aria-live="polite"
        aria-label="Agent reasoning output"
        className="flex-1 overflow-y-auto px-4 py-3"
      >
        {blocks.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <span className="text-xs" style={{ fontFamily: theme.fontInter, color: theme.textGhost }}>
              Agent reasoning and tool calls appear here when a session runs
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {blocks.map((block, idx) => (
              <div key={idx}>
                {block.type === 'thinking' ? (
                  <div
                    className="text-xs leading-relaxed whitespace-pre-wrap"
                    style={{ fontFamily: theme.fontManrope, color: theme.textMuted }}
                  >
                    {block.content}
                  </div>
                ) : (
                  <div
                    className="text-[10px] py-0.5 font-medium"
                    style={{
                      fontFamily: theme.fontMono,
                      color: block.content.startsWith('[tool:')
                        ? '#c084fc'
                        : block.content.startsWith('[result]')
                          ? theme.success
                          : theme.textDim,
                    }}
                  >
                    {block.content}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
