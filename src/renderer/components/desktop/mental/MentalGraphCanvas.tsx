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
import React, { useCallback, useMemo, useRef } from 'react';
import {
  ReactFlow,
  Background,
  useReactFlow,
  ReactFlowProvider,
  ConnectionMode,
  Position,
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
import { MentalNode } from './MentalNode';
import { MentalEdge } from './MentalEdge';

// ─── Custom node/edge type registrations ─────────────────────────

const nodeTypes = { mental: MentalNode };
const edgeTypes = { mental: MentalEdge };

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

// ─── Inner component (requires ReactFlowProvider ancestor) ───────
// Also owns the container div so it can access useReactFlow() for
// the pane double-click → new node handler.

function MentalGraphCanvasInner() {
  const mentalNodes = useDesktopStore((s) => s.mentalNodes);
  const mentalEdges = useDesktopStore((s) => s.mentalEdges);
  const mentalTool = useDesktopStore((s) => s.mentalTool);
  const canvasPan = useDesktopStore((s) => s.canvasPan);
  const canvasZoom = useDesktopStore((s) => s.canvasZoom);
  const updateMentalNode = useDesktopStore((s) => s.updateMentalNode);
  const addMentalEdge = useDesktopStore((s) => s.addMentalEdge);
  const createRamificationFromDrop = useDesktopStore((s) => s.createRamificationFromDrop);
  const setMentalEditingNodeId = useDesktopStore((s) => s.setMentalEditingNodeId);

  const { screenToFlowPosition } = useReactFlow();
  const connectingSourceRef = useRef<string | null>(null);

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
      };
    }),
    [mentalNodes]
  );

  // ─── Map store edges → React Flow edges ──────────────────────

  const rfEdges: Edge[] = useMemo(() =>
    mentalEdges.map((e) => ({
      id: e.id,
      source: e.sourceId,
      target: e.targetId,
      sourceHandle: e.sourceHandle || 'bottom',
      targetHandle: e.targetHandle || 'top',
      type: 'mental',
      data: {
        edgeColor: e.color,
        edgeType: e.type,
      },
    })),
    [mentalEdges]
  );

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

  return (
    <div
      className="mental-graph-canvas-container"
      data-testid="mental-graph-canvas"
      data-mental-tool={mentalTool}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 1,
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
        onViewportChange={() => {}}
      >
        <Background color="rgba(255,255,255,0.03)" gap={24} />
      </ReactFlow>
    </div>
  );
}

// ─── Public export (wraps in provider) ───────────────────────────

export function MentalGraphCanvas() {
  const mentalMode = useDesktopStore((s) => s.mentalMode);
  const mentalNodes = useDesktopStore((s) => s.mentalNodes);

  // Always render when there are existing mental nodes (so they stay visible).
  // Only hide the canvas when there are zero nodes AND mode is off.
  if (mentalMode === 'off' && mentalNodes.length === 0) return null;

  return (
    <ReactFlowProvider>
      <MentalGraphCanvasInner />
    </ReactFlowProvider>
  );
}
