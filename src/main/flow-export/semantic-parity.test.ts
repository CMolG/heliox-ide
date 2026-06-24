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

// ---------------------------------------------------------------------------
// Suite — Semantic execution parity
// ---------------------------------------------------------------------------

describe('cross-runtime semantic execution parity — golden trace', () => {
  it('produces a trace identical to golden-trace.json when fed scripted LLM responses', async () => {
    const flow = importFlow(exportedFlow);
    const trace: Array<{ stepId: string; output: string }> = [];

    await executeAgenticFlow(flow, {
      runStep: async (input) => {
        // Scripted generateText — returns the canned response for this step id,
        // ignoring the model/prompt arguments so no real LLM is called.
        const scripted = async () => ({
          text: scriptedResponses[input.step.id] ?? '',
          usage: null,
          toolCalls: [],
          toolResults: [],
          steps: [],
        });

        // Run through the REAL runLLMStep so the full TS step pipeline
        // (context-builder output, telemetry, cognitive-trace extraction,
        // output propagation) is exercised — not a shortcut.
        const result = await runLLMStep({
          ...input,
          generateText: scripted,
        });

        trace.push({ stepId: input.step.id, output: result.text });
        return result;
      },
    });

    // Primary assertion: trace matches the golden contract exactly.
    expect(trace).toEqual(goldenTrace);
  });

  it('visits steps in the canonical DAG order step-a → step-b → step-c → step-d', async () => {
    const flow = importFlow(exportedFlow);
    const visitOrder: string[] = [];

    await executeAgenticFlow(flow, {
      runStep: async (input) => {
        const scripted = async () => ({
          text: scriptedResponses[input.step.id] ?? '',
          usage: null,
          toolCalls: [],
          toolResults: [],
          steps: [],
        });

        const result = await runLLMStep({ ...input, generateText: scripted });
        visitOrder.push(input.step.id);
        return result;
      },
    });

    expect(visitOrder).toEqual(['step-a', 'step-b', 'step-c', 'step-d']);
  });
});
