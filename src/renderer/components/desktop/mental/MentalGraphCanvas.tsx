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
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  useReactFlow,
  ReactFlowProvider,
  ConnectionMode,
  Position,
  MarkerType,
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
import { MentalNode } from './MentalNode';
import { StepNode } from './StepNode';
import { MentalEdge } from './MentalEdge';
import { FlowEdge } from '../nodes/FlowEdge';
import { MentalAttachActionBubble } from './MentalAttachActionBubble';
import { FrameNode } from '../nodes/FrameNode';
import { MetaChat } from '../harness/MetaChat';
import { ScorecardPanel } from '../harness/ScorecardPanel';
import { ArenaButton } from '../harness/ArenaButton';
import { TimeTravelPanel } from './TimeTravelPanel';
import { LucideIcon } from '../LucideIcon';
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

function MentalGraphCanvasInner() {
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
  const setSelectedMentalNodeIds = useDesktopStore((s) => s.setSelectedMentalNodeIds);
  const setCanvasPan = useDesktopStore((s) => s.setCanvasPan);
  const setCanvasZoom = useDesktopStore((s) => s.setCanvasZoom);

  // ─── Fork-indicator state (READ ONLY from harness store) ────────
  // When a fork exists, `lastForkRunId` is set and `highlightedStepId`
  // identifies the step from which the run was forked (the checkpoint step
  // that was active when the user clicked "Fork from here").
  const lastForkRunId = useHarnessStore((s) => s.checkpointState.lastForkRunId);
  const forkOriginStepId = useHarnessStore((s) => s.checkpointState.highlightedStepId);

  // ─── Harness panel visibility toggles ───────────────────────────
  // Three panels are mounted on demand; visibility driven by local state.
  const [showScorecard, setShowScorecard] = useState(false);
  const [showArena, setShowArena] = useState(false);
  const [showTimeTravel, setShowTimeTravel] = useState(false);

  // activeFlow + lastForkRunId are sourced from harness-store to wire TimeTravelPanel.
  // `runId` is derived: use the forkRunId if a fork was created, else the activeFlow id.
  const activeFlow = useHarnessStore((s) => s.activeFlow);
  const timeTravelRunId: string | null = lastForkRunId ?? activeFlow?.id ?? null;

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
      if (isFrameGraphNode(n)) {
        return {
          id: n.id,
          type: 'frame',
          position: n.position,
          data: n.data,
          width: n.width,
          height: n.height,
          style: { width: n.width, height: n.height },
          dragHandle: '.pipeline-frame-node',
          zIndex: 0,
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
          zIndex: 2,
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
      };
    }),
    [mentalNodes, lastForkRunId, forkOriginStepId]
  );

  // ─── Map store edges → React Flow edges ──────────────────────
  // Edges between two Step nodes use the directional FlowEdge type.
  // All other edges (mental node ↔ mental node) keep the plain MentalEdge.

  const rfEdges: Edge[] = useMemo(() => {
    const stepIds = new Set(mentalNodes.filter(isStepGraphNode).map((n) => n.id));

    return mentalEdges.map((e) => {
      const isFlowEdge = stepIds.has(e.sourceId) && stepIds.has(e.targetId);
      const edgeColor = e.color ?? '#4DA8FF';

      if (isFlowEdge) {
        return {
          id: e.id,
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
        source: e.sourceId,
        target: e.targetId,
        sourceHandle: e.sourceHandle || 'bottom',
        targetHandle: e.targetHandle || 'top',
        type: 'mental',
        data: {
          edgeColor: e.color,
          edgeType: e.type,
        },
      };
    });
  }, [mentalEdges, mentalNodes]);

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
      >
        {showGraphBackdrop && <Background color="rgba(255,255,255,0.03)" gap={24} />}
      </ReactFlow>
      <MentalAttachActionBubble />
      <MetaChat />

      {/* ── Harness toolbar: toggles for Scorecard / Arena / TimeTravel ── */}
      <div
        style={{
          position: 'absolute',
          bottom: 76,
          left: 16,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 8,
          pointerEvents: 'auto',
          zIndex: 190,
        }}
        aria-label="Harness panels toolbar"
      >
        {/* Panel containers — rendered above the toolbar row */}
        {showScorecard && (
          <div
            data-testid="scorecard-panel"
            style={{
              background: 'var(--hx-surface, #1a1a2e)',
              border: '1px solid var(--hx-border, rgba(255,255,255,0.08))',
              borderRadius: 10,
              overflow: 'auto',
              maxHeight: 560,
              width: 360,
              boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
            }}
          >
            <ScorecardPanel />
          </div>
        )}

        {showArena && (
          <div
            data-testid="arena-panel"
            style={{
              background: 'var(--hx-surface, #1a1a2e)',
              border: '1px solid var(--hx-border, rgba(255,255,255,0.08))',
              borderRadius: 10,
              overflow: 'auto',
              maxHeight: 560,
              width: 400,
              boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
            }}
          >
            <ArenaButton />
          </div>
        )}

        {showTimeTravel && (
          <TimeTravelPanel
            runId={timeTravelRunId}
            flow={activeFlow}
            onClose={() => setShowTimeTravel(false)}
          />
        )}

        {/* Toggle button row */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            gap: 6,
            background: 'var(--hx-surface, #1a1a2e)',
            border: '1px solid var(--hx-border, rgba(255,255,255,0.10))',
            borderRadius: 8,
            padding: '4px 6px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
          }}
          role="toolbar"
          aria-label="Harness panel toggles"
        >
          <button
            type="button"
            data-testid="harness-scorecard-toggle"
            aria-label="Toggle Scorecard panel"
            aria-pressed={showScorecard}
            onClick={() => setShowScorecard((v) => !v)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 30,
              height: 30,
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              background: showScorecard
                ? 'var(--hx-accent, rgba(77,168,255,0.18))'
                : 'transparent',
              color: showScorecard
                ? 'var(--hx-blue, #4DA8FF)'
                : 'var(--hx-muted, #6b7280)',
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            <LucideIcon name="Gauge" size={15} />
          </button>

          <button
            type="button"
            data-testid="harness-arena-toggle"
            aria-label="Toggle Arena panel"
            aria-pressed={showArena}
            onClick={() => setShowArena((v) => !v)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 30,
              height: 30,
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              background: showArena
                ? 'var(--hx-accent, rgba(77,168,255,0.18))'
                : 'transparent',
              color: showArena
                ? 'var(--hx-blue, #4DA8FF)'
                : 'var(--hx-muted, #6b7280)',
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            <LucideIcon name="GitCompareArrows" size={15} />
          </button>

          <button
            type="button"
            data-testid="harness-timetravel-toggle"
            aria-label="Toggle Time Travel panel"
            aria-pressed={showTimeTravel}
            onClick={() => setShowTimeTravel((v) => !v)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 30,
              height: 30,
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              background: showTimeTravel
                ? 'var(--hx-accent, rgba(77,168,255,0.18))'
                : 'transparent',
              color: showTimeTravel
                ? 'var(--hx-blue, #4DA8FF)'
                : 'var(--hx-muted, #6b7280)',
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            <LucideIcon name="History" size={15} />
          </button>
        </div>
      </div>
    </div>
    </>
  );
}

// ─── Public export (wraps in provider) ───────────────────────────

export function MentalGraphCanvas() {
  return (
    <ReactFlowProvider>
      <MentalGraphCanvasInner />
    </ReactFlowProvider>
  );
}
