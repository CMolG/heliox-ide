/**
 * LoopEdge.tsx — Bounded loop-back edge for Step-to-Step pipeline connections
 *
 * Responsibility:
 * - Renders a directed loop-back edge (later step → earlier step) as a
 *   pronounced amber arc, visually distinct from the smooth-step forward
 *   FlowEdge — a loop must read as a first-class-but-quiet visual, not a
 *   second copy of the forward-edge treatment.
 * - Owns the loop's inline affordances: an iteration-count badge that swaps
 *   for a live `n/total` readout while the loop is running, a click-to-open
 *   stepper for editing `maxIterations` (clamped 1..50), and a right-click
 *   context menu (set iterations / change color / delete).
 *
 * Boundaries:
 * - Owns: loop edge visual treatment + its own inline editing affordances
 *   (badge, stepper, iteration state).
 * - Does NOT own: the loop/cycle decision (MentalGraphCanvas + `wouldCreateStepCycle`
 *   decide when a connection becomes a loop edge at all), execution internals
 *   (harness-store owns `stepStatuses`/`stepIterations`; this component only
 *   reads them), or the shared hover/hit-area/context-menu/color-editor
 *   chrome (see EdgeChrome, which this and MentalEdge both render for that
 *   scaffolding — the "Set iterations…" entry is this component's only
 *   addition to the shared menu).
 */
import React, { useCallback, useRef, useState } from 'react';
import { EdgeLabelRenderer, BaseEdge, getBezierPath } from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import { useDesktopStore } from '../../../store/desktop-store';
import { useHarnessStore } from '../../../store/harness-store';
import { LucideIcon } from '../LucideIcon';
import { LOOP_DEFAULT_MAX_ITERATIONS, LOOP_MAX_ITERATIONS_CAP, clampLoopIterations } from '@/types/harness';
import { theme } from '../../../logic/theme';
import { EdgeChrome } from '../edges/EdgeChrome';
import type { EdgeChromeHandle } from '../edges/EdgeChrome';

const LOOP_EDGE_DEFAULT_COLOR: string = theme.warning;

export interface LoopEdgeData {
  edgeColor?: string;
  maxIterations?: number;
  /** Domain edge id (desktop-store `MentalGraphEdge.id`) — store mutations key on
   * this, not the React Flow `id` prop, so this component stays decoupled from
   * React Flow's own id namespace even though the two are equal in practice. */
  loopEdgeId?: string;
  [key: string]: unknown;
}

const stepperButtonStyle: React.CSSProperties = {
  width: 20,
  height: 20,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px solid rgba(245, 158, 11, 0.3)',
  borderRadius: 5,
  background: 'rgba(245, 158, 11, 0.12)',
  color: '#FCD34D',
  cursor: 'pointer',
  padding: 0,
};

const stepperButtonDisabledStyle: React.CSSProperties = {
  ...stepperButtonStyle,
  opacity: 0.35,
  cursor: 'not-allowed',
};

export const LoopEdge = React.memo(function LoopEdge(props: EdgeProps) {
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

  const edgeData = data as unknown as LoopEdgeData | undefined;
  const edgeColor = edgeData?.edgeColor ?? LOOP_EDGE_DEFAULT_COLOR;
  const maxIterations = clampLoopIterations(edgeData?.maxIterations ?? LOOP_DEFAULT_MAX_ITERATIONS);
  const loopEdgeId = edgeData?.loopEdgeId ?? id;

  // Narrowed from raw `stepStatuses`/`stepIterations` MAP subscriptions (perf
  // fix, 2026-07-05 canvas/inspector plan Phase 3): this edge only ever cares
  // about its own two endpoints, so subscribing to the full maps re-rendered
  // every loop edge on the canvas whenever ANY step's status/iteration ticked
  // — one `useShallow` object keeps this bailing except when `source`/
  // `target`'s own values actually change.
  const { sourceStatus, targetStatus, sourceIteration, targetIteration } = useHarnessStore(
    useShallow((s) => ({
      sourceStatus: s.stepStatuses[source],
      targetStatus: s.stepStatuses[target],
      sourceIteration: s.stepIterations?.[source],
      targetIteration: s.stepIterations?.[target],
    })),
  );
  const removeMentalEdge = useDesktopStore((s) => s.removeMentalEdge);
  const updateMentalEdgeColor = useDesktopStore((s) => s.updateMentalEdgeColor);
  const updateMentalEdgeData = useDesktopStore((s) => s.updateMentalEdgeData);
  const invertMentalEdge = useDesktopStore((s) => s.invertMentalEdge);

  const flowing = sourceStatus === 'running' || targetStatus === 'running';
  const liveIteration = sourceIteration ?? targetIteration;
  const showLive = flowing && liveIteration != null;

  const [hovered, setHovered] = useState(false);
  const [stepperOpen, setStepperOpen] = useState(false);
  const chromeRef = useRef<EdgeChromeHandle>(null);

  // Pronounced curvature so a loop-back arcs clearly, distinct from the
  // smooth-step right-angle path forward FlowEdges use.
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature: 0.75,
  });

  const strokeColor = hovered || selected
    ? '#FCD34D'
    : flowing
      ? `color-mix(in srgb, ${edgeColor} 100%, white 20%)`
      : edgeColor;
  const strokeWidth = flowing ? 2.5 : hovered || selected ? 3 : 2;

  const setIterations = useCallback((next: number) => {
    updateMentalEdgeData(loopEdgeId, { maxIterations: clampLoopIterations(next) });
  }, [updateMentalEdgeData, loopEdgeId]);

  // The badge lives outside EdgeChrome (it's this component's own affordance),
  // but right-clicking it should open the exact same shared context menu that
  // right-clicking the hit-area opens — hence the ref instead of duplicating
  // menu state here.
  const openContextMenuFromBadge = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    chromeRef.current?.openContextMenu(e.clientX, e.clientY);
  }, []);

  return (
    <EdgeChrome
      ref={chromeRef}
      id={id}
      edgePath={edgePath}
      strokeWidth={strokeWidth}
      edgeColor={edgeColor}
      onColorChange={(color) => updateMentalEdgeColor(loopEdgeId, color)}
      labelX={labelX}
      colorModalTop={labelY + (stepperOpen ? 52 : 20)}
      centerColorModal
      onHoverChange={setHovered}
      hitAreaTestId={`loop-edge-hit-${id}`}
      menuTestId={`loop-edge-ctx-menu-${id}`}
      colorMenuItemTestId={`loop-edge-ctx-color-${id}`}
      deleteMenuItemTestId={`loop-edge-ctx-delete-${id}`}
      onDelete={() => removeMentalEdge(loopEdgeId)}
      extraMenuItems={[
        {
          label: 'Invert order',
          testId: `loop-edge-ctx-invert-${id}`,
          onSelect: () => invertMentalEdge(loopEdgeId),
        },
        {
          label: 'Set iterations…',
          testId: `loop-edge-ctx-iterations-${id}`,
          onSelect: () => setStepperOpen(true),
        },
      ]}
    >
      {/* Primary dashed loop-back edge — animated when either endpoint is running.
          The dash pattern is the loop's permanent identity marker: it stays
          dashed regardless of hover/selection, only color/width brighten. */}
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        className={flowing ? 'flow-edge-path is-flowing' : undefined}
        style={{
          stroke: strokeColor,
          strokeWidth,
          strokeLinecap: 'round',
          strokeDasharray: '6 4',
          fill: 'none',
        }}
      />

      <EdgeLabelRenderer>
        {/* Iteration badge — double-click toggles the stepper (a single click
            only stops propagation, so it doesn't fall through to a pane
            click/deselect). Shows the static cap (×N) by default; while the
            loop is actively running, swaps to a live n/total readout so
            progress is visible without opening the step's info panel. */}
        <button
          type="button"
          className="nodrag nopan"
          data-testid={`loop-edge-label-${id}`}
          aria-label={showLive
            ? `Loop iteration ${liveIteration!.iteration} of ${liveIteration!.total}`
            : `Loop repeats up to ${maxIterations} times — double-click to edit`}
          title={showLive
            ? `Iteration ${liveIteration!.iteration} of ${liveIteration!.total}`
            : `Repeats up to ${maxIterations}× — double-click to edit`}
          style={{
            position: 'absolute',
            left: labelX,
            top: labelY,
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'all',
            display: 'flex',
            alignItems: 'center',
            gap: 3,
            padding: '2px 7px',
            borderRadius: 999,
            fontSize: 10,
            fontFamily: 'var(--font-mono)',
            fontWeight: 700,
            lineHeight: 1.4,
            color: '#FCD34D',
            background: 'rgba(245, 158, 11, 0.16)',
            border: '1px solid rgba(245, 158, 11, 0.4)',
            cursor: 'pointer',
          }}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => { e.stopPropagation(); setStepperOpen((v) => !v); }}
          onContextMenu={openContextMenuFromBadge}
        >
          <LucideIcon name="RefreshCw" size={10} />
          {showLive ? `${liveIteration!.iteration}/${liveIteration!.total}` : `×${maxIterations}`}
        </button>

        {stepperOpen && (
          <div
            data-testid={`loop-edge-stepper-${id}`}
            style={{
              position: 'absolute',
              left: labelX,
              top: labelY + 20,
              transform: 'translate(-50%, 0)',
              pointerEvents: 'all',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 6px',
              borderRadius: 8,
              background: 'rgba(20, 20, 20, 0.96)',
              border: '1px solid rgba(255, 255, 255, 0.14)',
              boxShadow: '0 8px 20px rgba(0, 0, 0, 0.35)',
              zIndex: 71,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              data-testid={`loop-edge-stepper-dec-${id}`}
              aria-label="Decrease max iterations"
              disabled={maxIterations <= 1}
              style={maxIterations <= 1 ? stepperButtonDisabledStyle : stepperButtonStyle}
              onClick={() => setIterations(maxIterations - 1)}
            >
              <LucideIcon name="Minus" size={11} />
            </button>
            <span
              data-testid={`loop-edge-stepper-value-${id}`}
              style={{ minWidth: 18, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, color: '#f5f5f5' }}
            >
              {maxIterations}
            </span>
            <button
              type="button"
              data-testid={`loop-edge-stepper-inc-${id}`}
              aria-label="Increase max iterations"
              disabled={maxIterations >= LOOP_MAX_ITERATIONS_CAP}
              style={maxIterations >= LOOP_MAX_ITERATIONS_CAP ? stepperButtonDisabledStyle : stepperButtonStyle}
              onClick={() => setIterations(maxIterations + 1)}
            >
              <LucideIcon name="Plus" size={11} />
            </button>
          </div>
        )}
      </EdgeLabelRenderer>
    </EdgeChrome>
  );
});
