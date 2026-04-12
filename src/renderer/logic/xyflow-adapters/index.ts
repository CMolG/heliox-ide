/**
 * xyflow-adapters/index.ts — Public barrel export for the @xyflow/react adapter layer
 *
 * Re-exports all adapters for clean imports:
 *   import { windowsToNodes, connectionsToEdges } from '@/renderer/logic/xyflow-adapters';
 */

// Types
export type {
  CanvasNodeType,
  CanvasEdgeType,
  CanvasNode,
  CanvasEdge,
  CanvasNodeData,
  CanvasEdgeData,
  WindowNodeData,
  AttachableNodeData,
  MentalNodeData,
  GridNodeData,
  ConnectionEdgeData,
  AttachmentEdgeData,
  MentalEdgeData,
  CanvasViewport,
} from './types';

// Node adapters (store → React Flow)
export {
  windowToNode,
  windowsToNodes,
  attachableToNode,
  attachablesToNodes,
  mentalGraphNodeToNode,
  mentalNodesToNodes,
  gridToNode,
  gridsToNodes,
} from './node-adapter';

// Edge adapters (store → React Flow)
export {
  connectionToEdge,
  connectionsToEdges,
  deriveAttachmentEdges,
  mentalEdgeToFlowEdge,
  mentalEdgesToFlowEdges,
} from './edge-adapter';

// Viewport adapters
export {
  toReactFlowViewport,
  fromReactFlowViewport,
  toCanvasViewport,
  fitBoundsToViewport,
} from './viewport-adapter';

// Event adapters (React Flow → store)
export {
  extractPositionUpdates,
  extractDimensionUpdates,
  extractRemovals,
  extractEdgeRemovals,
  connectionToIds,
} from './event-adapter';
