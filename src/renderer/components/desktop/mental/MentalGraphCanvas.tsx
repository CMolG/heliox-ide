/**
 * MentalGraphCanvas.tsx — React Flow host for the mental graph surface
 *
 * Responsibility:
 * - Hosts a React Flow instance with custom MentalNode and MentalEdge renderers.
 * - Translates between the Zustand mental graph slice and React Flow's node/edge model.
 * - Implements the Ramification Tool: drag-from-handle-to-empty creates child node + directed edge.
 *
 * Boundaries:
 * - Owns: React Flow configuration, node/edge mapping, connection lifecycle (onConnect, onConnectEnd)
 * - Does NOT own: node-level UI (delegated to MentalNode), edge styling (delegated to MentalEdge),
 *   or store persistence (delegated to desktop-store)
 */
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ReactFlow,
  Background,
  useReactFlow,
  ReactFlowProvider,
  ConnectionMode,
  Position,
  MarkerType,
  ViewportPortal,
} from '@xyflow/react';
import type {
  Node,
  Edge,
  OnNodesChange,
  OnConnect,
  OnConnectEnd,
  NodeChange,
  Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { resolveSnap, type GridSpec } from '@javadaba/daba-engine';
import { engineStore } from '../../../store/engine-bridge';
import { useDesktopStore } from '../../../store/desktop-store';
import { useHarnessStore } from '../../../store/harness-store';
import { getConnectedComponent } from '../../../logic/mental-graph';
import { wouldCreateStepCycle } from '../../../lib/harness-compiler';
import { orientConnection } from './orient-connection';
import { MentalNode } from './MentalNode';
import { StepNode } from './StepNode';
import { MentalEdge } from './MentalEdge';
import { FlowEdge } from '../nodes/FlowEdge';
import { LoopEdge } from '../nodes/LoopEdge';
import { FrameNode } from '../nodes/FrameNode';
import { PhaseNode } from '../nodes/PhaseNode';
import type { CanvasGraphNode, FrameGraphNode, MentalGraphEdge, PhaseGraphNode, StepGraphNode } from '@/types/desktop';
import { LOOP_DEFAULT_MAX_ITERATIONS } from '@/types/harness';

// ─── Custom node/edge type registrations ─────────────────────────

const nodeTypes = { mental: MentalNode, step: StepNode, frame: FrameNode, phase: PhaseNode };
const edgeTypes = { mental: MentalEdge, flow: FlowEdge, loop: LoopEdge };

// ─── Declarative handle positions ────────────────────────────────
// Providing `handles` on each node lets React Flow resolve edge
// endpoints and connection-drag immediately, without waiting for
// the ResizeObserver to populate handleBounds from the DOM.

const HANDLE_SIZE = 10;

function buildHandles(width: number, height: number, shape: string) {
  // Handle x/y = top-left of the handle element relative to node origin.
  // React Flow derives the connection point from handle position prop.
  const hw = HANDLE_SIZE;
  const hh = HANDLE_SIZE;
  const cx = width / 2 - hw / 2;   // center-x handle offset
  const cy = height / 2 - hh / 2;  // center-y handle offset
  const rightY = shape === 'triangle' ? height * 0.7 - hh / 2 : cy;
  const leftY  = shape === 'triangle' ? height * 0.7 - hh / 2 : cy;

  return [
    { id: 'top',    type: 'target' as const, position: Position.Top,    x: cx,            y: -hh / 2,         width: hw, height: hh },
    { id: 'right',  type: 'source' as const, position: Position.Right,  x: width - hw / 2, y: rightY,          width: hw, height: hh },
    { id: 'bottom', type: 'source' as const, position: Position.Bottom, x: cx,            y: height - hh / 2,  width: hw, height: hh },
    { id: 'left',   type: 'target' as const, position: Position.Left,   x: -hw / 2,       y: leftY,            width: hw, height: hh },
  ];
}

function isStepGraphNode(node: CanvasGraphNode): node is StepGraphNode {
  return node.type === 'step';
}

function isFrameGraphNode(node: CanvasGraphNode): node is FrameGraphNode {
  return node.type === 'frame';
}

function isPhaseGraphNode(node: CanvasGraphNode): node is PhaseGraphNode {
  return node.type === 'phase';
}

/**
 * Decides whether a new Step→Step connection should compile as an ordinary
 * forward 'link' edge or a bounded loop-back 'loop' edge. Delegates entirely
 * to `wouldCreateStepCycle`, which already returns false whenever either
 * endpoint isn't a Step node — so no separate step-node-ness check is needed
 * here.
 *
 * Exported as a pure function (no store/React Flow access) so the decision
 * is unit-testable without a real connection-drag simulation: this file's
 * tests mock `<ReactFlow>` down to a plain children-passthrough div, which
 * drops the `onConnect` prop entirely and makes it otherwise unreachable
 * from a render-based test.
 */
/**
 * Task 13 (adoption plan #20) — snap-to-grid quantization for a mental-node
 * drag COMMIT only. Unlike `DesktopWindow.tsx` (which defers ALL store
 * writes to pointerup, mutating the DOM directly mid-drag), React Flow fires
 * an `onNodesChange` position event on every intermediate frame too — this
 * function must stay a no-op passthrough for those (quantizing every frame
 * would fight the live drag / feel jittery), and only quantize the FINAL one.
 * xyflow signals that with `dragging: false` on the change (`dragging: true`
 * for every frame in between, `undefined` for a position change that didn't
 * come from a user drag at all — e.g. programmatic moves — which must also
 * pass through unchanged, so `dragging !== false` covers both).
 *
 * Fluxor has no alignment-guide system for mental nodes (only windows do,
 * via `calculateSnapGuides` in desktop-store.ts) — task13-decisiones.md's
 * "Alcance extra" note is explicit that none should be invented here, so
 * there is no guide precedence to honor, just grid-enabled-or-not. `width`/
 * `height` are irrelevant to `resolveSnap`'s grid branch (see
 * `DesktopWindow.tsx`'s `resolveWindowDropPosition` doc-comment) so a dummy
 * 0x0 rect is passed instead of looking up the node's own size.
 *
 * Pure/exported for golden-value testing without simulating a real React
 * Flow drag (same idiom as `resolveConnectionEdgeType` below, and
 * `DesktopWindow.tsx`'s `resolveWindowDropPosition`).
 */
export function resolveMentalNodeDragPosition(
  position: { x: number; y: number },
  dragging: boolean | undefined,
  snapGrid: { enabled: boolean; spec: GridSpec },
): { x: number; y: number } {
  if (dragging !== false || !snapGrid.enabled) return position;
  return resolveSnap(
    { x: position.x, y: position.y, width: 0, height: 0 },
    [],
    { grid: snapGrid, guides: { enabled: false, threshold: 0 } },
  ).pos;
}

export function resolveConnectionEdgeType(
  sourceId: string,
  targetId: string,
  nodes: CanvasGraphNode[],
  edges: MentalGraphEdge[],
): 'loop' | 'link' {
  return wouldCreateStepCycle(sourceId, targetId, nodes, edges) ? 'loop' : 'link';
}

// ─── Inner component (requires ReactFlowProvider ancestor) ───────
// Also owns the container div so it can access useReactFlow() for
// the pane double-click → new node handler.

interface MentalGraphCanvasInnerProps {
  viewportChildren?: React.ReactNode;
}

function MentalGraphCanvasInner({ viewportChildren }: MentalGraphCanvasInnerProps) {
  const mentalNodes = useDesktopStore((s) => s.mentalNodes);
  const mentalEdges = useDesktopStore((s) => s.mentalEdges);
  const mentalTool = useDesktopStore((s) => s.mentalTool);
  const mentalMode = useDesktopStore((s) => s.mentalMode);
  const canvasPan = useDesktopStore((s) => s.canvasPan);
  const canvasZoom = useDesktopStore((s) => s.canvasZoom);
  const updateMentalNode = useDesktopStore((s) => s.updateMentalNode);
  const addMentalEdge = useDesktopStore((s) => s.addMentalEdge);
  const createRamificationFromDrop = useDesktopStore((s) => s.createRamificationFromDrop);
  const setMentalEditingNodeId = useDesktopStore((s) => s.setMentalEditingNodeId);
  const selectedMentalNodeIds = useDesktopStore((s) => s.selectedMentalNodeIds);
  const setSelectedMentalNodeIds = useDesktopStore((s) => s.setSelectedMentalNodeIds);
  const setCanvasPan = useDesktopStore((s) => s.setCanvasPan);
  const setCanvasZoom = useDesktopStore((s) => s.setCanvasZoom);
  const mentalZ = useDesktopStore((s) => s.mentalZ);
  const bringMentalToFront = useDesktopStore((s) => s.bringMentalToFront);

  // ─── Fork-indicator state (READ ONLY from harness store) ────────
  // When a fork exists, `lastForkRunId` is set and `highlightedStepId`
  // identifies the step from which the run was forked (the checkpoint step
  // that was active when the user clicked "Fork from here").
  const lastForkRunId = useHarnessStore((s) => s.checkpointState.lastForkRunId);
  const forkOriginStepId = useHarnessStore((s) => s.checkpointState.highlightedStepId);

  const { screenToFlowPosition } = useReactFlow();
  const connectingSourceRef = useRef<string | null>(null);
  const showGraphBackdrop = mentalMode !== 'off' || mentalNodes.length > 0;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      const ids = useDesktopStore.getState().selectedMentalNodeIds;
      if (ids.length === 0) return;
      event.preventDefault();
      for (const id of ids) {
        useDesktopStore.getState().removeMentalNode(id);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // ─── Map store nodes → React Flow nodes ──────────────────────
  // width + height on the node object (not only in style) is required by
  // @xyflow/react v12 to skip the "measure first → render visible" cycle.
  // Without them React Flow renders every node as visibility:hidden until
  // a ResizeObserver measurement resolves — making them invisible in tests
  // and during the first render frame.
  //
  // `handles` provides declarative handle positions so React Flow can
  // resolve edge endpoints and initiate connection drags immediately,
  // without waiting for DOM measurement via ResizeObserver.

  const rfNodes: Node[] = useMemo(() =>
    mentalNodes.map((n) => {
      // Controlled selection: React Flow derives selection from the `nodes` prop,
      // so without an explicit `selected` field it deselects on every rebuild —
      // which made the selection-order z-elevation flicker off immediately.
      const isSelected = selectedMentalNodeIds.includes(n.id);

      if (isFrameGraphNode(n)) {
        // Frames render below their step children; explicit mentalZ or 0 baseline.
        return {
          id: n.id,
          type: 'frame',
          position: n.position,
          data: n.data,
          width: n.width,
          height: n.height,
          style: { width: n.width, height: n.height },
          dragHandle: '.pipeline-frame-node',
          zIndex: mentalZ[n.id] ?? 0,
          selected: isSelected,
          selectable: true,
        };
      }

      if (isPhaseGraphNode(n)) {
        // The middle nesting level: parented to its frame like a step is, and
        // z-stacked between the two (frame 0 < phase 1 < step 2) so it reads
        // as a surface the steps sit on rather than a peer of either.
        return {
          id: n.id,
          type: 'phase',
          parentId: n.parentId,
          extent: 'parent' as const,
          position: n.position,
          data: n.data,
          width: n.width,
          height: n.height,
          style: { width: n.width, height: n.height },
          dragHandle: '.pipeline-phase-node',
          zIndex: mentalZ[n.id] ?? 1,
          selected: isSelected,
          selectable: true,
        };
      }

      if (isStepGraphNode(n)) {
        // Inject fork indicator data when this step is the fork-origin.
        // `_isForkOrigin` and `_forkRunId` are consumed by StepNode to render
        // the "forked here" badge. The underscore prefix signals these are
        // canvas-injected ephemeral fields, not persistent StepNodeData fields.
        const isForkOrigin = lastForkRunId !== null && forkOriginStepId === n.id;
        return {
          id: n.id,
          type: 'step',
          ...(n.parentId ? { parentId: n.parentId, extent: 'parent' as const } : {}),
          position: n.position,
          data: isForkOrigin
            ? { ...n.data, _isForkOrigin: true, _forkRunId: lastForkRunId }
            : n.data,
          width: n.width,
          height: n.height,
          style: { width: n.width, height: n.height },
          dragHandle: '.step-node-drag-handle',
          handles: buildHandles(n.width, n.height, 'square'),
          zIndex: mentalZ[n.id] ?? 2,
          selected: isSelected,
        };
      }

      const shape = n.shape ?? 'square';
      return {
        id: n.id,
        type: 'mental',
        position: n.position,
        data: {
          text: n.text,
          color: n.color,
          width: n.width,
          height: n.height,
          shape,
        },
        width: n.width,
        height: n.height,
        style: { width: n.width, height: n.height },
        dragHandle: '.mental-card',
        handles: buildHandles(n.width, n.height, shape),
        zIndex: mentalZ[n.id] ?? 2,
        selected: isSelected,
      };
    }),
    [mentalNodes, lastForkRunId, forkOriginStepId, mentalZ, selectedMentalNodeIds]
  );

  // ─── Map store edges → React Flow edges ──────────────────────
  // Edges between two Step nodes use the directional FlowEdge type.
  // All other edges (mental node ↔ mental node) keep the plain MentalEdge.

  const rfEdges: Edge[] = useMemo(() => {
    const stepIds = new Set(mentalNodes.filter(isStepGraphNode).map((n) => n.id));

    return mentalEdges.map((e) => {
      const isFlowEdge = stepIds.has(e.sourceId) && stepIds.has(e.targetId);
      // Mixed edge: one end is a step node, the other is a mental node.
      // Rendered as a dashed MentalEdge to visually read as an "attachment" link.
      const isMixedEdge = (stepIds.has(e.sourceId) && !stepIds.has(e.targetId)) ||
                          (!stepIds.has(e.sourceId) && stepIds.has(e.targetId));
      const edgeColor = e.color ?? '#4DA8FF';
      // Edges ride with their connected component: take the higher z of their two
      // endpoints so the whole map (nodes + links) elevates as a single unit when
      // any part of it is brought to front. Without this the cards rise above a
      // window but the connecting lines stay behind it.
      const edgeZ = Math.max(mentalZ[e.sourceId] ?? 1, mentalZ[e.targetId] ?? 1);

      if (isFlowEdge) {
        const isLoopEdge = e.type === 'loop';
        return {
          id: e.id,
          zIndex: edgeZ,
          source: e.sourceId,
          target: e.targetId,
          sourceHandle: e.sourceHandle || 'right',
          targetHandle: e.targetHandle || 'left',
          type: isLoopEdge ? 'loop' : 'flow',
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 16,
            height: 16,
            color: edgeColor,
          },
          data: isLoopEdge
            ? {
                edgeColor,
                maxIterations: e.maxIterations ?? LOOP_DEFAULT_MAX_ITERATIONS,
                loopEdgeId: e.id,
              }
            : {
                edgeColor,
                edgeType: e.type,
                flowEdgeId: e.id,
              },
        };
      }

      return {
        id: e.id,
        zIndex: edgeZ,
        source: e.sourceId,
        target: e.targetId,
        sourceHandle: e.sourceHandle || 'bottom',
        targetHandle: e.targetHandle || 'top',
        type: 'mental',
        data: {
          edgeColor: e.color,
          edgeType: isMixedEdge ? 'attachment' : e.type,
          isAttachment: isMixedEdge,
        },
      };
    });
  }, [mentalEdges, mentalNodes, mentalZ]);

  // ─── Handle node position/dimension changes ─────────────────

  const onNodesChange: OnNodesChange = useCallback((changes: NodeChange[]) => {
    for (const change of changes) {
      if (change.type === 'position' && change.position) {
        const position = resolveMentalNodeDragPosition(change.position, change.dragging, engineStore.getState().snap.grid);
        updateMentalNode(change.id, { position });
      }
      if (change.type === 'dimensions' && change.dimensions) {
        updateMentalNode(change.id, {
          width: change.dimensions.width,
          height: change.dimensions.height,
        });
      }
    }
  }, [updateMentalNode]);

  // ─── Node-to-node connection (drop on existing node) ─────────

  const onConnect: OnConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    // xyflow's ConnectionMode.Loose assigns source/target by handle TYPE, not
    // drag order — re-orient so the edge direction always follows the node
    // the user actually dragged from (tracked by onConnectStart, below).
    const oriented = orientConnection(connectingSourceRef.current, {
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle,
      targetHandle: connection.targetHandle,
    });
    const edgeType = resolveConnectionEdgeType(oriented.source, oriented.target, mentalNodes, mentalEdges);
    addMentalEdge(
      oriented.source,
      oriented.target,
      edgeType,
      oriented.sourceHandle ?? undefined,
      oriented.targetHandle ?? undefined,
      edgeType === 'loop' ? LOOP_DEFAULT_MAX_ITERATIONS : undefined,
    );
  }, [addMentalEdge, mentalNodes, mentalEdges]);

  // ─── Track connection start for ramification ─────────────────

  const onConnectStart = useCallback((_: any, params: { nodeId: string | null }) => {
    connectingSourceRef.current = params.nodeId;
  }, []);

  // ─── Ramification: drag handle to empty space ────────────────

  const onConnectEnd: OnConnectEnd = useCallback((event: MouseEvent | TouchEvent, connectionState) => {
    const sourceId = connectingSourceRef.current;
    connectingSourceRef.current = null;
    if (!sourceId) return;

    // React Flow v12: connectionState.isValid is true when the drag ended on a
    // valid target handle — onConnect already fired, nothing to do here.
    if (connectionState.isValid) return;

    // Dropped on empty space → create a new child node (ramification)
    const clientX = (event as MouseEvent).clientX ?? (event as TouchEvent).changedTouches?.[0]?.clientX;
    const clientY = (event as MouseEvent).clientY ?? (event as TouchEvent).changedTouches?.[0]?.clientY;
    if (clientX == null || clientY == null) return;

    const flowPosition = screenToFlowPosition({ x: clientX, y: clientY });
    createRamificationFromDrop(sourceId, flowPosition);
  }, [screenToFlowPosition, createRamificationFromDrop]);

  // ─── Deselect editing on pane click ─────────────────────────

  const onPaneClick = useCallback((_event: React.MouseEvent) => {
    setMentalEditingNodeId(null);
  }, [setMentalEditingNodeId]);

  const onViewportChange = useCallback((viewport: { x: number; y: number; zoom: number }) => {
    const store = useDesktopStore.getState();
    if (Math.abs(store.canvasPan.x - viewport.x) > 0.5 || Math.abs(store.canvasPan.y - viewport.y) > 0.5) {
      setCanvasPan({ x: viewport.x, y: viewport.y });
    }
    if (Math.abs(store.canvasZoom - viewport.zoom) > 0.001) {
      setCanvasZoom(viewport.zoom);
    }
  }, [setCanvasPan, setCanvasZoom]);

  return (
    <>
    {/* Scoped motion preference: suppresses button transitions for reduced-motion users.
        Cannot touch index.css (sibling owns it), so a once-rendered style tag is used. */}
    <style>{`@media (prefers-reduced-motion: reduce) { [data-testid^="harness-"] { transition: none !important; } }`}</style>
    <div
      className="mental-graph-canvas-container"
      data-testid="mental-graph-canvas"
      data-mental-tool={mentalTool}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 2,
      }}
    >
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onPaneClick={onPaneClick}
        onEdgeClick={(_, edge) => bringMentalToFront(edge.source)}
        onSelectionChange={({ nodes }) => setSelectedMentalNodeIds(nodes.map(n => n.id))}
        selectionOnDrag
        multiSelectionKeyCode="Shift"
        connectionMode={ConnectionMode.Loose}
        connectOnClick={true}
        fitView={false}
        proOptions={{ hideAttribution: true }}
        className="mental-graph-canvas"
        minZoom={0.15}
        maxZoom={3}
        defaultEdgeOptions={{ type: 'mental' }}
        deleteKeyCode={null}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        panOnScroll={false}
        preventScrolling={false}
        nodesDraggable={true}
        nodesConnectable={true}
        elementsSelectable={true}
        viewport={{ x: canvasPan.x, y: canvasPan.y, zoom: canvasZoom }}
        onViewportChange={onViewportChange}
        elevateNodesOnSelect={false}
        elevateEdgesOnSelect={false}
      >
        {showGraphBackdrop && <Background color="rgba(255,255,255,0.03)" gap={24} />}
        {viewportChildren && <ViewportPortal>{viewportChildren}</ViewportPortal>}
      </ReactFlow>
    </div>
    </>
  );
}

// ─── Public export (wraps in provider) ───────────────────────────

interface MentalGraphCanvasProps {
  viewportChildren?: React.ReactNode;
}

export function MentalGraphCanvas({ viewportChildren }: MentalGraphCanvasProps = {}) {
  return (
    <ReactFlowProvider>
      <MentalGraphCanvasInner viewportChildren={viewportChildren} />
    </ReactFlowProvider>
  );
}
