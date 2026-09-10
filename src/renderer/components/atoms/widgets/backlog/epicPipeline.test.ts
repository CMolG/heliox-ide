import { describe, expect, it } from 'vitest';
import { epicToPipelineAssembly } from './epicPipeline';
import type { BacklogCard } from '@/types/market';

function card(overrides: Partial<BacklogCard>): BacklogCard {
  return {
    filename: `${overrides.taskId}.md`, taskId: 'T', targetAgent: '', targetModule: '',
    priority: 'medium', status: 'todo', runState: 'idle', order: 0, tags: [], estimate: 0,
    assignees: [], related: [], createdAt: '', updatedAt: '', title: 'x', description: 'y',
    comments: [], attachments: [], ...overrides,
  };
}

describe('epicToPipelineAssembly (F3 — deterministic, no LLM)', () => {
  it('produces one step per card, id = sanitized taskId', () => {
    const cards = [card({ taskId: 'TASK-1', title: 'A' }), card({ taskId: 'TASK-2', title: 'B' })];
    const assembly = epicToPipelineAssembly(cards, 'Security');
    expect(assembly.steps).toHaveLength(2);
    expect(assembly.steps.map(s => s.id)).toEqual(['task-1', 'task-2']);
    expect(assembly.frameTitle).toContain('Security');
  });

  it('orders by priority (superHigh first), prevStepIds chain to the immediately preceding step when related[] is empty', () => {
    const cards = [
      card({ taskId: 'LOW', priority: 'low' }),
      card({ taskId: 'HIGH', priority: 'superHigh' }),
    ];
    const assembly = epicToPipelineAssembly(cards, 'E');
    expect(assembly.steps[0].id).toBe('high');
    expect(assembly.steps[1].id).toBe('low');
    expect(assembly.steps[1].prevStepIds).toEqual(['high']);
    expect(assembly.steps[0].prevStepIds).toEqual([]);
  });

  it('uses related[] (filtered to earlier-sorted epic siblings) as prevStepIds instead of the default chain', () => {
    const cards = [
      card({ taskId: 'A', priority: 'high' }),
      card({ taskId: 'B', priority: 'high', related: ['A'] }),
      card({ taskId: 'C', priority: 'low', related: ['A'] }),
    ];
    const assembly = epicToPipelineAssembly(cards, 'E');
    const byId = Object.fromEntries(assembly.steps.map(s => [s.id, s]));
    expect(byId['b'].prevStepIds).toEqual(['a']);
    expect(byId['c'].prevStepIds).toEqual(['a']);
  });

  it('drops a related[] id that points to a LATER step (would invert the DAG) and falls back to chain', () => {
    // Sort order by priority: A(high) -> B(medium) -> C(low). B's related:['C']
    // points FORWARD (C sorts after B) — must be dropped, falling back to the
    // immediately-preceding step (A) instead.
    const cards = [
      card({ taskId: 'A', priority: 'high' }),
      card({ taskId: 'B', priority: 'medium', related: ['C'] }),
      card({ taskId: 'C', priority: 'low' }),
    ];
    const assembly = epicToPipelineAssembly(cards, 'E');
    const byId = Object.fromEntries(assembly.steps.map(s => [s.id, s]));
    expect(byId['b'].prevStepIds).toEqual(['a']);
  });

  it('roleId/modIds default to empty (no forced persona) per meta-agent.ts PipelineAssemblyStep contract', () => {
    const assembly = epicToPipelineAssembly([card({ taskId: 'A' })], 'E');
    expect(assembly.steps[0].roleId).toBe('');
    expect(assembly.steps[0].modIds).toEqual([]);
  });
});
