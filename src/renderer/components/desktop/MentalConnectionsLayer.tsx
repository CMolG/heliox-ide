/**
 * MentalConnectionsLayer.tsx — Renderer Desktop Surface Component
 *
 * Responsibility:
 * - Renders mental-card connection lines and line-level actions.
 * - Keeps line interactions isolated from window-connection behavior.
 */
import React, { useMemo, useState } from 'react';
import { useDesktopStore } from '../../store/desktop-store';

interface RenderedConnection {
  id: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  midpointX: number;
  midpointY: number;
  color: string;
}

export function MentalConnectionsLayer() {
  const attachables = useDesktopStore((s) => s.attachables);
  const mentalConnections = useDesktopStore((s) => s.mentalConnections);
  const removeMentalConnection = useDesktopStore((s) => s.removeMentalConnection);
  const updateMentalConnectionColor = useDesktopStore((s) => s.updateMentalConnectionColor);
  const canvasPan = useDesktopStore((s) => s.canvasPan);
  const canvasZoom = useDesktopStore((s) => s.canvasZoom);

  const [lineMenu, setLineMenu] = useState<{ connectionId: string; x: number; y: number } | null>(null);
  const [lineColorEditor, setLineColorEditor] = useState<{ connectionId: string; x: number; y: number } | null>(null);

  const renderedConnections = useMemo<RenderedConnection[]>(() => {
    return mentalConnections
      .map((conn) => {
        const from = attachables.find((a) => a.id === conn.fromAttachableId && a.type === 'mental');
        const to = attachables.find((a) => a.id === conn.toAttachableId && a.type === 'mental');
        if (!from || !to) return null;
        const fromWidth = from.mental?.width ?? 220;
        const fromHeight = from.mental?.height ?? 120;
        const toWidth = to.mental?.width ?? 220;
        const toHeight = to.mental?.height ?? 120;
        const fromX = from.position.x + fromWidth / 2;
        const fromY = from.position.y + fromHeight / 2;
        const toX = to.position.x + toWidth / 2;
        const toY = to.position.y + toHeight / 2;
        return {
          id: conn.id,
          fromX,
          fromY,
          toX,
          toY,
          midpointX: (fromX + toX) / 2,
          midpointY: (fromY + toY) / 2,
          color: conn.color,
        };
      })
      .filter((line): line is RenderedConnection => Boolean(line));
  }, [mentalConnections, attachables]);

  const toCanvasCoords = (clientX: number, clientY: number) => {
    const rect = document.querySelector('.desktop-canvas')?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - canvasPan.x) / canvasZoom,
      y: (clientY - rect.top - canvasPan.y) / canvasZoom,
    };
  };

  if (renderedConnections.length === 0) return null;

  return (
    <>
      {(lineMenu || lineColorEditor) && (
        <div
          className="mental-overlay-dismiss"
          onClick={() => {
            setLineMenu(null);
            setLineColorEditor(null);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setLineMenu(null);
            setLineColorEditor(null);
          }}
        />
      )}
      <svg className="mental-connection-layer" aria-hidden="true">
        {renderedConnections.map((line) => (
          <g key={line.id}>
            <line
              x1={line.fromX}
              y1={line.fromY}
              x2={line.toX}
              y2={line.toY}
              stroke={line.color}
              strokeWidth={2}
              strokeLinecap="round"
            />
            <line
              className="mental-connection-hit"
              x1={line.fromX}
              y1={line.fromY}
              x2={line.toX}
              y2={line.toY}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const pos = toCanvasCoords(e.clientX, e.clientY);
                setLineMenu({ connectionId: line.id, x: pos.x, y: pos.y });
              }}
            />
          </g>
        ))}
      </svg>

      {renderedConnections.map((line) => (
        <button
          key={`${line.id}-chip`}
          className="mental-line-color-chip"
          style={{ left: line.midpointX - 8, top: line.midpointY - 8, background: line.color }}
          aria-label="Edit line color"
          onClick={(e) => {
            e.stopPropagation();
            setLineColorEditor({ connectionId: line.id, x: line.midpointX, y: line.midpointY });
          }}
          onPointerDown={(e) => e.stopPropagation()}
        />
      ))}

      {lineMenu && (
        <div
          className="mental-line-menu"
          style={{ left: lineMenu.x, top: lineMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            className="mental-line-menu-item"
            onClick={() => {
              removeMentalConnection(lineMenu.connectionId);
              setLineMenu(null);
            }}
          >
            Delete line
          </button>
          <button
            className="mental-line-menu-item"
            onClick={() => {
              setLineColorEditor({ connectionId: lineMenu.connectionId, x: lineMenu.x, y: lineMenu.y });
              setLineMenu(null);
            }}
          >
            Recolor line
          </button>
        </div>
      )}

      {lineColorEditor && (
        <div
          className="mental-line-color-modal"
          style={{ left: lineColorEditor.x, top: lineColorEditor.y }}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <input
            className="mental-line-color-input"
            type="color"
            value={
              renderedConnections.find((line) => line.id === lineColorEditor.connectionId)?.color ?? '#6D28D9'
            }
            onChange={(e) => updateMentalConnectionColor(lineColorEditor.connectionId, e.target.value)}
          />
          <button
            className="mental-line-menu-item"
            onClick={() => setLineColorEditor(null)}
          >
            Done
          </button>
        </div>
      )}
      {(lineMenu || lineColorEditor) && (
        <div
          className="mental-overlay-dismiss"
          onClick={() => {
            setLineMenu(null);
            setLineColorEditor(null);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setLineMenu(null);
            setLineColorEditor(null);
          }}
        />
      )}
    </>
  );
}
