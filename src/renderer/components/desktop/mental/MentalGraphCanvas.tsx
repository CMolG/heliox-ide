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
import { useDesktopStore } from '../../../store/desktop-store';
import { useHarnessStore } from '../../../store/harness-store';
import { getConnectedComponent } from '../../../logic/mental-graph';
import { MentalNode } from './MentalNode';
import { StepNode } from './StepNode';
import { MentalEdge } from './MentalEdge';
import { FlowEdge } from '../nodes/FlowEdge';
import { FrameNode } from '../nodes/FrameNode';
import type { CanvasGraphNode, FrameGraphNode, StepGraphNode } from '@/types/desktop';

// ─── Custom node/edge type registrations ─────────────────────────

const nodeTypes = { mental: MentalNode, step: StepNode, frame: FrameNode };
const edgeTypes = { mental: MentalEdge, flow: FlowEdge };

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
        return {
          id: e.id,
          zIndex: edgeZ,
          source: e.sourceId,
          target: e.targetId,
          sourceHandle: e.sourceHandle || 'right',
          targetHandle: e.targetHandle || 'left',
          type: 'flow',
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 16,
            height: 16,
            color: edgeColor,
          },
          data: {
            edgeColor,
            edgeType: e.type,
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
        updateMentalNode(change.id, { position: change.position });
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
    addMentalEdge(
      connection.source,
      connection.target,
      'link',
      connection.sourceHandle ?? undefined,
      connection.targetHandle ?? undefined,
    );
  }, [addMentalEdge]);

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
