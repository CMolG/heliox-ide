/**
 * context-builder.ts — Cognitive prompt assembly for harness steps
 *
 * Roles become the highest-priority heuristics in the system prompt.
 *
 * System vs. user prompt split for `pre_process` mods: a mod whose `config`
 * declares a literal, non-empty `inject` string is a *constraint mod* — its
 * resolved output is promoted into the system prompt's `<execution_constraints>`
 * block (law, not reference material — see EXECUTION_CONSTRAINTS_PREAMBLE).
 * Every other pre_process mod (situational/dynamic output, e.g. one resolved
 * from `config.context`/`config.prompt`, or a custom resolver with no static
 * `inject`) keeps landing in the user prompt's `<pre_process_context>` block,
 * exactly as before. `StepContext.preProcessOutputs` still carries EVERY
 * resolved output (constraints + context, unpartitioned) in resolution order —
 * checkpoints/telemetry consumers rely on that full list.
 *
 * `validateStepAtoms` enforces two structural invariants before any prompt is
 * assembled: the Single Persona rule (at most one role per step) and pairwise
 * mod compatibility (no two attached mods may be mutually `incompatibleWith`
 * or share an `exclusiveGroup`).
 */
import type { AgenticMod, AgenticStep } from '../../types/harness';
import type { RetrievedChunk } from './retriever';

export interface StepContext {
  systemPrompt: string;
  userPrompt: string;
  preProcessOutputs: Array<{ modId: string; output: string }>;
}

export interface BuildStepContextOptions {
  resolvePreProcessMod?: (mod: AgenticMod, step: AgenticStep) => Promise<string>;
  onModStatus?: (
    mod: AgenticMod,
    status: 'running' | 'completed' | 'error',
    logs?: string,
  ) => void;
  /**
   * Chunks retrieved by a preceding `retriever` step (or the current step when
   * it IS the retriever step). Injected into the user prompt under the
   * `<retrieved_context>` delimiter so downstream steps consume them through
   * the normal DAG context mechanism.
   */
  injectedChunks?: RetrievedChunk[];
}

function stringifyConfig(config: Record<string, unknown> | undefined): string {
  return config ? JSON.stringify(config, null, 2) : '{}';
}

async function defaultResolvePreProcessMod(mod: AgenticMod): Promise<string> {
  const injected = mod.config?.inject ?? mod.config?.context ?? mod.config?.prompt;
  if (typeof injected === 'string' && injected.trim()) {
    return injected.trim();
  }

  return `Pre-process mod "${mod.name}" resolved with config ${stringifyConfig(mod.config)}.`;
}

// ─── Step atom validation (Single Persona rule + mod compatibility) ───────

const SINGLE_PERSONA_RULE = 'Single Persona rule (at most one role attached per step)';

/** Keeps only string entries — tolerates malformed/non-array market data. */
function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function toExclusiveGroup(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Throws if `a` and `b` conflict: either declares the other incompatible
 * (checked in both directions — `incompatibleWith` lists may be authored
 * asymmetrically) or both share a non-empty `exclusiveGroup`.
 */
function assertModsCompatible(step: AgenticStep, a: AgenticMod, b: AgenticMod): void {
  const aIncompatible = toStringList(a.config?.incompatibleWith);
  const bIncompatible = toStringList(b.config?.incompatibleWith);
  const listedIncompatible = aIncompatible.includes(b.id) || aIncompatible.includes(b.name)
    || bIncompatible.includes(a.id) || bIncompatible.includes(a.name);

  const aGroup = toExclusiveGroup(a.config?.exclusiveGroup);
  const bGroup = toExclusiveGroup(b.config?.exclusiveGroup);
  const sharedGroup = aGroup !== undefined && aGroup === bGroup;

  if (!listedIncompatible && !sharedGroup) return;

  const reason = sharedGroup
    ? `they share the exclusive group "${aGroup}"`
    : 'they are declared mutually incompatible';
  throw new Error(
    `Step "${step.id}" attaches incompatible mods "${a.name}" and "${b.name}" — ${reason}.`,
  );
}

/**
 * Validates structural invariants before any prompt assembly:
 *   1. Single Persona rule — a step may carry at most one role.
 *   2. Mod compatibility — no two attached mods may declare each other
 *      `incompatibleWith` (either direction) or share an `exclusiveGroup`.
 * Defensive against malformed market data: absent, non-array, or non-string
 * `incompatibleWith`/`exclusiveGroup` fields are treated as "no constraint"
 * rather than thrown on.
 */
export function validateStepAtoms(step: AgenticStep): void {
  if (step.roles.length > 1) {
    const names = step.roles.map((role) => role.name).join(', ');
    throw new Error(
      `Step "${step.id}" has ${step.roles.length} roles attached (${names}) — violates the ${SINGLE_PERSONA_RULE}.`,
    );
  }

  for (let i = 0; i < step.mods.length; i++) {
    for (let j = i + 1; j < step.mods.length; j++) {
      assertModsCompatible(step, step.mods[i], step.mods[j]);
    }
  }
}

// ─── Execution constraints (system-prompt-promoted pre_process mods) ─────

const EXECUTION_CONSTRAINTS_PREAMBLE = [
  'The mods below are binding execution constraints for this step — law, not reference material. They override role preferences and stylistic defaults.',
  'When two constraints conflict, precedence is: (1) security and safety rules, (2) correctness rules, (3) scope-minimization rules, (4) style rules. If still tied, the earlier-listed mod wins.',
  'If a constraint cannot be satisfied, state it explicitly in the response — never silently drop one.',
].join('\n');

function buildExecutionConstraints(constraintOutputs: Array<{ modId: string; output: string }>): string {
  if (constraintOutputs.length === 0) return '';

  return [
    '<execution_constraints>',
    EXECUTION_CONSTRAINTS_PREAMBLE,
    '',
    constraintOutputs.map((entry) => `[${entry.modId}]\n${entry.output}`).join('\n\n'),
    '</execution_constraints>',
  ].join('\n');
}

function buildSystemPrompt(
  step: AgenticStep,
  constraintOutputs: Array<{ modId: string; output: string }>,
): string {
  const roleLines = step.roles.length > 0
    ? step.roles.map((role) => `[${role.name}]\n${role.systemPrompt}`).join('\n\n')
    : 'No explicit roles were attached. Use Fluxor default engineering judgment.';

  const systemMods = step.mods
    .filter((mod) => mod.type === 'system_override')
    .map((mod) => `[${mod.name}]\n${stringifyConfig(mod.config)}`);

  return [
    '<role_heuristics>',
    roleLines,
    '</role_heuristics>',
    buildExecutionConstraints(constraintOutputs),
    systemMods.length > 0
      ? ['<system_modifiers>', ...systemMods, '</system_modifiers>'].join('\n')
      : '',
  ].filter(Boolean).join('\n\n');
}

function buildMentalContext(step: AgenticStep): string {
  if (step.mentalContext.length === 0) return '';

  return [
    '<mental_context>',
    ...step.mentalContext.map((context) => `[${context.relationToStep}] ${context.text}`),
    '</mental_context>',
  ].join('\n');
}

function buildPostProcessHint(step: AgenticStep): string {
  const postMods = step.mods.filter((mod) => mod.type === 'post_process');
  if (postMods.length === 0) return '';

  return [
    '<post_process_mods>',
    ...postMods.map((mod) => `[${mod.name}] ${stringifyConfig(mod.config)}`),
    '</post_process_mods>',
  ].join('\n');
}

function buildRetrievedContext(chunks: RetrievedChunk[] | undefined): string {
  if (!chunks || chunks.length === 0) return '';

  return [
    '<retrieved_context>',
    ...chunks.map((c, i) => `[${i + 1}] (score=${c.score.toFixed(4)}, doc=${c.docId})\n${c.text}`),
    '</retrieved_context>',
  ].join('\n');
}

export async function buildStepContext(
  step: AgenticStep,
  options: BuildStepContextOptions = {},
): Promise<StepContext> {
  validateStepAtoms(step);

  const resolvePreProcessMod = options.resolvePreProcessMod ?? defaultResolvePreProcessMod;
  const preProcessOutputs: Array<{ modId: string; output: string }> = [];
  // Partition of the same resolved outputs above: constraint mods (static
  // `config.inject`) go to the system prompt; the rest stay in the user
  // prompt's `<pre_process_context>`, exactly as before this change.
  const constraintOutputs: Array<{ modId: string; output: string }> = [];
  const contextOutputs: Array<{ modId: string; output: string }> = [];

  for (const mod of step.mods.filter((item) => item.type === 'pre_process')) {
    options.onModStatus?.(mod, 'running', `Pre-process mod "${mod.name}" started.`);
    try {
      const output = await resolvePreProcessMod(mod, step);
      const entry = { modId: mod.id, output };
      preProcessOutputs.push(entry);

      // Classification reads the mod's own *declared* `config.inject` — a
      // static constraint string — not the resolved output. A custom resolver
      // may transform it, but whether the mod itself intends to be a binding
      // constraint vs. situational context is fixed by its own config.
      const injectValue = mod.config?.inject;
      const isConstraint = typeof injectValue === 'string' && injectValue.trim().length > 0;
      (isConstraint ? constraintOutputs : contextOutputs).push(entry);

      options.onModStatus?.(mod, 'completed', output);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      options.onModStatus?.(mod, 'error', message);
      throw error;
    }
  }

  const preProcessContext = contextOutputs.length > 0
    ? [
        '<pre_process_context>',
        ...contextOutputs.map((entry) => `[${entry.modId}]\n${entry.output}`),
        '</pre_process_context>',
      ].join('\n')
    : '';

  const userPrompt = [
    step.prompt,
    preProcessContext,
    buildMentalContext(step),
    buildRetrievedContext(options.injectedChunks),
    buildPostProcessHint(step),
  ].filter(Boolean).join('\n\n');

  return {
    systemPrompt: buildSystemPrompt(step, constraintOutputs),
    userPrompt,
    preProcessOutputs,
  };
}
