/**
 * context-manifest.ts — Rosetta context manifest (feedback-mode flows)
 *
 * Spec (LAW): docs/superpowers/specs/2026-07-10-rosetta-context-manifest.md
 *
 * Pure and side-effect free by design (same discipline as loop-plan.ts) — the
 * executor is the only caller that performs I/O (creating the run-context
 * directory, writing manifest.json, seeding + reading context files); this
 * module only computes shapes and strings.
 *
 * Convention (LAW, see spec "Ubicación y convención de nombres"): everything
 * lives under `<rootDir>/.fluxor/run-context/<runId>/`:
 *   - manifest.json            — this module's ContextManifest, serialized.
 *   - step.<stepId>.md         — a non-loop step's assigned context file.
 *   - step.<stepId>.iter<N>.md — a loop-body step's per-iteration file (N from 1).
 *
 * Two deliberately distinct key namespaces (spec "Notas de implementación"):
 *   - loop-plan.ts's `instanceKey()` uses `stepId@iteration` internally.
 *   - This module's manifest is keyed by `stepId` (non-loop) or
 *     `stepId#iterN` (loop-body, every pass including iteration 1).
 * `manifestKeyForInstance` is the ONLY place that translates between them —
 * the `@` form never leaks into the manifest, seeds, or prompts.
 *
 * Retriever exemption (spec "Steps retriever"): the executor's retriever
 * branch returns before the LLM path — it receives no tools, no system
 * prompt, no `<flow_awareness>`. A retriever-type step's manifest entry gets
 * `writesTo: []` (no promises ⇒ no guardrail obligation) and `readBy: []`
 * (nobody is instructed to read it), tagged `exempt: 'retriever'` so a
 * consumer reading the manifest never expects a briefing that will never
 * arrive. Its `contextFile` still exists (seeded at genesis) — an upstream
 * producer whose forward edge targets it still legitimately promises a
 * briefing there (mechanically derived from the DAG like any other edge);
 * the retriever simply never reads it, same as today.
 */
import type { AgenticFlow } from '../../types/harness';
import { topoSortAgenticSteps } from '../../types/harness';
import type { ExecutionPlan, StepInstance } from './loop-plan';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** `ContextManifest.version` — bump only on a breaking schema change. */
export const CONTEXT_MANIFEST_VERSION = 1;

/** Default per-context-file byte budget (spec "Presupuesto" decision — ~3k tokens). */
export const DEFAULT_CONTEXT_BUDGET_BYTES = 12_000;

/** Rosetta convention root, relative to the run's effective rootDir. */
const CONTEXT_RUN_SUBDIR = '.fluxor/run-context';

/** Max chars for a manifest entry's `purpose` (spec "Presupuesto" decision). */
const PURPOSE_MAX_CHARS = 140;

/** Default cap on `<flow_awareness>` topology lines (spec "Presupuesto" decision — "≤~30 líneas"). */
const DEFAULT_TOPOLOGY_MAX_LINES = 30;

const ELLIPSIS = '…';

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/** Path (relative to the run's rootDir) of the run's context directory — e.g. ".fluxor/run-context/<runId>". */
export function contextRunSubdir(runId: string): string {
  return `${CONTEXT_RUN_SUBDIR}/${runId}`;
}

/**
 * Absolute-ish path (rootDir + contextRunSubdir) the executor uses for genesis
 * I/O (mkdir/writeFile) via its fileSystem adapter (real fs or an injected
 * VFS). `rootDir` is the run's already-materialized EFFECTIVE root (see
 * executor.ts) — this function does no normalization of its own.
 */
export function contextRunDir(rootDir: string, runId: string): string {
  return `${rootDir.replace(/\/+$/, '')}/${contextRunSubdir(runId)}`;
}

/**
 * The rootDir-relative path a step's OWN read_file/write_file tools would use
 * to reach a bare context filename (e.g. a manifest entry's `contextFile` or
 * one of its `writesTo` entries) — those tools resolve paths relative to the
 * overall project rootDir, not relative to the run-context directory.
 */
export function relativeContextFilePath(runId: string, filename: string): string {
  return `${contextRunSubdir(runId)}/${filename}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A regexp STRING (matched case-insensitively, mirroring every other
 * `StepArtifactRequirement.pathPattern` in this codebase) that matches the
 * END of a workspace path for this run-context file — anchored with `$` so
 * it matches regardless of the absolute prefix a snapshot uses (a real
 * filesystem's absolute path vs. the PF sandbox VFS's virtual `/workspace`
 * root), without needing to know which one is in play.
 */
export function contextArtifactPathPattern(runId: string, filename: string): string {
  return `${escapeRegExp(relativeContextFilePath(runId, filename))}$`;
}

// ---------------------------------------------------------------------------
// Purpose summarization
// ---------------------------------------------------------------------------

/**
 * Collapses a step prompt into a single-line summary truncated to at most
 * `maxChars` characters (spec "Presupuesto" decision: "resumen 1 línea del
 * prompt del step, truncado a 140 chars"). When truncation is necessary the
 * result ends with a single ellipsis character, and the TOTAL length
 * (including that marker) never exceeds `maxChars`.
 */
export function summarizePurpose(prompt: string, maxChars: number = PURPOSE_MAX_CHARS): string {
  const collapsed = prompt.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxChars) return collapsed;
  const cut = Math.max(0, maxChars - ELLIPSIS.length);
  return `${collapsed.slice(0, cut)}${ELLIPSIS}`;
}

// ---------------------------------------------------------------------------
// Manifest key / context-file naming (the ONLY place that bridges loop-plan's
// `stepId@iteration` namespace and this module's `stepId[#iterN]` namespace)
// ---------------------------------------------------------------------------

/** `stepId` for a non-loop instance; `stepId#iterN` for a loop-body instance (every pass, including 1). */
export function manifestKeyForInstance(instance: Pick<StepInstance, 'stepId' | 'iteration' | 'loop'>): string {
  return instance.loop ? `${instance.stepId}#iter${instance.iteration}` : instance.stepId;
}

/** `step.<stepId>.md` for a non-loop instance; `step.<stepId>.iter<N>.md` for a loop-body instance. */
function contextFileNameForInstance(instance: Pick<StepInstance, 'stepId' | 'iteration' | 'loop'>): string {
  return instance.loop
    ? `step.${instance.stepId}.iter${instance.iteration}.md`
    : `step.${instance.stepId}.md`;
}

// ---------------------------------------------------------------------------
// ContextManifest schema (spec "Schema del manifest")
// ---------------------------------------------------------------------------

export interface ContextManifestStepEntry {
  /** Bare filename (no directory) — resolve via relativeContextFilePath/contextRunDir. */
  contextFile: string;
  /** 1-line summary of the step's prompt, truncated to PURPOSE_MAX_CHARS. */
  purpose: string;
  /** Real stepIds instructed to read `contextFile`; empty for exempt steps. */
  readBy: string[];
  /** Bare filenames (other steps' contextFiles) this instance is expected to write briefings into. */
  writesTo: string[];
  /** Present only for steps exempt from briefing duties (v1: retriever steps). */
  exempt?: 'retriever';
}

export interface ContextManifest {
  version: typeof CONTEXT_MANIFEST_VERSION;
  runId: string;
  flowId: string;
  contextMode: 'feedback';
  budgetBytes: number;
  /** Keyed by manifestKeyForInstance() — bare stepId, or stepId#iterN for loop-body instances. */
  steps: Record<string, ContextManifestStepEntry>;
}

// ---------------------------------------------------------------------------
// buildContextManifest
// ---------------------------------------------------------------------------

/**
 * Builds the Rosetta manifest for one feedback-mode run from the flow, its
 * EXPANDED execution plan (loop-plan.ts's buildExecutionPlan — `writesTo`
 * derives from the expanded DAG's `nextKeys`, per spec, so loop-body
 * `writesTo` correctly targets the NEXT iteration's file, not last-write-wins
 * across passes), and the run's id.
 */
export function buildContextManifest(
  flow: AgenticFlow,
  plan: ExecutionPlan,
  runId: string,
  budgetBytes: number = DEFAULT_CONTEXT_BUDGET_BYTES,
): ContextManifest {
  const steps: Record<string, ContextManifestStepEntry> = {};

  for (const instance of plan.instances.values()) {
    const step = flow.stepsRecord[instance.stepId];
    const isRetriever = step?.type === 'retriever';
    const key = manifestKeyForInstance(instance);

    const writesTo = isRetriever
      ? []
      : (plan.nextKeys.get(instance.key) ?? []).map((nextKey) => {
          const nextInstance = plan.instances.get(nextKey)!;
          return contextFileNameForInstance(nextInstance);
        });

    steps[key] = {
      contextFile: contextFileNameForInstance(instance),
      purpose: summarizePurpose(step?.prompt ?? ''),
      readBy: isRetriever ? [] : [instance.stepId],
      writesTo,
      ...(isRetriever ? { exempt: 'retriever' as const } : {}),
    };
  }

  return {
    version: CONTEXT_MANIFEST_VERSION,
    runId,
    flowId: flow.id,
    contextMode: 'feedback',
    budgetBytes,
    steps,
  };
}

// ---------------------------------------------------------------------------
// seedContextFiles — deterministic header content, keyed by bare filename
// ---------------------------------------------------------------------------

/**
 * Deterministic seed content for every context file in `manifest` — a header
 * + the step's purpose (spec "Génesis y ciclo de vida": "sembrar cada
 * contextFile con un header determinista... para que 'leer tu fichero' nunca
 * falle por inexistencia"). Keyed by bare filename (as it appears in
 * `contextFile`/`writesTo`) so the executor can write each entry directly
 * under `contextRunDir(rootDir, runId)`.
 */
export function seedContextFiles(manifest: ContextManifest): Record<string, string> {
  const seeds: Record<string, string> = {};

  for (const [key, entry] of Object.entries(manifest.steps)) {
    const iterMatch = /#iter(\d+)$/.exec(key);
    const realStepId = iterMatch ? key.slice(0, iterMatch.index) : key;
    const iterationSuffix = iterMatch
      ? ` (iteración ${iterMatch[1]}/${totalIterationsFor(manifest, realStepId)})`
      : '';

    seeds[entry.contextFile] = [
      `# Contexto para ${realStepId}${iterationSuffix}`,
      '',
      entry.purpose,
      '',
    ].join('\n');
  }

  return seeds;
}

/** Total iterations for `stepId`'s loop, read off any of its own manifest entries. */
function totalIterationsFor(manifest: ContextManifest, stepId: string): number {
  let max = 1;
  for (const key of Object.keys(manifest.steps)) {
    const match = /^(.*)#iter(\d+)$/.exec(key);
    if (match && match[1] === stepId) {
      max = Math.max(max, Number(match[2]));
    }
  }
  return max;
}

// ---------------------------------------------------------------------------
// buildTopologySummaryLines — the <flow_awareness> topology block
// ---------------------------------------------------------------------------

/**
 * One line per REAL step (canonical topo order via topoSortAgenticSteps —
 * NOT one line per expanded loop instance, so a flow with few steps but many
 * loop passes still yields a short, readable summary), truncated to at most
 * `maxLines` entries with a trailing "...and N more step(s)" summary line
 * when the flow has more real steps than that (spec "Presupuesto" decision:
 * "el harness trunca nombres/propósitos largos" when injecting topology).
 */
export function buildTopologySummaryLines(
  flow: AgenticFlow,
  plan: ExecutionPlan,
  maxLines: number = DEFAULT_TOPOLOGY_MAX_LINES,
): string[] {
  const ordered = topoSortAgenticSteps(Object.values(flow.stepsRecord));

  const loopInfoByStepId = new Map<string, { totalIterations: number }>();
  for (const instance of plan.instances.values()) {
    if (instance.loop && !loopInfoByStepId.has(instance.stepId)) {
      loopInfoByStepId.set(instance.stepId, { totalIterations: instance.loop.totalIterations });
    }
  }

  const cap = Math.max(1, maxLines);
  const shown = ordered.length > cap ? ordered.slice(0, cap - 1) : ordered;

  const lines = shown.map((step) => {
    const loopInfo = loopInfoByStepId.get(step.id);
    const exemptSuffix = step.type === 'retriever' ? ' [retriever, exempt from briefings]' : '';
    const loopSuffix = loopInfo ? ` [loops ×${loopInfo.totalIterations}]` : '';
    return `- ${step.id}: ${summarizePurpose(step.prompt)}${loopSuffix}${exemptSuffix}`;
  });

  if (ordered.length > cap) {
    const remaining = ordered.length - shown.length;
    lines.push(`- …and ${remaining} more step(s) not shown.`);
  }

  return lines;
}
