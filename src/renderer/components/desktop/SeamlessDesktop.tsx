/**
 * SeamlessDesktop.tsx — Renderer Desktop Surface Component
 *
 * Responsibility:
 * - Renders the SeamlessDesktop surface in the renderer layer.
 * - Encapsulates Desktop canvas/window composition within the renderer workspace.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
export { SeamlessCanvas as SeamlessDesktop } from './SeamlessCanvas';
