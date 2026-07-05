/**
 * flow-markdown.test.ts — Golden-string tests for flowToMarkdown
 *
 * Strategy: exact `.toBe(...)` matches against hand-built `AgenticFlow`
 * fixtures (not snapshots) so any accidental formatting drift is immediately
 * visible in a readable diff. See flow-markdown.ts's header doc-comment for
 * the output contract these fixtures exercise.
 */
import { describe, expect, it } from 'vitest';
import { flowToMarkdown } from './flow-markdown';
import type { AgenticFlow, AgenticStep } from '@/types/harness';

// ── Minimal flow: 1 step, no flow-level meta, no optional step fields ──────

describe('flowToMarkdown — minimal flow (1 step, no meta)', () => {
  const flow: AgenticFlow = {
    id: 'flow-min',
    name: 'Minimal Flow',
    rootStepId: 'step-a',
    stepsRecord: {
      'step-a': {
        id: 'step-a',
        type: 'llm_call',
        prompt: 'Say hello.',
        tools: [],
        prevStepIds: [],
        nextStepIds: [],
        mods: [],
        roles: [],
        mentalContext: [],
      },
    },
  };

  it('renders exactly the H1, step heading, type, and prompt fence — every optional section omitted', () => {
    expect(flowToMarkdown(flow)).toBe(
      '# Minimal Flow\n'
      + '\n'
      + '## step-a\n'
      + '\n'
      + 'Type: llm_call\n'
      + '\n'
      + 'Prompt:\n'
      + '```\n'
      + 'Say hello.\n'
      + '```\n',
    );
  });
});

// ── Full flow: meta, 3 steps with deps, role systemPrompt, tools, model
// override, and 1 loop ──────────────────────────────────────────────────────

describe('flowToMarkdown — full flow (meta, deps, role, tools, model override, loop)', () => {
  const stepA: AgenticStep = {
    id: 'step-a',
    type: 'llm_call',
    prompt: 'Research the topic.',
    tools: [{ id: 'web-search', name: 'web-search' }],
    prevStepIds: [],
    nextStepIds: ['step-b'],
    mods: [],
    roles: [{ id: 'exported-role', name: 'ExportedRole', systemPrompt: 'You are a meticulous researcher.' }],
    mentalContext: [],
    description: 'Kick off the flow.',
  };
  const stepB: AgenticStep = {
    id: 'step-b',
    type: 'tool_call',
    prompt: 'Draft the report.',
    tools: [{ id: 'file-write', name: 'file-write' }, { id: 'web-search', name: 'web-search' }],
    prevStepIds: ['step-a'],
    nextStepIds: ['step-c'],
    mods: [],
    roles: [],
    mentalContext: [],
  };
  const stepC: AgenticStep = {
    id: 'step-c',
    type: 'llm_call',
    prompt: 'Summarize the findings.',
    tools: [],
    prevStepIds: ['step-b'],
    nextStepIds: [],
    mods: [],
    roles: [],
    mentalContext: [],
    model: 'anthropic/claude-opus-4.6',
  };

  /** Builds the same flow with `stepsRecord` keys inserted in a different order. */
  function buildFlow(order: 'a-b-c' | 'c-a-b'): AgenticFlow {
    return {
      id: 'flow-full',
      name: 'Full Flow',
      rootStepId: 'step-a',
      description: 'An end-to-end example flow.',
      tags: ['demo', 'full'],
      author: 'Ada Lovelace',
      version: '1.2.0',
      stepsRecord: order === 'a-b-c'
        ? { 'step-a': stepA, 'step-b': stepB, 'step-c': stepC }
        : { 'step-c': stepC, 'step-a': stepA, 'step-b': stepB },
      loops: [{ id: 'loop-1', sourceStepId: 'step-b', targetStepId: 'step-a', maxIterations: 3 }],
    };
  }

  const EXPECTED = [
    '# Full Flow',
    '',
    'Description: An end-to-end example flow.',
    'Tags: demo, full',
    'Author: Ada Lovelace',
    'Version: 1.2.0',
    '',
    '## step-a',
    '',
    'Type: llm_call',
    '',
    'Description: Kick off the flow.',
    '',
    'Prompt:',
    '```',
    'Research the topic.',
    '```',
    '',
    'Role prompt:',
    '```',
    'You are a meticulous researcher.',
    '```',
    '',
    'Tools:',
    '- web-search',
    '',
    '## step-b',
    '',
    'Type: tool_call',
    '',
    'Prompt:',
    '```',
    'Draft the report.',
    '```',
    '',
    'Tools:',
    '- file-write',
    '- web-search',
    '',
    'Depends on:',
    '- step-a',
    '',
    '## step-c',
    '',
    'Type: llm_call',
    '',
    'Prompt:',
    '```',
    'Summarize the findings.',
    '```',
    '',
    'Depends on:',
    '- step-b',
    '',
    'Model: anthropic/claude-opus-4.6',
    '',
    '## Loops',
    '',
    'step-b → step-a ×3',
  ].join('\n') + '\n';

  it('renders the exact expected Markdown (steps in dependency order: a, b, c)', () => {
    expect(flowToMarkdown(buildFlow('a-b-c'))).toBe(EXPECTED);
  });

  it('is deterministic: calling twice on the same input yields identical output', () => {
    const flow = buildFlow('a-b-c');
    expect(flowToMarkdown(flow)).toBe(flowToMarkdown(flow));
  });

  it('is deterministic regardless of stepsRecord insertion order (shuffled -> same output)', () => {
    const shuffled = flowToMarkdown(buildFlow('c-a-b'));
    expect(shuffled).toBe(EXPECTED);
    expect(shuffled).toBe(flowToMarkdown(buildFlow('a-b-c')));
  });
});
