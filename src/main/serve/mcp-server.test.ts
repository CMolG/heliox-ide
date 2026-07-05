/**
 * mcp-server.test.ts — ARCH-064 acceptance tests
 *
 * Verifies:
 *   1. An MCP client can listTools and see the flow tool (name = flow id).
 *   2. An MCP client can callTool and receive the flow output.
 *   3. callTool result equals a direct executeAgenticFlow run (parity AC).
 *   4. createMcpFlowServer throws synchronously for an invalid flow.
 *
 * No real LLM is involved; runStep is fully scripted.
 * Transport: InMemoryTransport (in-process, no stdio or ports).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgenticStep } from '@/types/harness';
import type { HarnessEventPayload } from '@/types/ipc-events';
import type { LLMStepResult } from '../harness-engine/llm-runner';
import type { HarnessStepRunnerInput } from '../harness-engine/executor';
import { harnessEventBus, HARNESS_EVENT_NAME } from '../harness-engine/event-bus';
import { executeAgenticFlow } from '../harness-engine/executor';
import { importFlow, type HelioxFlowExport } from '../flow-export/heliox-flow';
import { createMcpFlowServer, createInProcessMcpClient } from './mcp-server';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { McpFlowServer } from './mcp-server';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const FIXTURE_PATH = resolve(
  __dirname,
  '../../../sdk/conformance/conformance-chain.flow.json',
);

const exported: HelioxFlowExport = JSON.parse(
  readFileSync(FIXTURE_PATH, 'utf-8'),
) as HelioxFlowExport;

// Scripted runner that returns deterministic output per step.
function makeScriptedRunStep() {
  return vi.fn(async ({ step }: HarnessStepRunnerInput): Promise<LLMStepResult> => ({
    text: `scripted-output:${step.id}`,
    usage: null,
    toolCalls: [],
    toolResults: [],
  }));
}

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------

let client: Client;
let mcpServer: McpFlowServer;

beforeEach(async () => {
  harnessEventBus.removeAllListeners();
  const scriptedRunStep = makeScriptedRunStep();
  ({ client, mcpServer } = await createInProcessMcpClient(exported, {
    runStep: scriptedRunStep as (input: HarnessStepRunnerInput) => Promise<LLMStepResult>,
  }));
});

afterEach(async () => {
  harnessEventBus.removeAllListeners();
  await client.close();
  await mcpServer.close();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('listTools', () => {
  it('exposes the flow as a single tool with name = flow id', async () => {
    const result = await client.listTools();
    expect(result.tools).toHaveLength(1);
    const tool = result.tools[0]!;
    expect(tool.name).toBe(exported.id);
  });

  it('tool description contains the flow name and step summary', async () => {
    const result = await client.listTools();
    const tool = result.tools[0]!;
    expect(tool.description).toContain(exported.name);
    // All step ids appear in the description.
    for (const step of exported.steps) {
      expect(tool.description).toContain(step.id);
    }
  });

  it('tool has an input schema with an optional "input" string field', async () => {
    const result = await client.listTools();
    const tool = result.tools[0]!;
    expect(tool.inputSchema.type).toBe('object');
    expect(tool.inputSchema.properties).toBeDefined();
    expect((tool.inputSchema.properties as Record<string, unknown>)['input']).toBeDefined();
  });
});

describe('callTool — parity', () => {
  it('callTool result equals a direct executeAgenticFlow run', async () => {
    // -----------------------------------------------------------------------
    // (a) Direct execution path.
    // -----------------------------------------------------------------------
    const scriptedRunStep = makeScriptedRunStep();
    const directEvents: HarnessEventPayload[] = [];

    harnessEventBus.on(HARNESS_EVENT_NAME, (e: HarnessEventPayload) =>
      directEvents.push(e),
    );

    const directFlow = importFlow(exported);
    await executeAgenticFlow(directFlow, { runStep: scriptedRunStep });

    const directCompleted = directEvents.find(
      (e): e is Extract<HarnessEventPayload, { type: 'FlowCompleted' }> =>
        e.type === 'FlowCompleted',
    )!;

    harnessEventBus.removeAllListeners();

    // -----------------------------------------------------------------------
    // (b) MCP callTool path with the SAME scripted runner.
    // -----------------------------------------------------------------------
    const mcpScriptedRunStep = vi.fn(async ({ step }: HarnessStepRunnerInput): Promise<LLMStepResult> => ({
      text: `scripted-output:${step.id}`,
      usage: null,
      toolCalls: [],
      toolResults: [],
    }));

    const { client: parityClient, mcpServer: parityServer } = await createInProcessMcpClient(
      exported,
      {
        runStep: mcpScriptedRunStep as (input: HarnessStepRunnerInput) => Promise<LLMStepResult>,
      },
    );

    let toolResult: Awaited<ReturnType<typeof parityClient.callTool>>;
    try {
      toolResult = await parityClient.callTool({ name: exported.id, arguments: {} });
    } finally {
      await parityClient.close();
      await parityServer.close();
    }

    // The tool returns a JSON-serialised finalOutput as a text content block.
    const content = toolResult.content as Array<{ type: string; text: string }>;
    expect(content).toHaveLength(1);
    const block = content[0] as { type: string; text: string };
    expect(block.type).toBe('text');

    const parsedOutput = JSON.parse(block.text) as Record<string, unknown>;

    // stepOutputs and completedStepIds must match the direct run.
    const directFinalOutput = directCompleted.finalOutput as {
      completedStepIds: string[];
      stepOutputs: Record<string, string>;
    };
    expect(parsedOutput['completedStepIds']).toEqual(directFinalOutput.completedStepIds);
    expect(parsedOutput['stepOutputs']).toEqual(directFinalOutput.stepOutputs);
  });

  it('returns an isError response when flow execution fails', async () => {
    const failingRunStep = vi.fn(async ({ step }: HarnessStepRunnerInput): Promise<LLMStepResult> => {
      if (step.id === 'step-b') throw new Error('scripted mcp failure');
      return {
        text: `ok:${step.id}`,
        usage: null,
        toolCalls: [],
        toolResults: [],
      };
    });

    const { client: errClient, mcpServer: errServer } = await createInProcessMcpClient(
      exported,
      {
        runStep: failingRunStep as (input: HarnessStepRunnerInput) => Promise<LLMStepResult>,
      },
    );

    let toolResult: Awaited<ReturnType<typeof errClient.callTool>>;
    try {
      toolResult = await errClient.callTool({ name: exported.id, arguments: {} });
    } finally {
      await errClient.close();
      await errServer.close();
    }

    expect(toolResult.isError).toBe(true);
    const errContent = toolResult.content as Array<{ type: string; text: string }>;
    const block = errContent[0] as { type: string; text: string };
    expect(block.text).toContain('scripted mcp failure');
  });
});

describe('createMcpFlowServer — validation', () => {
  it('throws synchronously for a flow with an invalid rootStepId', () => {
    const bad: HelioxFlowExport = {
      ...exported,
      rootStepId: 'nonexistent-step',
    };
    expect(() => createMcpFlowServer(bad)).toThrow(/rootStepId/);
  });
});
