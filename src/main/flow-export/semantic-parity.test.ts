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
import { mkdtemp, readdir, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { executeAgenticFlow } from '../harness-engine/executor';
import { runLLMStep } from '../harness-engine/llm-runner';
import { importFlow, type FluxorFlowExport } from './fluxor-flow';

// ---------------------------------------------------------------------------
// Load shared fixtures (the cross-runtime contract)
// ---------------------------------------------------------------------------

const fixtureDir = join(process.cwd(), 'sdk', 'conformance');

const exportedFlow: FluxorFlowExport = JSON.parse(
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
// Load loop conformance fixtures (Phase 4a — bounded loop-back edges)
// ---------------------------------------------------------------------------

const loopExportedFlow: FluxorFlowExport = JSON.parse(
  readFileSync(join(fixtureDir, 'conformance-loop.flow.json'), 'utf-8'),
);

/** stepId → array of canned responses, one entry consumed per call to that step. */
const scriptedLoopResponses: Record<string, string[]> = JSON.parse(
  readFileSync(join(fixtureDir, 'scripted-loop-responses.json'), 'utf-8'),
);

const goldenLoopTrace: Array<{ stepId: string; iteration: number; output: string }> = JSON.parse(
  readFileSync(join(fixtureDir, 'golden-loop-trace.json'), 'utf-8'),
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

// ---------------------------------------------------------------------------
// Suite — Loop execution parity (Phase 4a)
//
// Proves the TS executor's loop expansion (loop-plan.ts's buildExecutionPlan,
// driven by executor.ts's Kahn scheduler) reproduces the canonical loop trace
// when fed per-iteration scripted responses — the cross-runtime contract
// Java/Python must also satisfy once they implement loop expansion.
// ---------------------------------------------------------------------------

describe('cross-runtime loop execution parity — golden loop trace', () => {
  it('reproduces golden-loop-trace.json exactly when fed per-iteration scripted responses', async () => {
    const flow = importFlow(loopExportedFlow);

    // Per-step queues, one array entry consumed per call to that step — cloned
    // from the fixture so this test never mutates the shared parsed-JSON module.
    const queues = new Map<string, string[]>(
      Object.entries(scriptedLoopResponses).map(([stepId, responses]) => [stepId, [...responses]]),
    );

    const trace: Array<{ stepId: string; output: string }> = [];

    await executeAgenticFlow(flow, {
      runStep: async (input) => {
        const stepId = input.step.id;
        const output = queues.get(stepId)?.shift() ?? '';
        trace.push({ stepId, output });
        return { text: output, usage: null, toolCalls: [], toolResults: [] };
      },
    });

    // Primary assertion: stepId + output match the golden trace, in completion order.
    expect(trace).toEqual(goldenLoopTrace.map(({ stepId, output }) => ({ stepId, output })));

    // Structural cross-check: per-step call count matches the golden fixture's
    // per-step iteration count — i.e. every declared `iteration` actually ran,
    // confirming `trace`'s order also encodes the right pass count per step.
    const countByStep = (entries: Array<{ stepId: string }>) =>
      entries.reduce<Map<string, number>>((counts, entry) => {
        counts.set(entry.stepId, (counts.get(entry.stepId) ?? 0) + 1);
        return counts;
      }, new Map());
    expect(countByStep(trace)).toEqual(countByStep(goldenLoopTrace));

    // step-c sits outside the loop body ({step-b1, step-b2}): it must run
    // exactly once, strictly after the loop's final (3rd) step-b2 pass.
    const stepIds = trace.map((entry) => entry.stepId);
    const stepCIndex = stepIds.indexOf('step-c');
    expect(stepIds.filter((id) => id === 'step-c')).toHaveLength(1);
    expect(stepIds.filter((id) => id === 'step-b1')).toHaveLength(3);
    expect(stepIds.filter((id) => id === 'step-b2')).toHaveLength(3);
    expect(stepCIndex).toBe(stepIds.lastIndexOf('step-b2') + 1);
    expect(trace[stepCIndex]).toEqual({ stepId: 'step-c', output: 'C output' });
  });
});

// ---------------------------------------------------------------------------
// Suite — contextMode: 'feedback' is additive (Rosetta, spec:
// docs/superpowers/specs/2026-07-10-rosetta-context-manifest.md)
//
// Java/Python downgrade contextMode: 'feedback' to blind on import in v1
// (decision 2) — the cross-runtime CONTRACT this suite otherwise guards is
// therefore untouched by feedback mode today. What this suite instead proves
// for the TS runtime itself: turning feedback mode on for the SAME
// conformance-chain flow this file already golden-traces does not perturb
// that golden-trace text contract — the Rosetta machinery is confined to
// side-channel files under .fluxor/run-context/, never the step outputs a
// future runtime parity check would compare.
// ---------------------------------------------------------------------------

// Linear chain (confirmed by the "canonical DAG order" test above):
// step-a → step-b → step-c → step-d → step-e. Each non-terminal step writes
// a real briefing into its immediate successor's file — satisfying the
// feedback-mode guardrail on the FIRST attempt, so retries never fire and
// the trace stays 1:1 with goldenTrace (a retry would otherwise re-invoke
// runStep and duplicate that step's trace entry).
const NEXT_STEP_ID: Record<string, string> = {
  'step-a': 'step-b',
  'step-b': 'step-c',
  'step-c': 'step-d',
  'step-d': 'step-e',
};

describe('feedback-mode contextMode is additive — does not perturb the golden trace', () => {
  it('produces the SAME golden-trace text with contextMode: "feedback" added, and materializes a run-context manifest on disk', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'fluxor-semantic-parity-feedback-'));
    try {
      const feedbackExportedFlow: FluxorFlowExport = { ...exportedFlow, contextMode: 'feedback' };
      const flow = importFlow(feedbackExportedFlow);
      expect(flow.contextMode).toBe('feedback');

      const trace: Array<{ stepId: string; output: string }> = [];
      const runId = 'run-semantic-parity-feedback';

      await executeAgenticFlow(flow, {
        rootDir: tmpDir,
        runId,
        runStep: async (input) => {
          const stepId = input.step.id;

          // Satisfy the promised-briefing guardrail on the first attempt.
          // Generously long (well beyond any single seeded header + a
          // 140-char purpose line) so it clears minBytes for every target
          // regardless of that target step's own prompt length.
          const nextStepId = NEXT_STEP_ID[stepId];
          if (nextStepId) {
            await input.tools.write_file.execute?.(
              {
                path: `.fluxor/run-context/${runId}/step.${nextStepId}.md`,
                content: `A real, detailed briefing from ${stepId} for ${nextStepId}. `.repeat(10),
              },
              { toolCallId: `briefing-${stepId}`, messages: [] },
            );
          }

          if (stepId === 'step-e') {
            // Same tool-calling scripted shape as the golden-trace suite
            // above — this suite is about proving feedback mode doesn't
            // perturb the OUTPUT, not re-proving tool-calling parity.
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
              steps: [
                {
                  text: '',
                  content: [
                    { type: 'tool-call', toolCallId: 'call_conformance_1', toolName: 'uppercase', input: UPPERCASE_TOOL_ARGS },
                  ],
                  toolCalls: [
                    { toolCallId: 'call_conformance_1', toolName: 'uppercase', input: UPPERCASE_TOOL_ARGS },
                  ],
                  toolResults: [],
                },
                {
                  text: finalText,
                  content: [
                    { type: 'tool-result', toolCallId: 'call_conformance_1', toolName: 'uppercase', output: toolResult },
                    { type: 'text', text: finalText },
                  ],
                  toolCalls: [],
                  toolResults: [
                    { toolCallId: 'call_conformance_1', toolName: 'uppercase', output: toolResult },
                  ],
                },
              ],
            });

            const result = await runLLMStep({ ...input, generateText: scripted });
            trace.push({ stepId, output: result.text });
            return result;
          }

          const scripted = async () => ({
            text: scriptedResponses[stepId] ?? '',
            usage: null,
            toolCalls: [],
            toolResults: [],
            steps: [],
          });
          const result = await runLLMStep({ ...input, generateText: scripted });
          trace.push({ stepId, output: result.text });
          return result;
        },
      });

      // The primary claim: feedback mode is additive. Same golden contract.
      expect(trace).toEqual(goldenTrace);

      // And genesis actually happened (proving "additive" isn't vacuous —
      // the run-context machinery genuinely ran alongside the golden trace).
      const manifestPath = join(tmpDir, '.fluxor', 'run-context', runId, 'manifest.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
      expect(manifest.contextMode).toBe('feedback');
      expect(Object.keys(manifest.steps).sort()).toEqual(
        ['step-a', 'step-b', 'step-c', 'step-d', 'step-e'].sort(),
      );
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('a blind-mode run of the SAME chain (no contextMode) creates no .fluxor/run-context directory at all', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'fluxor-semantic-parity-blind-'));
    try {
      const flow = importFlow(exportedFlow); // exportedFlow carries no contextMode — blind
      expect(flow.contextMode).toBeUndefined();

      await executeAgenticFlow(flow, {
        rootDir: tmpDir,
        runStep: async (input) => {
          const stepId = input.step.id;
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

      await expect(readdir(join(tmpDir, '.fluxor'))).rejects.toThrow();
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
