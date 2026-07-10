import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runPerformanceFrontier } from './runner';

let outputDir: string;

describe('performance frontier runner', () => {
  beforeEach(async () => {
    outputDir = await mkdtemp(join(tmpdir(), 'fluxor-pf-run-'));
  });

  afterEach(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  it('runs the architecture case in the sandbox and writes report artifacts', async () => {
    const result = await runPerformanceFrontier({
      seed: 11,
      outputDir,
      modelId: 'fake/model',
      runStep: async ({ tools }) => {
        await tools.write_file.execute?.({
          path: 'package.json',
          content: '{"scripts":{"dev":"node src/server.js"},"dependencies":{"express":"latest"}}',
        }, { toolCallId: 'tool-1', messages: [] });
        await tools.write_file.execute?.({
          path: 'src/server.js',
          content: 'const express = require("express");',
        }, { toolCallId: 'tool-2', messages: [] });
        return {
          text: 'Created Express API files.',
          usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140 },
          toolCalls: [{ toolName: 'write_file' }, { toolName: 'write_file' }],
          toolResults: [{}, {}],
        };
      },
      judge: async (input) => ({
        runId: input.runId,
        caseId: input.caseId,
        suite: input.suite,
        modelUnderTest: input.modelUnderTest,
        verdict: 'pass',
        finalScore: 94,
        semanticScore: 85,
        telemetryScore: 9,
        evaluations: {
          telemetryEfficiency: {
            score: 9,
            justification: 'Efficient run.',
            latencyMs: input.telemetry.latencyMs,
            totalTokens: input.telemetry.totalTokens,
          },
        },
        criticalFailures: [],
        telemetry: input.telemetry,
      } as any),
    });

    expect(result.finalScore).toBe(94);
    await expect(readFile(result.reportPath, 'utf-8')).resolves.toContain('Performance Frontier');
    await expect(readFile(result.ledgerPath, 'utf-8')).resolves.toContain('"finalScore":94');
  });

  it('passes the configured PF step timeout into the step runner', async () => {
    await runPerformanceFrontier({
      seed: 3,
      outputDir,
      modelId: 'fake/model',
      stepTimeoutMs: 321_000,
      runStep: async ({ timeoutMs }) => {
        expect(timeoutMs).toBe(321_000);
        return {
          text: 'ok',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          toolCalls: [],
          toolResults: [],
        };
      },
      judge: async (input) => ({
        runId: input.runId,
        caseId: input.caseId,
        suite: input.suite,
        modelUnderTest: input.modelUnderTest,
        verdict: 'pass',
        finalScore: 90,
        semanticScore: 80,
        telemetryScore: 10,
        evaluations: {
          telemetryEfficiency: {
            score: 10,
            justification: 'ok',
            latencyMs: input.telemetry.latencyMs,
            totalTokens: input.telemetry.totalTokens,
          },
        },
        criticalFailures: [],
        telemetry: input.telemetry,
        cognitiveTrace: input.cognitiveTrace,
      } as any),
    });
  });

  it('runs the analysis case with seeded VFS files and cognitive trace in the report', async () => {
    const result = await runPerformanceFrontier({
      suite: 'analysis',
      seed: 12,
      outputDir,
      modelId: 'fake/model',
      runStep: async ({ tools }) => {
        const file = await tools.read_file.execute?.({
          path: 'src/user-loader.ts',
        }, { toolCallId: 'tool-1', messages: [] });
        const fileText = String(file?.content[0]?.text ?? '');
        expect(fileText).toContain('records.map');
        expect(fileText).toContain('Promise.all');

        return {
          text: 'The concurrency bug is the missing await on the records.map load line.',
          usage: { inputTokens: 80, outputTokens: 30, totalTokens: 110 },
          toolCalls: [{ toolName: 'read_file' }],
          toolResults: [{}],
          cognitiveTrace: [
            { type: 'thought', content: 'I should inspect src/user-loader.ts.' },
            { type: 'tool_call', toolName: 'read_file', content: '{\n  "path": "src/user-loader.ts"\n}' },
            { type: 'tool_result', toolName: 'read_file', content: fileText },
          ],
        };
      },
      judge: async (input) => {
        expect(input.suite).toBe('analysis');
        expect(input.vfsSnapshot['/workspace/src/user-loader.ts']).toContain('records.map');
        expect(input.cognitiveTrace).toHaveLength(3);

        return {
          runId: input.runId,
          caseId: input.caseId,
          suite: input.suite,
          modelUnderTest: input.modelUnderTest,
          verdict: 'pass',
          finalScore: 92,
          semanticScore: 83,
          telemetryScore: 9,
          evaluations: {
            telemetryEfficiency: {
              score: 9,
              justification: 'Efficient analysis run.',
              latencyMs: input.telemetry.latencyMs,
              totalTokens: input.telemetry.totalTokens,
            },
          },
          criticalFailures: [],
          telemetry: input.telemetry,
        } as any;
      },
    });

    const html = await readFile(result.reportPath, 'utf-8');
    expect(result.suite).toBe('analysis');
    expect(html).toContain('Cognitive Execution Trace');
    expect(html).toContain('I should inspect src/user-loader.ts.');
  });

  it('runs the flow assembler suite through the Meta-Agent and renders AST evidence', async () => {
    const result = await runPerformanceFrontier({
      suite: 'flow-assembler',
      seed: 101,
      outputDir,
      modelId: 'fake/model',
      assemblePipeline: async (userIntent, assembleOptions) => {
        assembleOptions?.onGeneration?.({
          discoveredCatalog: {
            roles: [{ id: 'confident-executor', name: 'ConfidentExecutor', description: 'Executor', systemPrompt: 'Run efficiently.' }],
            mods: [{ id: 'anti-verification-interceptor', name: 'AntiVerificationInterceptor', type: 'system_override', description: 'Avoid verification noise.' }],
          },
          usage: { inputTokens: 120, outputTokens: 60, totalTokens: 180 },
          latencyMs: 25,
        });
        expect(userIntent).toContain('ticket de Jira');
        return {
          frameTitle: 'Jira Delivery Pipeline',
          description: 'Turns a Jira ticket into tests and implementation.',
          missingCapabilitiesRequested: [],
          steps: [
            { id: 'read-ticket', prompt: 'Extract acceptance criteria from the Jira ticket.', roleId: 'confident-executor', modIds: [], prevStepIds: [] },
            { id: 'write-tests', prompt: 'Write unit tests that encode the acceptance criteria.', roleId: 'confident-executor', modIds: ['anti-verification-interceptor'], prevStepIds: ['read-ticket'] },
            { id: 'implement-function', prompt: 'Implement the minimal function that satisfies the tests.', roleId: 'confident-executor', modIds: ['anti-verification-interceptor'], prevStepIds: ['write-tests'] },
          ],
        };
      },
      judge: async (input) => {
        expect(input.suite).toBe('flow-assembler');
        expect(input.flowAssembler?.userIntent).toContain('ticket de Jira');
        expect(input.flowAssembler?.generatedAst.frameTitle).toBe('Jira Delivery Pipeline');
        expect(input.flowAssembler?.discoveredCatalog.roles[0]?.id).toBe('confident-executor');
        expect(input.vfsSnapshot).toEqual({});
        expect(input.telemetry.stepCount).toBe(1);

        return {
          runId: input.runId,
          caseId: input.caseId,
          suite: input.suite,
          modelUnderTest: input.modelUnderTest,
          verdict: 'pass',
          finalScore: 93,
          semanticScore: 140,
          semanticMaxScore: 150,
          telemetryScore: 10,
          evaluations: {
            dagValidity: {
              score: 20,
              justification: 'Valid DAG.',
              missingDependencyIds: [],
              cycleDetected: false,
            },
            componentSelection: {
              score: 20,
              justification: 'Uses discovered components.',
              inappropriateRoleIds: [],
              inappropriateModIds: [],
            },
            instructionQuality: {
              score: 20,
              justification: 'Delegated prompts.',
              weakStepIds: [],
              selfSolvingDetected: false,
            },
            telemetryEfficiency: {
              score: 10,
              justification: 'Efficient assembler run.',
              latencyMs: input.telemetry.latencyMs,
              totalTokens: input.telemetry.totalTokens,
            },
          },
          criticalFailures: [],
          telemetry: input.telemetry,
          cognitiveTrace: input.cognitiveTrace,
          flowAssembler: input.flowAssembler,
        } as any;
      },
    });

    const html = await readFile(result.reportPath, 'utf-8');
    expect(result.suite).toBe('flow-assembler');
    expect(html).toContain('User Intent');
    expect(html).toContain('Generated AST (JSON)');
    expect(html).toContain('Jira Delivery Pipeline');
    expect(html.indexOf('Generated AST (JSON)')).toBeLessThan(html.indexOf('Cognitive Execution Trace'));
  });

  it('runs the progression suite as two epochs on a shared, non-destroyed VFS', async () => {
    const epochStepOrder: string[] = [];
    let epoch2SawEpoch1Avatar = false;

    const result = await runPerformanceFrontier({
      suite: 'progression',
      seed: 5,
      outputDir,
      modelId: 'fake/model',
      runStep: async ({ step, tools }) => {
        epochStepOrder.push(step.id);

        if (step.id === 'epoch-1-root') {
          await tools.write_file.execute?.({
            path: 'src/routes/avatars.js',
            content: "// POST /users/:id/avatar — added in Epoch 1",
          }, { toolCallId: 'e1-write', messages: [] });
          return {
            text: 'Added the avatar upload endpoint.',
            usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
            toolCalls: [{ toolName: 'write_file' }],
            toolResults: [{}],
            cognitiveTrace: [{ type: 'thought', content: 'Adding the avatar endpoint.' }],
          };
        }

        // Epoch 2 must see Epoch 1's file on the SAME, non-destroyed VFS.
        const avatar = await tools.read_file.execute?.({
          path: 'src/routes/avatars.js',
        }, { toolCallId: 'e2-read', messages: [] });
        epoch2SawEpoch1Avatar = String(avatar?.content[0]?.text ?? '').includes('avatar');
        await tools.write_file.execute?.({
          path: 'src/middleware/auth.js',
          content: '// JWT auth with refresh tokens — refactored in Epoch 2',
        }, { toolCallId: 'e2-write', messages: [] });
        return {
          text: 'Refactored auth to JWT with refresh tokens.',
          usage: { inputTokens: 60, outputTokens: 25, totalTokens: 85 },
          toolCalls: [{ toolName: 'read_file' }, { toolName: 'write_file' }],
          toolResults: [{}, {}],
          cognitiveTrace: [{ type: 'thought', content: 'Refactoring auth to JWT.' }],
        };
      },
      judge: async (input) => {
        expect(input.suite).toBe('progression');
        expect(input.progression?.epochs).toHaveLength(2);
        expect(input.progression?.epochs[0].vfsSnapshot['/workspace/src/routes/avatars.js']).toContain('avatar');
        expect(input.progression?.epochs[1].vfsSnapshot['/workspace/src/middleware/auth.js']).toContain('JWT');
        // The avatar endpoint from Epoch 1 survives into Epoch 2's snapshot.
        expect(input.progression?.epochs[1].vfsSnapshot['/workspace/src/routes/avatars.js']).toContain('avatar');
        // The seeded Epoch 0 routes are still present in the cumulative final VFS.
        expect(input.vfsSnapshot['/workspace/src/routes/health.js']).toContain('status');
        expect(input.cognitiveTrace.map((entry) => entry.epoch)).toEqual(['epoch-1', 'epoch-2']);

        return {
          runId: input.runId,
          caseId: input.caseId,
          suite: input.suite,
          modelUnderTest: input.modelUnderTest,
          verdict: 'pass',
          finalScore: 88,
          semanticScore: 100,
          semanticMaxScore: 120,
          telemetryScore: 9,
          evaluations: {
            regressionScore: {
              score: 28,
              justification: 'No regressions: avatar endpoint intact after the auth refactor.',
              brokenEpoch1Features: [],
              unintendedDependencyChanges: [],
            },
            telemetryEfficiency: {
              score: 9,
              justification: 'Efficient brownfield run.',
              latencyMs: input.telemetry.latencyMs,
              totalTokens: input.telemetry.totalTokens,
            },
          },
          criticalFailures: [],
          telemetry: input.telemetry,
          cognitiveTrace: input.cognitiveTrace,
          progression: input.progression,
        } as any;
      },
    });

    const html = await readFile(result.reportPath, 'utf-8');
    expect(epochStepOrder).toEqual(['epoch-1-root', 'epoch-2-root']);
    expect(epoch2SawEpoch1Avatar).toBe(true);
    expect(result.suite).toBe('progression');
    expect(html).toContain('Progression — Epoch Evolution');
    expect(html).toContain('Epoch 1');
    expect(html).toContain('Epoch 2');
    expect(html).toContain('src/middleware/auth.js');
  });

  it('passes verifyDevelopment ground-truth results to the judge and surfaces them in the HTML report', async () => {
    let capturedGroundTruth: unknown;

    const result = await runPerformanceFrontier({
      suite: 'development',
      seed: 1,
      outputDir,
      modelId: 'fake/model',
      runStep: async ({ tools }) => {
        await tools.write_file.execute?.({
          path: 'calculator.ts',
          content: 'export function add(a: number, b: number): number { return a + b; }',
        }, { toolCallId: 'tool-calc', messages: [] });
        return {
          text: 'Wrote calculator.ts implementation.',
          usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
          toolCalls: [{ toolName: 'write_file' }],
          toolResults: [{}],
        };
      },
      verifyDevelopment: async (_vfsSnapshot) => ({
        ran: true,
        passed: 11,
        failed: 2,
        total: 13,
        output: '',
      }),
      judge: async (input) => {
        capturedGroundTruth = input.groundTruth;
        expect(input.groundTruth?.tests?.passed).toBe(11);
        expect(input.groundTruth?.tests?.failed).toBe(2);
        expect(input.groundTruth?.tests?.total).toBe(13);
        expect(input.groundTruth?.tests?.ran).toBe(true);

        return {
          runId: input.runId,
          caseId: input.caseId,
          suite: input.suite,
          modelUnderTest: input.modelUnderTest,
          verdict: 'partial',
          finalScore: 72,
          semanticScore: 63,
          telemetryScore: 9,
          evaluations: {
            telemetryEfficiency: {
              score: 9,
              justification: 'ok',
              latencyMs: input.telemetry.latencyMs,
              totalTokens: input.telemetry.totalTokens,
            },
          },
          criticalFailures: [],
          telemetry: input.telemetry,
          groundTruth: input.groundTruth,
        } as any;
      },
    });

    expect(capturedGroundTruth).toMatchObject({ tests: { ran: true, passed: 11, failed: 2, total: 13 } });
    const html = await readFile(result.reportPath, 'utf-8');
    expect(html).toContain('Ground Truth');
    expect(html).toContain('11');
  });

  it('orchestrates the team-work DAG through planner, designer, and developer handoffs', async () => {
    const stepOrder: string[] = [];
    const result = await runPerformanceFrontier({
      suite: 'team-work',
      seed: 42,
      outputDir,
      modelId: 'fake/model',
      runStep: async ({ step, tools }) => {
        stepOrder.push(step.id);

        if (step.id === 'team-planner') {
          await tools.write_file.execute?.({
            path: 'content.md',
            content: '# FluxPilot\n\nHero: Coordinate AI delivery teams without copy drift.',
          }, { toolCallId: 'tool-plan', messages: [] });
          return {
            text: 'content.md created.',
            usage: { inputTokens: 30, outputTokens: 20, totalTokens: 50 },
            toolCalls: [{ toolName: 'write_file' }],
            toolResults: [{}],
            cognitiveTrace: [{ type: 'thought', content: 'Planner writes the approved landing copy.' }],
          };
        }

        if (step.id === 'team-designer') {
          const copy = await tools.read_file.execute?.({
            path: 'content.md',
          }, { toolCallId: 'tool-read-copy', messages: [] });
          expect(String(copy?.content[0]?.text ?? '')).toContain('FluxPilot');
          await tools.write_file.execute?.({
            path: 'theme.json',
            content: '{"primary":"#38bdf8","accent":"#f0abfc","surface":"#020617"}',
          }, { toolCallId: 'tool-theme', messages: [] });
          return {
            text: 'theme.json created.',
            usage: { inputTokens: 35, outputTokens: 20, totalTokens: 55 },
            toolCalls: [{ toolName: 'read_file' }, { toolName: 'write_file' }],
            toolResults: [{}, {}],
            cognitiveTrace: [{ type: 'thought', content: 'Designer derives theme from content.md.' }],
          };
        }

        const copy = await tools.read_file.execute?.({
          path: 'content.md',
        }, { toolCallId: 'tool-read-copy-dev', messages: [] });
        const theme = await tools.read_file.execute?.({
          path: 'theme.json',
        }, { toolCallId: 'tool-read-theme-dev', messages: [] });
        expect(String(copy?.content[0]?.text ?? '')).toContain('FluxPilot');
        expect(String(theme?.content[0]?.text ?? '')).toContain('#38bdf8');
        await tools.write_file.execute?.({
          path: 'index.html',
          content: '<!doctype html><html><head><script src="https://cdn.tailwindcss.com"></script><script>tailwind.config={theme:{extend:{colors:{primary:"#38bdf8",surface:"#020617"}}}}</script></head><body class="bg-surface text-primary">FluxPilot</body></html>',
        }, { toolCallId: 'tool-dev', messages: [] });
        return {
          text: 'index.html created.',
          usage: { inputTokens: 40, outputTokens: 40, totalTokens: 80 },
          toolCalls: [{ toolName: 'read_file' }, { toolName: 'read_file' }, { toolName: 'write_file' }],
          toolResults: [{}, {}, {}],
          cognitiveTrace: [{ type: 'thought', content: 'Developer preserves copy and theme in zero-build index.html.' }],
        };
      },
      judge: async (input) => {
        expect(input.suite).toBe('team-work');
        expect(input.vfsSnapshot['/workspace/content.md']).toContain('FluxPilot');
        expect(input.vfsSnapshot['/workspace/theme.json']).toContain('#38bdf8');
        expect(input.vfsSnapshot['/workspace/index.html']).toContain('https://cdn.tailwindcss.com');
        expect(input.vfsSnapshot['/workspace/index.html']).toContain('tailwind.config');
        expect(input.vfsSnapshot['/workspace/index.html']).toContain('FluxPilot');
        expect(input.cognitiveTrace.map((entry) => entry.stepId)).toEqual([
          'team-planner',
          'team-designer',
          'team-developer',
        ]);

        return {
          runId: input.runId,
          caseId: input.caseId,
          suite: input.suite,
          modelUnderTest: input.modelUnderTest,
          verdict: 'pass',
          finalScore: 96,
          semanticScore: 86,
          telemetryScore: 10,
          evaluations: {
            pipelineCohesion: {
              score: 20,
              justification: 'Developer preserved Step A copy and Step B theme.',
              handoffBreaks: [],
            },
            telemetryEfficiency: {
              score: 10,
              justification: 'Efficient team run.',
              latencyMs: input.telemetry.latencyMs,
              totalTokens: input.telemetry.totalTokens,
            },
          },
          criticalFailures: [],
          telemetry: input.telemetry,
          cognitiveTrace: input.cognitiveTrace,
        } as any;
      },
    });

    const html = await readFile(result.reportPath, 'utf-8');
    const ledger = await readFile(result.ledgerPath, 'utf-8');
    expect(stepOrder).toEqual(['team-planner', 'team-designer', 'team-developer']);
    expect(result.suite).toBe('team-work');
    expect(result.artifactsDir).toContain(join(outputDir, 'artifacts'));
    await expect(readFile(join(result.artifactsDir, 'index.html'), 'utf-8'))
      .resolves
      .toContain('https://cdn.tailwindcss.com');
    expect(result.generatedArtifacts.some((artifact) => artifact.vfsPath === '/workspace/index.html'))
      .toBe(true);
    expect(html).toContain('team-planner');
    expect(html).toContain('team-designer');
    expect(html).toContain('team-developer');
    expect(html).toContain('Generated Artifacts');
    expect(html).toContain('index.html');
    expect(ledger).toContain('"suite":"team-work"');
    expect(ledger).toContain('"artifactsDir"');
  });
});
