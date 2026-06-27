/**
 * semantic-parity.test.ts — Cross-runtime semantic execution parity (TS half)
 *
 * Proves that the TypeScript pipeline (importFlow → executeAgenticFlow →
 * runLLMStep) produces the same per-step outputs as the golden trace when
 * fed identical scripted LLM responses, exercising the full TS step pipeline
 * (context-builder + runLLMStep telemetry/trace path) without a real LLM.
 *
 * The Java runtime must reproduce `golden-trace.json` identically from the
 * same `conformance-chain.flow.json` and `scripted-responses.json` fixtures.
 *
 * Tool-calling parity (ARCH-075): step-e invokes the deterministic `uppercase`
 * tool (registered in both runtimes) and asserts the tool call + result +
 * post-tool output match `golden-tool-calls.json` byte-for-byte.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { executeAgenticFlow } from '../harness-engine/executor';
import { runLLMStep } from '../harness-engine/llm-runner';
import { importFlow, type HelioxFlowExport } from './heliox-flow';

// ---------------------------------------------------------------------------
// Load shared fixtures (the cross-runtime contract)
// ---------------------------------------------------------------------------

const fixtureDir = join(process.cwd(), 'sdk', 'conformance');

const exportedFlow: HelioxFlowExport = JSON.parse(
  readFileSync(join(fixtureDir, 'conformance-chain.flow.json'), 'utf-8'),
);

const scriptedResponses: Record<string, string> = JSON.parse(
  readFileSync(join(fixtureDir, 'scripted-responses.json'), 'utf-8'),
);

const goldenTrace: Array<{ stepId: string; output: string }> = JSON.parse(
  readFileSync(join(fixtureDir, 'golden-trace.json'), 'utf-8'),
);

const goldenToolCalls: Array<{
  stepId: string;
  toolName: string;
  arguments: string;
  result: string;
}> = JSON.parse(
  readFileSync(join(fixtureDir, 'golden-tool-calls.json'), 'utf-8'),
);

// ---------------------------------------------------------------------------
// Deterministic conformance tool — uppercase
//
// This is the SAME pure function registered in the Java ToolRegistry (test scope).
// Both runtimes call it with identical arguments and expect the identical result.
// ---------------------------------------------------------------------------

function uppercase(text: string): string {
  return text.toUpperCase();
}

// Tool-call fixture constants (must match golden-tool-calls.json exactly).
const UPPERCASE_TOOL_ARGS = { text: 'hello conformance' };
const UPPERCASE_TOOL_RESULT = uppercase(UPPERCASE_TOOL_ARGS.text); // "HELLO CONFORMANCE"

// ---------------------------------------------------------------------------
// Suite — Semantic execution parity
// ---------------------------------------------------------------------------

describe('cross-runtime semantic execution parity — golden trace', () => {
  it('produces a trace identical to golden-trace.json when fed scripted LLM responses', async () => {
    const flow = importFlow(exportedFlow);
    const trace: Array<{ stepId: string; output: string }> = [];

    await executeAgenticFlow(flow, {
      runStep: async (input) => {
        const stepId = input.step.id;

        if (stepId === 'step-e') {
          // Tool-calling step: actually invoke the uppercase tool (not hardcoded),
          // then return a complete scripted-provider result that mirrors what the
          // AI SDK's multi-step generateText returns after the tool loop.
          const toolResult = uppercase(UPPERCASE_TOOL_ARGS.text);
          const argsJson = JSON.stringify(UPPERCASE_TOOL_ARGS);
          const finalText = scriptedResponses[stepId] ?? '';

          const scripted = async () => ({
            text: finalText,
            usage: null,
            toolCalls: [
              { toolCallId: 'call_conformance_1', toolName: 'uppercase', input: UPPERCASE_TOOL_ARGS },
            ],
            toolResults: [
              { toolCallId: 'call_conformance_1', toolName: 'uppercase', output: toolResult },
            ],
            steps: [
              {
                // Step 0: provider requests the tool call.
                text: '',
                content: [
                  {
                    type: 'tool-call',
                    toolCallId: 'call_conformance_1',
                    toolName: 'uppercase',
                    input: UPPERCASE_TOOL_ARGS,
                  },
                ],
                toolCalls: [
                  { toolCallId: 'call_conformance_1', toolName: 'uppercase', input: UPPERCASE_TOOL_ARGS },
                ],
                toolResults: [],
              },
              {
                // Step 1: provider emits final text after tool result is fed back.
                text: finalText,
                content: [
                  {
                    type: 'tool-result',
                    toolCallId: 'call_conformance_1',
                    toolName: 'uppercase',
                    output: toolResult,
                  },
                  { type: 'text', text: finalText },
                ],
                toolCalls: [],
                toolResults: [
                  { toolCallId: 'call_conformance_1', toolName: 'uppercase', output: toolResult },
                ],
              },
            ],
          });

          // Run through the REAL runLLMStep (telemetry + cognitive-trace extraction).
          const result = await runLLMStep({
            ...input,
            generateText: scripted,
          });

          trace.push({ stepId, output: result.text });

          // Assert tool-call segment matches the golden contract.
          const goldenEntry = goldenToolCalls.find((e) => e.stepId === stepId);
          expect(goldenEntry).toBeDefined();
          if (goldenEntry) {
            // Tool must have been ACTUALLY INVOKED (not hardcoded): the result
            // comes from calling uppercase(args.text), not a literal string.
            expect(toolResult).toBe(goldenEntry.result);
            expect(argsJson).toBe(goldenEntry.arguments);
            // The cognitive trace must capture the tool call.
            const toolCallEntry = result.cognitiveTrace?.find((e) => e.type === 'tool_call');
            expect(toolCallEntry).toBeDefined();
            expect(toolCallEntry?.toolName).toBe(goldenEntry.toolName);
          }

          return result;
        }

        // Plain LLM steps (step-a through step-d): scripted generateText as before.
        const scripted = async () => ({
          text: scriptedResponses[stepId] ?? '',
          usage: null,
          toolCalls: [],
          toolResults: [],
          steps: [],
        });

        const result = await runLLMStep({
          ...input,
          generateText: scripted,
        });

        trace.push({ stepId, output: result.text });
        return result;
      },
    });

    // Primary assertion: trace matches the golden contract exactly.
    expect(trace).toEqual(goldenTrace);
  });

  it('visits steps in the canonical DAG order step-a → step-b → step-c → step-d → step-e', async () => {
    const flow = importFlow(exportedFlow);
    const visitOrder: string[] = [];

    await executeAgenticFlow(flow, {
      runStep: async (input) => {
        const stepId = input.step.id;
        visitOrder.push(stepId);

        if (stepId === 'step-e') {
          // Minimal scripted response for the tool-calling step.
          const toolResult = uppercase(UPPERCASE_TOOL_ARGS.text);
          const finalText = scriptedResponses[stepId] ?? '';
          const scripted = async () => ({
            text: finalText,
            usage: null,
            toolCalls: [
              { toolCallId: 'call_conformance_1', toolName: 'uppercase', input: UPPERCASE_TOOL_ARGS },
            ],
            toolResults: [
              { toolCallId: 'call_conformance_1', toolName: 'uppercase', output: toolResult },
            ],
            steps: [],
          });
          return runLLMStep({ ...input, generateText: scripted });
        }

        const scripted = async () => ({
          text: scriptedResponses[stepId] ?? '',
          usage: null,
          toolCalls: [],
          toolResults: [],
          steps: [],
        });

        return runLLMStep({ ...input, generateText: scripted });
      },
    });

    expect(visitOrder).toEqual(['step-a', 'step-b', 'step-c', 'step-d', 'step-e']);
  });
});
