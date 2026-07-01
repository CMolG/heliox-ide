/**
 * MentalEdge.tsx — Custom React Flow edge for the mental graph canvas
 *
 * Responsibility:
 * - Renders an edge with contrast stroke and halo underlay (no arrowheads).
 * - Supports hover/selection state for clarity without changing topology.
 *
 * Boundaries:
 * - Owns: edge visual treatment (stroke, halo)
 * - Does NOT own: edge creation/deletion logic, store persistence
 */
import React, { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { BaseEdge, getSmoothStepPath, EdgeLabelRenderer } from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';
import { useDesktopStore } from '../../../store/desktop-store';

export interface MentalEdgeData {
  edgeColor: string;
  edgeType: 'ramification' | 'link' | 'attachment';
  isAttachment?: boolean;
  [key: string]: unknown;
}

export function MentalEdge(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    selected,
    data,
  } = props;

  const edgeData = data as unknown as MentalEdgeData | undefined;
  const edgeColor = edgeData?.edgeColor ?? '#4DA8FF';

  const removeMentalEdge = useDesktopStore((s) => s.removeMentalEdge);
  const updateMentalEdgeColor = useDesktopStore((s) => s.updateMentalEdgeColor);

  const [hovered, setHovered] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [colorEditor, setColorEditor] = useState(false);

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 16,
  });

  const strokeColor = hovered || selected ? '#7FC1FF' : edgeColor;
  const strokeWidth = hovered || selected ? 3 : 2;
  const haloColor = 'rgba(0, 0, 0, 0.25)';

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  return (
    <>
      {/* Halo underlay for readability across card fills */}
      <BaseEdge
        id={`${id}-halo`}
        path={edgePath}
        style={{
          stroke: haloColor,
          strokeWidth: strokeWidth + 4,
          strokeLinecap: 'round',
          fill: 'none',
        }}
      />

      {/* Primary edge stroke — plain line, no arrowhead.
          Attachment edges (mental↔step) render dashed to visually distinguish
          them from mental→mental hierarchy edges. */}
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: strokeColor,
          strokeWidth,
          strokeLinecap: 'round',
          strokeDasharray: edgeData?.isAttachment ? '6 4' : undefined,
          fill: 'none',
        }}
      />

      {/* Wider invisible hit-area for hover/click detection */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        style={{ cursor: 'pointer' }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onContextMenu={handleContextMenu}
      />

      {/* Color editor via EdgeLabelRenderer (portal within React Flow) */}
      <EdgeLabelRenderer>
        {colorEditor && (
          <div
            className="mental-line-color-modal"
            style={{
              position: 'absolute',
              left: labelX,
              top: labelY + 12,
              pointerEvents: 'all',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              className="mental-line-color-input"
              type="color"
              value={edgeColor}
              onChange={(e) => updateMentalEdgeColor(id, e.target.value)}
            />
            <button
              className="mental-line-menu-item"
              onClick={() => setColorEditor(false)}
            >
              Done
            </button>
          </div>
        )}
      </EdgeLabelRenderer>

      {/* Context menu — portaled to body to escape React Flow transform */}
      {contextMenu && createPortal(
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 10002, pointerEvents: 'all' }}
          onClick={() => setContextMenu(null)}
          onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }}
        >
          <div
            className="mental-line-menu"
            data-testid={`mental-edge-ctx-menu-${id}`}
            style={{
              position: 'absolute',
              left: contextMenu.x,
              top: contextMenu.y,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="mental-line-menu-item"
              data-testid={`mental-edge-color-${id}`}
              onClick={() => {
                setColorEditor(true);
                setContextMenu(null);
              }}
            >
              Change color
            </button>
            <button
              className="mental-line-menu-item"
              data-testid={`mental-edge-delete-${id}`}
              onClick={() => {
                removeMentalEdge(id);
                setContextMenu(null);
              }}
            >
              Delete edge
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
