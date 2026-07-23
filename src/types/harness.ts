/**
 * harness.ts — Agentic execution AST types
 *
 * These interfaces describe the visual-canvas-free execution contract consumed
 * by the future harness runtime and SDK integrations.
 */

export type AgenticStepType = 'llm_call' | 'tool_call' | 'router' | string;

export type AgenticExecutionStatus = 'idle' | 'compiling' | 'running' | 'paused' | 'completed' | 'error';

export interface AgenticTool {
  id: string;
  name: string;
  config?: Record<string, unknown>;
}

export interface AgenticMod {
  id: string;
  name: string;
  type: 'pre_process' | 'post_process' | 'system_override' | 'tool_provider';
  config?: Record<string, unknown>;
}

export interface AgenticRole {
  id: string;
  name: string;
  systemPrompt: string;
}

export interface AgenticMentalContext {
  id: string;
  text: string;
  relationToStep: 'incoming' | 'outgoing';
}

/**
 * A single required output artifact for a step's completion contract. The
 * guardrail engine matches `pathPattern` against the workspace and asserts every
 * `mustContain` signature is present — deterministically, for any model.
 */
export interface StepArtifactRequirement {
  /** Human description surfaced in corrective feedback on failure. */
  description: string;
  /** RegExp (string) matched against workspace file paths. */
  pathPattern: string;
  /** RegExp (string) signatures at least one matching file must contain. */
  mustContain?: string[];
  /** Minimum byte size for at least one matching file (rejects empty stubs). */
  minBytes?: number;
}

/**
 * A model-agnostic "definition of done" for a step. After the step runs, the
 * executor verifies this contract against the workspace and re-runs the step
 * with concrete corrective feedback until it passes or the attempt budget is
 * spent — so output quality does not depend on the model's stamina.
 */
export interface StepContract {
  /** The step must create or modify at least one file. */
  mustWriteFiles?: boolean;
  /** Files the step wrote may not contain TODO/FIXME/placeholder stubs. */
  forbidStubMarkers?: boolean;
  /** Artifacts that must exist (with required content) when the step finishes. */
  requiredArtifacts?: StepArtifactRequirement[];
  /**
   * Path patterns (RegExp strings) this step must NOT create — used to forbid
   * divergent parallel systems (e.g. a second i18n module) and keep one
   * canonical source of truth.
   */
  forbiddenArtifacts?: Array<{ description: string; pathPattern: string }>;
  /**
   * Assert every external package imported across the workspace is declared in
   * package.json (dependencies or devDependencies) — catches a project that
   * imports a package it never declares and so would not install/build.
   */
  requireDeclaredDependencies?: boolean;
  /** Override the default verify-and-retry attempt budget for this step. */
  maxAttempts?: number;
}

export interface AgenticStep {
  id: string;
  type: AgenticStepType;
  prompt: string;
  tools: AgenticTool[];
  prevStepIds: string[];
  nextStepIds: string[];
  mods: AgenticMod[];
  roles: AgenticRole[];
  mentalContext: AgenticMentalContext[];
  /** Optional deterministic completion contract enforced by the guardrail engine. */
  contract?: StepContract;
  /** Optional per-step model override ("provider/model"); beats the flow model + router. */
  model?: string;
  /**
   * Optional human-facing description carried through from the canvas step
   * node, purely for display/documentation — distinct from `prompt` (the
   * resolved execution text). Never consulted by the execution pipeline.
   */
  description?: string;
}

/**
 * A bounded loop-back edge in the flow graph: after `sourceStepId` completes,
 * control returns to `targetStepId` (an upstream step) and the steps between
 * them re-run, up to `maxIterations` total passes. The forward graph (all
 * non-loop edges) always stays acyclic; loops are the only cycles and they are
 * always bounded. Bodies are recomputed by each runtime, never persisted here.
 */
export interface AgenticLoop {
  id: string;
  sourceStepId: string;
  targetStepId: string;
  /** Total passes of the loop body (1..50); first pass counts as iteration 1. */
  maxIterations: number;
}

/** Default loop passes when a loop-back edge omits a count. */
export const LOOP_DEFAULT_MAX_ITERATIONS = 3;
/** Hard cap on loop passes — the format-normative upper bound. */
export const LOOP_MAX_ITERATIONS_CAP = 50;
/** Clamp any user/generator/persisted value into [1, cap], defaulting non-finite input. */
export function clampLoopIterations(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : LOOP_DEFAULT_MAX_ITERATIONS;
  return Math.min(LOOP_MAX_ITERATIONS_CAP, Math.max(1, v));
}

// ---------------------------------------------------------------------------
// Deterministic step ordering
// ---------------------------------------------------------------------------

/**
 * Deterministic topological sort over a step graph: dependency-free steps
 * (`prevStepIds = []`) first, then each newly-unblocked layer in turn, with
 * ties at every layer broken by id ascending — root-first, ordered by
 * dependency depth, with a stable id tie-break. This is the single canonical
 * ordering shared by the portable export format (`fluxor-flow.ts`'s
 * `exportFlow`) and the human-readable Markdown renderer (`flow-markdown.ts`'s
 * `flowToMarkdown`), so both surfaces present a flow's steps in the same
 * reproducible order regardless of `stepsRecord` insertion order. Lives here
 * (rather than in either consumer) because it is pure and both a `src/main`
 * module and a `src/renderer` module need it — this file is the boundary-safe
 * shared home for both (also home to `clampLoopIterations`, for the same
 * reason).
 */
export function topoSortAgenticSteps(steps: AgenticStep[]): AgenticStep[] {
  const byId = new Map<string, AgenticStep>(steps.map((s) => [s.id, s]));
  const inDegree = new Map<string, number>();
  for (const s of steps) {
    inDegree.set(s.id, s.prevStepIds.length);
  }

  // Seed with roots (no dependencies), sorted by id for determinism.
  const ready: AgenticStep[] = steps
    .filter((s) => s.prevStepIds.length === 0)
    .sort((a, b) => a.id.localeCompare(b.id));

  const sorted: AgenticStep[] = [];

  while (ready.length > 0) {
    // Pop from front (already sorted before insertion).
    const current = ready.shift()!;
    sorted.push(current);

    // Collect newly-unblocked successors, sort them by id, then push to ready.
    const newly: AgenticStep[] = [];
    for (const nextId of current.nextStepIds) {
      const next = byId.get(nextId);
      if (!next) continue;
      const remaining = (inDegree.get(nextId) ?? 0) - 1;
      inDegree.set(nextId, remaining);
      if (remaining === 0) {
        newly.push(next);
      }
    }
    // Insert new candidates in id order, maintaining overall sort invariant.
    newly.sort((a, b) => a.id.localeCompare(b.id));
    ready.push(...newly);
    ready.sort((a, b) => a.id.localeCompare(b.id));
  }

  return sorted;
}

/**
 * A named, explicitly-declared grouping of steps that carries BLOCK-level
 * semantics — behavior that is redundant or impossible to express step by
 * step: a completion gate evaluated once for the whole group, and a resumable
 * boundary on checkpoints. Read-only with respect to loop bodies: a phase's
 * `stepIds` MAY coincide with a loop body's derived step set (making the
 * phase a named, visible projection of that body), but a phase never carries
 * `maxIterations` and never re-triggers execution — `AgenticLoop` (via its
 * loop-back edge) remains the sole carrier of repetition semantics in v1.
 *
 * Capa 1 ONLY — see spec docs/superpowers/specs/2026-07-21-agentic-phase-model.md.
 * Capa 2 (conditional exit, skip, block retry, rollback, phase timeout) is
 * explicitly NOT modeled here and must not be inferred from this shape.
 */
export interface AgenticPhase {
  /**
   * Unique, flow-scoped phase identifier. Referenced by checkpoint
   * phase-boundary markers (Checkpoint.phaseBoundary.phaseId) and by exit-gate
   * breach messages — must be unique across `flow.phases` (compiler-validated)
   * since both consumers resolve a phase BY this id alone.
   */
  id: string;
  /**
   * Human-facing name. Surfaced verbatim in exit-gate breach feedback
   * ("Phase <name> breached its exit contract…"), in checkpoint
   * phase-boundary markers (frozen at checkpoint-creation time), and on the
   * canvas (F2). Purely descriptive; never consulted for control flow.
   */
  name: string;
  /**
   * Member step ids, declared DIRECTLY — unlike a loop body, which is
   * DERIVED from a loop-back edge, a phase has no edge to derive from. Must
   * satisfy the membership invariants: non-empty, no duplicates, every id
   * resolves to a real step, and the SET forms one connected component of
   * the forward graph. Compiler-validated for canvas-authored flows
   * (harness-compiler.ts) and defensively re-validated for hand-built/
   * imported flows (validateFlow, executor.ts).
   */
  stepIds: string[];
  /**
   * Optional aggregate completion contract for the WHOLE phase, evaluated
   * EXACTLY ONCE — when the phase's last instance completes — by reusing
   * guardrails.ts's `verifyStepContract` UNCHANGED against a workspace
   * snapshot pair scoped to the phase's own execution window. Absent ⇒ zero
   * extra snapshots, zero extra verification calls, identical cost to a step
   * with no `contract`. `maxAttempts` (inherited from StepContract's shape)
   * is meaningless here and is silently ignored — the exit gate never
   * retries (see `onError`).
   */
  exitContract?: StepContract;
  /**
   * How this phase responds to an unrecoverable condition — an uncaught
   * error thrown by a step inside it, OR an `exitContract` breach. v1
   * supports ONLY 'halt': abort the run, reusing the executor's EXISTING
   * throw → emit-error-event → rethrow path (the same path any uncaught
   * step error already takes today, phase or no phase). Optional because
   * 'halt' is also the only sane default — it is ALREADY every flow's
   * ambient behavior for an uncaught step error — so omitting this field
   * changes nothing observable. Any value other than 'halt' (or absent) is a
   * compiler/executor validation error, not a silent feature.
   */
  onError?: 'halt';
}

export interface AgenticFlow {
  id: string;
  name: string;
  rootStepId: string;
  stepsRecord: Record<string, AgenticStep>;
  /** Bounded loop-back edges; omitted when the flow has none. */
  loops?: AgenticLoop[];
  /** Optional human-facing flow description, carried from the owning canvas Frame. */
  description?: string;
  /** Optional free-form labels for search/organization, carried from the owning canvas Frame. */
  tags?: string[];
  /** Optional flow author, carried from the owning canvas Frame. */
  author?: string;
  /**
   * Optional user-defined flow version, carried from the owning canvas Frame.
   * Distinct from FLUXOR_FLOW_FORMAT_VERSION (the export wire-format version).
   */
  version?: string;
  /**
   * Per-flow execution mode for the Rosetta context system (spec:
   * docs/superpowers/specs/2026-07-10-rosetta-context-manifest.md).
   *
   *   - `'blind'` (today's behavior, and the default when this field is
   *     absent): each step sees only the workspace + its own prompt — zero
   *     cross-step awareness, zero side effects tied to this field.
   *   - `'feedback'`: the executor materializes a per-run context directory
   *     + manifest (`context-manifest.ts`) under the run's workspace and
   *     injects a deterministic `<flow_awareness>` block (topology summary +
   *     assigned file + promised briefing paths) into the system prompt so
   *     steps can read/write per-step briefing files with their existing FS
   *     tools.
   *
   * Absent is equivalent to `'blind'` — every pre-existing flow (authored
   * before this field existed, or one that simply never sets it) keeps
   * executing byte-identically: no context directory, no manifest, no
   * `<flow_awareness>` block.
   */
  contextMode?: 'blind' | 'feedback';
  /**
   * Optional named groupings of steps with block-level semantics (an exit
   * gate + a resumable checkpoint boundary) — see AgenticPhase and spec
   * docs/superpowers/specs/2026-07-21-agentic-phase-model.md. Additive,
   * following the exact precedent of `loops` and `contextMode`: omitted when
   * the flow has no phases, and a runtime that does not know this field
   * exists (an older TS build, or the Java/Python SDKs in v1) executes
   * byte-identically — `phases` is never consulted by loop-plan.ts, never
   * changes stepsRecord/rootStepId/the forward graph, and only ever adds NEW
   * code paths (the exit gate, the checkpoint marker) that a runtime
   * ignoring this field simply never runs.
   */
  phases?: AgenticPhase[];
}
