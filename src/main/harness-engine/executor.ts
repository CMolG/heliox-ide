/**
 * executor.ts — Agentic flow executor
 *
 * The scheduler preserves DAG dependency semantics while each step delegates to
 * the LLM runner and MCP-backed tool surface.
 */
import type { AgenticFlow, AgenticMod, AgenticStep } from '../../types/harness';
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

  // Build the base toolset: local FS + optional browser tools (unchanged).
  const baseTools = {
    ...createLocalMcpToolSet({
      rootDir: options.rootDir,
      fileSystem: options.fileSystem,
      telemetrySink: options.telemetrySink,
      antiVerificationInterceptor: hasAntiVerificationInterceptor(step),
    }),
    ...(hasWebBrowserMod(step) ? createBrowserToolSet() : {}),
  };

  // ADDITIVE: detect and connect any MCP tool-provider mod; merge its tools.
  // Connections are always closed in the finally block below — no leaks.
  const mcpModToolSet = await getMcpClientModToolSet(step);
  const tools = { ...baseTools, ...(mcpModToolSet?.tools ?? {}) };

  const runStep = options.runStep ?? runLLMStep;

  try {
    const result = await runStep({
      flowId: flow.id,
      step,
      systemPrompt: context.systemPrompt,
      userPrompt: context.userPrompt,
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
