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
 * ordering shared by the portable export format (`heliox-flow.ts`'s
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
   * Distinct from HELIOX_FLOW_FORMAT_VERSION (the export wire-format version).
   */
  version?: string;
}
