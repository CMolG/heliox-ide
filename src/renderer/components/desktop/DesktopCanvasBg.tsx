/**
 * DesktopCanvasBg.tsx — Renderer Desktop Surface Component
 *
 * Responsibility:
 * - Renders the DesktopCanvasBg surface in the renderer layer.
 * - Encapsulates Desktop canvas/window composition within the renderer workspace.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
import { useEffect, useRef } from 'react';
import { DottedBackground } from './DottedBackground';

export function DesktopCanvasBg() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgRef = useRef<DottedBackground | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const bg = new DottedBackground(canvas);
    bgRef.current = bg;
    bg.start(); // Fires the single intro wave — no subsequent triggers

    return () => {
      bg.destroy();
      bgRef.current = null;
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      data-testid="desktop-canvas-bg"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'block',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        // Task 12 (daba-engine adoption): was 0, painted BEHIND the old
        // pan-layer purely by DOM order (this used to be its preceding
        // sibling). SeamlessCanvas.tsx now renders this inside <DabaCanvas>'s
        // `overlay` slot, which always paints AFTER the pan-layer in the DOM
        // — and `.daba-pan-layer` carries no z-index of its own (auto), so a
        // 0 here would now tie-break by DOM order and paint IN FRONT of the
        // pan-layer's contents (window-connections/attachables) instead of
        // behind them. A negative value paints behind BOTH non-positioned
        // content and any z-index:auto/0 positioned content regardless of
        // DOM order (CSS 2.1 Appendix E, step 2 vs. step 6), restoring the
        // original stacking exactly.
        zIndex: -1,
      }}
    />
  );
}
