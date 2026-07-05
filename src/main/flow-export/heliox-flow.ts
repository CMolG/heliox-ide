/**
 * heliox-flow.ts — Canonical portable export format for Heliox agentic flows.
 *
 * This module defines the interchange format that bridges the TypeScript IDE
 * model (AgenticFlow / AgenticStep) and the Java runtime model
 * (FlowDefinition / StepConfig). The format is designed to map cleanly to both:
 *
 *   TS IDE          → HelioxFlowExport   → Java runtime
 *   stepsRecord     → steps[]            → List<StepConfig>
 *   prevStepIds     → dependsOn          → dependencies
 *   roles[].systemPrompt → systemPrompt  → systemPrompt (flat string)
 *   tools[].name    → tools[]            → (ignored by Java, preserved here)
 *   mentalContext   → context map        → context Map<String,String>
 *
 * Round-trip fidelity contract
 * ─────────────────────────────
 * EXACT (execution-relevant structure preserved):
 *   step ids, dependsOn graph, prompt per step, flattened systemPrompt,
 *   tool names, rootStepId, flow id/name, per-step `contract` (StepContract,
 *   carried opaquely — this module never interprets it), per-step `model`
 *   override, per-step `description` (human-facing, execution-inert), flow
 *   `meta` (human-facing description/tags/author/version, execution-inert),
 *   and `loops` (bounded loop-back edges).
 *
 * INTENTIONALLY FLATTENED (lossy but acceptable):
 *   - role ids and role names collapse into a single 'exported-role' sentinel;
 *     multiple roles are joined with \n\n into one systemPrompt string.
 *   - mod details (id, name, type, config) are dropped; Java has no mod concept.
 *   - mentalContext.relationToStep is not preserved (always restored as 'incoming').
 *
 * Loop cap (format-normative): `loops[].maxIterations` is clamped into
 * [1, LOOP_MAX_ITERATIONS_CAP] (1..50) at export time via `clampLoopIterations`
 * — every consumer of this format (TS, Java, Python) may assume a value in
 * that range without re-validating. Loops never affect `dependsOn` /
 * `nextStepIds` derivation, which stays forward-edges-only; a runtime expands
 * loop bodies into per-iteration passes separately (see loop-plan.ts).
 *
 * Human-facing metadata (format-additive, Phase 5): step `description` and
 * flow `meta` carry zero execution semantics — nothing in this module or its
 * consumers ever branches on them. Both are omitted entirely (no key at all)
 * when absent, so pre-Phase-5 exports stay byte-identical. `meta.version` is
 * user-defined flow versioning, unrelated to the top-level `version` field
 * (HELIOX_FLOW_FORMAT_VERSION, the wire format version) — nesting the four
 * fields under `meta` avoids colliding with it.
 */

import {
  clampLoopIterations,
  topoSortAgenticSteps,
  type AgenticFlow,
  type AgenticStep,
  type StepContract,
} from '../../types/harness';

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

export const HELIOX_FLOW_FORMAT_VERSION = '1';

// ---------------------------------------------------------------------------
// Schema types
// ---------------------------------------------------------------------------

export interface HelioxFlowStep {
  /** Unique step identifier — matches AgenticStep.id and Java StepConfig.id. */
  id: string;
  /** Step kind tag (e.g. 'llm_call', 'tool_call', 'router'). */
  type: string;
  /** User-facing prompt template for the step. */
  prompt: string;
  /**
   * Parent step ids — equivalent to AgenticStep.prevStepIds and Java
   * StepConfig.dependencies.
   */
  dependsOn: string[];
  /**
   * Flattened system prompt joined from all AgenticRole.systemPrompt values
   * (delimiter: '\n\n'). Omitted when no roles are defined.
   */
  systemPrompt?: string;
  /** Tool names available to this step (AgenticStep.tools[].name). */
  tools: string[];
  /**
   * Flattened mental-context map: AgenticMentalContext.id → text.
   * Omitted when no context entries exist.
   */
  context?: Record<string, string>;
  /**
   * Optional deterministic completion contract (AgenticStep.contract),
   * carried opaquely — round-tripped EXACTLY, never interpreted by this
   * module. The guardrail engine (executor-side) is the sole consumer.
   */
  contract?: StepContract;
  /**
   * Optional per-step model override ("provider/model"), round-tripped
   * EXACTLY (AgenticStep.model).
   */
  model?: string;
  /**
   * Optional human-facing description (AgenticStep.description), round-tripped
   * EXACTLY. Purely for display — never consulted by the execution pipeline.
   */
  description?: string;
}

/**
 * A bounded loop-back edge, exported opaquely from AgenticLoop. Declared
 * independently (not reused via import) — same convention as HelioxFlowStep
 * mirroring AgenticStep — so the wire format and the internal execution-AST
 * type can evolve on separate timelines even though they agree today.
 */
export interface HelioxFlowLoop {
  /** Loop identifier. */
  id: string;
  /** Step id after which control returns to targetStepId. */
  sourceStepId: string;
  /** Upstream step id the loop body restarts from. */
  targetStepId: string;
  /** Total passes of the loop body (1..50 — clamped at export time). */
  maxIterations: number;
}

export interface HelioxFlowExport {
  /** Format version — must equal HELIOX_FLOW_FORMAT_VERSION. */
  version: string;
  /** Flow identifier. */
  id: string;
  /** Human-readable flow name. */
  name: string;
  /** Id of the first step (no dependsOn entries). */
  rootStepId: string;
  /**
   * Steps ordered by a deterministic topological sort:
   *   1. dependency-free steps first (dependsOn = []).
   *   2. among equal-depth candidates, tie-broken by id ascending.
   *
   * This ordering is stable across serialisations and meaningful for both
   * array-indexed Java consumers and streaming TS deserialisers.
   */
  steps: HelioxFlowStep[];
  /**
   * Bounded loop-back edges (AgenticFlow.loops), round-tripped EXACTLY.
   * Omitted when the flow has no loops. `maxIterations` is clamped into
   * [1, 50] at export time — see the module header's "Loop cap" note.
   */
  loops?: HelioxFlowLoop[];
  /**
   * Optional human-facing flow metadata (AgenticFlow.description/tags/author/
   * version), nested under `meta` rather than flattened to top-level keys —
   * the top-level `version` field above is the wire FORMAT version
   * (HELIOX_FLOW_FORMAT_VERSION) and a top-level `version` here would collide
   * with it. Omitted entirely when the flow declares none of the four fields.
   */
  meta?: {
    description?: string;
    tags?: string[];
    author?: string;
    version?: string;
  };
}

// ---------------------------------------------------------------------------
// exportFlow
// ---------------------------------------------------------------------------

/**
 * Convert an AgenticFlow to a HelioxFlowExport.
 *
 * Mapping rules:
 *   - dependsOn   ← step.prevStepIds
 *   - systemPrompt ← step.roles.map(r => r.systemPrompt).join('\n\n') || undefined
 *   - tools        ← step.tools.map(t => t.name)
 *   - context      ← Object.fromEntries(step.mentalContext.map(c => [c.id, c.text]))
 *                    (omitted when empty)
 *   - contract     ← step.contract, copied verbatim when present
 *   - model        ← step.model, copied verbatim when present
 *   - description  ← step.description, copied verbatim when present
 *   - loops        ← flow.loops, each maxIterations re-clamped via
 *                    clampLoopIterations (omitted when flow.loops is empty/absent)
 *   - meta         ← { description, tags, author, version } collected from the
 *                    flow's matching fields; attached only if at least one is
 *                    present (omitted entirely otherwise)
 *
 * Steps are emitted in a stable deterministic topological order (dependency-free
 * first; ties broken by id ascending) so the export is reproducible.
 */
export function exportFlow(flow: AgenticFlow): HelioxFlowExport {
  const allSteps = Object.values(flow.stepsRecord);
  const ordered = topoSortAgenticSteps(allSteps);

  const steps: HelioxFlowStep[] = ordered.map((step) => {
    const systemPrompt =
      step.roles.length > 0
        ? step.roles.map((r) => r.systemPrompt).join('\n\n')
        : undefined;

    const contextEntries = step.mentalContext.map((c) => [c.id, c.text] as const);
    const context =
      contextEntries.length > 0 ? Object.fromEntries(contextEntries) : undefined;

    const exported: HelioxFlowStep = {
      id: step.id,
      type: step.type,
      prompt: step.prompt,
      dependsOn: step.prevStepIds,
      tools: step.tools.map((t) => t.name),
    };

    if (systemPrompt !== undefined) exported.systemPrompt = systemPrompt;
    if (context !== undefined) exported.context = context;
    if (step.contract !== undefined) exported.contract = step.contract;
    if (step.model !== undefined) exported.model = step.model;
    if (step.description !== undefined) exported.description = step.description;

    return exported;
  });

  const loops: HelioxFlowLoop[] | undefined =
    flow.loops && flow.loops.length > 0
      ? flow.loops.map((loop) => ({
          id: loop.id,
          sourceStepId: loop.sourceStepId,
          targetStepId: loop.targetStepId,
          maxIterations: clampLoopIterations(loop.maxIterations),
        }))
      : undefined;

  // Human-facing flow metadata, nested under `meta` (see HelioxFlowExport's
  // doc-comment for why it isn't flattened to top-level keys). Attached only
  // when at least one of the four fields is present, so a flow carrying no
  // metadata exports with no `meta` key at all — keeping pre-Phase-5 exports
  // byte-identical.
  const hasMeta =
    flow.description !== undefined ||
    flow.tags !== undefined ||
    flow.author !== undefined ||
    flow.version !== undefined;
  const meta: HelioxFlowExport['meta'] = hasMeta
    ? {
        ...(flow.description !== undefined ? { description: flow.description } : {}),
        ...(flow.tags !== undefined ? { tags: flow.tags } : {}),
        ...(flow.author !== undefined ? { author: flow.author } : {}),
        ...(flow.version !== undefined ? { version: flow.version } : {}),
      }
    : undefined;

  const exported: HelioxFlowExport = {
    version: HELIOX_FLOW_FORMAT_VERSION,
    id: flow.id,
    name: flow.name,
    rootStepId: flow.rootStepId,
    steps,
  };
  if (loops !== undefined) exported.loops = loops;
  if (meta !== undefined) exported.meta = meta;

  return exported;
}

// ---------------------------------------------------------------------------
// importFlow
// ---------------------------------------------------------------------------

/**
 * Reconstruct an AgenticFlow from a HelioxFlowExport.
 *
 * Reconstruction rules:
 *   - prevStepIds ← dependsOn
 *   - nextStepIds ← derived by inverting the dependsOn graph across all steps
 *   - roles       ← systemPrompt !== undefined ? [{ id:'exported-role', name:'ExportedRole', systemPrompt }] : []
 *                   (checked for presence, not truthiness, so a role whose
 *                   systemPrompt is the empty string round-trips exactly
 *                   instead of being dropped)
 *   - tools       ← tools.map(name => ({ id: name, name }))
 *   - mentalContext ← context ? entries mapped with relationToStep:'incoming' : []
 *   - mods        ← [] (not preserved in the export format)
 *   - contract    ← s.contract, restored verbatim when present
 *   - model       ← s.model, restored verbatim when present
 *   - description ← s.description, restored verbatim when present
 *   - loops       ← exported.loops, restored verbatim when present (loops do
 *                   not affect nextStepIds derivation, which stays dependsOn-only)
 *   - description/tags/author/version (flow-level) ← exported.meta's matching
 *                   field, restored verbatim when present
 */
export function importFlow(exported: HelioxFlowExport): AgenticFlow {
  // First pass: build stepsRecord without nextStepIds.
  const stepsRecord: Record<string, AgenticStep> = {};

  for (const s of exported.steps) {
    const roles =
      s.systemPrompt !== undefined
        ? [{ id: 'exported-role', name: 'ExportedRole', systemPrompt: s.systemPrompt }]
        : [];

    const tools = s.tools.map((name) => ({ id: name, name }));

    const mentalContext = s.context
      ? Object.entries(s.context).map(([id, text]) => ({
          id,
          text,
          relationToStep: 'incoming' as const,
        }))
      : [];

    const step: AgenticStep = {
      id: s.id,
      type: s.type,
      prompt: s.prompt,
      prevStepIds: s.dependsOn,
      nextStepIds: [], // filled in second pass
      mods: [],
      roles,
      tools,
      mentalContext,
    };
    if (s.contract !== undefined) step.contract = s.contract;
    if (s.model !== undefined) step.model = s.model;
    if (s.description !== undefined) step.description = s.description;

    stepsRecord[s.id] = step;
  }

  // Second pass: derive nextStepIds from the inverse of dependsOn.
  for (const step of Object.values(stepsRecord)) {
    for (const parentId of step.prevStepIds) {
      const parent = stepsRecord[parentId];
      if (parent && !parent.nextStepIds.includes(step.id)) {
        parent.nextStepIds.push(step.id);
      }
    }
  }

  const flow: AgenticFlow = {
    id: exported.id,
    name: exported.name,
    rootStepId: exported.rootStepId,
    stepsRecord,
  };
  if (exported.loops !== undefined) flow.loops = exported.loops;
  if (exported.meta?.description !== undefined) flow.description = exported.meta.description;
  if (exported.meta?.tags !== undefined) flow.tags = exported.meta.tags;
  if (exported.meta?.author !== undefined) flow.author = exported.meta.author;
  if (exported.meta?.version !== undefined) flow.version = exported.meta.version;

  return flow;
}
