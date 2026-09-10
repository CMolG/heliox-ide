import { describe, expect, it } from 'vitest';
import { MAX_LAUNCH_PROMPT_CHARS, buildLaunchPrompt } from './launch-prompt';
import type { BacklogCard } from '@/types/market';

function makeCard(overrides: Partial<BacklogCard> = {}): BacklogCard {
  return {
    filename: 'JDB-001-probe.md', taskId: 'JDB-001', targetAgent: '', targetModule: '',
    priority: 'high', status: 'todo', runState: 'idle', order: 0,
    epic: 'harness', tags: ['fluxor', 'backlog'], estimate: 4, assignees: [], related: ['JDB-027'],
    createdAt: '2026-09-08T00:00:00.000Z', updatedAt: '2026-09-08T00:00:00.000Z',
    title: 'Probe card', description: 'A card the e2e launches.',
    comments: [], attachments: [],
    ...overrides,
  };
}

const CTX = { cardRelativePath: '.backlog/JDB-001-probe.md' };

describe('buildLaunchPrompt', () => {
  it('names the card and points at the file rather than pasting its body', () => {
    const prompt = buildLaunchPrompt(makeCard(), CTX);
    expect(prompt).toContain('JDB-001 — Probe card');
    expect(prompt).toContain('The card file is .backlog/JDB-001-probe.md; read it in full first.');
    // The description lives in the file; a second copy in argv would go stale
    // the moment the agent edits it.
    expect(prompt).not.toContain('A card the e2e launches.');
  });

  it('carries both mandatory moves in the backlog skill\'s own terms, and the deploy refusal', () => {
    const prompt = buildLaunchPrompt(makeCard(), CTX);
    expect(prompt).toContain('move the card to doing with runState running');
    expect(prompt).toContain('move it to review with runState completed');
    expect(prompt).toContain('what you tested and what remains untested');
    expect(prompt).toContain('Never move a card to deploy');
  });

  it('offers the backlog CLI with the card id substituted, and the fallback when it is absent', () => {
    const prompt = buildLaunchPrompt(makeCard(), CTX);
    expect(prompt).toContain('python3 .harness/skills/backlog/backlog.py move JDB-001 doing --run-state running');
    expect(prompt).toContain('… move JDB-001 review --run-state completed');
    expect(prompt).toContain('… comment JDB-001 --text');
    expect(prompt).toContain('otherwise edit the frontmatter status/runState and append under ## Comments');
  });

  it('carries the HUMAN rule, with what triggers it and the instruction to stop', () => {
    const prompt = buildLaunchPrompt(makeCard(), CTX);
    expect(prompt).toContain('only a person can do');
    expect(prompt).toContain('a secret, money, a legal call, a reboot');
    expect(prompt).toContain('--human');
    expect(prompt).toContain('--related JDB-001');
    expect(prompt).toContain('and stop');
  });

  it('ends with the plain-text metadata line the prehook\'s atom market reads', () => {
    const prompt = buildLaunchPrompt(makeCard(), CTX);
    const last = prompt.split('\n').at(-1);
    expect(last).toBe('Priority: high · Epic: harness · Tags: fluxor, backlog · Related: JDB-027');
  });

  it('renders an em dash rather than an empty field when epic/tags/related are absent', () => {
    const prompt = buildLaunchPrompt(makeCard({ epic: undefined, tags: [], related: [] }), CTX);
    expect(prompt.split('\n').at(-1)).toBe('Priority: high · Epic: — · Tags: — · Related: —');
  });

  it('carries no persona and no system prompt — that is the project\'s own harness', () => {
    const prompt = buildLaunchPrompt(makeCard(), CTX);
    expect(prompt.toLowerCase()).not.toContain('you are a');
    expect(prompt.toLowerCase()).not.toContain('senior engineer');
  });

  it('stays under the ceiling for a normal card', () => {
    expect(buildLaunchPrompt(makeCard(), CTX).length).toBeLessThanOrEqual(MAX_LAUNCH_PROMPT_CHARS);
  });

  it('stays under the ceiling for an absurd card, shedding the metadata first and the title next', () => {
    const monstrous = makeCard({
      title: 'x'.repeat(600),
      tags: Array.from({ length: 60 }, (_, i) => `tag-number-${i}`),
      related: Array.from({ length: 60 }, (_, i) => `JDB-${i}`),
    });
    const prompt = buildLaunchPrompt(monstrous, { cardRelativePath: `.backlog/${'y'.repeat(200)}.md` });
    expect(prompt.length).toBeLessThanOrEqual(MAX_LAUNCH_PROMPT_CHARS);
    // Whatever it sheds, the id and the two mandatory moves are not negotiable.
    expect(prompt).toContain('JDB-001');
    expect(prompt).toContain('move the card to doing with runState running');
  });

  it('falls back to the filename when a card has no task id', () => {
    const prompt = buildLaunchPrompt(makeCard({ taskId: '' }), CTX);
    expect(prompt.startsWith('JDB-001-probe.md — Probe card')).toBe(true);
  });
});
