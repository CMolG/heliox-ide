/**
 * launchActions.ts — shared orchestration for the F3 agentic launchers
 * (backlog card -> running flow), reused identically by BacklogCardItem's
 * compact LaunchMenu trigger and BacklogCardModal's header LaunchMenu button
 * (F3 Tasks 3/4/6), so the ~three async orchestration steps per mode aren't
 * duplicated across the two consumer components.
 *
 * Zero new materializer (plan §0.2 / Gate 2): every path funnels through the
 * SAME canonical seams already in the codebase —
 *   - "en flow existente": useHarnessStore.runFrameWithContext (F3 Task 2),
 *     itself built on compileFlowFromCanvas + the private executeFlow
 *     closure (harness-store.ts). No canvas node is created.
 *   - "autoflow": window.fluxorAPI.assemblePipeline (Meta-Agent) ->
 *     useDesktopStore.insertPipelineAssembly (desktop-store.ts — the ONE
 *     insertPipelineAssembly implementation) -> useHarnessStore.runFromStep.
 * Neither path calls addStepNode, references runAgent, or builds a second
 * StepGraphNode/FrameGraphNode-constructing function.
 *
 * Optimistic write-back (F0 spec §3.4, launch-time row): only the step that
 * starts immediately (the run's root — here, always the launched card
 * itself) gets `{status:'doing', runState:'running'}` written the moment the
 * user clicks, via the same extended `update-backlog-card-status` IPC path.
 * Correlation-map registration (`backlogRunCorrelation`) and the
 * completed/failed write-back are F4 (out of this task's scope) — this
 * module only ever writes the launch-time optimistic row.
 *
 * The write is skipped if `executionStatus` reads back 'error' immediately
 * after dispatch (frame not found, a compile error, or the IPC bridge being
 * unavailable) — mirroring `executeFlow`'s own error self-correction
 * (harness-store.ts marks the root step 'running' before `startHarness`,
 * then overwrites to 'error' in its catch block). Without this check a
 * launch that never actually started would leave a card permanently
 * reading "running" with no StepStatusChanged ever due to arrive to correct
 * it. This is still "optimistic, before waiting for the run's result" per
 * the spec — it only guards against a failure that is already known
 * synchronously, not against the run's real outcome.
 */
import { useDesktopStore } from '@/renderer/store/desktop-store';
import { useHarnessStore } from '@/renderer/store/harness-store';
import { calculateSafeInsertionPoint } from '@/renderer/store/spatial-engine';
import { epicToPipelineAssembly, slugify } from './epicPipeline';
import type { BacklogCard } from '@/types/market';
import type { PipelineAssembly } from '@/types/meta-agent';

// Mirrors HudAutoChatPanel.tsx's own `estimateFrameSize` (MarketplaceApp.tsx
// carries an equivalent third copy under a different name) — there is no
// shared frame-sizing util today; F5's dead-code sweep (task doc, out of F3
// scope) is where any future consolidation belongs, not this task.
const FRAME_HORIZONTAL_PADDING = 112;
const FRAME_VERTICAL_PADDING = 210;
const STEP_HORIZONTAL_GAP = 250;
const STEP_WIDTH = 300;
const MIN_FRAME_WIDTH = 860;
const MIN_FRAME_HEIGHT = 420;

function estimateFrameSize(assembly: PipelineAssembly): { width: number; height: number } {
  const stepCount = Math.max(1, assembly.steps.length);
  return {
    width: Math.max(MIN_FRAME_WIDTH, FRAME_HORIZONTAL_PADDING + STEP_WIDTH + (stepCount - 1) * STEP_HORIZONTAL_GAP + 96),
    height: Math.max(MIN_FRAME_HEIGHT, FRAME_VERTICAL_PADDING + (stepCount > 1 ? 34 : 0)),
  };
}

/** Same "pan + zoom onto the freshly-materialized frame" affordance as HudAutoChatPanel.tsx/MarketplaceApp.tsx. */
function centerViewportOn(position: { x: number; y: number }, size: { width: number; height: number }): void {
  const { setCanvasZoom, setCanvasPan } = useDesktopStore.getState();
  const container = document.querySelector('.mental-graph-canvas-container');
  const viewW = container?.clientWidth ?? window.innerWidth;
  const viewH = container?.clientHeight ?? window.innerHeight;
  const targetZoom = 0.8;
  const centerX = position.x + size.width / 2;
  const centerY = position.y + size.height / 2;
  setCanvasZoom(targetZoom);
  setCanvasPan({ x: viewW / 2 - centerX * targetZoom, y: viewH / 2 - centerY * targetZoom });
}

/**
 * F0 spec §3.4 launch-time row: optimistic `{status:'doing',
 * runState:'running'}` for exactly the card starting immediately. Patches
 * `backlogCards` + an open `canvasModalCard` in place (mirrors the shape F4
 * Task 3's StepStatusChanged write-back will reuse for the terminal
 * transitions) and persists via the extended `update-backlog-card-status`
 * IPC — never touches the .md file's other fields.
 */
function optimisticallyMarkRunning(backlogDir: string | null, filename: string): void {
  const state = useDesktopStore.getState();
  useDesktopStore.setState({
    backlogCards: state.backlogCards.map((c) => (c.filename === filename ? { ...c, status: 'doing', runState: 'running' } : c)),
    canvasModalCard: state.canvasModalCard?.filename === filename
      ? { ...state.canvasModalCard, status: 'doing', runState: 'running' }
      : state.canvasModalCard,
  });
  if (backlogDir) {
    void window.fluxorAPI?.updateBacklogCardStatus(backlogDir, filename, 'doing', undefined, 'running');
  }
}

/**
 * Mode 1 — "En flow existente": inject the card's title+description as
 * context onto an existing Frame's compiled flow and dispatch in place via
 * `runFrameWithContext`. No canvas node is created.
 */
export async function launchExistingFlow(card: BacklogCard, frameId: string, backlogDir: string | null): Promise<void> {
  const contextText = `${card.title}\n\n${card.description}`;
  await useHarnessStore.getState().runFrameWithContext(frameId, contextText);
  if (useHarnessStore.getState().executionStatus !== 'error') {
    optimisticallyMarkRunning(backlogDir, card.filename);
  }
}

/**
 * Mode 2 — "Autoflow": the Meta-Agent assembles a PipelineAssembly from the
 * card's title+description, materialized via the canonical
 * `insertPipelineAssembly` seam (the same call shape HudAutoChatPanel.tsx
 * uses), then run from its root via `runFromStep`.
 */
export async function launchAutoflow(card: BacklogCard, backlogDir: string | null): Promise<void> {
  const result = await window.fluxorAPI?.assemblePipeline(`${card.title}\n\n${card.description}`);
  if (!result?.success || !result.data) {
    throw new Error(result?.error ?? 'Meta-Agent assembly failed.');
  }

  const { mentalNodes, insertPipelineAssembly } = useDesktopStore.getState();
  const frameSize = estimateFrameSize(result.data);
  const position = calculateSafeInsertionPoint(mentalNodes, frameSize.width, frameSize.height);
  const { frameId } = insertPipelineAssembly({
    assembly: result.data,
    position,
    frameWidth: frameSize.width,
    frameHeight: frameSize.height,
  });

  // Mirrors insertPipelineAssembly's own internal `${frameId}-${step.id}`
  // node-naming convention (desktop-store.ts) — not a second id scheme.
  const rootStepId = result.data.steps.find((s) => s.prevStepIds.length === 0)?.id;
  const rootNodeId = `${frameId}-${rootStepId}`;
  await useHarnessStore.getState().runFromStep(rootNodeId);

  // The frame materializes regardless of whether the run's dispatch itself
  // succeeded — always reveal it. Only the optimistic card write is gated.
  centerViewportOn(position, frameSize);
  if (useHarnessStore.getState().executionStatus !== 'error') {
    optimisticallyMarkRunning(backlogDir, card.filename);
  }
}

/**
 * Mode 3 — "Flow por épica": the deterministic `epicToPipelineAssembly`
 * mapper (no LLM call) replaces the Meta-Agent step autoflow uses, but from
 * there on reuses the exact same seam: the SAME `insertPipelineAssembly` and
 * the SAME `runFromStep`.
 *
 * Per the F0 spec §3.4 launch-time row, only the run's ROOT card — the
 * unique epic member whose assembled step has an empty `prevStepIds` (always
 * the highest-priority, lowest-`order` card; `epicToPipelineAssembly`
 * guarantees exactly one such step) — gets the immediate optimistic write.
 * The rest of the epic's cards simply wait for their own individual
 * `StepStatusChanged:'running'` event as the harness reaches their turn in
 * the DAG (F4, out of this task's scope) — writing all of them here would
 * double-report cards that haven't actually started yet.
 */
export async function launchEpicFlow(epicName: string, backlogDir: string | null): Promise<void> {
  const { backlogCards, mentalNodes, insertPipelineAssembly } = useDesktopStore.getState();
  const epicCards = backlogCards.filter((c) => c.epic === epicName);
  if (epicCards.length === 0) return;

  const assembly = epicToPipelineAssembly(epicCards, epicName);
  const frameSize = estimateFrameSize(assembly);
  const position = calculateSafeInsertionPoint(mentalNodes, frameSize.width, frameSize.height);
  const { frameId } = insertPipelineAssembly({
    assembly,
    position,
    frameWidth: frameSize.width,
    frameHeight: frameSize.height,
  });

  // Same root-resolution pattern as launchAutoflow, reused verbatim.
  const rootStep = assembly.steps.find((s) => s.prevStepIds.length === 0);
  const rootNodeId = `${frameId}-${rootStep?.id}`;
  await useHarnessStore.getState().runFromStep(rootNodeId);

  centerViewportOn(position, frameSize);
  if (useHarnessStore.getState().executionStatus !== 'error') {
    const rootCard = rootStep ? epicCards.find((c) => slugify(c.taskId) === rootStep.id) : undefined;
    if (rootCard) optimisticallyMarkRunning(backlogDir, rootCard.filename);
  }
}
