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

function makeFlow(): AgenticFlow {
  return {
    id: 'flow-converged',
    name: 'Converged DAG',
    rootStepId: 'root',
    stepsRecord: {
      root: makeStep('root', [], ['branch-a', 'branch-b']),
      'branch-a': makeStep('branch-a', ['root'], ['merge'], [
        { id: 'mod-a', name: 'Mod A', type: 'system_override' },
      ]),
      'branch-b': makeStep('branch-b', ['root'], ['merge'], [
        { id: 'mod-b', name: 'Mod B', type: 'system_override' },
      ]),
      merge: makeStep('merge', ['branch-a', 'branch-b'], []),
    },
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
