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
        zIndex: 0,
      }}
    />
  );
}
