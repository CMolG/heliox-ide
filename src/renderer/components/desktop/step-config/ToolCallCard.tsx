/**
 * ToolCallCard.tsx — Compact activity row for a step's tool-call bursts
 *
 * Responsibility:
 * - Renders one `stepThinkings` entry of kind 'tool' as a collapsed-by-
 *   default row (wrench icon + best-effort tool-name label) that expands to
 *   show the full raw text.
 *
 * Data-honesty note (2026-07-10, Task T — see final report "Escalación"):
 * the harness-engine step-run pipeline's `StepThinkingDelta{kind:'tool'}` is
 * a single flattened brief string built by `llm-runner.ts` as
 * `` `${toolName}(${JSON.stringify(input)})` `` — there is no structured
 * input/result pair, and no per-call status (running/done/error): tool
 * RESULTS are never streamed over IPC at all (`executor.ts` computes them
 * but discards them once the step's final text is built). This card
 * therefore does NOT claim the per-call running/done/error status the
 * (unexecuted) `agentic-chat-overhaul` plan's ToolCallCard spec envisioned —
 * it shows exactly the one brief string harness-store actually has, labelled
 * via a best-effort regex over that string. If several tool calls fire
 * back-to-back with no intervening reasoning/text delta, harness-store's
 * reducer merges their briefs into ONE entry with no separator — the label
 * then reflects only the first call, but the expanded body always shows the
 * complete, un-reparsed raw text, so no information is ever hidden or
 * misrepresented.
 *
 * Boundaries:
 * - Owns: presentation + its own local expand/collapse state.
 * - Does NOT own: fetching/subscribing to transcript data — a plain `text`
 *   string prop in, nothing else.
 */
import React, { useState } from 'react';
import { LucideIcon } from '../LucideIcon';
import { theme } from '../../../logic/theme';

const CARD_STYLE: React.CSSProperties = {
  border: '1px solid rgba(96, 165, 250, 0.22)',
  background: 'rgba(96, 165, 250, 0.06)',
  borderRadius: 7,
  padding: '5px 8px',
  margin: '4px 0',
};
const HEADER_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  cursor: 'pointer',
  background: 'transparent',
  border: 'none',
  padding: 0,
  width: '100%',
  textAlign: 'left',
  color: 'rgba(147, 197, 253, 0.95)',
  fontFamily: theme.fontMono,
  fontSize: 10.5,
};
const LABEL_STYLE: React.CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flex: 1,
};
const BODY_STYLE: React.CSSProperties = {
  marginTop: 5,
  maxHeight: 240,
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontFamily: theme.fontMono,
  fontSize: 10.5,
  color: theme.textMuted,
  lineHeight: 1.5,
};

/**
 * Best-effort `toolName` extraction from a `name(...)` brief — falls back to
 * a generic label when the text doesn't match. Never blocks rendering the
 * raw text in the expanded body, so a parse miss only costs a worse label,
 * never lost information.
 */
function toolLabel(text: string): string {
  const match = /^([a-zA-Z_][\w.]*)\(/.exec(text);
  return match ? match[1] : 'Tool activity';
}

export interface ToolCallCardProps {
  text: string;
}

export function ToolCallCard({ text }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const label = toolLabel(text);

  return (
    <div style={CARD_STYLE} data-testid="step-transcript-tool-card">
      <button
        type="button"
        style={HEADER_STYLE}
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        aria-label={`Tool activity: ${label}`}
        data-testid="step-transcript-tool-card-toggle"
      >
        <LucideIcon name="Wrench" size={11} />
        <span style={LABEL_STYLE}>{label}</span>
        <LucideIcon name={expanded ? 'ChevronDown' : 'ChevronRight'} size={11} />
      </button>
      {expanded && (
        <div style={BODY_STYLE} data-testid="step-transcript-tool-card-body">
          {text}
        </div>
      )}
    </div>
  );
}
