import { mkdtemp, readFile as nodeReadFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgenticFlow, AgenticStep, StepContract } from '@/types/harness';
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

describe('validateFlow — phase sanity checks (Capa 1)', () => {
  afterEach(() => {
    harnessEventBus.removeAllListeners();
  });

  const okRunStep = async () => ({ text: 'ok', usage: null, toolCalls: [], toolResults: [] });

  // Two-step linear flow (a -> b) plus whatever phases the case declares.
  function flowWithPhases(phases: AgenticFlow['phases']): AgenticFlow {
    return {
      ...makeFlow({ a: makeStep('a', [], ['b']), b: makeStep('b', ['a'], []) }, 'a'),
      ...(phases ? { phases } : {}),
    };
  }

  it('throws when a phase references a missing step', async () => {
    await expect(executeAgenticFlow(flowWithPhases([{ id: 'phase-1', name: 'P', stepIds: ['a', 'ghost'] }]), { runStep: okRunStep }))
      .rejects.toThrow(/missing step "ghost"/);
  });

  it('throws when onError is not "halt"', async () => {
    await expect(executeAgenticFlow(flowWithPhases([{ id: 'phase-1', name: 'P', stepIds: ['a'], onError: 'skip' as never }]), { runStep: okRunStep }))
      .rejects.toThrow(/only "halt" is supported/);
  });

  it('throws when two phases claim the same step', async () => {
    await expect(executeAgenticFlow(flowWithPhases([
      { id: 'p1', name: 'P1', stepIds: ['a'] },
      { id: 'p2', name: 'P2', stepIds: ['a'] },
    ]), { runStep: okRunStep })).rejects.toThrow(/both claim step "a"/);
  });

  it('throws when a phase declares no member steps', async () => {
    await expect(executeAgenticFlow(flowWithPhases([{ id: 'p1', name: 'P1', stepIds: [] }]), { runStep: okRunStep }))
      .rejects.toThrow(/has no member steps/);
  });

  it('throws when a phase\'s members are not a connected subgraph', async () => {
    const flow: AgenticFlow = {
      ...makeFlow({
        a: makeStep('a', [], ['b']),
        b: makeStep('b', ['a'], ['c']),
        c: makeStep('c', ['b'], []),
      }, 'a'),
      phases: [{ id: 'p1', name: 'Ends', stepIds: ['a', 'c'] }],
    };
    await expect(executeAgenticFlow(flow, { runStep: okRunStep })).rejects.toThrow(/is not a connected subgraph/);
  });

  it('throws on a duplicate phase id', async () => {
    await expect(executeAgenticFlow(flowWithPhases([
      { id: 'p1', name: 'P1', stepIds: ['a'] },
      { id: 'p1', name: 'P2', stepIds: ['b'] },
    ]), { runStep: okRunStep })).rejects.toThrow(/duplicate phase id "p1"/i);
  });

  it('accepts a well-formed phase with no exitContract (pure grouping, runs normally)', async () => {
    await expect(executeAgenticFlow(flowWithPhases([{ id: 'phase-1', name: 'P', stepIds: ['a', 'b'] }]), { runStep: okRunStep }))
      .resolves.toBeUndefined();
  });

  it('leaves a flow with no phases completely untouched', async () => {
    await expect(executeAgenticFlow(flowWithPhases(undefined), { runStep: okRunStep })).resolves.toBeUndefined();
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

// ---------------------------------------------------------------------------
// contextMode: 'feedback' — Rosetta context system (spec:
// docs/superpowers/specs/2026-07-10-rosetta-context-manifest.md)
// ---------------------------------------------------------------------------

/** Minimal in-memory McpFileSystem — enough to back genesis, the model's own
 * FS tools, and the guardrail's snapshotWorkspace walk, without touching disk. */
function makeInMemoryFileSystem(): McpFileSystem & { files: Map<string, string> } {
  const files = new Map<string, string>();
  const dirs = new Set<string>(['/workspace']);

  const normalize = (p: string) => p.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';

  return {
    files,
    mkdir: async (path: string) => {
      dirs.add(normalize(path));
    },
    readdir: async (path: string) => {
      const prefix = `${normalize(path)}/`;
      const names = new Set<string>();
      for (const p of files.keys()) {
        if (p.startsWith(prefix)) names.add(p.slice(prefix.length).split('/')[0]);
      }
      for (const d of dirs) {
        if (d.startsWith(prefix) && d !== prefix) names.add(d.slice(prefix.length).split('/')[0]);
      }
      return [...names];
    },
    readFile: async (path: string) => {
      const content = files.get(normalize(path));
      if (content === undefined) throw new Error(`ENOENT: no such file: ${path}`);
      return content;
    },
    stat: async (path: string) => {
      const norm = normalize(path);
      const isDir = dirs.has(norm) || [...files.keys()].some((p) => p.startsWith(`${norm}/`));
      const content = files.get(norm);
      return {
        isDirectory: () => isDir,
        isFile: () => content !== undefined,
        size: content !== undefined ? Buffer.byteLength(content, 'utf-8') : 0,
      };
    },
    writeFile: async (path: string, content: string) => {
      files.set(normalize(path), content);
    },
  };
}

function makeFeedbackFlow(
  stepsRecord: Record<string, AgenticStep>,
  rootStepId: string,
): AgenticFlow {
  return {
    id: 'flow-feedback',
    name: 'Feedback Flow',
    rootStepId,
    stepsRecord,
    contextMode: 'feedback',
  };
}

describe('executeAgenticFlow — contextMode: blind (default) has zero side effects', () => {
  afterEach(() => {
    harnessEventBus.removeAllListeners();
  });

  it('never touches the fileSystem for any .fluxor path when contextMode is absent', async () => {
    const fs = makeInMemoryFileSystem();
    const flow: AgenticFlow = {
      id: 'flow-blind-check',
      name: 'Blind Check',
      rootStepId: 'root',
      stepsRecord: { root: makeStep('root', [], []) },
    };

    await executeAgenticFlow(flow, {
      rootDir: '/workspace',
      fileSystem: fs,
      runStep: async ({ step }) => ({ text: `output:${step.id}`, usage: null, toolCalls: [], toolResults: [] }),
    });

    expect([...fs.files.keys()].some((path) => path.includes('.fluxor'))).toBe(false);
  });

  it('never touches the fileSystem for any .fluxor path when contextMode is explicitly "blind"', async () => {
    const fs = makeInMemoryFileSystem();
    const flow: AgenticFlow = {
      id: 'flow-blind-explicit',
      name: 'Blind Explicit',
      rootStepId: 'root',
      stepsRecord: { root: makeStep('root', [], []) },
      contextMode: 'blind',
    };

    await executeAgenticFlow(flow, {
      rootDir: '/workspace',
      fileSystem: fs,
      runStep: async ({ step }) => ({ text: `output:${step.id}`, usage: null, toolCalls: [], toolResults: [] }),
    });

    expect([...fs.files.keys()].some((path) => path.includes('.fluxor'))).toBe(false);
  });

  it('a blind flow with NO fileSystem/rootDir at all runs exactly as before (no crash, no genesis)', async () => {
    const flow: AgenticFlow = {
      id: 'flow-blind-bare',
      name: 'Blind Bare',
      rootStepId: 'root',
      stepsRecord: { root: makeStep('root', [], []) },
    };

    await expect(executeAgenticFlow(flow, {
      runStep: async ({ step }) => ({ text: `output:${step.id}`, usage: null, toolCalls: [], toolResults: [] }),
    })).resolves.toBeUndefined();
  });
});

describe('executeAgenticFlow — contextMode: feedback — genesis', () => {
  afterEach(() => {
    harnessEventBus.removeAllListeners();
  });

  it('creates manifest.json + seeded step.*.md files under .fluxor/run-context/<runId>/ before any step runs', async () => {
    const fs = makeInMemoryFileSystem();
    const flow = makeFeedbackFlow(
      {
        root: makeStep('root', [], ['leaf']),
        leaf: makeStep('leaf', ['root'], []),
      },
      'root',
    );

    const runId = 'run-genesis-1';
    await executeAgenticFlow(flow, {
      rootDir: '/workspace',
      fileSystem: fs,
      runId,
      runStep: async ({ step }) => ({ text: `output:${step.id}`, usage: null, toolCalls: [], toolResults: [] }),
    });

    const manifestRaw = fs.files.get(`/workspace/.fluxor/run-context/${runId}/manifest.json`);
    expect(manifestRaw).toBeDefined();
    const manifest = JSON.parse(manifestRaw!);
    expect(manifest.runId).toBe(runId);
    expect(manifest.flowId).toBe('flow-feedback');
    expect(manifest.contextMode).toBe('feedback');
    expect(Object.keys(manifest.steps).sort()).toEqual(['leaf', 'root']);

    expect(fs.files.get(`/workspace/.fluxor/run-context/${runId}/step.root.md`)).toContain('# Contexto para root');
    expect(fs.files.get(`/workspace/.fluxor/run-context/${runId}/step.leaf.md`)).toContain('# Contexto para leaf');
  });

  it('uses the caller-supplied fileSystem for genesis when provided (no real disk touched)', async () => {
    const fs = makeInMemoryFileSystem();
    const flow = makeFeedbackFlow({ root: makeStep('root', [], []) }, 'root');

    await executeAgenticFlow(flow, {
      rootDir: '/workspace',
      fileSystem: fs,
      runId: 'run-genesis-2',
      runStep: async ({ step }) => ({ text: `output:${step.id}`, usage: null, toolCalls: [], toolResults: [] }),
    });

    expect(fs.files.has('/workspace/.fluxor/run-context/run-genesis-2/manifest.json')).toBe(true);
  });

  it('with NO options.fileSystem, synthesizes a real-FS adapter and writes to a real rootDir on disk', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'fluxor-context-genesis-'));
    try {
      const flow = makeFeedbackFlow({ root: makeStep('root', [], []) }, 'root');

      await executeAgenticFlow(flow, {
        rootDir: tmpDir,
        runId: 'run-genesis-real-fs',
        runStep: async ({ step }) => ({ text: `output:${step.id}`, usage: null, toolCalls: [], toolResults: [] }),
      });

      const manifestPath = join(tmpDir, '.fluxor', 'run-context', 'run-genesis-real-fs', 'manifest.json');
      const manifestRaw = await nodeReadFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestRaw);
      expect(manifest.runId).toBe('run-genesis-real-fs');

      const seedPath = join(tmpDir, '.fluxor', 'run-context', 'run-genesis-real-fs', 'step.root.md');
      await expect(nodeReadFile(seedPath, 'utf-8')).resolves.toContain('# Contexto para root');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('with NO options.rootDir either, defaults the real-FS adapter to process.cwd() — not guardrails.ts\'s independent "/workspace" default', async () => {
    // Regression guard for the rootDir-default mismatch the spec calls out:
    // guardrails.ts's snapshotWorkspace defaults to '/workspace' while the
    // model's own FS tools (mcp-adapter.ts's normalizeRootDir) default to
    // process.cwd() — genesis must agree with the LATTER. process.cwd() is
    // mocked to a disposable temp dir so this test never touches the real
    // repository working directory.
    const tmpDir = await mkdtemp(join(tmpdir(), 'fluxor-context-cwd-default-'));
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    try {
      const flow = makeFeedbackFlow({ root: makeStep('root', [], []) }, 'root');

      await expect(executeAgenticFlow(flow, {
        runId: 'run-genesis-cwd-default',
        runStep: async ({ step }) => ({ text: `output:${step.id}`, usage: null, toolCalls: [], toolResults: [] }),
      })).resolves.toBeUndefined();

      // Landed under the mocked cwd, proving it did NOT fall back to '/workspace'.
      const manifestPath = join(tmpDir, '.fluxor', 'run-context', 'run-genesis-cwd-default', 'manifest.json');
      await expect(nodeReadFile(manifestPath, 'utf-8')).resolves.toContain('"runId"');
    } finally {
      cwdSpy.mockRestore();
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('executeAgenticFlow — contextMode: feedback — <flow_awareness> wiring', () => {
  afterEach(() => {
    harnessEventBus.removeAllListeners();
  });

  it('passes <flow_awareness> (topology + assigned file + writesTo) to the LLM-path step\'s systemPrompt', async () => {
    const fs = makeInMemoryFileSystem();
    const flow = makeFeedbackFlow(
      {
        root: makeStep('root', [], ['leaf']),
        leaf: makeStep('leaf', ['root'], []),
      },
      'root',
    );

    const seenSystemPrompts: Record<string, string> = {};
    await executeAgenticFlow(flow, {
      rootDir: '/workspace',
      fileSystem: fs,
      runId: 'run-awareness-1',
      runStep: async ({ step, systemPrompt }) => {
        seenSystemPrompts[step.id] = systemPrompt;
        return { text: `output:${step.id}`, usage: null, toolCalls: [], toolResults: [] };
      },
    });

    expect(seenSystemPrompts.root).toContain('<flow_awareness>');
    expect(seenSystemPrompts.root).toContain('.fluxor/run-context/run-awareness-1/step.root.md');
    expect(seenSystemPrompts.root).toContain('.fluxor/run-context/run-awareness-1/step.leaf.md');
    // leaf is terminal — no writesTo, so no "write a briefing" targets, but it
    // still gets the block (its own assigned file + topology).
    expect(seenSystemPrompts.leaf).toContain('<flow_awareness>');
    expect(seenSystemPrompts.leaf).toContain('.fluxor/run-context/run-awareness-1/step.leaf.md');
  });

  it('a retriever step never receives <flow_awareness> (its branch returns before the LLM path)', async () => {
    const fs = makeInMemoryFileSystem();
    const flow = makeFeedbackFlow(
      {
        root: makeStep('root', [], ['fetch']),
        fetch: makeStep('fetch', ['root'], ['use']),
        use: makeStep('use', ['fetch'], []),
      },
      'root',
    );
    flow.stepsRecord.fetch.type = 'retriever';

    const seenSystemPrompts: Record<string, string> = {};
    await executeAgenticFlow(flow, {
      rootDir: '/workspace',
      fileSystem: fs,
      runId: 'run-awareness-retriever',
      runStep: async ({ step, systemPrompt }) => {
        seenSystemPrompts[step.id] = systemPrompt;
        return { text: `output:${step.id}`, usage: null, toolCalls: [], toolResults: [] };
      },
    });

    // The retriever never calls runStep at all (its branch bypasses it), so
    // it simply has no entry — proving the LLM path (and its
    // <flow_awareness>) was never reached for it.
    expect(seenSystemPrompts.fetch).toBeUndefined();
    // Its seeded file still exists (genesis seeds every contextFile).
    expect(fs.files.get('/workspace/.fluxor/run-context/run-awareness-retriever/step.fetch.md'))
      .toContain('# Contexto para fetch');
    // Downstream (non-exempt) steps are unaffected.
    expect(seenSystemPrompts.use).toContain('<flow_awareness>');
  });
});

describe('executeAgenticFlow — contextMode: feedback — guardrail enforces promised briefings', () => {
  afterEach(() => {
    harnessEventBus.removeAllListeners();
  });

  it('passes silently when the step writes a real briefing (beyond the seed) into its writesTo target', async () => {
    const fs = makeInMemoryFileSystem();
    const flow = makeFeedbackFlow(
      {
        root: makeStep('root', [], ['leaf']),
        leaf: makeStep('leaf', ['root'], []),
      },
      'root',
    );

    const events: HarnessEventPayload[] = [];
    harnessEventBus.on(HARNESS_EVENT_NAME, (e) => events.push(e));

    await executeAgenticFlow(flow, {
      rootDir: '/workspace',
      fileSystem: fs,
      runId: 'run-guardrail-pass',
      guardrailMaxAttempts: 2,
      runStep: async ({ step, tools }) => {
        if (step.id === 'root') {
          await tools.write_file.execute?.(
            { path: '.fluxor/run-context/run-guardrail-pass/step.leaf.md', content: 'A real, detailed briefing for leaf that clearly exceeds the tiny seeded header in length.' },
            { toolCallId: 'tool-1', messages: [] },
          );
        }
        return { text: `output:${step.id}`, usage: null, toolCalls: [], toolResults: [] };
      },
    });

    const stepEvents = events.filter(
      (e): e is Extract<HarnessEventPayload, { type: 'StepStatusChanged' }> => e.type === 'StepStatusChanged',
    );
    expect(stepEvents.some((e) => e.logs?.includes('breached contract'))).toBe(false);
  });

  it('retries then breaches when the step never writes into its writesTo target', async () => {
    const fs = makeInMemoryFileSystem();
    const flow = makeFeedbackFlow(
      {
        root: makeStep('root', [], ['leaf']),
        leaf: makeStep('leaf', ['root'], []),
      },
      'root',
    );

    const events: HarnessEventPayload[] = [];
    harnessEventBus.on(HARNESS_EVENT_NAME, (e) => events.push(e));

    await executeAgenticFlow(flow, {
      rootDir: '/workspace',
      fileSystem: fs,
      runId: 'run-guardrail-breach',
      guardrailMaxAttempts: 2,
      runStep: async ({ step }) => ({ text: `output:${step.id}`, usage: null, toolCalls: [], toolResults: [] }),
    });

    const stepEvents = events.filter(
      (e): e is Extract<HarnessEventPayload, { type: 'StepStatusChanged' }> => e.type === 'StepStatusChanged',
    );
    expect(stepEvents.some((e) => e.stepId === 'root' && e.logs?.includes('breached contract'))).toBe(true);
  });

  it('a terminal step with no writesTo never activates the guardrail (no contract at all)', async () => {
    const fs = makeInMemoryFileSystem();
    const flow = makeFeedbackFlow({ root: makeStep('root', [], []) }, 'root');

    const events: HarnessEventPayload[] = [];
    harnessEventBus.on(HARNESS_EVENT_NAME, (e) => events.push(e));

    await executeAgenticFlow(flow, {
      rootDir: '/workspace',
      fileSystem: fs,
      runId: 'run-guardrail-terminal',
      runStep: async ({ step }) => ({ text: `output:${step.id}`, usage: null, toolCalls: [], toolResults: [] }),
    });

    const stepEvents = events.filter(
      (e): e is Extract<HarnessEventPayload, { type: 'StepStatusChanged' }> => e.type === 'StepStatusChanged',
    );
    expect(stepEvents.some((e) => e.logs?.includes('guardrail'))).toBe(false);
  });
});

describe('executeAgenticFlow — contextMode: feedback — checkpoint contextFileSnapshot', () => {
  afterEach(() => {
    harnessEventBus.removeAllListeners();
  });

  it('attaches contextFileSnapshot (path + content) to each step\'s checkpoint', async () => {
    const fs = makeInMemoryFileSystem();
    const flow = makeFeedbackFlow({ root: makeStep('root', [], []) }, 'root');
    const runId = 'run-checkpoint-ctx';

    await executeAgenticFlow(flow, {
      rootDir: '/workspace',
      fileSystem: fs,
      runId,
      runStep: async ({ step }) => ({ text: `output:${step.id}`, usage: null, toolCalls: [], toolResults: [] }),
    });

    const checkpoints = listCheckpoints(runId);
    const rootCheckpoint = checkpoints.find((c) => c.stepId === 'root');
    expect(rootCheckpoint?.contextFileSnapshot?.path).toBe('.fluxor/run-context/run-checkpoint-ctx/step.root.md');
    expect(rootCheckpoint?.contextFileSnapshot?.content).toContain('# Contexto para root');
  });

  it('omits contextFileSnapshot entirely for a blind-mode run\'s checkpoints', async () => {
    const flow: AgenticFlow = {
      id: 'flow-blind-checkpoint',
      name: 'Blind Checkpoint',
      rootStepId: 'root',
      stepsRecord: { root: makeStep('root', [], []) },
    };
    const runId = 'run-checkpoint-blind';

    await executeAgenticFlow(flow, {
      runId,
      runStep: async ({ step }) => ({ text: `output:${step.id}`, usage: null, toolCalls: [], toolResults: [] }),
    });

    const checkpoints = listCheckpoints(runId);
    expect('contextFileSnapshot' in checkpoints[0]).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Phases — Capa 1 exit gate + checkpoint boundary marker
// (spec docs/superpowers/specs/2026-07-21-agentic-phase-model.md §5.1-5.3)
// ---------------------------------------------------------------------------

/** Three-step chain a -> b -> c, with one phase over `phaseStepIds`. */
function chainFlow(phaseStepIds: string[], exitContract?: StepContract): AgenticFlow {
  return {
    id: 'flow-phase-gate',
    name: 'Phase Gate Flow',
    rootStepId: 'a',
    stepsRecord: {
      a: makeStep('a', [], ['b']),
      b: makeStep('b', ['a'], ['c']),
      c: makeStep('c', ['b'], []),
    },
    phases: [{ id: 'phase-1', name: 'Middle', stepIds: phaseStepIds, ...(exitContract ? { exitContract } : {}) } as never],
  };
}

describe('executeAgenticFlow — phases (Capa 1 exit gate)', () => {
  afterEach(() => {
    harnessEventBus.removeAllListeners();
  });

  it('a flow with no phases takes zero extra snapshotWorkspace calls', async () => {
    const fileSystem = makeInMemoryFileSystem();
    let readdirCalls = 0;
    const wrapped: McpFileSystem = {
      ...fileSystem,
      readdir: async (path: string) => { readdirCalls++; return fileSystem.readdir(path); },
    };
    const flow = makeFlow({ a: makeStep('a', [], []) }, 'a');

    await executeAgenticFlow(flow, {
      fileSystem: wrapped,
      runStep: async () => ({ text: 'ok', usage: null, toolCalls: [], toolResults: [] }),
    });

    expect(readdirCalls).toBe(0);
  });

  it('a phase with no exitContract also takes zero snapshots (pure grouping is free)', async () => {
    const fileSystem = makeInMemoryFileSystem();
    let readdirCalls = 0;
    const wrapped: McpFileSystem = {
      ...fileSystem,
      readdir: async (path: string) => { readdirCalls++; return fileSystem.readdir(path); },
    };

    await executeAgenticFlow(chainFlow(['a', 'b']), {
      fileSystem: wrapped,
      runStep: async ({ step }: { step: AgenticStep }) => ({ text: `${step.id} ok`, usage: null, toolCalls: [], toolResults: [] }),
    });

    expect(readdirCalls).toBe(0);
  });

  it('passes silently when the exit contract is satisfied', async () => {
    const fileSystem = makeInMemoryFileSystem();

    await expect(executeAgenticFlow(chainFlow(['a', 'b'], { mustWriteFiles: true }), {
      fileSystem,
      rootDir: '/workspace',
      runStep: async ({ step }: { step: AgenticStep }) => {
        await fileSystem.writeFile(`/workspace/out-${step.id}.md`, `${step.id} wrote this`, 'utf-8');
        return { text: `${step.id} ok`, usage: null, toolCalls: [], toolResults: [] };
      },
    })).resolves.toBeUndefined();
  });

  it('throws naming the phase when the contract is breached, and never persists a checkpoint for the breaching instance', async () => {
    const fileSystem = makeInMemoryFileSystem();
    const runId = 'run-phase-breach';

    await expect(executeAgenticFlow(chainFlow(['a', 'b'], { mustWriteFiles: true }), {
      runId,
      fileSystem,
      rootDir: '/workspace',
      // Never writes — mustWriteFiles can never be satisfied.
      runStep: async ({ step }: { step: AgenticStep }) => ({ text: `${step.id} ok`, usage: null, toolCalls: [], toolResults: [] }),
    })).rejects.toThrow(/Phase "Middle" breached its exit contract/);

    // 'b' is the breaching instance: its checkpoint is never written, because
    // the gate throws before saveCheckpoint is reached in that same iteration.
    expect(listCheckpoints(runId).map((c) => c.stepId)).toEqual(['a']);
  });

  it('ignores exitContract.maxAttempts silently — never retries the gate', async () => {
    const fileSystem = makeInMemoryFileSystem();
    let stepBRunCount = 0;

    await expect(executeAgenticFlow(chainFlow(['a', 'b'], { mustWriteFiles: true, maxAttempts: 5 }), {
      fileSystem,
      rootDir: '/workspace',
      runStep: async ({ step }: { step: AgenticStep }) => {
        if (step.id === 'b') stepBRunCount++;
        return { text: `${step.id} ok`, usage: null, toolCalls: [], toolResults: [] };
      },
    })).rejects.toThrow(/breached its exit contract/);

    expect(stepBRunCount).toBe(1);
  });

  it('is inert without a fileSystem (same limitation as a per-step contract)', async () => {
    await expect(executeAgenticFlow(chainFlow(['a', 'b'], { mustWriteFiles: true }), {
      // No fileSystem at all -> gateFileSystem undefined -> the gate is skipped
      // rather than run against an empty {} pair, which would false-positive.
      runStep: async ({ step }: { step: AgenticStep }) => ({ text: `${step.id} ok`, usage: null, toolCalls: [], toolResults: [] }),
    })).resolves.toBeUndefined();
  });
});

describe('executeAgenticFlow — phase-boundary checkpoint marker', () => {
  afterEach(() => {
    harnessEventBus.removeAllListeners();
  });

  it('attaches boundaries: ["start"] then ["end"] across a multi-step phase\'s checkpoints', async () => {
    const flow: AgenticFlow = {
      ...makeFlow({ a: makeStep('a', [], ['b']), b: makeStep('b', ['a'], []) }, 'a'),
      phases: [{ id: 'phase-1', name: 'Setup', stepIds: ['a', 'b'] }],
    };
    const runId = 'run-boundary-1';
    await executeAgenticFlow(flow, { runId, runStep: async ({ step }: { step: AgenticStep }) => ({ text: `${step.id} ok`, usage: null, toolCalls: [], toolResults: [] }) });

    const checkpoints = listCheckpoints(runId);
    expect(checkpoints.find((c) => c.stepId === 'a')?.phaseBoundary).toEqual({ phaseId: 'phase-1', phaseName: 'Setup', boundaries: ['start'] });
    expect(checkpoints.find((c) => c.stepId === 'b')?.phaseBoundary).toEqual({ phaseId: 'phase-1', phaseName: 'Setup', boundaries: ['end'] });
  });

  it('attaches boundaries: ["start","end"] for a single-instance phase', async () => {
    const flow: AgenticFlow = {
      ...makeFlow({ a: makeStep('a', [], []) }, 'a'),
      phases: [{ id: 'phase-1', name: 'Solo', stepIds: ['a'] }],
    };
    const runId = 'run-boundary-2';
    await executeAgenticFlow(flow, { runId, runStep: async () => ({ text: 'ok', usage: null, toolCalls: [], toolResults: [] }) });

    expect(listCheckpoints(runId)[0]?.phaseBoundary).toEqual({ phaseId: 'phase-1', phaseName: 'Solo', boundaries: ['start', 'end'] });
  });

  it('omits phaseBoundary entirely for a step outside any phase', async () => {
    const runId = 'run-boundary-3';
    await executeAgenticFlow(makeFlow({ a: makeStep('a', [], []) }, 'a'), {
      runId,
      runStep: async () => ({ text: 'ok', usage: null, toolCalls: [], toolResults: [] }),
    });

    expect('phaseBoundary' in listCheckpoints(runId)[0]).toBe(false);
  });

  it('a phase spanning a loop body marks its end after the loop\'s FINAL iteration', async () => {
    const flow: AgenticFlow = {
      ...makeFlow(
        { a: makeStep('a', [], ['b']), b: makeStep('b', ['a'], []) },
        'a',
        [{ id: 'loop-1', sourceStepId: 'b', targetStepId: 'a', maxIterations: 3 }],
      ),
      phases: [{ id: 'phase-1', name: 'Looped', stepIds: ['a', 'b'] }],
    };
    const runId = 'run-boundary-loop';
    await executeAgenticFlow(flow, { runId, runStep: async ({ step }: { step: AgenticStep }) => ({ text: `${step.id} ok`, usage: null, toolCalls: [], toolResults: [] }) });

    const endMarked = listCheckpoints(runId).filter((c) => c.phaseBoundary?.boundaries.includes('end'));
    expect(endMarked).toHaveLength(1);
    expect(endMarked[0].stepId).toBe('b');
    expect(endMarked[0].iteration).toBe(3); // the loop's LAST pass, not the first
  });
});
