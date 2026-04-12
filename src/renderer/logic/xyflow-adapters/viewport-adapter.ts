/**
 * xyflow-adapters/viewport-adapter.ts — Syncs canvas pan/zoom ↔ React Flow viewport
 *
 * Bridges the existing canvasPan + canvasZoom state from the desktop store
 * to React Flow's Viewport type and vice versa.
 */
import type { Viewport } from '@xyflow/react';
import type { CanvasPan } from '@/types/desktop';
import type { CanvasViewport } from './types';

/** Convert store pan/zoom to React Flow viewport. */
export function toReactFlowViewport(pan: CanvasPan, zoom: number): Viewport {
  return { x: pan.x, y: pan.y, zoom };
}

/** Convert React Flow viewport back to store pan/zoom. */
export function fromReactFlowViewport(viewport: Viewport): { pan: CanvasPan; zoom: number } {
  return {
    pan: { x: viewport.x, y: viewport.y },
    zoom: viewport.zoom,
  };
}

/** Canonical CanvasViewport from store state. */
export function toCanvasViewport(pan: CanvasPan, zoom: number): CanvasViewport {
  return { x: pan.x, y: pan.y, zoom };
}

/**
 * Compute the viewport transform needed to fit a bounding rect
 * within the container while keeping a minimum padding.
 */
export function fitBoundsToViewport(
  bounds: { x: number; y: number; width: number; height: number },
  containerWidth: number,
  containerHeight: number,
  padding = 50,
  minZoom = 0.25,
  maxZoom = 3,
): Viewport {
  const paddedWidth = containerWidth - padding * 2;
  const paddedHeight = containerHeight - padding * 2;

  if (paddedWidth <= 0 || paddedHeight <= 0 || bounds.width <= 0 || bounds.height <= 0) {
    return { x: 0, y: 0, zoom: 1 };
  }

  const zoom = Math.max(minZoom, Math.min(maxZoom,
    Math.min(paddedWidth / bounds.width, paddedHeight / bounds.height)
  ));

  const x = (containerWidth - bounds.width * zoom) / 2 - bounds.x * zoom;
  const y = (containerHeight - bounds.height * zoom) / 2 - bounds.y * zoom;

  return { x, y, zoom };
}
