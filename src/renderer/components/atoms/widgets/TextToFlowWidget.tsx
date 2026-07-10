/**
 * TextToFlowWidget.tsx — Renderer IDE Widget Component
 *
 * Responsibility:
 * - "Text to Flow": the user describes, in natural language, what they need, and
 *   the Meta-Agent (window.fluxorAPI.assemblePipeline) compiles it into a full
 *   step DAG that is inserted onto the canvas. Migrated from the floating MetaChat
 *   into the widget system — same AI assembler + FluxorSpinner, NOT line-splitting.
 *
 * Boundaries:
 * - Owns: intent input + assembly request UX.
 * - Does NOT own: pipeline generation (main/meta-agent) or canvas node lifecycle.
 */
import React, { useState, useCallback, useMemo, useRef } from 'react';
import type { PipelineAssembly } from '@/types/meta-agent';
import { useDesktopStore } from '../../../store/desktop-store';
import { calculateSafeInsertionPoint } from '../../../store/spatial-engine';
import { FluxorSpinner } from '../../brand/FluxorSpinner';
import { theme } from '../../../logic/theme';

const FRAME_HORIZONTAL_PADDING = 112;
const FRAME_VERTICAL_PADDING = 210;
const STEP_HORIZONTAL_GAP = 250;
const STEP_WIDTH = 300;
const MIN_FRAME_WIDTH = 860;
const MIN_FRAME_HEIGHT = 420;

// Example intents — one click fills the textarea so the first action is
// click + Enter instead of a blank page. Reuses the widget's own placeholder copy.
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

export function TextToFlowWidget() {
  const [intent, setIntent] = useState('');
  const [status, setStatus] = useState<'idle' | 'assembling' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const mentalNodes = useDesktopStore(s => s.mentalNodes);
  const insertPipelineAssembly = useDesktopStore(s => s.insertPipelineAssembly);
  const setCanvasPan = useDesktopStore(s => s.setCanvasPan);
  const setCanvasZoom = useDesktopStore(s => s.setCanvasZoom);

  const canSubmit = useMemo(() => intent.trim().length > 0 && status !== 'assembling', [intent, status]);

  const handleChipClick = useCallback((sample: string) => {
    setIntent(sample);
    textareaRef.current?.focus();
  }, []);

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
      insertPipelineAssembly({
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

      setIntent('');
      setStatus('idle');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [intent, insertPipelineAssembly, setCanvasPan, setCanvasZoom, status]);

  return (
    <form
      style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
      onSubmit={handleSubmit}
      aria-label="Text to Flow compiler"
      data-testid="text-to-flow"
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
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }} role="group" aria-label="Example intents">
        {EXAMPLE_INTENTS.map((ex) => (
          <button
            key={ex.label}
            type="button"
            onClick={() => handleChipClick(ex.intent)}
            disabled={status === 'assembling'}
            data-testid={`text-to-flow-chip-${ex.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
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
  );
}
