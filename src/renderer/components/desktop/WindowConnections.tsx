/**
 * WindowConnections.tsx — Renderer Desktop Surface Component
 *
 * Responsibility:
 * - Renders the WindowConnections surface in the renderer layer.
 * - Encapsulates Desktop canvas/window composition within the renderer workspace.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/desktop/WindowConnections.tsx — SVG layer for arrow connections
import React, { useMemo } from 'react';
import { useDesktopStore } from '../../store/desktop-store';
import type { ConnectionPort, DesktopWindow } from '@/types/desktop';

function getPortPosition(win: DesktopWindow, port: ConnectionPort): { x: number; y: number } {
  const { x, y } = win.position;
  const { width, height } = win.size;

  switch (port) {
    case 'top':    return { x: x + width / 2, y };
    case 'bottom': return { x: x + width / 2, y: y + height };
    case 'left':   return { x, y: y + height / 2 };
    case 'right':  return { x: x + width, y: y + height / 2 };
  }
}

function bezierPath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const dx = Math.abs(to.x - from.x) * 0.5;
  const dy = Math.abs(to.y - from.y) * 0.5;
  const cx1 = from.x + dx;
  const cy1 = from.y;
  const cx2 = to.x - dx;
  const cy2 = to.y;
  return `M ${from.x} ${from.y} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${to.x} ${to.y}`;
}

export function WindowConnections() {
  const connections = useDesktopStore(s => s.connections);
  const windows = useDesktopStore(s => s.windows);
  const removeConnection = useDesktopStore(s => s.removeConnection);

  const paths = useMemo(() => {
    return connections.map(conn => {
      const sourceWin = windows.find(w => w.id === conn.sourceWindowId);
      const targetWin = windows.find(w => w.id === conn.targetWindowId);
      if (!sourceWin || !targetWin) return null;

      const from = getPortPosition(sourceWin, conn.sourcePort);
      const to = getPortPosition(targetWin, conn.targetPort);
      const d = bezierPath(from, to);

      // Arrow head at target
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      const arrowLen = 10;
      const a1x = to.x - arrowLen * Math.cos(angle - Math.PI / 6);
      const a1y = to.y - arrowLen * Math.sin(angle - Math.PI / 6);
      const a2x = to.x - arrowLen * Math.cos(angle + Math.PI / 6);
      const a2y = to.y - arrowLen * Math.sin(angle + Math.PI / 6);

      return { id: conn.id, d, arrowHead: `M ${a1x} ${a1y} L ${to.x} ${to.y} L ${a2x} ${a2y}` };
    }).filter(Boolean);
  }, [connections, windows]);

  if (paths.length === 0) return null;

  return (
    <svg className="connection-layer" aria-hidden="true">
      {paths.map(p => p && (
        <g key={p.id}>
          <path d={p.d} onClick={() => removeConnection(p.id)} />
          <path d={p.arrowHead} fill="rgba(var(--cli-accent-rgb), 0.5)" stroke="none" />
        </g>
      ))}
    </svg>
  );
}
