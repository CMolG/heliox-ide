/**
 * FlowEdge.tsx — Directional edge for Step-to-Step pipeline connections
 *
 * Responsibility:
 * - Renders a directed edge (with arrowhead) between two Step nodes.
 * - Animates with a flowing dash when either endpoint step is running.
 * - Visual style mirrors MentalEdge (halo + stroke) but adds markerEnd support.
 *
 * Boundaries:
 * - Owns: directional edge visual treatment (stroke, halo, arrowhead, animation)
 * - Does NOT own: edge creation/deletion logic, color pickers, context menus
 */
import React, { useState } from 'react';
import { BaseEdge, getSmoothStepPath } from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';
import { useHarnessStore } from '../../../store/harness-store';

const FLOW_EDGE_DEFAULT_COLOR = '#4DA8FF';

export function FlowEdge(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    selected,
    markerEnd,
    source,
    target,
    data,
  } = props;

  const edgeColor = (data as Record<string, unknown> | undefined)?.edgeColor as string | undefined
    ?? FLOW_EDGE_DEFAULT_COLOR;

  const stepStatuses = useHarnessStore((s) => s.stepStatuses);
  const flowing = stepStatuses[source] === 'running' || stepStatuses[target] === 'running';

  const [hovered, setHovered] = useState(false);

  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 16,
  });

  const strokeColor = hovered || selected
    ? '#7FC1FF'
    : flowing
      ? `color-mix(in srgb, ${edgeColor} 100%, white 20%)`
      : edgeColor;
  const strokeWidth = flowing ? 2.5 : hovered || selected ? 3 : 2;
  const haloColor = 'rgba(0, 0, 0, 0.25)';

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

      {/* Primary directed edge — animated when flowing */}
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        className={flowing ? 'flow-edge-path is-flowing' : undefined}
        style={{
          stroke: strokeColor,
          strokeWidth,
          strokeLinecap: 'round',
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
      />
    </>
  );
}
