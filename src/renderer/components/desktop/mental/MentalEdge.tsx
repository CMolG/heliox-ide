/**
 * MentalEdge.tsx — Custom React Flow edge for the mental graph canvas
 *
 * Responsibility:
 * - Renders an edge with contrast stroke and halo underlay (no arrowheads).
 * - Supports hover/selection state for clarity without changing topology.
 *
 * Boundaries:
 * - Owns: edge visual treatment (stroke, halo)
 * - Does NOT own: edge creation/deletion logic, store persistence, or the
 *   shared hover/hit-area/context-menu/color-editor chrome (see EdgeChrome,
 *   which this and LoopEdge both render for that scaffolding).
 */
import React, { useState } from 'react';
import { BaseEdge, getSmoothStepPath } from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';
import { useDesktopStore } from '../../../store/desktop-store';
import { EdgeChrome } from '../edges/EdgeChrome';

export interface MentalEdgeData {
  edgeColor: string;
  edgeType: 'ramification' | 'link' | 'attachment';
  isAttachment?: boolean;
  [key: string]: unknown;
}

// No raw store-array/map subscription to narrow here — everything below
// already resolves to a primitive or an action reference. Wrapped in
// React.memo anyway for the same win as LoopEdge/FlowEdge (perf fix,
// 2026-07-05 canvas/inspector plan Phase 3): `rfEdges` in MentalGraphCanvas
// doesn't rebuild on selection changes, but it does on every edge/node/z
// patch, so this still bails re-renders for untouched edges on those ticks.
export const MentalEdge = React.memo(function MentalEdge(props: EdgeProps) {
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

  return (
    <EdgeChrome
      id={id}
      edgePath={edgePath}
      strokeWidth={strokeWidth}
      edgeColor={edgeColor}
      onColorChange={(color) => updateMentalEdgeColor(id, color)}
      labelX={labelX}
      colorModalTop={labelY + 12}
      onHoverChange={setHovered}
      menuTestId={`mental-edge-ctx-menu-${id}`}
      colorMenuItemTestId={`mental-edge-color-${id}`}
      deleteMenuItemTestId={`mental-edge-delete-${id}`}
      onDelete={() => removeMentalEdge(id)}
    >
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
    </EdgeChrome>
  );
});
