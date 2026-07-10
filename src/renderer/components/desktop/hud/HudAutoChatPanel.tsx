/**
 * HudAutoChatPanel.tsx — The single automation-chat surface (HUD panel)
 *
 * Responsibility:
 * - The ONE remaining "chat" in the product: a fixed, collapsible HUD panel
 *   (chats→steps re-architecture, F0 decision 2, 2026-07-10) — NOT a
 *   `DesktopWindow` (general chat windows are retired entirely).
 * - This is a one-shot INTENT BOX, not a conversational agent. The user
 *   describes what they need in natural language; `window.fluxorAPI
 *   .assemblePipeline` (the Meta-Agent, `ipc-handlers.ts`'s
 *   `assemble-pipeline` handler) compiles that single intent into a
 *   `PipelineAssembly` in one call — it does not hold a conversation, there
 *   is no multi-turn state, and there is no "assistant reply" to render.
 *   `insertPipelineAssembly` (desktop-store) then materializes the result
 *   onto the board as real, editable steps — the same canonical seam
 *   `TextToFlowWidget` used (this panel evolves/replaces that widget in its
 *   HUD slot rather than duplicating it — see the `HudWidgetType` rename in
 *   desktop-store.ts, 'text-to-flow' → 'auto-chat').
 * - The "history" below the input is a lightweight log of past intents +
 *   what each one materialized (or the error) — NOT a transcript. It is
 *   intentionally NOT the react-markdown/tool-call-card rich transcript the
 *   old `agentic-chat-overhaul` plan describes — that tech is retargeted to
 *   `StepRunEvidence` (Task T), which is where actual per-step tool/agent
 *   activity happens (this panel never runs an agent session — it makes
 *   exactly one structured-generation call and stops).
 * - Never edits code directly and holds no code-editing toolset: its only
 *   effect on the workspace is `insertPipelineAssembly`, which writes step
 *   nodes to the canvas — the same operation "copy a market flow to the
 *   board" and the mono-step canvas gesture (SeamlessCanvas.tsx) use. It
 *   does not import or call `agent-manager` in any way.
 *
 * Boundaries:
 * - Owns: intent input UX, submit/assembly request lifecycle, and the local
 *   collapse toggle for its own history list.
 * - Does NOT own: pipeline generation (main/meta-agent), canvas node
 *   lifecycle (desktop-store), or per-step run evidence (StepRunEvidence).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PipelineAssembly } from '@/types/meta-agent';
import { useDesktopStore } from '../../../store/desktop-store';
import { calculateSafeInsertionPoint } from '../../../store/spatial-engine';
import { FluxorSpinner } from '../../brand/FluxorSpinner';
import { LucideIcon } from '../LucideIcon';
import { theme } from '../../../logic/theme';

const FRAME_HORIZONTAL_PADDING = 112;
const FRAME_VERTICAL_PADDING = 210;
const STEP_HORIZONTAL_GAP = 250;
const STEP_WIDTH = 300;
const MIN_FRAME_WIDTH = 860;
const MIN_FRAME_HEIGHT = 420;

// Example intents — one click fills the textarea so the first action is
// click + Enter instead of a blank page. (Ported verbatim from the widget
// this panel replaces in the HUD — same copy, same seam.)
const EXAMPLE_INTENTS: { label: string; intent: string }[] = [
  { label: 'Scrape + summarize + email', intent: 'Scrape a site, summarise each page, then email me a digest' },
  { label: 'Test an API', intent: 'Call a REST API, validate the response schema, and report failures' },
  { label: 'Sync sheet to DB', intent: 'Fetch rows from a spreadsheet, transform them, and upsert into a database' },
];

function estimateFrameSize(assembly: PipelineAssembly): { width: number; height: number } {
  const stepCount = Math.max(1, assembly.steps.length);
  return {
    width: Math.max(MIN_FRAME_WIDTH, FRAME_HORIZONTAL_PADDING + STEP_WIDTH + (stepCount - 1) * STEP_HORIZONTAL_GAP + 96),
    height: Math.max(MIN_FRAME_HEIGHT, FRAME_VERTICAL_PADDING + (stepCount > 1 ? 34 : 0)),
  };
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function HudAutoChatPanel() {
  const [intent, setIntent] = useState('');
  const [status, setStatus] = useState<'idle' | 'assembling' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const mentalNodes = useDesktopStore(s => s.mentalNodes);
  const insertPipelineAssembly = useDesktopStore(s => s.insertPipelineAssembly);
  const setCanvasPan = useDesktopStore(s => s.setCanvasPan);
  const setCanvasZoom = useDesktopStore(s => s.setCanvasZoom);
  const history = useDesktopStore(s => s.autoChatHistory);
  const addAutoChatHistoryEntry = useDesktopStore(s => s.addAutoChatHistoryEntry);
  const clearAutoChatHistory = useDesktopStore(s => s.clearAutoChatHistory);

  const canSubmit = useMemo(() => intent.trim().length > 0 && status !== 'assembling', [intent, status]);

  // Auto-focus: on mount (covers the common "just became visible" case — the
  // HUD only mounts a widget while `visible: true`, see HudWidgetLayer) AND
  // on the 'fluxor:focus-auto-chat' event (covers "already visible, the user
  // clicked the dock/menu affordance again" — same event-bus convention as
  // the legacy 'fluxor:focus-chat', dispatched by Dock.tsx).
  useEffect(() => {
    textareaRef.current?.focus();
    const handler = () => textareaRef.current?.focus();
    window.addEventListener('fluxor:focus-auto-chat', handler);
    return () => window.removeEventListener('fluxor:focus-auto-chat', handler);
  }, []);

  const handleChipClick = useCallback((sample: string) => {
    setIntent(sample);
    textareaRef.current?.focus();
  }, []);

  const panToFrame = useCallback((frameId: string) => {
    const frame = useDesktopStore.getState().mentalNodes.find(n => n.id === frameId);
    if (!frame) return; // deleted since — nothing to pan to
    const container = document.querySelector('.mental-graph-canvas-container');
    const viewW = container?.clientWidth ?? window.innerWidth;
    const viewH = container?.clientHeight ?? window.innerHeight;
    const targetZoom = 0.8;
    const centerX = frame.position.x + frame.width / 2;
    const centerY = frame.position.y + frame.height / 2;
    setCanvasZoom(targetZoom);
    setCanvasPan({ x: viewW / 2 - centerX * targetZoom, y: viewH / 2 - centerY * targetZoom });
  }, [setCanvasPan, setCanvasZoom]);

  const handleSubmit = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    const userIntent = intent.trim();
    if (!userIntent || status === 'assembling') return;

    setStatus('assembling');
    setError(null);
    try {
      const result = await window.fluxorAPI?.assemblePipeline(userIntent);
      if (!result?.success || !result.data) {
        throw new Error(result?.error ?? 'Meta-Agent assembly failed.');
      }

      const frameSize = estimateFrameSize(result.data);
      const safePoint = calculateSafeInsertionPoint(
        useDesktopStore.getState().mentalNodes,
        frameSize.width,
        frameSize.height,
      );
      const { frameId, stepIds } = insertPipelineAssembly({
        assembly: result.data,
        position: safePoint,
        frameWidth: frameSize.width,
        frameHeight: frameSize.height,
      });

      // Center the controlled viewport on the freshly assembled flow.
      const targetZoom = 0.8;
      const container = document.querySelector('.mental-graph-canvas-container');
      const viewW = container?.clientWidth ?? window.innerWidth;
      const viewH = container?.clientHeight ?? window.innerHeight;
      const centerX = safePoint.x + frameSize.width / 2;
      const centerY = safePoint.y + frameSize.height / 2;
      setCanvasZoom(targetZoom);
      setCanvasPan({ x: viewW / 2 - centerX * targetZoom, y: viewH / 2 - centerY * targetZoom });

      addAutoChatHistoryEntry({ intent: userIntent, result: { kind: 'success', frameId, stepCount: stepIds.length } });
      setIntent('');
      setStatus('idle');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus('error');
      setError(message);
      addAutoChatHistoryEntry({ intent: userIntent, result: { kind: 'error', message } });
    }
  }, [intent, insertPipelineAssembly, setCanvasPan, setCanvasZoom, status, addAutoChatHistoryEntry]);

  const chipRowStyle: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6 };

  const historyHeaderStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 4,
  };

  const historyToggleStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 4,
    background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
    fontFamily: theme.fontGrotesk, fontSize: 10, fontWeight: 600,
    color: theme.textFaint, textTransform: 'uppercase', letterSpacing: 0.4,
  };

  const historyListStyle: React.CSSProperties = {
    listStyle: 'none', margin: 0, padding: 0,
    display: 'flex', flexDirection: 'column', gap: 4,
    maxHeight: 180, overflowY: 'auto',
  };

  const historyItemBase: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: 2,
    padding: '5px 6px', borderRadius: 5, background: theme.surfaceCard,
    border: `1px solid ${theme.borderLight}`, textAlign: 'left', width: '100%',
    cursor: 'default',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} data-testid="auto-chat-panel-root">
      <form
        style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
        onSubmit={handleSubmit}
        aria-label="Auto-chat: describe a flow in natural language"
        data-testid="auto-chat"
      >
        <textarea
          ref={textareaRef}
          value={intent}
          rows={3}
          placeholder={mentalNodes.length > 0
            ? 'Describe the next flow in natural language…'
            : 'Describe what you need — e.g. "scrape a site, summarise each page, then email me a digest"'}
          disabled={status === 'assembling'}
          onChange={(e) => setIntent(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') e.currentTarget.form?.requestSubmit(); }}
          style={{
            width: '100%', resize: 'vertical', minHeight: 64, boxSizing: 'border-box',
            background: theme.surfaceCard, border: `1px solid ${theme.borderLight}`, borderRadius: 6,
            color: theme.textPrimary, fontFamily: theme.fontInter, fontSize: 11, padding: '6px 8px',
            outline: 'none', lineHeight: 1.5,
          }}
          aria-label="Describe the flow you need"
        />
        <div style={chipRowStyle} role="group" aria-label="Example intents">
          {EXAMPLE_INTENTS.map((ex) => (
            <button
              key={ex.label}
              type="button"
              onClick={() => handleChipClick(ex.intent)}
              disabled={status === 'assembling'}
              data-testid={`auto-chat-chip-${ex.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
              style={{
                padding: '3px 9px', borderRadius: 999, border: `1px solid ${theme.borderLight}`,
                background: theme.surfaceCard, color: theme.textSecondary, fontFamily: theme.fontInter,
                fontSize: 10, cursor: status === 'assembling' ? 'default' : 'pointer', lineHeight: 1.4,
              }}
            >
              {ex.label}
            </button>
          ))}
        </div>
        <button
          type="submit"
          disabled={!canSubmit}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 6, border: `1px solid ${theme.accentBlueBorder}`,
            background: theme.accentBlueBg, color: theme.accentBlue, fontFamily: theme.fontGrotesk,
            fontSize: 11, fontWeight: 600, cursor: canSubmit ? 'pointer' : 'default',
            opacity: canSubmit ? 1 : 0.5, transition: 'opacity 0.15s', width: '100%',
          }}
          aria-label="Build flow from description"
        >
          {status === 'assembling' ? <><FluxorSpinner size={14} /> Assembling…</> : 'Build flow'}
        </button>
        {error && (
          <div role="status" style={{ fontFamily: theme.fontInter, fontSize: 10, color: theme.danger, lineHeight: 1.4 }}>
            {error}
          </div>
        )}
      </form>

      {history.length > 0 && (
        <div data-testid="auto-chat-history">
          <div style={historyHeaderStyle}>
            {/* A real <button>, not a div+role reimplementation — sibling
                (not parent) of the clear button below, so neither nests an
                interactive element inside another. */}
            <button
              type="button"
              style={historyToggleStyle}
              onClick={() => setHistoryOpen(o => !o)}
              aria-expanded={historyOpen}
              aria-controls="auto-chat-history-list"
              data-testid="auto-chat-history-toggle"
            >
              <LucideIcon name={historyOpen ? 'ChevronDown' : 'ChevronRight'} size={11} />
              Recent ({history.length})
            </button>
            <button
              type="button"
              onClick={() => clearAutoChatHistory()}
              aria-label="Clear intent history"
              data-testid="auto-chat-history-clear"
              style={{
                background: 'transparent', border: 'none', color: theme.textFaint,
                cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center',
              }}
            >
              <LucideIcon name="X" size={11} />
            </button>
          </div>

          {historyOpen && (
            <ul id="auto-chat-history-list" style={historyListStyle} role="list" aria-label="Past intents">
              {history.map((h) => {
                // Narrow through a local `const` — TS discriminated-union
                // narrowing doesn't reliably survive a `h.result.kind === …`
                // check re-evaluated inside a nested closure (the onClick
                // handler below); binding it once here does.
                const result = h.result;
                const isSuccess = result.kind === 'success';
                return (
                <li key={h.id}>
                  <button
                    type="button"
                    style={{
                      ...historyItemBase,
                      borderLeft: isSuccess ? `2px solid ${theme.accentBlue}` : `2px solid ${theme.danger}`,
                      cursor: isSuccess ? 'pointer' : 'default',
                    }}
                    onClick={isSuccess ? () => panToFrame(result.frameId) : undefined}
                    data-testid={`auto-chat-history-item-${h.id}`}
                    aria-label={isSuccess ? `Jump to flow built from: ${h.intent}` : `Failed intent: ${h.intent}`}
                  >
                    <span style={{ fontFamily: theme.fontMono, fontSize: 9, color: theme.textFaint }}>
                      {formatTime(h.timestamp)}
                    </span>
                    <span style={{
                      fontFamily: theme.fontGrotesk, fontSize: 11, color: theme.textSecondary, lineHeight: 1.4,
                      overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                    }}>
                      {h.intent}
                    </span>
                    <span style={{
                      display: 'flex', alignItems: 'center', gap: 4, fontFamily: theme.fontGrotesk, fontSize: 10,
                      color: isSuccess ? theme.textFaint : theme.danger,
                    }}>
                      <LucideIcon name={isSuccess ? 'Workflow' : 'XCircle'} size={10} />
                      {isSuccess ? `${result.stepCount} step${result.stepCount === 1 ? '' : 's'}` : result.message}
                    </span>
                  </button>
                </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
