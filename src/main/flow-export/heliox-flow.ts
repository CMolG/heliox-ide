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
 *   tool names, rootStepId, flow id/name.
 *
 * INTENTIONALLY FLATTENED (lossy but acceptable):
 *   - role ids and role names collapse into a single 'exported-role' sentinel;
 *     multiple roles are joined with \n\n into one systemPrompt string.
 *   - mod details (id, name, type, config) are dropped; Java has no mod concept.
 *   - mentalContext.relationToStep is not preserved (always restored as 'incoming').
 */

import type { AgenticFlow, AgenticStep } from '../../types/harness';

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
}

// ---------------------------------------------------------------------------
// Topological sort (deterministic, tie-broken by id ascending)
// ---------------------------------------------------------------------------

function topoSort(steps: AgenticStep[]): AgenticStep[] {
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
 *
 * Steps are emitted in a stable deterministic topological order (dependency-free
 * first; ties broken by id ascending) so the export is reproducible.
 */
export function exportFlow(flow: AgenticFlow): HelioxFlowExport {
  const allSteps = Object.values(flow.stepsRecord);
  const ordered = topoSort(allSteps);

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

    return exported;
  });

  return {
    version: HELIOX_FLOW_FORMAT_VERSION,
    id: flow.id,
    name: flow.name,
    rootStepId: flow.rootStepId,
    steps,
  };
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
 *   - roles       ← systemPrompt ? [{ id:'exported-role', name:'ExportedRole', systemPrompt }] : []
 *   - tools       ← tools.map(name => ({ id: name, name }))
 *   - mentalContext ← context ? entries mapped with relationToStep:'incoming' : []
 *   - mods        ← [] (not preserved in the export format)
 */
export function importFlow(exported: HelioxFlowExport): AgenticFlow {
  // First pass: build stepsRecord without nextStepIds.
  const stepsRecord: Record<string, AgenticStep> = {};

  for (const s of exported.steps) {
    const roles =
      s.systemPrompt
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

    stepsRecord[s.id] = {
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

  return {
    id: exported.id,
    name: exported.name,
    rootStepId: exported.rootStepId,
    stepsRecord,
  };
}
