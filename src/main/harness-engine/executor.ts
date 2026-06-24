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
import { runLLMStep, type LLMStepResult, type RunLLMStepInput } from './llm-runner';
import type { LLMStepTelemetryEvent } from '../performance-frontier/telemetry/collector';

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

async function executeStep(
  flow: AgenticFlow,
  step: AgenticStep,
  options: ExecuteAgenticFlowOptions,
): Promise<LLMStepResult> {
  emitStepStatus(flow.id, step.id, 'running', `Step "${step.id}" started.`);

  const context = await buildStepContext(step, {
    onModStatus: (mod, status, logs) => emitModStatus(flow.id, step.id, mod, status, logs),
  });
  const tools = createLocalMcpToolSet({
    rootDir: options.rootDir,
    fileSystem: options.fileSystem,
    telemetrySink: options.telemetrySink,
    antiVerificationInterceptor: hasAntiVerificationInterceptor(step),
  });
  const runStep = options.runStep ?? runLLMStep;
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
  });

  emitStepStatus(flow.id, step.id, 'completed', result.text);
  return result;
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
