/**
 * context-builder.ts — Cognitive prompt assembly for harness steps
 *
 * Roles become the highest-priority heuristics in the system prompt. Step
 * prompts, resolved pre-process mods, and mental context become the user prompt.
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

function buildSystemPrompt(step: AgenticStep): string {
  const roleLines = step.roles.length > 0
    ? step.roles.map((role) => `[${role.name}]\n${role.systemPrompt}`).join('\n\n')
    : 'No explicit roles were attached. Use Heliox default engineering judgment.';

  const systemMods = step.mods
    .filter((mod) => mod.type === 'system_override')
    .map((mod) => `[${mod.name}]\n${stringifyConfig(mod.config)}`);

  return [
    '<role_heuristics>',
    roleLines,
    '</role_heuristics>',
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
  const resolvePreProcessMod = options.resolvePreProcessMod ?? defaultResolvePreProcessMod;
  const preProcessOutputs: Array<{ modId: string; output: string }> = [];

  for (const mod of step.mods.filter((item) => item.type === 'pre_process')) {
    options.onModStatus?.(mod, 'running', `Pre-process mod "${mod.name}" started.`);
    try {
      const output = await resolvePreProcessMod(mod, step);
      preProcessOutputs.push({ modId: mod.id, output });
      options.onModStatus?.(mod, 'completed', output);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      options.onModStatus?.(mod, 'error', message);
      throw error;
    }
  }

  const preProcessContext = preProcessOutputs.length > 0
    ? [
        '<pre_process_context>',
        ...preProcessOutputs.map((entry) => `[${entry.modId}]\n${entry.output}`),
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
    systemPrompt: buildSystemPrompt(step),
    userPrompt,
    preProcessOutputs,
  };
}
