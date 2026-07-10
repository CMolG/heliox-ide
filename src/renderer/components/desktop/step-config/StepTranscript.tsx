/**
 * StepTranscript.tsx — Structured transcript for a launched step's run
 *
 * Responsibility:
 * - Renders the ordered `stepThinkings[stepId]` timeline of a step the
 *   harness actually launched: reasoning (collapsible), assistant text (real
 *   Markdown via `TranscriptMarkdown`), and tool-activity bursts
 *   (`ToolCallCard`). Adds smart scroll pinning (auto-follow only while the
 *   user is at the bottom; a "New activity" pill re-pins otherwise) and a
 *   live thinking indicator while the step is running.
 *
 * This is the surface that absorbs the transcript TECHNOLOGY of the
 * (unexecuted) `agentic-chat-overhaul` plan (#4), retargeted from the retired
 * chat window to per-step run evidence — see the F0 re-scope spec
 * (docs/superpowers/specs/2026-07-10-chats-to-steps-f0-rescope.md, §"#4").
 * It reuses the existing `chat/CodeBlock.tsx` (through `TranscriptMarkdown`)
 * rather than forking it.
 *
 * Data-shape honesty (Task T): the harness step-run pipeline flattens each
 * turn into `{ kind: 'reasoning' | 'text' | 'tool'; text: string }` deltas
 * (harness-store `StepThinkingDelta` reducer). There is no per-tool
 * input/result/status pair and no file-change stream — see `ToolCallCard` and
 * `FileChangeChips` for how each degrades. This component renders exactly
 * what that timeline carries, in order, never fabricating structure the
 * pipeline doesn't emit.
 *
 * Boundaries:
 * - Owns: timeline layout, per-entry dispatch, scroll pinning, and its own
 *   collapse/pin local state.
 * - Does NOT own: the transcript data (a plain `entries` array in — the
 *   parent `StepRunEvidence` selects it from harness-store), nor any store
 *   mutation.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LucideIcon } from '../LucideIcon';
import { theme } from '../../../logic/theme';
import { TranscriptMarkdown } from './TranscriptMarkdown';
import { ToolCallCard } from './ToolCallCard';

/** A single flattened transcript delta — mirrors harness-store `stepThinkings` entries. */
export interface StepTranscriptEntry {
  kind: 'reasoning' | 'text' | 'tool';
  text: string;
}

// Distance (px) from the bottom within which we consider the user "pinned"
// and keep auto-following new content. Matches the chat-overhaul plan's 48px.
const PIN_THRESHOLD = 48;

const SCROLL_STYLE: React.CSSProperties = {
  maxHeight: 320,
  overflowY: 'auto',
  padding: '8px 10px',
  borderRadius: 8,
  background: '#0d0d0d',
  border: `1px solid ${theme.borderLight}`,
  scrollbarWidth: 'thin',
};

// ── Reasoning row (collapsible) ─────────────────────────────────────

const REASONING_TOGGLE_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  width: '100%',
  textAlign: 'left',
  background: 'transparent',
  border: 'none',
  padding: '2px 0',
  cursor: 'pointer',
  color: theme.textMuted,
  fontFamily: theme.fontMono,
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};
const REASONING_BODY_STYLE: React.CSSProperties = {
  margin: '2px 0 6px',
  maxHeight: 200,
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontStyle: 'italic',
  fontSize: 11,
  lineHeight: 1.55,
  color: 'rgba(161, 161, 170, 0.82)',
};

function ReasoningRow({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid="step-transcript-reasoning">
      <button
        type="button"
        style={REASONING_TOGGLE_STYLE}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Reasoning (${text.length} characters)`}
        data-testid="step-transcript-reasoning-toggle"
      >
        <LucideIcon name={open ? 'ChevronDown' : 'ChevronRight'} size={10} />
        Reasoning ({text.length} chars)
      </button>
      {open && (
        <div style={REASONING_BODY_STYLE} data-testid="step-transcript-reasoning-body">
          {text}
        </div>
      )}
    </div>
  );
}

// ── Transcript ──────────────────────────────────────────────────────

export interface StepTranscriptProps {
  entries: StepTranscriptEntry[];
  /** True while the step is still executing — shows the live thinking pulse. */
  running?: boolean;
}

export function StepTranscript({ entries, running = false }: StepTranscriptProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Ref, not state: the scroll position is imperative DOM, and reading it in
  // the post-update effect must not itself trigger a re-render loop.
  const pinnedRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < PIN_THRESHOLD;
    pinnedRef.current = nearBottom;
    if (nearBottom) setShowJump(false);
  }, []);

  // After each content change: follow the bottom only if the user was pinned;
  // otherwise surface the "New activity" pill instead of yanking their view.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (pinnedRef.current) {
      el.scrollTop = el.scrollHeight;
    } else {
      setShowJump(true);
    }
  }, [entries, running]);

  const jumpToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    pinnedRef.current = true;
    setShowJump(false);
  }, []);

  return (
    <div style={{ position: 'relative' }}>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={SCROLL_STYLE}
        data-testid="step-transcript"
        role="log"
        aria-live="polite"
        aria-label="Step run transcript"
      >
        {entries.map((entry, i) => {
          // Stable-enough key: entries are append-only per turn and the store
          // merges same-kind deltas in place, so index maps to a stable slot.
          if (entry.kind === 'tool') return <ToolCallCard key={i} text={entry.text} />;
          if (entry.kind === 'reasoning') return <ReasoningRow key={i} text={entry.text} />;
          return <TranscriptMarkdown key={i} content={entry.text} />;
        })}
        {running && (
          <div className="step-thinking-thinking-indicator" data-testid="step-transcript-running">
            <span className="step-thinking-dot" />
            <span className="step-thinking-dot" />
            <span className="step-thinking-dot" />
            <span className="step-thinking-thinking-label">running…</span>
          </div>
        )}
      </div>
      {showJump && (
        <button
          type="button"
          onClick={jumpToBottom}
          data-testid="step-transcript-jump"
          aria-label="Jump to latest activity"
          style={{
            position: 'absolute',
            bottom: 10,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 10px',
            borderRadius: 999,
            border: `1px solid ${theme.accentBlueBorder}`,
            background: theme.accentBlueBg,
            color: theme.accentBlue,
            fontFamily: theme.fontInter,
            fontSize: 10,
            fontWeight: 600,
            cursor: 'pointer',
            backdropFilter: 'blur(6px)',
          }}
        >
          <LucideIcon name="ChevronDown" size={11} />
          New activity
        </button>
      )}
    </div>
  );
}
