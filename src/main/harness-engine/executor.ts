/**
 * executor.ts — Agentic flow executor
 *
 * The scheduler preserves DAG dependency semantics while each step delegates to
 * the LLM runner and MCP-backed tool surface.
 */
import type { AgenticFlow, AgenticMod, AgenticStep, StepContract } from '../../types/harness';
import { harnessEventBus } from './event-bus';
import { buildStepContext } from './context-builder';
import { createLocalMcpToolSet, type LocalMcpOptions } from './mcp-adapter';
import { getMcpClientModToolSet } from './mcp-client-mod';
import { createBrowserToolSet } from './browser-toolset';
import { runLLMStep, type LLMStepResult, type RunLLMStepInput } from './llm-runner';
import type { LLMStepTelemetryEvent } from '../performance-frontier/telemetry/collector';
import { saveCheckpoint } from './checkpoints';
import { retrieve, type EmbedFn } from './retriever';
import type { VectorStore } from './knowledge/vector-store';
import {
  snapshotWorkspace,
  verifyStepContract,
  buildCorrectivePrompt,
  mergeStepContracts,
  DEFAULT_GUARDRAIL_MAX_ATTEMPTS,
} from './guardrails';

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
   * (default: DEFAULT_GUARDRAIL_MAX_ATTEMPTS / HELIOX_GUARDRAIL_MAX_ATTEMPTS).
   */
  guardrailMaxAttempts?: number;
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

  return flow.stepsRecord[flow.rootStepId];
}

function createDependencyCounters(flow: AgenticFlow): Map<string, number> {
  const remainingDependencies = new Map<string, number>();
  for (const step of Object.values(flow.stepsRecord)) {
    remainingDependencies.set(step.id, step.prevStepIds.length);
  }
  return remainingDependencies;
}

function emitStepStatus(
  flowId: string,
  stepId: string,
  status: 'running' | 'completed' | 'error',
  logs?: string,
): void {
  harnessEventBus.emitHarnessEvent({
    type: 'StepStatusChanged',
    flowId,
    stepId,
    status,
    timestamp: now(),
    ...(logs ? { logs } : {}),
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

async function executeStep(
  flow: AgenticFlow,
  step: AgenticStep,
  options: ExecuteAgenticFlowOptions,
): Promise<LLMStepResult> {
  emitStepStatus(flow.id, step.id, 'running', `Step "${step.id}" started.`);

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
    emitStepStatus(flow.id, step.id, 'completed', resultText);
    return { text: resultText, usage: null, toolCalls: [], toolResults: [] };
  }

  // ---------------------------------------------------------------------------
  // Default LLM path (unchanged)
  // ---------------------------------------------------------------------------
  const context = await buildStepContext(step, {
    onModStatus: (mod, status, logs) => emitModStatus(flow.id, step.id, mod, status, logs),
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
    emitStepStatus(flow.id, step.id, 'running', `[mcp] ${blocked.message}`);
  }

  // Enforce each mod's `runtime.blockTools` by removing the named tool from
  // the surface the model actually sees — the engine enforces it instead of
  // trusting the prompt (e.g. `dry-run` blocking `write_file`).
  for (const toolName of modRuntime.blockTools) {
    if (toolName in tools) {
      delete tools[toolName];
      const modName = modRuntime.blockedBy.get(toolName) ?? 'unknown mod';
      emitStepStatus(flow.id, step.id, 'running', `[mods] tool "${toolName}" blocked by mod "${modName}".`);
    }
  }

  const runStep = options.runStep ?? runLLMStep;

  // ── Model-agnostic guardrail: verify a step's completion contract and re-run
  // it with concrete corrective feedback until it passes or the budget is spent.
  // Steps without a `contract` (own or mod-contributed) keep the original
  // single-pass behaviour exactly.
  const contract = mergeStepContracts(step.contract, modRuntime.contracts);
  const guardrailActive = Boolean(contract) && Boolean(options.fileSystem);
  const maxAttempts = guardrailActive
    ? Math.max(1, contract!.maxAttempts ?? options.guardrailMaxAttempts ?? DEFAULT_GUARDRAIL_MAX_ATTEMPTS)
    : 1;
  const vfsBefore = guardrailActive ? await snapshotWorkspace(options.fileSystem, options.rootDir) : {};

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
        modelId: options.modelId,
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

      const vfsAfter = await snapshotWorkspace(options.fileSystem, options.rootDir);
      const findings = verifyStepContract(contract!, vfsBefore, vfsAfter);
      if (findings.length === 0) {
        if (attempt > 1) {
          emitStepStatus(flow.id, step.id, 'running', `[guardrail] step "${step.id}" satisfied its contract on attempt ${attempt}/${maxAttempts}.`);
        }
        break;
      }

      const summary = findings.map((finding) => finding.requirement).join(', ');
      const signature = findings.map((finding) => finding.requirement).sort().join('|');
      const stalled = signature === prevFindingSignature; // identical gaps as last attempt → no progress
      prevFindingSignature = signature;

      if (attempt < maxAttempts && !stalled) {
        corrective = buildCorrectivePrompt(findings);
        emitStepStatus(flow.id, step.id, 'running', `[guardrail] attempt ${attempt}/${maxAttempts} breached contract (${summary}); retrying with corrective feedback.`);
        console.warn(`[guardrail] step "${step.id}" attempt ${attempt}/${maxAttempts} unmet: ${summary}`);
        continue;
      }

      // Stop retrying: budget spent, or the model made zero progress versus the
      // previous attempt (re-running would only burn tokens). Surface the breach.
      const reason = stalled && attempt < maxAttempts
        ? `no progress after attempt ${attempt}/${maxAttempts}`
        : `after ${maxAttempts} attempts`;
      emitStepStatus(flow.id, step.id, 'running', `[guardrail] step "${step.id}" breached contract ${reason} (${summary}).`);
      console.warn(`[guardrail] step "${step.id}" BREACHED contract ${reason}: ${findings.map((finding) => finding.detail).join(' | ')}`);
      break;
    }

    emitStepStatus(flow.id, step.id, 'completed', result.text);
    return result;
  } finally {
    // Close MCP connections after every step (success or failure).
    await mcpModToolSet?.close();
  }
}

export async function executeAgenticFlow(
  flow: AgenticFlow,
  options: ExecuteAgenticFlowOptions = {},
): Promise<void> {
  let activeStepId = flow.rootStepId;

  try {
    const rootStep = validateFlow(flow);
    const remainingDependencies = createDependencyCounters(flow);
    const queuedStepIds = new Set<string>([rootStep.id]);
    const completedStepIds = new Set<string>();
    const stepOutputs: Record<string, string> = {};
    const readyQueue = [rootStep.id];
    const runId = options.runId ?? `${flow.id}_${now()}`;

    harnessEventBus.emitHarnessEvent({
      type: 'FlowStarted',
      flowId: flow.id,
      timestamp: now(),
    });

    while (readyQueue.length > 0) {
      const stepId = readyQueue.shift()!;
      if (completedStepIds.has(stepId)) continue;

      activeStepId = stepId;
      const step = getStep(flow, stepId);
      const result = await executeStep(flow, step, options);
      stepOutputs[stepId] = result.text;
      completedStepIds.add(stepId);

      // Persist an immutable checkpoint capturing state-so-far.
      const checkpoint = saveCheckpoint({
        runId,
        stepId,
        inputContext: `${step.prompt ?? ''}`,
        output: result.text,
        completedStepIds: [...completedStepIds],
        modelId: options.modelId,
      });
      harnessEventBus.emitHarnessEvent({
        type: 'CheckpointCreated',
        flowId: flow.id,
        checkpointId: checkpoint.id,
        stepId,
        completedStepIds: [...completedStepIds],
        timestamp: checkpoint.timestamp,
      });

      for (const nextStepId of step.nextStepIds) {
        const remaining = (remainingDependencies.get(nextStepId) ?? 0) - 1;
        remainingDependencies.set(nextStepId, remaining);

        if (remaining === 0 && !queuedStepIds.has(nextStepId)) {
          queuedStepIds.add(nextStepId);
          readyQueue.push(nextStepId);
        }
      }
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
    emitStepStatus(flow.id, activeStepId, 'error', getErrorMessage(error));
    throw error;
  }
}
