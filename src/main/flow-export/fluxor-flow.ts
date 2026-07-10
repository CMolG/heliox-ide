/**
 * fluxor-flow.ts — Canonical portable export format for Fluxor agentic flows.
 *
 * This module defines the interchange format that bridges the TypeScript IDE
 * model (AgenticFlow / AgenticStep) and the Java runtime model
 * (FlowDefinition / StepConfig). The format is designed to map cleanly to both:
 *
 *   TS IDE          → FluxorFlowExport   → Java runtime
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
 * (FLUXOR_FLOW_FORMAT_VERSION, the wire format version) — nesting the four
 * fields under `meta` avoids colliding with it.
 *
 * Format tag (Capa B, Heliox → Fluxor rebrand): `format` names this wire
 * format across all 3 runtimes (TS/Java/Python) — "fluxor-flow" going
 * forward. Legacy compat: files exported before this field existed carry no
 * `format` key at all; `importFlow` treats that (and the literal legacy value
 * "heliox-flow", in case some tool started stamping it early) as the
 * deprecated format and warns once, but still imports normally — the rest of
 * the schema is unchanged, so there is nothing to migrate structurally.
 */

import {
  clampLoopIterations,
  topoSortAgenticSteps,
  type AgenticFlow,
  type AgenticStep,
  type StepContract,
} from '../../types/harness';
import { warnOnce } from '../lib/warn-once';

// ---------------------------------------------------------------------------
// Version + format tag
// ---------------------------------------------------------------------------

export const FLUXOR_FLOW_FORMAT_VERSION = '1';

/** Current wire-format name, stamped into every export's `format` field. */
export const FLUXOR_FLOW_FORMAT_NAME = 'fluxor-flow';

// Legacy compat: the pre-rebrand format name. Never written by exportFlow
// anymore, but still recognized (with a warning) on import — see the
// module header's "Format tag" note.
const LEGACY_HELIOX_FLOW_FORMAT_NAME = 'heliox-flow';

// ---------------------------------------------------------------------------
// Schema types
// ---------------------------------------------------------------------------

export interface FluxorFlowStep {
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
 * independently (not reused via import) — same convention as FluxorFlowStep
 * mirroring AgenticStep — so the wire format and the internal execution-AST
 * type can evolve on separate timelines even though they agree today.
 */
export interface FluxorFlowLoop {
  /** Loop identifier. */
  id: string;
  /** Step id after which control returns to targetStepId. */
  sourceStepId: string;
  /** Upstream step id the loop body restarts from. */
  targetStepId: string;
  /** Total passes of the loop body (1..50 — clamped at export time). */
  maxIterations: number;
}

export interface FluxorFlowExport {
  /** Format version — must equal FLUXOR_FLOW_FORMAT_VERSION. */
  version: string;
  /**
   * Wire-format name — "fluxor-flow" for every export produced by this
   * module. Optional on the TYPE only because legacy files (exported before
   * this field existed) omit it entirely; importFlow treats an absent value
   * the same as the deprecated "heliox-flow" name (see module header).
   */
  format?: string;
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
  steps: FluxorFlowStep[];
  /**
   * Bounded loop-back edges (AgenticFlow.loops), round-tripped EXACTLY.
   * Omitted when the flow has no loops. `maxIterations` is clamped into
   * [1, 50] at export time — see the module header's "Loop cap" note.
   */
  loops?: FluxorFlowLoop[];
  /**
   * Optional human-facing flow metadata (AgenticFlow.description/tags/author/
   * version), nested under `meta` rather than flattened to top-level keys —
   * the top-level `version` field above is the wire FORMAT version
   * (FLUXOR_FLOW_FORMAT_VERSION) and a top-level `version` here would collide
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
 * Convert an AgenticFlow to a FluxorFlowExport.
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
export function exportFlow(flow: AgenticFlow): FluxorFlowExport {
  const allSteps = Object.values(flow.stepsRecord);
  const ordered = topoSortAgenticSteps(allSteps);

  const steps: FluxorFlowStep[] = ordered.map((step) => {
    const systemPrompt =
      step.roles.length > 0
        ? step.roles.map((r) => r.systemPrompt).join('\n\n')
        : undefined;

    const contextEntries = step.mentalContext.map((c) => [c.id, c.text] as const);
    const context =
      contextEntries.length > 0 ? Object.fromEntries(contextEntries) : undefined;

    const exported: FluxorFlowStep = {
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

  const loops: FluxorFlowLoop[] | undefined =
    flow.loops && flow.loops.length > 0
      ? flow.loops.map((loop) => ({
          id: loop.id,
          sourceStepId: loop.sourceStepId,
          targetStepId: loop.targetStepId,
          maxIterations: clampLoopIterations(loop.maxIterations),
        }))
      : undefined;

  // Human-facing flow metadata, nested under `meta` (see FluxorFlowExport's
  // doc-comment for why it isn't flattened to top-level keys). Attached only
  // when at least one of the four fields is present, so a flow carrying no
  // metadata exports with no `meta` key at all — keeping pre-Phase-5 exports
  // byte-identical.
  const hasMeta =
    flow.description !== undefined ||
    flow.tags !== undefined ||
    flow.author !== undefined ||
    flow.version !== undefined;
  const meta: FluxorFlowExport['meta'] = hasMeta
    ? {
        ...(flow.description !== undefined ? { description: flow.description } : {}),
        ...(flow.tags !== undefined ? { tags: flow.tags } : {}),
        ...(flow.author !== undefined ? { author: flow.author } : {}),
        ...(flow.version !== undefined ? { version: flow.version } : {}),
      }
    : undefined;

  const exported: FluxorFlowExport = {
    version: FLUXOR_FLOW_FORMAT_VERSION,
    format: FLUXOR_FLOW_FORMAT_NAME,
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
 * Legacy compat: warns (once per distinct value) when importing a flow that
 * doesn't carry the current `format` tag. Never throws — an unrecognized or
 * absent format is a deprecation signal, not a validation failure, since the
 * rest of the schema hasn't changed shape.
 */
function warnIfLegacyFormat(format: string | undefined): void {
  if (format === FLUXOR_FLOW_FORMAT_NAME) return;
  const seenAs = format ?? LEGACY_HELIOX_FLOW_FORMAT_NAME;
  warnOnce(
    `Importing a flow in the deprecated "${seenAs}" format; re-export it to upgrade to "${FLUXOR_FLOW_FORMAT_NAME}".`,
  );
}

/**
 * Reconstruct an AgenticFlow from a FluxorFlowExport.
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
 *
 * Legacy compat: a missing/legacy `format` (see warnIfLegacyFormat) never
 * blocks reconstruction — every field below is read the same way regardless.
 */
export function importFlow(exported: FluxorFlowExport): AgenticFlow {
  warnIfLegacyFormat(exported.format);

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
