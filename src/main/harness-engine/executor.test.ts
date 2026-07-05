import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgenticFlow, AgenticStep } from '@/types/harness';
import type { HarnessEventPayload } from '@/types/ipc-events';
import type { McpFileSystem } from './mcp-adapter';
import {
  HARNESS_EVENT_CHANNEL,
  HARNESS_EVENT_NAME,
  harnessEventBus,
  setHarnessEventWindow,
} from './event-bus';
import { executeAgenticFlow } from './executor';
import { listCheckpoints } from './checkpoints';

function makeStep(
  id: string,
  prevStepIds: string[],
  nextStepIds: string[],
  mods: AgenticStep['mods'] = [],
): AgenticStep {
  return {
    id,
    type: 'llm_call',
    prompt: `Prompt for ${id}`,
    tools: [],
    prevStepIds,
    nextStepIds,
    mods,
    roles: [],
    mentalContext: [],
  };
}

function makeFlow(
  stepsRecord: Record<string, AgenticStep> = {
    root: makeStep('root', [], ['branch-a', 'branch-b']),
    'branch-a': makeStep('branch-a', ['root'], ['merge'], [
      { id: 'mod-a', name: 'Mod A', type: 'system_override' },
    ]),
    'branch-b': makeStep('branch-b', ['root'], ['merge'], [
      { id: 'mod-b', name: 'Mod B', type: 'system_override' },
    ]),
    merge: makeStep('merge', ['branch-a', 'branch-b'], []),
  },
  rootStepId = 'root',
  loops?: AgenticFlow['loops'],
): AgenticFlow {
  return {
    id: 'flow-converged',
    name: 'Converged DAG',
    rootStepId,
    stepsRecord,
    ...(loops ? { loops } : {}),
  };
}

describe('harness event bus', () => {
  afterEach(() => {
    setHarnessEventWindow(null);
    harnessEventBus.removeAllListeners();
  });

  it('routes harness payloads to Electron and local listeners', () => {
    const payload: HarnessEventPayload = {
      type: 'FlowStarted',
      flowId: 'flow-1',
      timestamp: 10,
    };
    const send = vi.fn();
    const observed: HarnessEventPayload[] = [];

    setHarnessEventWindow({ webContents: { send } } as any);
    harnessEventBus.on(HARNESS_EVENT_NAME, (event) => observed.push(event));

    harnessEventBus.emitHarnessEvent(payload);

    expect(send).toHaveBeenCalledWith(HARNESS_EVENT_CHANNEL, payload);
    expect(observed).toEqual([payload]);
  });
});

describe('executeAgenticFlow', () => {
  afterEach(() => {
    harnessEventBus.removeAllListeners();
  });

  it('waits for all previous steps before running a converged next step', async () => {
    const events: HarnessEventPayload[] = [];
    harnessEventBus.on(HARNESS_EVENT_NAME, (event) => events.push(event));
    const runStep = vi.fn(async ({ step }: { step: AgenticStep }) => ({
      text: `output:${step.id}`,
      usage: null,
      toolCalls: [],
      toolResults: [],
    }));

    await executeAgenticFlow(makeFlow(), { runStep });

    const stepEvents = events.filter(
      (event): event is Extract<HarnessEventPayload, { type: 'StepStatusChanged' }> =>
        event.type === 'StepStatusChanged',
    );
    const runningSteps = stepEvents
      .filter((event) => event.status === 'running')
      .map((event) => event.stepId);

    expect(runningSteps).toEqual(['root', 'branch-a', 'branch-b', 'merge']);

    const mergeRunningIndex = stepEvents.findIndex(
      (event) => event.stepId === 'merge' && event.status === 'running',
    );
    const branchACompletedIndex = stepEvents.findIndex(
      (event) => event.stepId === 'branch-a' && event.status === 'completed',
    );
    const branchBCompletedIndex = stepEvents.findIndex(
      (event) => event.stepId === 'branch-b' && event.status === 'completed',
    );

    expect(mergeRunningIndex).toBeGreaterThan(branchACompletedIndex);
    expect(mergeRunningIndex).toBeGreaterThan(branchBCompletedIndex);
    expect(events.at(-1)).toMatchObject({
      type: 'FlowCompleted',
      flowId: 'flow-converged',
    });
    expect(runStep).toHaveBeenCalledTimes(4);
    expect(stepEvents.find((event) => event.stepId === 'root' && event.status === 'completed')?.logs)
      .toContain('output:root');
  });

  it('emits a step error when the LLM runner fails', async () => {
    const events: HarnessEventPayload[] = [];
    harnessEventBus.on(HARNESS_EVENT_NAME, (event) => events.push(event));

    await expect(executeAgenticFlow(makeFlow(), {
      runStep: async ({ step }) => {
        if (step.id === 'branch-a') throw new Error('provider timeout');
        return { text: `output:${step.id}`, usage: null, toolCalls: [], toolResults: [] };
      },
    })).rejects.toThrow('provider timeout');

    expect(events).toContainEqual(expect.objectContaining({
      type: 'StepStatusChanged',
      stepId: 'branch-a',
      status: 'error',
      logs: 'provider timeout',
    }));
  });

  it('passes an injected MCP filesystem through generated step tools', async () => {
    const flow: AgenticFlow = {
      id: 'flow-vfs',
      name: 'VFS Flow',
      rootStepId: 'root',
      stepsRecord: {
        root: makeStep('root', [], []),
      },
    };
    const fileSystem: McpFileSystem = {
      readFile: async () => 'from pf vfs',
      writeFile: async () => undefined,
      mkdir: async () => undefined,
      readdir: async () => ['README.md'],
      stat: async () => ({
        isDirectory: () => false,
        isFile: () => true,
        size: 11,
      }),
    };

    const runStep = vi.fn(async ({ tools }) => {
      const result = await tools.read_file.execute?.(
        { path: 'README.md' },
        { toolCallId: 'tool-1', messages: [] },
      );
      const toolText = String(result?.content[0]?.text ?? '');
      expect(toolText).toContain('from pf vfs');

      return {
        text: toolText,
        usage: null,
        toolCalls: [],
        toolResults: [],
      };
    });

    await executeAgenticFlow(flow, {
      rootDir: '/workspace',
      fileSystem,
      runStep,
    });

    expect(runStep).toHaveBeenCalledTimes(1);
  });

  it('enables anti-verification interception when the step has the mod attached', async () => {
    const root = makeStep('root', [], [], [{
      id: 'anti-verification-interceptor',
      name: 'AntiVerificationInterceptor',
      type: 'system_override',
      config: { intercepts: ['list_directory', 'read_file'] },
    }]);
    const flow: AgenticFlow = {
      id: 'flow-interceptor',
      name: 'Interceptor Flow',
      rootStepId: 'root',
      stepsRecord: { root },
    };
    const calls: string[] = [];
    const fileSystem: McpFileSystem = {
      readFile: async (path: string) => {
        calls.push(`read:${path}`);
        return '';
      },
      writeFile: async (path: string) => {
        calls.push(`write:${path}`);
      },
      mkdir: async (path: string) => {
        calls.push(`mkdir:${path}`);
      },
      readdir: async (path: string) => {
        calls.push(`list:${path}`);
        return [];
      },
      stat: async () => ({
        isDirectory: () => false,
        isFile: () => true,
        size: 0,
      }),
    };

    await executeAgenticFlow(flow, {
      rootDir: '/workspace',
      fileSystem,
      runStep: async ({ tools }) => {
        await tools.write_file.execute?.(
          { path: 'src/server.js', content: 'ok' },
          { toolCallId: 'tool-1', messages: [] },
        );
        const result = await tools.list_directory.execute?.(
          { path: 'src' },
          { toolCallId: 'tool-2', messages: [] },
        );
        expect(String(result?.content[0]?.text ?? '')).toContain('System Mod Interception');
        return { text: 'done', usage: null, toolCalls: [], toolResults: [] };
      },
    });

    expect(calls).toEqual([
      'mkdir:/workspace/src',
      'write:/workspace/src/server.js',
    ]);
  });

  it('strips a tool named in a mod\'s runtime.blockTools from the surface passed to runStep', async () => {
    const events: HarnessEventPayload[] = [];
    harnessEventBus.on(HARNESS_EVENT_NAME, (event) => events.push(event));

    const root = makeStep('root', [], [], [{
      id: 'dry-run',
      name: 'DryRun',
      type: 'pre_process',
      config: { runtime: { blockTools: ['write_file'] } },
    }]);
    const flow: AgenticFlow = {
      id: 'flow-block-tools',
      name: 'Block Tools Flow',
      rootStepId: 'root',
      stepsRecord: { root },
    };
    const fileSystem: McpFileSystem = {
      readFile: async () => 'content',
      writeFile: async () => undefined,
      mkdir: async () => undefined,
      readdir: async () => [],
      stat: async () => ({ isDirectory: () => false, isFile: () => true, size: 0 }),
    };

    const runStep = vi.fn(async ({ tools }: { tools: Record<string, unknown> }) => {
      expect(tools.write_file).toBeUndefined();
      expect(tools.read_file).toBeDefined();
      expect(tools.list_directory).toBeDefined();
      return { text: 'done', usage: null, toolCalls: [], toolResults: [] };
    });

    await executeAgenticFlow(flow, { rootDir: '/workspace', fileSystem, runStep });

    expect(runStep).toHaveBeenCalledTimes(1);
    const stepEvents = events.filter(
      (event): event is Extract<HarnessEventPayload, { type: 'StepStatusChanged' }> =>
        event.type === 'StepStatusChanged',
    );
    expect(stepEvents.some((event) => event.logs?.includes('tool "write_file" blocked by mod "DryRun"'))).toBe(true);
  });

  it('attaches the browser toolset when a mod declares runtime.attachTools: ["web-browser"]', async () => {
    const root = makeStep('root', [], [], [{
      id: 'seo-meta',
      name: 'SeoMeta',
      type: 'pre_process',
      config: { runtime: { attachTools: ['web-browser'] } },
    }]);
    const flow: AgenticFlow = {
      id: 'flow-attach-tools',
      name: 'Attach Tools Flow',
      rootStepId: 'root',
      stepsRecord: { root },
    };

    const runStep = vi.fn(async ({ tools }: { tools: Record<string, unknown> }) => {
      expect(tools.browser_goto).toBeDefined();
      return { text: 'done', usage: null, toolCalls: [], toolResults: [] };
    });

    await executeAgenticFlow(flow, { runStep });

    expect(runStep).toHaveBeenCalledTimes(1);
  });

  it('ignores an unknown runtime.attachTools toolset without crashing', async () => {
    const root = makeStep('root', [], [], [{
      id: 'mystery-mod',
      name: 'MysteryMod',
      type: 'pre_process',
      config: { runtime: { attachTools: ['not-a-real-toolset'] } },
    }]);
    const flow: AgenticFlow = {
      id: 'flow-unknown-attach',
      name: 'Unknown Attach Flow',
      rootStepId: 'root',
      stepsRecord: { root },
    };

    const runStep = vi.fn(async ({ tools }: { tools: Record<string, unknown> }) => {
      expect(tools.browser_goto).toBeUndefined();
      return { text: 'done', usage: null, toolCalls: [], toolResults: [] };
    });

    await expect(executeAgenticFlow(flow, { runStep })).resolves.toBeUndefined();
    expect(runStep).toHaveBeenCalledTimes(1);
  });
});

describe('executeAgenticFlow — bounded loops', () => {
  afterEach(() => {
    harnessEventBus.removeAllListeners();
  });

  function stepEventsOf(events: HarnessEventPayload[]) {
    return events.filter(
      (event): event is Extract<HarnessEventPayload, { type: 'StepStatusChanged' }> =>
        event.type === 'StepStatusChanged',
    );
  }

  it('runs a loop body for its bounded iteration count in the golden completion order', async () => {
    const events: HarnessEventPayload[] = [];
    harnessEventBus.on(HARNESS_EVENT_NAME, (event) => events.push(event));

    const flow = makeFlow(
      {
        root: makeStep('root', [], ['b1']),
        b1: makeStep('b1', ['root'], ['b2']),
        b2: makeStep('b2', ['b1'], ['down']),
        down: makeStep('down', ['b2'], []),
      },
      'root',
      [{ id: 'loop-1', sourceStepId: 'b2', targetStepId: 'b1', maxIterations: 3 }],
    );

    const runOrder: string[] = [];
    const runStep = vi.fn(async ({ step }: { step: AgenticStep }) => {
      runOrder.push(step.id);
      return { text: `output:${step.id}`, usage: null, toolCalls: [], toolResults: [] };
    });

    await executeAgenticFlow(flow, { runStep });

    // Real stepIds behind root@1, b1@1, b2@1, b1@2, b2@2, b1@3, b2@3, down@1.
    expect(runOrder).toEqual(['root', 'b1', 'b2', 'b1', 'b2', 'b1', 'b2', 'down']);
    expect(runStep).toHaveBeenCalledTimes(8);

    const completedOrder = stepEventsOf(events)
      .filter((event) => event.status === 'completed')
      .map((event) => event.stepId);
    expect(completedOrder).toEqual(['root', 'b1', 'b2', 'b1', 'b2', 'b1', 'b2', 'down']);

    // The downstream step runs exactly once, after the loop body finishes.
    expect(completedOrder.filter((stepId) => stepId === 'down')).toHaveLength(1);
  });

  it('tags StepStatusChanged events for loop-body steps with iteration/totalIterations/loopId', async () => {
    const events: HarnessEventPayload[] = [];
    harnessEventBus.on(HARNESS_EVENT_NAME, (event) => events.push(event));

    const flow = makeFlow(
      {
        root: makeStep('root', [], ['b1']),
        b1: makeStep('b1', ['root'], ['b2']),
        b2: makeStep('b2', ['b1'], []),
      },
      'root',
      [{ id: 'loop-1', sourceStepId: 'b2', targetStepId: 'b1', maxIterations: 2 }],
    );

    await executeAgenticFlow(flow, {
      runStep: async ({ step }) => ({ text: `output:${step.id}`, usage: null, toolCalls: [], toolResults: [] }),
    });

    const stepEvents = stepEventsOf(events);

    // 'root' sits outside every loop body — it must carry no loop metadata.
    for (const event of stepEvents.filter((e) => e.stepId === 'root')) {
      expect(event.iteration).toBeUndefined();
      expect(event.totalIterations).toBeUndefined();
      expect(event.loopId).toBeUndefined();
    }

    const b1Completed = stepEvents.filter((e) => e.stepId === 'b1' && e.status === 'completed');
    expect(b1Completed.map((e) => e.iteration)).toEqual([1, 2]);
    for (const event of b1Completed) {
      expect(event.totalIterations).toBe(2);
      expect(event.loopId).toBe('loop-1');
    }

    const b2Completed = stepEvents.filter((e) => e.stepId === 'b2' && e.status === 'completed');
    expect(b2Completed.map((e) => e.iteration)).toEqual([1, 2]);
  });

  it('emits error with the real stepId + loop metadata and halts when a body step throws mid-loop', async () => {
    const events: HarnessEventPayload[] = [];
    harnessEventBus.on(HARNESS_EVENT_NAME, (event) => events.push(event));

    const flow = makeFlow(
      {
        root: makeStep('root', [], ['b1']),
        b1: makeStep('b1', ['root'], ['b2']),
        b2: makeStep('b2', ['b1'], ['down']),
        down: makeStep('down', ['b2'], []),
      },
      'root',
      [{ id: 'loop-1', sourceStepId: 'b2', targetStepId: 'b1', maxIterations: 3 }],
    );

    let b1Calls = 0;
    await expect(executeAgenticFlow(flow, {
      runStep: async ({ step }) => {
        if (step.id === 'b1') {
          b1Calls += 1;
          if (b1Calls === 2) throw new Error('body step exploded');
        }
        return { text: `output:${step.id}`, usage: null, toolCalls: [], toolResults: [] };
      },
    })).rejects.toThrow('body step exploded');

    expect(b1Calls).toBe(2); // the 3rd pass never starts

    expect(events).toContainEqual(expect.objectContaining({
      type: 'StepStatusChanged',
      stepId: 'b1',
      status: 'error',
      logs: 'body step exploded',
      iteration: 2,
      totalIterations: 3,
      loopId: 'loop-1',
    }));

    // The flow halted — 'down' never even started.
    expect(stepEventsOf(events).some((event) => event.stepId === 'down')).toBe(false);
  });

  it('records the final pass of a loop-body step as its stepOutputs entry', async () => {
    const events: HarnessEventPayload[] = [];
    harnessEventBus.on(HARNESS_EVENT_NAME, (event) => events.push(event));

    const flow = makeFlow(
      {
        root: makeStep('root', [], ['b1']),
        b1: makeStep('b1', ['root'], ['b2']),
        b2: makeStep('b2', ['b1'], []),
      },
      'root',
      [{ id: 'loop-1', sourceStepId: 'b2', targetStepId: 'b1', maxIterations: 3 }],
    );

    let b1Pass = 0;
    await executeAgenticFlow(flow, {
      runStep: async ({ step }) => {
        if (step.id === 'b1') {
          b1Pass += 1;
          return { text: `b1-pass-${b1Pass}`, usage: null, toolCalls: [], toolResults: [] };
        }
        return { text: `output:${step.id}`, usage: null, toolCalls: [], toolResults: [] };
      },
    });

    const completedEvent = events.find(
      (event): event is Extract<HarnessEventPayload, { type: 'FlowCompleted' }> => event.type === 'FlowCompleted',
    );
    const finalOutput = completedEvent?.finalOutput as { stepOutputs: Record<string, string> };
    expect(finalOutput.stepOutputs.b1).toBe('b1-pass-3'); // the final pass wins, not the first
  });

  it('a loop-free flow never attaches loop metadata to StepStatusChanged events (structural parity)', async () => {
    const events: HarnessEventPayload[] = [];
    harnessEventBus.on(HARNESS_EVENT_NAME, (event) => events.push(event));

    await executeAgenticFlow(makeFlow(), {
      runStep: async ({ step }) => ({ text: `output:${step.id}`, usage: null, toolCalls: [], toolResults: [] }),
    });

    const stepEvents = stepEventsOf(events);
    expect(stepEvents.length).toBeGreaterThan(0);
    for (const event of stepEvents) {
      expect('iteration' in event).toBe(false);
      expect('totalIterations' in event).toBe(false);
      expect('loopId' in event).toBe(false);
    }
  });

  it('tags each loop-body checkpoint with its 1-based pass number; non-loop steps get no iteration key', async () => {
    const flow = makeFlow(
      {
        root: makeStep('root', [], ['b1']),
        b1: makeStep('b1', ['root'], ['b2']),
        b2: makeStep('b2', ['b1'], ['down']),
        down: makeStep('down', ['b2'], []),
      },
      'root',
      [{ id: 'loop-1', sourceStepId: 'b2', targetStepId: 'b1', maxIterations: 3 }],
    );

    // Explicit runId so this test's checkpoints can't collide with any other
    // test sharing the module-level in-memory checkpoint store.
    const runId = 'run-checkpoint-iteration-marker';
    await executeAgenticFlow(flow, {
      runId,
      runStep: async ({ step }) => ({ text: `output:${step.id}`, usage: null, toolCalls: [], toolResults: [] }),
    });

    const checkpoints = listCheckpoints(runId);

    // b1 and b2 sit inside the loop body — one checkpoint per pass, each
    // stamped with its own 1-based iteration, oldest (pass 1) first.
    const b1Checkpoints = checkpoints.filter((c) => c.stepId === 'b1');
    expect(b1Checkpoints.map((c) => c.iteration)).toEqual([1, 2, 3]);

    const b2Checkpoints = checkpoints.filter((c) => c.stepId === 'b2');
    expect(b2Checkpoints.map((c) => c.iteration)).toEqual([1, 2, 3]);

    // root (pre-loop) and down (post-loop) sit outside every loop body — the
    // field must be entirely absent, not just `undefined`-valued, so it never
    // shows a false "pass 1" badge for an ordinary single-pass step.
    const rootCheckpoint = checkpoints.find((c) => c.stepId === 'root')!;
    const downCheckpoint = checkpoints.find((c) => c.stepId === 'down')!;
    expect(rootCheckpoint).toBeDefined();
    expect(downCheckpoint).toBeDefined();
    expect('iteration' in rootCheckpoint).toBe(false);
    expect('iteration' in downCheckpoint).toBe(false);
  });
});

describe('executeAgenticFlow — WS2 model routing', () => {
  afterEach(() => {
    harnessEventBus.removeAllListeners();
  });

  function stepEventsOf(events: HarnessEventPayload[]) {
    return events.filter(
      (event): event is Extract<HarnessEventPayload, { type: 'StepStatusChanged' }> =>
        event.type === 'StepStatusChanged',
    );
  }

  it('fixed/no-policy parity — a loop-free run with no model configured emits no model meta at all (byte-identical to pre-Phase-3a)', async () => {
    const events: HarnessEventPayload[] = [];
    harnessEventBus.on(HARNESS_EVENT_NAME, (event) => events.push(event));

    await executeAgenticFlow(makeFlow(), {
      runStep: async ({ step }) => ({ text: `output:${step.id}`, usage: null, toolCalls: [], toolResults: [] }),
    });

    const completedEvents = stepEventsOf(events).filter((event) => event.status === 'completed');
    expect(completedEvents.length).toBeGreaterThan(0);
    for (const event of completedEvents) {
      expect('modelId' in event).toBe(false);
      expect('modelEvidence' in event).toBe(false);
    }
  });

  it('precedence: a step.model manual override wins over an active router, both in the runStep call and the completed event', async () => {
    const events: HarnessEventPayload[] = [];
    harnessEventBus.on(HARNESS_EVENT_NAME, (event) => events.push(event));

    const root = makeStep('root', [], []);
    root.model = 'anthropic/claude-override';
    const flow: AgenticFlow = { id: 'flow-override', name: 'Override Flow', rootStepId: 'root', stepsRecord: { root } };

    const seenModelIds: (string | undefined)[] = [];
    await executeAgenticFlow(flow, {
      modelPolicy: { mode: 'smart-local', strategy: 'best-score' },
      modelRouterDeps: {
        getLeaderboard: async () => [{
          modelId: 'router-would-pick-this',
          name: 'Router Pick',
          status: 'completed',
          scores: { architecture: 90, teamWork: 90, assembler: 90 },
          finalArenaScore: 90,
          totalTokens: 100,
          executionCostUsd: 0.01,
        }],
        getBetterOnById: () => new Map(),
        hasOpenRouterKey: () => false,
      },
      runStep: async ({ modelId, step }) => {
        seenModelIds.push(modelId);
        return { text: `output:${step.id}`, usage: null, toolCalls: [], toolResults: [] };
      },
    });

    expect(seenModelIds).toEqual(['anthropic/claude-override']);
    const completed = stepEventsOf(events).find((event) => event.stepId === 'root' && event.status === 'completed');
    expect(completed?.modelId).toBe('anthropic/claude-override');
    expect(completed?.modelEvidence).toEqual({
      source: 'fallback',
      reason: 'manual per-step model override',
      sealed: false, // 'anthropic/claude-override' was never on the injected (sealed) leaderboard
    });
  });

  it('a smart-local policy routes a step and the completed event carries modelId + modelEvidence', async () => {
    const events: HarnessEventPayload[] = [];
    harnessEventBus.on(HARNESS_EVENT_NAME, (event) => events.push(event));

    const flow: AgenticFlow = {
      id: 'flow-smart-local',
      name: 'Smart Local Flow',
      rootStepId: 'root',
      stepsRecord: { root: makeStep('root', [], []) },
    };

    const seenModelIds: (string | undefined)[] = [];
    await executeAgenticFlow(flow, {
      modelPolicy: { mode: 'smart-local', strategy: 'cheapest' },
      modelRouterDeps: {
        getLeaderboard: async () => [
          {
            modelId: 'cheap-model', name: 'Cheap', status: 'completed',
            scores: { architecture: 60, teamWork: 60, assembler: 60 }, finalArenaScore: 60,
            totalTokens: 100, executionCostUsd: 0.001,
          },
          {
            modelId: 'pricey-model', name: 'Pricey', status: 'completed',
            scores: { architecture: 95, teamWork: 95, assembler: 95 }, finalArenaScore: 95,
            totalTokens: 100, executionCostUsd: 0.5,
          },
        ],
        getBetterOnById: () => new Map(),
        hasOpenRouterKey: () => false,
      },
      runStep: async ({ modelId, step }) => {
        seenModelIds.push(modelId);
        return { text: `output:${step.id}`, usage: null, toolCalls: [], toolResults: [] };
      },
    });

    expect(seenModelIds).toEqual(['cheap-model']);
    const completed = stepEventsOf(events).find((event) => event.stepId === 'root' && event.status === 'completed');
    expect(completed?.modelId).toBe('cheap-model');
    expect(completed?.modelEvidence).toMatchObject({ source: 'arena-leaderboard', strategy: 'cheapest', sealed: true });
  });

  it('smart-external mode attributes the completed event to the model OpenRouter actually served (respondedModelId)', async () => {
    const events: HarnessEventPayload[] = [];
    harnessEventBus.on(HARNESS_EVENT_NAME, (event) => events.push(event));

    const flow: AgenticFlow = {
      id: 'flow-external',
      name: 'External Flow',
      rootStepId: 'root',
      stepsRecord: { root: makeStep('root', [], []) },
    };

    await executeAgenticFlow(flow, {
      modelPolicy: { mode: 'smart-external' },
      modelRouterDeps: {
        hasOpenRouterKey: () => true,
        getLeaderboard: async () => [{
          modelId: 'z-ai/glm-5.2', name: 'GLM', status: 'completed',
          scores: { architecture: 90, teamWork: 90, assembler: 90 }, finalArenaScore: 90,
          totalTokens: 100, executionCostUsd: 0.02,
        }],
        getBetterOnById: () => new Map(),
      },
      runStep: async ({ step }) => ({
        text: `output:${step.id}`,
        usage: null,
        toolCalls: [],
        toolResults: [],
        respondedModelId: 'z-ai/glm-5.2',
      }),
    });

    const completed = stepEventsOf(events).find((event) => event.stepId === 'root' && event.status === 'completed');
    expect(completed?.modelId).toBe('z-ai/glm-5.2');
    expect(completed?.modelEvidence).toEqual({
      source: 'external-router',
      reason: 'OpenRouter auto-router served z-ai/glm-5.2',
      sealed: true, // z-ai/glm-5.2 IS on the injected (sealed) leaderboard
    });
  });

  it('smart-external mode without a respondedModelId leaves the completed event unattributed but still flagged', async () => {
    const events: HarnessEventPayload[] = [];
    harnessEventBus.on(HARNESS_EVENT_NAME, (event) => events.push(event));

    const flow: AgenticFlow = {
      id: 'flow-external-unattributed',
      name: 'External Flow Unattributed',
      rootStepId: 'root',
      stepsRecord: { root: makeStep('root', [], []) },
    };

    await executeAgenticFlow(flow, {
      modelPolicy: { mode: 'smart-external' },
      modelRouterDeps: {
        hasOpenRouterKey: () => true,
        getLeaderboard: async () => [],
        getBetterOnById: () => new Map(),
      },
      runStep: async ({ step }) => ({ text: `output:${step.id}`, usage: null, toolCalls: [], toolResults: [] }),
    });

    const completed = stepEventsOf(events).find((event) => event.stepId === 'root' && event.status === 'completed');
    expect(completed?.modelId).toBe('openrouter/auto');
    expect(completed?.modelEvidence).toEqual({
      source: 'external-router',
      reason: 'OpenRouter auto-router served an unattributed model (no model metadata returned)',
      sealed: false,
    });
  });

  it('a router returning null (fail-open, empty leaderboard) falls back to options.modelId for the actual run, with no model evidence attached', async () => {
    const events: HarnessEventPayload[] = [];
    harnessEventBus.on(HARNESS_EVENT_NAME, (event) => events.push(event));

    const flow: AgenticFlow = {
      id: 'flow-router-null',
      name: 'Router Null Flow',
      rootStepId: 'root',
      stepsRecord: { root: makeStep('root', [], []) },
    };

    const seenModelIds: (string | undefined)[] = [];
    await executeAgenticFlow(flow, {
      modelId: 'openai/gpt-4o-mini',
      modelPolicy: { mode: 'smart-local', strategy: 'best-score' },
      modelRouterDeps: {
        getLeaderboard: async () => [], // empty → router fails open (resolve() returns null)
        getBetterOnById: () => new Map(),
        hasOpenRouterKey: () => false,
      },
      runStep: async ({ modelId, step }) => {
        seenModelIds.push(modelId);
        return { text: `output:${step.id}`, usage: null, toolCalls: [], toolResults: [] };
      },
    });

    expect(seenModelIds).toEqual(['openai/gpt-4o-mini']);
    const completed = stepEventsOf(events).find((event) => event.stepId === 'root' && event.status === 'completed');
    // The flow's already-resolved model still shows up as an honest "what ran" fact...
    expect(completed?.modelId).toBe('openai/gpt-4o-mini');
    // ...but carries no fabricated routing evidence, since no routing decision actually fired.
    expect('modelEvidence' in completed!).toBe(false);
  });
});

describe('executeAgenticFlow — resolveConnection threading (Phase 6 provider connections)', () => {
  afterEach(() => {
    harnessEventBus.removeAllListeners();
  });

  it('passes options.resolveConnection straight through to runStep\'s input, unchanged, for llm-runner.ts#resolveHarnessModel to consume', async () => {
    const resolveConnection = vi.fn((id: string) =>
      (id === 'conn-a' ? { protocol: 'openai' as const, baseUrl: 'https://x.example.com/v1', token: 't' } : undefined));

    let seenResolveConnection: unknown;

    const flow: AgenticFlow = {
      id: 'flow-conn-resolve',
      name: 'Conn Resolve Flow',
      rootStepId: 'root',
      stepsRecord: { root: makeStep('root', [], []) },
    };

    // Inline (not a separately-typed `const runStep = vi.fn(...)`) so the
    // parameter is contextually typed from `ExecuteAgenticFlowOptions['runStep']`
    // — matching this file's existing multi-property-destructure runStep
    // callbacks (e.g. the `{ modelId, step }` ones above) instead of writing
    // out a redundant, drift-prone parameter type annotation by hand.
    await executeAgenticFlow(flow, {
      resolveConnection,
      runStep: async ({ step, resolveConnection: rc }) => {
        seenResolveConnection = rc;
        return { text: `output:${step.id}`, usage: null, toolCalls: [], toolResults: [] };
      },
    });

    expect(seenResolveConnection).toBe(resolveConnection);
  });

  it('is undefined by default (no behavior change for callers that never set it)', async () => {
    let seenResolveConnection: unknown = 'not-yet-set';

    const flow: AgenticFlow = {
      id: 'flow-conn-resolve-default',
      name: 'Conn Resolve Default Flow',
      rootStepId: 'root',
      stepsRecord: { root: makeStep('root', [], []) },
    };

    await executeAgenticFlow(flow, {
      runStep: async ({ step, resolveConnection: rc }) => {
        seenResolveConnection = rc;
        return { text: `output:${step.id}`, usage: null, toolCalls: [], toolResults: [] };
      },
    });

    expect(seenResolveConnection).toBeUndefined();
  });
});
