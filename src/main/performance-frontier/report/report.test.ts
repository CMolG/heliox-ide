import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendLedgerRecord } from './ledger';
import { renderHtmlReport } from './html-report';

let rootDir: string;

describe('performance frontier report outputs', () => {
  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'heliox-pf-report-'));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it('appends immutable JSONL ledger records', async () => {
    const ledgerPath = join(rootDir, 'pf-history.jsonl');

    await appendLedgerRecord(ledgerPath, { runId: 'run-1', finalScore: 91 });
    await appendLedgerRecord(ledgerPath, { runId: 'run-2', finalScore: 72 });

    const lines = (await readFile(ledgerPath, 'utf-8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toMatchObject({ runId: 'run-1', finalScore: 91 });
    expect(JSON.parse(lines[1])).toMatchObject({ runId: 'run-2', finalScore: 72 });
  });

  it('renders a standalone Heliox-styled HTML report', () => {
    const html = renderHtmlReport({
      runId: 'run-1',
      suite: 'architecture',
      caseId: 'case-1',
      modelUnderTest: 'mimo/mimo-v2.5-pro',
      finalScore: 91,
      verdict: 'pass',
      semanticScore: 82,
      telemetryScore: 9,
      evaluations: {},
      criticalFailures: [],
      telemetry: {
        inputTokens: 400,
        outputTokens: 300,
        reasoningTokens: 500,
        cacheReadTokens: 100,
        cacheWriteTokens: 20,
        totalTokens: 1200,
        latencyMs: 900,
        mcpSyntaxPrecision: 1,
      },
      cognitiveTrace: [
        { stepId: 'team-planner', type: 'thought', content: 'I will write content.md.' },
        { stepId: 'team-designer', type: 'tool_call', toolName: 'read_file', content: '{ "path": "content.md" }' },
        { stepId: 'team-developer', type: 'tool_result', toolName: 'read_file', content: 'Hero copy' },
      ],
      generatedArtifacts: [{
        vfsPath: '/workspace/src/Landing.tsx',
        artifactPath: '/tmp/pf-artifacts/run-1/src/Landing.tsx',
        fileUrl: 'file:///tmp/pf-artifacts/run-1/src/Landing.tsx',
        sizeBytes: 42,
      }],
    } as any);

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('--hx-bg');
    expect(html).toContain('Performance Frontier');
    expect(html).toContain('91');
    expect(html).toContain('Cognitive Execution Trace');
    expect(html).toContain('Generated Artifacts');
    expect(html).toContain('Landing.tsx');
    expect(html).toContain('file:///tmp/pf-artifacts/run-1/src/Landing.tsx');
    expect(html).toContain('Prompt Tokens');
    expect(html).toContain('Completion Tokens');
    expect(html).toContain('Reasoning Tokens');
    expect(html).toContain('Cache Read');
    expect(html).toContain('trace-thought');
    expect(html).toContain('team-planner');
    expect(html).toContain('team-designer');
    expect(html).toContain('team-developer');
    expect(html).toContain('read_file');
    expect(html.indexOf('Cognitive Execution Trace')).toBeLessThan(html.indexOf('Judge Evaluation JSON'));
  });

  it('renders Flow Assembler audit sections before the cognitive trace', () => {
    const html = renderHtmlReport({
      runId: 'run-assembler',
      suite: 'flow-assembler',
      caseId: 'pf-flow-assembler-101',
      modelUnderTest: 'mimo/mimo-v2.5-pro',
      finalScore: 91,
      verdict: 'pass',
      semanticScore: 136,
      semanticMaxScore: 150,
      telemetryScore: 10,
      evaluations: {},
      criticalFailures: [],
      telemetry: {
        inputTokens: 400,
        outputTokens: 300,
        reasoningTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 700,
        latencyMs: 900,
        mcpSyntaxPrecision: 1,
      },
      cognitiveTrace: [{ stepId: 'flow-assembler-probe', type: 'thought', content: 'Generated AST.' }],
      flowAssembler: {
        userIntent: 'Crea un pipeline que reciba un ticket de Jira.',
        discoveredCatalog: { roles: [], mods: [] },
        generatedAst: {
          frameTitle: 'Jira Pipeline',
          description: 'Ticket to tests to implementation.',
          missingCapabilitiesRequested: [],
          steps: [
            { id: 'read-ticket', prompt: 'Analyze the ticket.', roleId: 'confident-executor', modIds: [], prevStepIds: [] },
          ],
        },
      },
    } as any);

    expect(html).toContain('User Intent');
    expect(html).toContain('Generated AST (JSON)');
    expect(html).toContain('&quot;frameTitle&quot;: &quot;Jira Pipeline&quot;');
    expect(html).toContain('136/150');
    expect(html.indexOf('User Intent')).toBeLessThan(html.indexOf('Generated AST (JSON)'));
    expect(html.indexOf('Generated AST (JSON)')).toBeLessThan(html.indexOf('Cognitive Execution Trace'));
  });
});
