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
 * This module only ever performs that one launch-time optimistic write
 * itself — the terminal completed/failed write-back (F4) lives in
 * harness-store.ts's `StepStatusChanged` handling, keyed off the
 * `backlogRunCorrelation` entries this module registers (see the F4 doc
 * comment below).
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
 *
 * F4 addition — card<->run correlation registration (plan §0.3): immediately
 * before dispatch, each mode registers `useDesktopStore.backlogRunCorrelation`
 * entries (stepId -> {backlogDir, filename}) so harness-store's
 * `StepStatusChanged` handling can write the terminal `{status, runState}`
 * back once the run actually reports completed/error (this module still only
 * ever performs the launch-time OPTIMISTIC write itself — the terminal
 * write-back lives in harness-store.ts). Per plan §0.3: "en flow existente"
 * registers only the frame's root step; "autoflow"/"flow por épica" register
 * EVERY materialized step (autoflow: all mapped to the one originating card;
 * epica: each mapped to its own originating card, via `idByTaskId`/`slugify`).
 */
import { useDesktopStore } from '@/renderer/store/desktop-store';
import { useHarnessStore } from '@/renderer/store/harness-store';
import { calculateSafeInsertionPoint } from '@/renderer/store/spatial-engine';
import { compileFlowFromCanvas } from '@/renderer/lib/harness-compiler';
import { openAgentSession } from '@/renderer/lib/agent-sessions';
import { buildLaunchPrompt } from '@/renderer/lib/launch-prompt';
import { epicToPipelineAssembly, slugify } from './epicPipeline';
import type { BacklogCard } from '@/types/market';
import type { PipelineAssembly } from '@/types/meta-agent';
import type { AgentVendorId, FrameGraphNode } from '@/types/desktop';

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
 * Read-only peek at a Frame's inferred root step id — F4's correlation
 * registration needs it BEFORE `runFrameWithContext` dispatches, but that
 * store action only exposes the compiled flow internally. Reuses the exact
 * same `compileFlowFromCanvas` seam `runFrameWithContext` itself calls
 * (harness-store.ts) — pure/read-only, safe to call twice; never throws
 * (returns null for the same conditions `runFrameWithContext` already turns
 * into a graceful error state: frame missing, compile failure).
 */
function findFrameRootStepId(frameId: string): string | null {
  const { mentalNodes, mentalEdges } = useDesktopStore.getState();
  const frame = mentalNodes.find((n): n is FrameGraphNode => n.type === 'frame' && n.id === frameId);
  if (!frame) return null;
  try {
    return compileFlowFromCanvas(mentalNodes, mentalEdges, { includeIds: new Set(frame.data.childIds) }).rootStepId;
  } catch {
    return null;
  }
}

/**
 * Mode 1 — "En flow existente": inject the card's title+description as
 * context onto an existing Frame's compiled flow and dispatch in place via
 * `runFrameWithContext`. No canvas node is created.
 */
export async function launchExistingFlow(card: BacklogCard, frameId: string, backlogDir: string | null): Promise<void> {
  const contextText = `${card.title}\n\n${card.description}`;

  // F4 — correlate the card with the frame's ROOT step (plan §0.3: "for 'en
  // flow existing': the frame's root step") before dispatch.
  if (backlogDir) {
    const rootStepId = findFrameRootStepId(frameId);
    if (rootStepId) {
      useDesktopStore.getState().registerBacklogRunStep(rootStepId, backlogDir, card.filename);
    }
  }

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

  // F4 — correlate EVERY materialized step back to this single originating
  // card (plan §0.3: "for autoflow/epic: every materialized step") so a
  // StepStatusChanged for any of them (not just the root) writes the card
  // back; last-write-wins per the F0 spec §3.5 concurrency policy.
  if (backlogDir) {
    for (const step of result.data.steps) {
      useDesktopStore.getState().registerBacklogRunStep(`${frameId}-${step.id}`, backlogDir, card.filename);
    }
  }

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

  // F4 — one registration per epic-member card -> its OWN step node id
  // (idByTaskId mapping surfaced by epicToPipelineAssembly's step ids via
  // `slugify`, composed with the frame id — same `${frameId}-${step.id}`
  // convention insertPipelineAssembly uses internally).
  if (backlogDir) {
    for (const step of assembly.steps) {
      const memberCard = epicCards.find((c) => slugify(c.taskId) === step.id);
      if (memberCard) {
        useDesktopStore.getState().registerBacklogRunStep(`${frameId}-${step.id}`, backlogDir, memberCard.filename);
      }
    }
  }

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

// ─── Mode 4 — "Open agent session" (Cockpit F3) ──────────────────

/** A branch name is read by people in `git branch`; 40 characters is where a slug stops helping. */
const MAX_BRANCH_SLUG_CHARS = 40;

/** The parent of `.backlog` — the project, for an in-tree backlog. */
function parentDirOf(dir: string): string {
  const trimmed = dir.replace(/[/\\]+$/, '');
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return cut > 0 ? trimmed.slice(0, cut) : trimmed;
}

/**
 * Where the card is FROM THE AGENT'S working directory.
 *
 * An in-tree backlog gives `.backlog/<file>.md`, which is true in the main tree
 * and equally true inside a worktree — same relative layout, which is exactly
 * why the write-back rule can be "the file the agent can see". An external
 * backlog is outside the project entirely, so the prompt has to name it
 * absolutely or the agent will look for a directory that is not there.
 */
export function cardPathForPrompt(projectRoot: string, backlogDir: string, filename: string): string {
  const root = projectRoot.replace(/[/\\]+$/, '');
  if (backlogDir.startsWith(`${root}/`) || backlogDir.startsWith(`${root}\\`)) {
    return `${backlogDir.slice(root.length + 1)}/${filename}`;
  }
  return `${backlogDir.replace(/[/\\]+$/, '')}/${filename}`;
}

export interface LaunchAgentSessionOptions {
  vendor: AgentVendorId;
  mode: 'attached' | 'worktree';
  /** The backlog lives in the IDE's config dir rather than in the tree. */
  isExternal: boolean;
  /**
   * Required when `isExternal` — an external backlog's directory says nothing
   * about which project it belongs to, and the picker is what knows. For an
   * in-tree backlog it defaults to `.backlog`'s parent.
   */
  projectRoot?: string;
}

/**
 * The Cockpit's launcher: the card opens a vendor CLI in a terminal, in the
 * project where `.harness/` already lives.
 *
 * It shares nothing with the three above by design. Those materialize a flow on
 * the canvas and run it through Fluxor's own harness engine; this one starts no
 * flow, creates no canvas node, and calls no model. The agent IS the vendor CLI,
 * and the only thing the Cockpit contributes is the first prompt
 * (`launch-prompt.ts`) and the `runState` write-back (`card-writeback.ts`).
 * `runAgent`, `harness-engine` and the three launchers are untouched.
 *
 * The optimistic `{status:'doing', runState:'running'}` the three above write at
 * click time is deliberately NOT done here: `status` belongs to the agent (that
 * is its first instruction) and `runState` is written when the PTY is actually
 * up, not when a menu was clicked — a session that dies on a missing binary
 * never ran anything.
 *
 * Returns the id of the session window it opened.
 */
export function launchAgentSession(
  card: BacklogCard,
  backlogDir: string,
  opts: LaunchAgentSessionOptions,
): string {
  const projectRoot = opts.projectRoot ?? parentDirOf(backlogDir);
  // An external backlog has no copy of the card inside a worktree, so there
  // would be nothing there for the agent to move. Forced, not refused — the
  // launcher already says why (LaunchMenu's disabled `worktree` row).
  const mode = opts.isExternal ? 'attached' : opts.mode;

  const idSlug = slugify(card.taskId);
  const titleSlug = slugify(card.title).slice(0, MAX_BRANCH_SLUG_CHARS).replace(/-+$/, '');

  const windowId = openAgentSession({
    vendor: opts.vendor,
    cwd: projectRoot,
    projectRoot,
    mode,
    // Reused on a retry rather than re-cut, so a second attempt does not leave
    // a second checkout on disk (AgentSessionApp's `handleRestart`).
    worktreeName: idSlug,
    branch: `${idSlug}/${titleSlug || 'session'}`,
    prompt: buildLaunchPrompt(card, {
      cardRelativePath: cardPathForPrompt(projectRoot, backlogDir, card.filename),
    }),
    title: `${card.taskId} · ${opts.vendor}`,
    cardId: card.taskId,
    // Always the MAIN tree's directory: it is what the board reads, and what
    // an attached session writes. The worktree's own copy is derived from
    // `worktreePath` at write time (card-writeback.ts).
    backlogDir,
    cardFilename: card.filename,
    isExternalBacklog: opts.isExternal,
  });

  const sessionId = useDesktopStore.getState().windows.find((w) => w.id === windowId)?.agentSession?.sessionId;
  if (sessionId) {
    useDesktopStore.getState().registerBacklogSession(sessionId, {
      backlogDir, filename: card.filename, cardId: card.taskId,
    });
  }
  return windowId;
}
