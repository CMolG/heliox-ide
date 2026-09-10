/**
 * executor.ts — Agentic flow executor
 *
 * The scheduler preserves DAG dependency semantics while each step delegates to
 * the LLM runner and MCP-backed tool surface.
 */
import { mkdir as nodeMkdir, readdir as nodeReaddir, readFile as nodeReadFile, stat as nodeStat, writeFile as nodeWriteFile } from 'fs/promises';
import { posix, resolve as resolvePath } from 'path';
import type { AgenticFlow, AgenticMod, AgenticPhase, AgenticStep, StepContract } from '../../types/harness';
import { harnessEventBus } from './event-bus';
import { buildStepContext, type FlowAwarenessInput } from './context-builder';
import { createLocalMcpToolSet, type LocalMcpOptions, type McpFileSystem } from './mcp-adapter';
import { getMcpClientModToolSet } from './mcp-client-mod';
import { createBrowserToolSet } from './browser-toolset';
import { runLLMStep, type LLMStepResult, type RunLLMStepInput } from './llm-runner';
import type { LLMStepTelemetryEvent } from '../performance-frontier/telemetry/collector';
import { saveCheckpoint, type PhaseBoundaryMarker } from './checkpoints';
import { retrieve, type EmbedFn } from './retriever';
import type { VectorStore } from './knowledge/vector-store';
import { buildExecutionPlan, type ExecutionPlan, type StepInstance } from './loop-plan';
import {
  snapshotWorkspace,
  verifyStepContract,
  buildCorrectivePrompt,
  mergeStepContracts,
  DEFAULT_GUARDRAIL_MAX_ATTEMPTS,
} from './guardrails';
import { createModelRouter, isSealed, loadDefaultLeaderboard, type ModelRouterDeps } from './model-router';
import type { ArenaLeaderboardEntry } from '../performance-frontier/arena/arena-runner';
import type { ConnectionResolver, ModelPolicy, RoutedModelEvidence } from '../../types/ipc-events';
import {
  buildContextManifest,
  buildTopologySummaryLines,
  contextArtifactPathPattern,
  contextRunDir,
  DEFAULT_CONTEXT_BUDGET_BYTES,
  manifestKeyForInstance,
  relativeContextFilePath,
  seedContextFiles,
  type ContextManifest,
} from './context-manifest';

// ---------------------------------------------------------------------------
// Effective rootDir + real-FS adapter (feedback mode only)
//
// Mirrors mcp-adapter.ts's private `normalizeRootDir`/`nodeFileSystem`
// (McpFileSystem shape) rather than importing/exporting them — this task's
// territory fence excludes editing mcp-adapter.ts, and the spec explicitly
// sanctions "export it or replicate it" (spec "Notas de implementación" —
// "rootDir efectivo"). MUST stay byte-for-byte equivalent: createLocalMcpToolSet
// resolves the model's own read_file/write_file/list_directory tools against
// this exact computation, so genesis (context dir creation) and the
// guardrail's workspace snapshots must agree with it — otherwise a step's
// assigned context file would live at a path its own FS tools can never see.
// ---------------------------------------------------------------------------

const toPosixPath = (value: string): string => value.replace(/\\/g, '/');
const isAbsoluteAnyPlatform = (value: string): boolean => (
  posix.isAbsolute(value) || /^[A-Za-z]:\//.test(value)
);

function resolveEffectiveRootDir(rootDir?: string): string {
  const raw = toPosixPath(rootDir ?? process.cwd());
  const absolute = isAbsoluteAnyPlatform(raw) ? raw : toPosixPath(resolvePath(raw));
  return posix.normalize(absolute);
}

/**
 * Minimal real-filesystem adapter used ONLY when `contextMode` is 'feedback'
 * and the caller passed no `options.fileSystem` — every production surface
 * (IDE/serve/webhook/mcp) omits it; only the Performance Frontier sandbox
 * supplies its own VFS. Blind-mode runs never construct or touch this.
 */
const realFileSystemAdapter: McpFileSystem = {
  mkdir: nodeMkdir,
  readdir: nodeReaddir as McpFileSystem['readdir'],
  readFile: nodeReadFile as McpFileSystem['readFile'],
  stat: nodeStat as McpFileSystem['stat'],
  writeFile: nodeWriteFile as McpFileSystem['writeFile'],
};

/**
 * Feedback-mode plumbing computed once per run (executeAgenticFlow) and
 * threaded into every executeStep call — undefined for every blind-mode run,
 * which is what keeps blind execution byte-identical: every new code path
 * below is gated behind `runContext` being defined.
 */
interface FeedbackRunContext {
  manifest: ContextManifest;
  runId: string;
  /** Absolute-ish path (contextRunDir(effectiveRootDir, runId)) where genesis/checkpoint I/O happens. */
  runDir: string;
  topologyLines: string[];
  /** Bare filename → seed content, so each writesTo target's exact minBytes floor is computable. */
  seeds: Record<string, string>;
  /** options.fileSystem, or the synthesized real-FS adapter when the caller passed none. */
  fileSystem: McpFileSystem;
}

/** This instance's own <flow_awareness> input, or undefined outside feedback mode / when it has no manifest entry. */
function computeFlowAwareness(
  runContext: FeedbackRunContext | undefined,
  instance: StepInstance | undefined,
): FlowAwarenessInput | undefined {
  if (!runContext || !instance) return undefined;
  const entry = runContext.manifest.steps[manifestKeyForInstance(instance)];
  if (!entry) return undefined;

  return {
    topologyLines: runContext.topologyLines,
    assignedFile: relativeContextFilePath(runContext.runId, entry.contextFile),
    writesTo: entry.writesTo.map((filename) => relativeContextFilePath(runContext.runId, filename)),
  };
}

/**
 * A StepContract fragment requiring every briefing this instance promises
 * (its manifest entry's `writesTo`) to exist with MORE bytes than its own
 * seed — mere existence would trivially always pass since genesis seeds
 * every context file up front, so minBytes (an existing, established
 * mechanism — see StepArtifactRequirement.minBytes's "rejects empty stubs"
 * doc) is set just above each SPECIFIC target's known seed length, making
 * the check meaningfully verify a real briefing was written, not merely that
 * the seeded stub survived. Composed into the step's effective contract via
 * the EXISTING mergeStepContracts (guardrails.ts) — no new StepContract
 * field, no mutation of the step's own AST contract.
 */
function computeContextContract(
  runContext: FeedbackRunContext | undefined,
  instance: StepInstance | undefined,
): StepContract | undefined {
  if (!runContext || !instance) return undefined;
  const entry = runContext.manifest.steps[manifestKeyForInstance(instance)];
  if (!entry || entry.writesTo.length === 0) return undefined;

  return {
    requiredArtifacts: entry.writesTo.map((filename) => ({
      description: `context briefing "${filename}" for a downstream step`,
      pathPattern: contextArtifactPathPattern(runContext.runId, filename),
      minBytes: Buffer.byteLength(runContext.seeds[filename] ?? '', 'utf-8') + 1,
    })),
  };
}

/** Reads back this instance's own assigned context file for the checkpoint's contextFileSnapshot. Never throws — a read failure is logged and simply omits the field. */
async function readContextFileSnapshot(
  runContext: FeedbackRunContext,
  instance: StepInstance,
): Promise<{ path: string; content: string } | undefined> {
  const entry = runContext.manifest.steps[manifestKeyForInstance(instance)];
  if (!entry) return undefined;

  const relPath = relativeContextFilePath(runContext.runId, entry.contextFile);
  try {
    const content = await runContext.fileSystem.readFile(`${runContext.runDir}/${entry.contextFile}`, 'utf-8');
    return { path: relPath, content };
  } catch (error) {
    console.warn(`[context-manifest] failed to snapshot context file "${relPath}" for checkpoint: ${getErrorMessage(error)}`);
    return undefined;
  }
}

export interface HarnessStepRunnerInput extends RunLLMStepInput {
  flowId: string;
  step: AgenticStep;
}

export interface ExecuteAgenticFlowOptions {
  rootDir?: string;
  fileSystem?: LocalMcpOptions['fileSystem'];
  telemetrySink?: LocalMcpOptions['telemetrySink'];
  onLLMStepTelemetry?: (event: LLMStepTelemetryEvent) => void;
  modelId?: string;
  /** WS2 smart-routing policy for this run (default: none — no router is created, byte-identical to pre-Phase-3a behavior). */
  modelPolicy?: ModelPolicy;
  /**
   * Test/advanced seam overriding the IO `createModelRouter` uses by default
   * (Arena leaderboard file, market/inventory.json betterOn hints, the
   * OPENROUTER_API_KEY env probe). Also backs this executor's own sealed-set
   * re-check (manual step.model override sealing + external-router
   * attribution) so a single injected `getLeaderboard` controls both.
   * Production callers never set this.
   */
  modelRouterDeps?: ModelRouterDeps;
  timeoutMs?: number;
  runStep?: (input: HarnessStepRunnerInput) => Promise<LLMStepResult>;
  /**
   * Caller-supplied run identifier used to group checkpoints.
   *
   * If not provided the executor generates one from the flow id and a
   * timestamp, e.g. `flow-converged_1719484800000`.
   */
  runId?: string;
  /**
   * Injectable vector store for `retriever` steps.
   * Defaults to the module-level active store when omitted.
   */
  vectorStore?: VectorStore;
  /**
   * Injectable embedding function for `retriever` steps.
   * Defaults to the module-level active embed fn when omitted.
   */
  embedFn?: EmbedFn;
  /**
   * Maximum number of chunks to retrieve per `retriever` step (default: 5).
   */
  retrieverK?: number;
  /**
   * Verify-and-retry attempt budget for steps that declare a `contract`
   * (default: DEFAULT_GUARDRAIL_MAX_ATTEMPTS / FLUXOR_GUARDRAIL_MAX_ATTEMPTS).
   */
  guardrailMaxAttempts?: number;
  /**
   * Injected lookup so a step's `conn:<connectionId>/<modelId>` modelId
   * (Settings → Connections) can be resolved to an AI SDK client — see
   * `llm-runner.ts#resolveHarnessModel`. The ipc/executor boundary
   * (`fluxor:start-harness`) builds this once per run from
   * `provider-connections.ts`; production callers otherwise leave it
   * undefined, in which case a `conn:` modelId fails with the same
   * descriptive "unknown connection" error as an unresolvable id today.
   */
  resolveConnection?: ConnectionResolver;
}

function now(): number {
  return Date.now();
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getStep(flow: AgenticFlow, stepId: string): AgenticStep {
  const step = flow.stepsRecord[stepId];
  if (!step) {
    throw new Error(`AgenticFlow "${flow.id}" references missing step "${stepId}".`);
  }
  return step;
}

/**
 * Undirected BFS, inclusive of `start` — a local copy for phase connectivity
 * re-validation. Mirrors loop-plan.ts's own independent copy of the same shape
 * rather than importing harness-compiler.ts's across the main/renderer
 * boundary, following the precedent already set in this engine.
 */
function reachableSetUndirected(start: string, adjacency: Map<string, string[]>): Set<string> {
  const visited = new Set<string>([start]);
  const queue: string[] = [start];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }
  return visited;
}

function validateFlow(flow: AgenticFlow): AgenticStep {
  if (!flow.rootStepId || !flow.stepsRecord[flow.rootStepId]) {
    throw new Error(`AgenticFlow "${flow.id}" has an invalid rootStepId "${flow.rootStepId}".`);
  }

  for (const step of Object.values(flow.stepsRecord)) {
    for (const prevStepId of step.prevStepIds) {
      getStep(flow, prevStepId);
    }
    for (const nextStepId of step.nextStepIds) {
      getStep(flow, nextStepId);
    }
  }

  // Loop sanity checks: resolvable endpoints, no self-loop, a finite count.
  // Reachability (target forward-reaches source) and disjointness of loop
  // bodies are the single responsibility of `buildExecutionPlan` — this is
  // just a fast, cheap-to-diagnose guard against malformed references.
  for (const loop of flow.loops ?? []) {
    getStep(flow, loop.sourceStepId);
    getStep(flow, loop.targetStepId);
    if (loop.sourceStepId === loop.targetStepId) {
      throw new Error(`AgenticFlow "${flow.id}" loop "${loop.id}" source and target must be different steps ("${loop.sourceStepId}").`);
    }
    if (!Number.isFinite(loop.maxIterations)) {
      throw new Error(`AgenticFlow "${flow.id}" loop "${loop.id}" has a non-finite maxIterations (${loop.maxIterations}).`);
    }
  }

  // Phase sanity checks: unique ids, resolvable stepIds, connected subgraph,
  // pairwise disjoint, onError restricted to 'halt' — the same defensive
  // re-validation discipline loops get above, necessary because an
  // AgenticFlow can reach the executor without ever passing through
  // compileFlowFromCanvas (hand-built, imported, or SDK-constructed). A flow
  // that declares no phases skips this loop entirely.
  const phaseStepIdOwner = new Map<string, string>();
  const seenPhaseIds = new Set<string>();
  for (const phase of flow.phases ?? []) {
    if (seenPhaseIds.has(phase.id)) {
      throw new Error(`AgenticFlow "${flow.id}" has a duplicate phase id "${phase.id}".`);
    }
    seenPhaseIds.add(phase.id);

    if (phase.stepIds.length === 0) {
      throw new Error(`AgenticFlow "${flow.id}" phase "${phase.id}" has no member steps.`);
    }

    const uniqueStepIds = [...new Set(phase.stepIds)];
    for (const stepId of uniqueStepIds) {
      getStep(flow, stepId); // throws "references missing step" if unresolved
    }

    const memberSet = new Set(uniqueStepIds);
    const undirectedAdjacency = new Map<string, string[]>();
    for (const stepId of uniqueStepIds) {
      const step = flow.stepsRecord[stepId];
      undirectedAdjacency.set(stepId, [...step.nextStepIds, ...step.prevStepIds].filter((id) => memberSet.has(id)));
    }
    const reached = reachableSetUndirected(uniqueStepIds[0], undirectedAdjacency);
    const unreached = uniqueStepIds.filter((id) => !reached.has(id));
    if (unreached.length > 0) {
      throw new Error(
        `AgenticFlow "${flow.id}" phase "${phase.id}" is not a connected subgraph: {${[...reached].sort().join(', ')}} is disconnected from {${unreached.sort().join(', ')}}.`,
      );
    }

    for (const stepId of uniqueStepIds) {
      const ownerId = phaseStepIdOwner.get(stepId);
      if (ownerId && ownerId !== phase.id) {
        throw new Error(
          `AgenticFlow "${flow.id}" phases "${ownerId}" and "${phase.id}" both claim step "${stepId}" — a step may belong to at most one phase.`,
        );
      }
      phaseStepIdOwner.set(stepId, phase.id);
    }

    if (phase.onError !== undefined && phase.onError !== 'halt') {
      throw new Error(`AgenticFlow "${flow.id}" phase "${phase.id}" declares onError "${phase.onError}" — only "halt" is supported in v1.`);
    }
  }

  return flow.stepsRecord[flow.rootStepId];
}

/** Loop-progress + WS2 model-routing metadata layered onto a StepStatusChanged event. */
export interface StepStatusMeta {
  iteration?: number;
  totalIterations?: number;
  loopId?: string;
  modelId?: string;
  modelEvidence?: RoutedModelEvidence;
}

function emitStepStatus(
  flowId: string,
  stepId: string,
  status: 'running' | 'completed' | 'error',
  logs?: string,
  meta?: StepStatusMeta,
): void {
  harnessEventBus.emitHarnessEvent({
    type: 'StepStatusChanged',
    flowId,
    stepId,
    status,
    timestamp: now(),
    ...(logs ? { logs } : {}),
    ...(meta?.iteration !== undefined ? { iteration: meta.iteration } : {}),
    ...(meta?.totalIterations !== undefined ? { totalIterations: meta.totalIterations } : {}),
    ...(meta?.loopId !== undefined ? { loopId: meta.loopId } : {}),
    ...(meta?.modelId !== undefined ? { modelId: meta.modelId } : {}),
    ...(meta?.modelEvidence !== undefined ? { modelEvidence: meta.modelEvidence } : {}),
  });
}

function emitModStatus(
  flowId: string,
  stepId: string,
  mod: AgenticMod,
  status: 'running' | 'completed' | 'error',
  logs?: string,
): void {
  harnessEventBus.emitHarnessEvent({
    type: 'ModExecutionEvent',
    flowId,
    stepId,
    modId: mod.id,
    status,
    timestamp: now(),
    ...(logs ? { logs } : {}),
  });
}

function hasAntiVerificationInterceptor(step: AgenticStep): boolean {
  return step.mods.some((mod) => (
    mod.id === 'anti-verification-interceptor'
    || mod.name === 'AntiVerificationInterceptor'
    || mod.config?.interceptor === 'anti-verification'
  ));
}

function hasWebBrowserMod(step: AgenticStep): boolean {
  return step.mods.some((mod) => (
    mod.id === 'web-browser'
    || mod.name === 'WebBrowser'
  ));
}

// ---------------------------------------------------------------------------
// Declarative mod runtime (MarketModRuntime) — the bridge between pure `.md`
// prompt injections and code-mods. A mod's `config.runtime` can strip tools
// from the step's surface, grant a built-in toolset, or contribute a contract
// fragment; everything here is inert data interpreted against known engine
// capabilities, never arbitrary execution.
// ---------------------------------------------------------------------------

/** Built-in toolset grants a mod's `runtime.attachTools` may request. */
const KNOWN_ATTACH_TOOLSETS = new Set(['web-browser']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

interface ModRuntimeCollection {
  blockTools: Set<string>;
  attachToolsets: Set<string>;
  contracts: StepContract[];
  /** tool name → name of the (first) mod that requested the block, for status logs. */
  blockedBy: Map<string, string>;
  /** toolset name → name of the (first) mod that requested the attach, for status logs. */
  attachedBy: Map<string, string>;
}

/**
 * Aggregates `MarketModRuntime` fragments declared across every mod attached
 * to `step` (`mod.config?.runtime`). Defensive against malformed/hand-authored
 * data: non-array `blockTools`/`attachTools` and non-object `contract` values
 * are ignored rather than thrown on; only string array entries are kept.
 */
function collectModRuntime(step: AgenticStep): ModRuntimeCollection {
  const blockTools = new Set<string>();
  const attachToolsets = new Set<string>();
  const contracts: StepContract[] = [];
  const blockedBy = new Map<string, string>();
  const attachedBy = new Map<string, string>();

  for (const mod of step.mods) {
    const runtime = mod.config?.runtime;
    if (!isPlainObject(runtime)) continue;

    for (const toolName of toStringArray(runtime.blockTools)) {
      blockTools.add(toolName);
      if (!blockedBy.has(toolName)) blockedBy.set(toolName, mod.name);
    }

    for (const toolset of toStringArray(runtime.attachTools)) {
      attachToolsets.add(toolset);
      if (!attachedBy.has(toolset)) attachedBy.set(toolset, mod.name);
    }

    if (isPlainObject(runtime.contract)) {
      contracts.push(runtime.contract as unknown as StepContract);
    }
  }

  return { blockTools, attachToolsets, contracts, blockedBy, attachedBy };
}

/** Per-instance WS2 routing decision, computed by the scheduler and threaded into `executeStep`. */
interface StepRouting {
  modelId?: string;
  evidence?: RoutedModelEvidence;
}

async function executeStep(
  flow: AgenticFlow,
  step: AgenticStep,
  options: ExecuteAgenticFlowOptions,
  effectiveRootDir: string,
  instance?: StepInstance,
  routing?: StepRouting,
  sealedIds?: Set<string>,
  runContext?: FeedbackRunContext,
): Promise<LLMStepResult> {
  // Loop-body progress, if this instance is a pass of a loop body. Kept as a
  // plain object (not spread further here) so Phase 3 can layer modelId /
  // modelEvidence onto the same `emit` calls without touching every call site.
  const loopMeta: StepStatusMeta | undefined = instance?.loop
    ? { iteration: instance.iteration, totalIterations: instance.loop.totalIterations, loopId: instance.loop.id }
    : undefined;
  const emit = (status: 'running' | 'completed' | 'error', logs?: string): void =>
    emitStepStatus(flow.id, step.id, status, logs, loopMeta);

  emit('running', `Step "${step.id}" started.`);

  // ---------------------------------------------------------------------------
  // Retriever branch — ADDITIVE: does NOT replace or break existing paths
  // ---------------------------------------------------------------------------
  if (step.type === 'retriever') {
    const k = options.retrieverK ?? 5;
    const { chunks } = await retrieve(
      step.prompt,
      k,
      options.vectorStore,
      options.embedFn,
    );

    // Build a context that surfaces the retrieved chunks via <retrieved_context>
    // so downstream steps in the DAG see them as mental context.
    const context = await buildStepContext(step, {
      onModStatus: (mod, status, logs) => emitModStatus(flow.id, step.id, mod, status, logs),
      injectedChunks: chunks,
    });

    // Emit retrieved context as plain text output — downstream steps read it
    // from stepOutputs, and it is captured by the checkpoint below.
    const resultText = context.userPrompt;
    emit('completed', resultText);
    return { text: resultText, usage: null, toolCalls: [], toolResults: [] };
  }

  // ---------------------------------------------------------------------------
  // Default LLM path
  // ---------------------------------------------------------------------------
  // Feedback mode only (runContext undefined ⇒ flowAwareness undefined ⇒
  // buildStepContext's output is byte-identical to before this feature).
  const flowAwareness = computeFlowAwareness(runContext, instance);
  const context = await buildStepContext(step, {
    onModStatus: (mod, status, logs) => emitModStatus(flow.id, step.id, mod, status, logs),
    ...(flowAwareness ? { flowAwareness } : {}),
  });

  // Declarative mod runtime: aggregate blockTools/attachTools/contract
  // fragments from every mod attached to this step (MarketModRuntime).
  const modRuntime = collectModRuntime(step);
  for (const toolset of modRuntime.attachToolsets) {
    if (!KNOWN_ATTACH_TOOLSETS.has(toolset)) {
      console.warn(
        `[executor] step "${step.id}": mod "${modRuntime.attachedBy.get(toolset) ?? 'unknown'}" `
        + `requested unknown runtime.attachTools toolset "${toolset}" — ignoring.`,
      );
    }
  }

  // Build the base toolset: local FS + optional browser tools. Browser tools
  // are granted either the legacy way (a `web-browser` mod attached) or
  // declaratively via a mod's `runtime.attachTools: ['web-browser']`.
  const baseTools = {
    ...createLocalMcpToolSet({
      rootDir: options.rootDir,
      fileSystem: options.fileSystem,
      telemetrySink: options.telemetrySink,
      antiVerificationInterceptor: hasAntiVerificationInterceptor(step),
    }),
    ...(hasWebBrowserMod(step) || modRuntime.attachToolsets.has('web-browser') ? createBrowserToolSet() : {}),
  };

  // ADDITIVE: detect and connect any MCP tool-provider mod; merge its tools.
  // Connections are always closed in the finally block below — no leaks.
  const mcpModToolSet = await getMcpClientModToolSet(step);
  const tools = { ...baseTools, ...(mcpModToolSet?.tools ?? {}) };

  // Surface MCP commands the allowlist rejected (mcp-command-policy.ts) on the
  // step's status log — same visible surface as the guardrail warnings below —
  // instead of silently running with a degraded toolset.
  for (const blocked of mcpModToolSet?.blockedCommands ?? []) {
    emit('running', `[mcp] ${blocked.message}`);
  }

  // Enforce each mod's `runtime.blockTools` by removing the named tool from
  // the surface the model actually sees — the engine enforces it instead of
  // trusting the prompt (e.g. `dry-run` blocking `write_file`).
  for (const toolName of modRuntime.blockTools) {
    if (toolName in tools) {
      delete tools[toolName];
      const modName = modRuntime.blockedBy.get(toolName) ?? 'unknown mod';
      emit('running', `[mods] tool "${toolName}" blocked by mod "${modName}".`);
    }
  }

  const runStep = options.runStep ?? runLLMStep;
  // WS2: the effective model for this step (precedence step manual > router >
  // flow modelId/env default was already applied by the scheduler when it
  // built `routing`) — recomputed here from the same inputs so this function
  // stays a plain, explicit-args function rather than needing executeStep to
  // return the value back out to the scheduler.
  const effectiveModelId = routing?.modelId ?? options.modelId;

  // ── Model-agnostic guardrail: verify a step's completion contract and re-run
  // it with concrete corrective feedback until it passes or the budget is spent.
  // Steps without a `contract` (own, mod-contributed, or feedback-mode
  // context-derived) keep the original single-pass behaviour exactly.
  //
  // Feedback mode additionally composes a requiredArtifacts fragment from
  // this instance's promised writesTo (computeContextContract) — this is the
  // ONLY way a step with no `contract` of its own can still have
  // guardrailActive become true, and only ever in feedback mode.
  const contextContract = computeContextContract(runContext, instance);
  const contract = mergeStepContracts(
    step.contract,
    contextContract ? [...modRuntime.contracts, contextContract] : modRuntime.contracts,
  );
  // Plumbing fix (spec "Notas de implementación" — "Guardrail fuera del PF"):
  // guardrailActive requires options.fileSystem, which NO production surface
  // (IDE/serve/webhook/mcp) ever passes — only the PF sandbox does. Solely in
  // feedback mode, when options.fileSystem is absent, fall back to the
  // real-FS adapter (+ the materialized effective rootDir, fixing
  // snapshotWorkspace's independent '/workspace' default disagreeing with the
  // model's own FS tools) so a promised-briefing guardrail can actually
  // activate on every surface, not just the PF sandbox. In blind mode this
  // expression is UNCHANGED — `runContext` is always undefined there, so both
  // operands fall through to exactly what they evaluated to before this
  // feature existed.
  const effectiveGuardrailFileSystem = runContext ? runContext.fileSystem : options.fileSystem;
  const effectiveGuardrailRootDir = runContext ? effectiveRootDir : options.rootDir;
  const guardrailActive = Boolean(contract) && Boolean(effectiveGuardrailFileSystem);
  const maxAttempts = guardrailActive
    ? Math.max(1, contract!.maxAttempts ?? options.guardrailMaxAttempts ?? DEFAULT_GUARDRAIL_MAX_ATTEMPTS)
    : 1;
  const vfsBefore = guardrailActive ? await snapshotWorkspace(effectiveGuardrailFileSystem, effectiveGuardrailRootDir) : {};

  try {
    let result!: LLMStepResult;
    let corrective = '';
    let prevFindingSignature = '';

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      result = await runStep({
        flowId: flow.id,
        step,
        systemPrompt: context.systemPrompt,
        userPrompt: corrective ? `${context.userPrompt}\n${corrective}` : context.userPrompt,
        tools,
        modelId: effectiveModelId,
        resolveConnection: options.resolveConnection,
        timeoutMs: options.timeoutMs,
        onTelemetry: (event) => options.onLLMStepTelemetry?.({
          ...event,
          flowId: flow.id,
          stepId: step.id,
        }),
        onDelta: (d) => harnessEventBus.emitHarnessEvent({
          type: 'StepThinkingDelta',
          flowId: flow.id,
          stepId: step.id,
          kind: d.kind,
          delta: d.delta,
          timestamp: now(),
        }),
      });

      if (!guardrailActive) break;

      const vfsAfter = await snapshotWorkspace(effectiveGuardrailFileSystem, effectiveGuardrailRootDir);
      const findings = verifyStepContract(contract!, vfsBefore, vfsAfter);
      if (findings.length === 0) {
        if (attempt > 1) {
          emit('running', `[guardrail] step "${step.id}" satisfied its contract on attempt ${attempt}/${maxAttempts}.`);
        }
        break;
      }

      const summary = findings.map((finding) => finding.requirement).join(', ');
      const signature = findings.map((finding) => finding.requirement).sort().join('|');
      const stalled = signature === prevFindingSignature; // identical gaps as last attempt → no progress
      prevFindingSignature = signature;

      // Never surrender early on a stall: escalate the corrective feedback and
      // keep retrying — a weaker model gets a blunter instruction instead of the
      // loop giving up with attempts still on the table. Only true exhaustion
      // (attempt === maxAttempts) ends the loop.
      if (attempt < maxAttempts) {
        corrective = buildCorrectivePrompt(findings, { escalate: stalled });
        emit('running', `[guardrail] step "${step.id}" attempt ${attempt}/${maxAttempts} unmet (${summary})${stalled ? ' — escalating' : ''}; retrying.`);
        console.warn(`[guardrail] step "${step.id}" attempt ${attempt}/${maxAttempts} unmet: ${summary}`);
        continue;
      }

      // attempt === maxAttempts → truly exhausted. Surface the breach and, for
      // a hard invariant (haltOnBreach), halt the flow instead of continuing
      // to build on a broken foundation.
      emit('running', `[guardrail] step "${step.id}" BREACHED contract after ${maxAttempts} attempts (${summary}).`);
      console.warn(`[guardrail] step "${step.id}" BREACHED contract after ${maxAttempts} attempts: ${findings.map((finding) => finding.detail).join(' | ')}`);
      if (contract!.haltOnBreach) {
        throw new Error(`Step "${step.id}" breached a hard invariant after ${maxAttempts} attempts: ${findings.map((finding) => finding.detail).join(' | ')}`);
      }
      break;
    }

    // WS2: attach model routing evidence to the completed event. `evidence`
    // is only ever defined when routing actually happened (manual override or
    // a router decision) — an unrouted step (fixed policy, no override) keeps
    // `evidence` undefined and so emits no model meta at all, byte-identical
    // to the pre-Phase-3a engine.
    const respondedModel = result.respondedModelId;
    const finalModelId = respondedModel ?? effectiveModelId;
    let evidence = routing?.evidence;
    if (evidence?.source === 'external-router') {
      // The auto-router's pick (`openrouter/auto`) isn't itself a real model —
      // attribute + re-seal against whatever the provider actually served.
      evidence = respondedModel
        ? { ...evidence, reason: `OpenRouter auto-router served ${respondedModel}`, sealed: isSealed(respondedModel, sealedIds ?? new Set()) }
        : { ...evidence, reason: 'OpenRouter auto-router served an unattributed model (no model metadata returned)' };
    }

    emitStepStatus(flow.id, step.id, 'completed', result.text, {
      ...loopMeta,
      ...(finalModelId ? { modelId: finalModelId } : {}),
      ...(evidence ? { modelEvidence: evidence } : {}),
    });
    return result;
  } finally {
    // Close MCP connections after every step (success or failure).
    await mcpModToolSet?.close();
  }
}

/** Capa-1 phase exit-gate + boundary-marker bookkeeping, computed once per run (spec §5.1-5.2). */
interface PhaseRuntimeState {
  phase: AgenticPhase;
  /** Counts down from this phase's total instance count to 0 at its last completed instance. */
  remainingInstances: number;
  /** Set once, the first time any instance of this phase is about to run — the phase's lazy `before` snapshot. */
  before?: Record<string, string>;
  /** Whether the 'start' boundary has already been attached to a checkpoint. */
  startAttached: boolean;
}

/**
 * Builds a stepId -> PhaseRuntimeState map (membership is disjoint per
 * validateFlow, so this is a safe 1:1 lookup) and each phase's expected
 * instance count from the ALREADY-EXPANDED plan — reads loop-plan.ts's
 * output, never touches loop-plan.ts itself. That is what makes "evaluate the
 * gate once, at the phase's LAST instance" correct for a phase spanning a
 * loop body: the count is of instances, not of steps.
 */
function buildPhaseRuntimeState(flow: AgenticFlow, plan: ExecutionPlan): Map<string, PhaseRuntimeState> {
  const phaseByStepId = new Map<string, PhaseRuntimeState>();
  for (const phase of flow.phases ?? []) {
    const memberIds = new Set(phase.stepIds);
    let total = 0;
    for (const instance of plan.instances.values()) {
      if (memberIds.has(instance.stepId)) total += 1;
    }
    const state: PhaseRuntimeState = { phase, remainingInstances: total, startAttached: false };
    for (const stepId of phase.stepIds) phaseByStepId.set(stepId, state);
  }
  return phaseByStepId;
}

export async function executeAgenticFlow(
  flow: AgenticFlow,
  options: ExecuteAgenticFlowOptions = {},
): Promise<void> {
  let activeStepId = flow.rootStepId;
  let activeInstance: StepInstance | undefined;

  try {
    validateFlow(flow);
    // The plan expands `flow` into one `StepInstance` per pass of every step
    // (loop bodies get `maxIterations` passes; every other step gets exactly
    // one) and pre-wires a Kahn-ready instance graph — see loop-plan.ts. A
    // loop-free flow expands to exactly one instance per step with the same
    // in-degrees the legacy counters produced, so this scheduler is a
    // structural superset of the pre-loop implementation, not a fork of it.
    const plan = buildExecutionPlan(flow);
    const completedInstanceKeys = new Set<string>();
    const queuedInstanceKeys = new Set<string>(plan.readyKeys);
    const completedStepIds = new Set<string>(); // unique real ids — checkpoint/FlowCompleted payloads (unchanged shape)
    const stepOutputs: Record<string, string> = {};
    const readyQueue = [...plan.readyKeys];
    const remaining = new Map(plan.remainingDeps);
    const runId = options.runId ?? `${flow.id}_${now()}`;

    // ── Rosetta context genesis (feedback mode only) ───────────────────────
    // Materialized ONCE, regardless of mode — pure/side-effect-free, so
    // computing it costs blind runs nothing observable. Actually CONSUMED
    // (génesis I/O, guardrail fallback, checkpoint reads) only when
    // `runContext` below is defined, i.e. only in feedback mode — a blind run
    // creates no directory, no manifest, and injects zero prompt bytes (spec
    // criterion 1: byte-identical to today).
    const effectiveRootDir = resolveEffectiveRootDir(options.rootDir);
    let runContext: FeedbackRunContext | undefined;
    if (flow.contextMode === 'feedback') {
      const contextManifest = buildContextManifest(flow, plan, runId, DEFAULT_CONTEXT_BUDGET_BYTES);
      const topologyLines = buildTopologySummaryLines(flow, plan);
      const seeds = seedContextFiles(contextManifest);
      const fileSystem = options.fileSystem ?? realFileSystemAdapter;
      const runDir = contextRunDir(effectiveRootDir, runId);

      await fileSystem.mkdir(runDir, { recursive: true });
      await fileSystem.writeFile(`${runDir}/manifest.json`, JSON.stringify(contextManifest, null, 2), 'utf-8');
      for (const [filename, content] of Object.entries(seeds)) {
        await fileSystem.writeFile(`${runDir}/${filename}`, content, 'utf-8');
      }

      runContext = { manifest: contextManifest, runId, runDir, topologyLines, seeds, fileSystem };
    }

    harnessEventBus.emitHarnessEvent({
      type: 'FlowStarted',
      flowId: flow.id,
      timestamp: now(),
    });

    // ── WS2 smart routing setup (once per flow run) ────────────────────────
    // `router` stays null under a fixed/no policy — every per-instance routing
    // computation below then short-circuits to an empty `routing`, so behavior
    // is byte-identical to the pre-Phase-3a engine. `sealedIds` is computed
    // unconditionally (cheap, fail-open) because it backs two independent
    // things regardless of policy: sealing a manual step.model override's
    // evidence, and re-sealing whatever model OpenRouter's auto-router
    // actually served.
    const router = options.modelPolicy ? createModelRouter(options.modelPolicy, options.modelRouterDeps) : null;
    const leaderboardLoader = options.modelRouterDeps?.getLeaderboard ?? loadDefaultLeaderboard;
    let leaderboardEntries: ArenaLeaderboardEntry[];
    try {
      leaderboardEntries = await leaderboardLoader();
    } catch {
      leaderboardEntries = [];
    }
    const sealedIds = new Set(
      leaderboardEntries.filter((entry) => entry.status === 'completed').map((entry) => entry.modelId),
    );

    const phaseByStepId = buildPhaseRuntimeState(flow, plan);

    while (readyQueue.length > 0) {
      const key = readyQueue.shift()!;
      if (completedInstanceKeys.has(key)) continue;

      const instance = plan.instances.get(key)!;
      activeInstance = instance;
      activeStepId = instance.stepId;
      const step = getStep(flow, instance.stepId);

      // ── WS2 per-instance routing (precedence: step manual override > router > flow modelId/env default) ──
      let routing: StepRouting = {};
      if (step.model) {
        routing = {
          modelId: step.model,
          evidence: {
            source: 'fallback',
            reason: 'manual per-step model override',
            sealed: isSealed(step.model, sealedIds),
          },
        };
      } else if (router) {
        const decision = await router.resolve(step, { flowModelId: options.modelId });
        if (decision) routing = { modelId: decision.modelId, evidence: decision.evidence };
      }
      const effectiveModelId = routing.modelId ?? options.modelId;

      // Lazy `before` snapshot for this instance's phase (spec §5.1) — taken
      // once, the first time the executor is ABOUT to run any instance in the
      // phase, and only when the phase actually declares an exitContract. A
      // phase without one costs exactly zero extra snapshots.
      const phaseState = phaseByStepId.get(instance.stepId);
      if (phaseState?.phase.exitContract && phaseState.before === undefined) {
        const gateFileSystem = runContext ? runContext.fileSystem : options.fileSystem;
        const gateRootDir = runContext ? effectiveRootDir : options.rootDir;
        // Mirrors executeStep's own `guardrailActive = Boolean(contract) &&
        // Boolean(effectiveGuardrailFileSystem)` gate for the PER-STEP
        // contract: without a fileSystem there is nothing to snapshot. See the
        // after-snapshot block below for why this guard is load-bearing.
        if (gateFileSystem) {
          phaseState.before = await snapshotWorkspace(gateFileSystem, gateRootDir);
        }
      }

      const result = await executeStep(flow, step, options, effectiveRootDir, instance, routing, sealedIds, runContext);
      stepOutputs[instance.stepId] = result.text; // final pass wins
      completedInstanceKeys.add(key);
      completedStepIds.add(instance.stepId);

      // Phase exit gate + boundary marker (spec §5.1-5.2). The gate is
      // evaluated EXACTLY ONCE, when the phase's last instance completes —
      // `remainingInstances` counts plan INSTANCES, so a phase spanning a
      // loop body fires after the loop's final pass, not on every iteration.
      let phaseBoundary: PhaseBoundaryMarker | undefined;
      if (phaseState) {
        const boundaries: Array<'start' | 'end'> = [];
        if (!phaseState.startAttached) {
          phaseState.startAttached = true;
          boundaries.push('start');
        }
        phaseState.remainingInstances -= 1;
        if (phaseState.remainingInstances === 0) {
          boundaries.push('end');
          if (phaseState.phase.exitContract) {
            const gateFileSystem = runContext ? runContext.fileSystem : options.fileSystem;
            const gateRootDir = runContext ? effectiveRootDir : options.rootDir;
            // CRITICAL: this guard is not optional. Without it, a run with no
            // fileSystem would call verifyStepContract(exitContract, {}, {}) —
            // empty-vs-empty means zero changed files, which trips
            // `mustWriteFiles` as a FALSE-POSITIVE breach. Same limitation a
            // per-step contract already has, for the same reason.
            if (gateFileSystem) {
              const after = await snapshotWorkspace(gateFileSystem, gateRootDir);
              const findings = verifyStepContract(phaseState.phase.exitContract, phaseState.before ?? {}, after);
              if (findings.length > 0) {
                // Throws BEFORE saveCheckpoint below is reached, so the
                // breaching instance persists no checkpoint — exactly what
                // already happens for an uncaught step error. Intentional:
                // do not "fix" it by moving the checkpoint save earlier.
                // `exitContract.maxAttempts` is inherited from StepContract's
                // shape and deliberately ignored — the gate never retries.
                throw new Error(
                  `Phase "${phaseState.phase.name}" breached its exit contract: ${findings.map((f) => f.detail).join(' | ')}`,
                );
              }
            }
          }
        }
        phaseBoundary = { phaseId: phaseState.phase.id, phaseName: phaseState.phase.name, boundaries };
      }

      // Feedback mode only: re-read this instance's own assigned context file
      // so the checkpoint can carry a contextFileSnapshot (path + content).
      // Never throws — a read failure is logged and simply omits the field,
      // since this is supplementary telemetry, not core execution state.
      const contextFileSnapshot = runContext ? await readContextFileSnapshot(runContext, instance) : undefined;

      // Persist an immutable checkpoint capturing state-so-far — one per
      // instance, i.e. one per iteration for a step inside a loop body.
      // `iteration` is attached only when this instance is a pass of a loop
      // body (same `instance.loop` truthiness check `loopMeta` above uses),
      // so a loop's 3 checkpoints for the same real stepId carry 1, 2, 3 and
      // the time-travel panel can tell them apart. Conditional spread keeps
      // the field entirely absent — never `iteration: undefined` — for the
      // first/only pass of a non-loop step. `contextFileSnapshot` follows the
      // exact same discipline for blind-mode runs (always absent there).
      const checkpoint = saveCheckpoint({
        runId,
        stepId: instance.stepId,
        ...(instance.loop ? { iteration: instance.iteration } : {}),
        inputContext: `${step.prompt ?? ''}`,
        output: result.text,
        completedStepIds: [...completedStepIds],
        modelId: effectiveModelId,
        ...(contextFileSnapshot ? { contextFileSnapshot } : {}),
        ...(phaseBoundary ? { phaseBoundary } : {}),
      });
      harnessEventBus.emitHarnessEvent({
        type: 'CheckpointCreated',
        flowId: flow.id,
        checkpointId: checkpoint.id,
        stepId: instance.stepId,
        completedStepIds: [...completedStepIds],
        timestamp: checkpoint.timestamp,
      });

      const newlyReady: string[] = [];
      for (const nextKey of plan.nextKeys.get(key) ?? []) {
        const nextRemaining = (remaining.get(nextKey) ?? 0) - 1;
        remaining.set(nextKey, nextRemaining);

        if (nextRemaining === 0 && !queuedInstanceKeys.has(nextKey)) {
          queuedInstanceKeys.add(nextKey);
          newlyReady.push(nextKey);
        }
      }
      // Determinism: newly-ready instances are pushed in (stepId, iteration)
      // order, same tie-break the plan uses to seed `readyKeys`.
      newlyReady.sort((a, b) => {
        const instanceA = plan.instances.get(a)!;
        const instanceB = plan.instances.get(b)!;
        return instanceA.stepId === instanceB.stepId
          ? instanceA.iteration - instanceB.iteration
          : instanceA.stepId.localeCompare(instanceB.stepId);
      });
      readyQueue.push(...newlyReady);
    }

    harnessEventBus.emitHarnessEvent({
      type: 'FlowCompleted',
      flowId: flow.id,
      timestamp: now(),
      finalOutput: {
        completedStepIds: [...completedStepIds],
        completedStepCount: completedStepIds.size,
        stepOutputs,
      },
    });
  } catch (error) {
    const errorMeta: StepStatusMeta | undefined = activeInstance?.loop
      ? { iteration: activeInstance.iteration, totalIterations: activeInstance.loop.totalIterations, loopId: activeInstance.loop.id }
      : undefined;
    emitStepStatus(flow.id, activeStepId, 'error', getErrorMessage(error), errorMeta);
    throw error;
  }
}
