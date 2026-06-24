import React, { useCallback, useMemo, useState } from 'react';
import type { PipelineAssembly } from '@/types/meta-agent';
import { useDesktopStore } from '../../../store/desktop-store';
import { calculateSafeInsertionPoint } from '../../../store/spatial-engine';
import { LucideIcon } from '../LucideIcon';

const FRAME_HORIZONTAL_PADDING = 112;
const FRAME_VERTICAL_PADDING = 210;
const STEP_HORIZONTAL_GAP = 250;
const STEP_WIDTH = 300;
const MIN_FRAME_WIDTH = 860;
const MIN_FRAME_HEIGHT = 420;

function estimateFrameSize(assembly: PipelineAssembly): { width: number; height: number } {
  const stepCount = Math.max(1, assembly.steps.length);
  return {
    width: Math.max(MIN_FRAME_WIDTH, FRAME_HORIZONTAL_PADDING + STEP_WIDTH + (stepCount - 1) * STEP_HORIZONTAL_GAP + 96),
    height: Math.max(MIN_FRAME_HEIGHT, FRAME_VERTICAL_PADDING + (stepCount > 1 ? 34 : 0)),
  };
}

export function MetaChat() {
  const [intent, setIntent] = useState('');
  const [status, setStatus] = useState<'idle' | 'assembling' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const mentalNodes = useDesktopStore((state) => state.mentalNodes);
  const insertPipelineAssembly = useDesktopStore((state) => state.insertPipelineAssembly);
  const setCanvasPan = useDesktopStore((state) => state.setCanvasPan);
  const setCanvasZoom = useDesktopStore((state) => state.setCanvasZoom);

  const canSubmit = useMemo(() => intent.trim().length > 0 && status !== 'assembling', [intent, status]);

  const handleSubmit = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    const userIntent = intent.trim();
    if (!userIntent || status === 'assembling') return;

    setStatus('assembling');
    setError(null);

    try {
      const result = await window.helioxAPI?.assemblePipeline(userIntent);
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

      // Center the camera on the freshly assembled pipeline. The React Flow
      // viewport in MentalGraphCanvas is CONTROLLED (driven by canvasPan/canvasZoom +
      // onViewportChange), so the imperative useReactFlow().setCenter() is overridden
      // by the controlled prop and its promise never resolves — which previously hung
      // this handler before setStatus('idle'). Center by moving the store viewport.
      const targetZoom = 0.8;
      const container = document.querySelector('.mental-graph-canvas-container');
      const viewW = container?.clientWidth ?? window.innerWidth;
      const viewH = container?.clientHeight ?? window.innerHeight;
      const centerX = safePoint.x + frameSize.width / 2;
      const centerY = safePoint.y + frameSize.height / 2;
      setCanvasZoom(targetZoom);
      setCanvasPan({
        x: viewW / 2 - centerX * targetZoom,
        y: viewH / 2 - centerY * targetZoom,
      });

      setIntent('');
      setStatus('idle');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [intent, insertPipelineAssembly, setCanvasPan, setCanvasZoom, status]);

  return (
    <form
      className="meta-chat-shell"
      data-testid="meta-chat"
      aria-label="Text to pipeline compiler"
      onSubmit={handleSubmit}
    >
      <div className="meta-chat-orb" aria-hidden="true">
        <LucideIcon name="Sparkles" size={16} />
      </div>
      <label className="meta-chat-label" htmlFor="meta-chat-intent">
        Text-to-Pipeline
      </label>
      <div className="meta-chat-input-row">
        <textarea
          id="meta-chat-intent"
          className="meta-chat-input"
          value={intent}
          rows={2}
          placeholder={mentalNodes.length > 0 ? 'Describe the next pipeline...' : 'Describe a pipeline...'}
          disabled={status === 'assembling'}
          onChange={(event) => setIntent(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button
          type="submit"
          className="meta-chat-submit"
          disabled={!canSubmit}
          aria-label="Assemble pipeline"
        >
          <LucideIcon
            name={status === 'assembling' ? 'LoaderCircle' : 'ArrowUp'}
            size={16}
            className={status === 'assembling' ? 'meta-chat-spinner' : undefined}
          />
        </button>
      </div>
      {status === 'assembling' && (
        <div className="meta-chat-status">Assembling DAG</div>
      )}
      {error && (
        <div className="meta-chat-error" role="status">{error}</div>
      )}
    </form>
  );
}
