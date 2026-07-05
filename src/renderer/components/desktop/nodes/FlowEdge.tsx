/**
 * FlowEdge.tsx — Directional edge for Step-to-Step pipeline connections
 *
 * Responsibility:
 * - Renders a directed edge (with arrowhead) between two Step nodes.
 * - Animates with a flowing dash when either endpoint step is running.
 * - Visual style mirrors MentalEdge/LoopEdge (halo + stroke) but adds
 *   markerEnd support for the arrowhead.
 * - Owns the hover/hit-area/right-click-menu/color-editor chrome via the
 *   shared `EdgeChrome` (see LoopEdge.tsx for the sibling consumer) — its
 *   only addition to the shared menu is "Invert order".
 *
 * Boundaries:
 * - Owns: directional edge visual treatment (stroke, halo, arrowhead, animation)
 *   and the context-menu items it contributes (invert / color / delete).
 * - Does NOT own: edge creation logic, the shared chrome scaffolding itself
 *   (EdgeChrome), or the loop/link (re)classification decision (desktop-store's
 *   `invertMentalEdge`, which this component only calls).
 */
import React, { useState } from 'react';
import { BaseEdge, getSmoothStepPath } from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import { useDesktopStore } from '../../../store/desktop-store';
import { useHarnessStore } from '../../../store/harness-store';
import { EdgeChrome } from '../edges/EdgeChrome';

const FLOW_EDGE_DEFAULT_COLOR = '#4DA8FF';

export interface FlowEdgeData {
  edgeColor?: string;
  edgeType?: string;
  /** Domain edge id (desktop-store `MentalGraphEdge.id`) — store mutations key on
   * this, not the React Flow `id` prop, mirroring LoopEdge's `loopEdgeId` convention. */
  flowEdgeId?: string;
  [key: string]: unknown;
}

export const FlowEdge = React.memo(function FlowEdge(props: EdgeProps) {
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

  const edgeData = data as unknown as FlowEdgeData | undefined;
  const edgeColor = edgeData?.edgeColor ?? FLOW_EDGE_DEFAULT_COLOR;
  const flowEdgeId = edgeData?.flowEdgeId ?? id;

  // Narrowed from a raw `stepStatuses` MAP subscription (perf fix, 2026-07-05
  // canvas/inspector plan Phase 3, mirrors LoopEdge's identical fix): only
  // this edge's own two endpoints matter for the "flowing" animation, so a
  // full-map subscription re-rendered every forward edge whenever ANY step's
  // status ticked.
  const { sourceStatus, targetStatus } = useHarnessStore(
    useShallow((s) => ({
      sourceStatus: s.stepStatuses[source],
      targetStatus: s.stepStatuses[target],
    })),
  );
  const removeMentalEdge = useDesktopStore((s) => s.removeMentalEdge);
  const updateMentalEdgeColor = useDesktopStore((s) => s.updateMentalEdgeColor);
  const invertMentalEdge = useDesktopStore((s) => s.invertMentalEdge);

  const flowing = sourceStatus === 'running' || targetStatus === 'running';

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

  const strokeColor = hovered || selected
    ? '#7FC1FF'
    : flowing
      ? `color-mix(in srgb, ${edgeColor} 100%, white 20%)`
      : edgeColor;
  const strokeWidth = flowing ? 2.5 : hovered || selected ? 3 : 2;

  return (
    <EdgeChrome
      id={id}
      edgePath={edgePath}
      strokeWidth={strokeWidth}
      edgeColor={edgeColor}
      onColorChange={(color) => updateMentalEdgeColor(flowEdgeId, color)}
      labelX={labelX}
      colorModalTop={labelY}
      centerColorModal
      onHoverChange={setHovered}
      hitAreaTestId={`flow-edge-hit-${id}`}
      menuTestId={`flow-edge-ctx-menu-${id}`}
      colorMenuItemTestId={`flow-edge-ctx-color-${id}`}
      deleteMenuItemTestId={`flow-edge-ctx-delete-${id}`}
      onDelete={() => removeMentalEdge(flowEdgeId)}
      extraMenuItems={[
        {
          label: 'Invert order',
          testId: `flow-edge-ctx-invert-${id}`,
          onSelect: () => invertMentalEdge(flowEdgeId),
        },
      ]}
    >
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
    </EdgeChrome>
  );
});
