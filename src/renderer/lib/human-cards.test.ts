import { beforeEach, describe, expect, it, vi } from 'vitest';
import { announceHumanEvents, diffForHumanEvents, isHumanCard, unblockedBy } from './human-cards';
import { useDesktopStore } from '../store/desktop-store';
import { useFluxorStore } from '../store';
import type { BacklogCard } from '@/types/market';

function makeCard(overrides: Partial<BacklogCard> = {}): BacklogCard {
  return {
    filename: 'x.md', taskId: 'JDB-001', targetAgent: '', targetModule: '',
    priority: 'medium', status: 'todo', runState: 'idle', order: 0,
    tags: [], estimate: 0, assignees: [], related: [],
    createdAt: '2026-09-08T00:00:00.000Z', updatedAt: '2026-09-08T00:00:00.000Z',
    title: 'A card', description: '', comments: [], attachments: [],
    ...overrides,
  };
}

function human(overrides: Partial<BacklogCard> = {}): BacklogCard {
  return makeCard({
    filename: 'HUMAN-001-needs-you.md', taskId: 'HUMAN-001', epic: 'HUMAN',
    tags: ['human'], assignees: ['carlos'], title: 'Set a secret on the server',
    ...overrides,
  });
}

describe('isHumanCard', () => {
  it('recognises the prefix, case-insensitively', () => {
    expect(isHumanCard(human())).toBe(true);
    expect(isHumanCard(human({ taskId: 'human-004' }))).toBe(true);
    expect(isHumanCard(human({ taskId: 'Human-004' }))).toBe(true);
  });

  it('is decided by the id alone — a hand-edited epic or tag does not change it', () => {
    expect(isHumanCard(human({ epic: undefined, tags: [] }))).toBe(true);
    expect(isHumanCard(makeCard({ epic: 'HUMAN', tags: ['human'] }))).toBe(false);
  });

  it('does not match an id that merely contains the word', () => {
    expect(isHumanCard(makeCard({ taskId: 'JDB-HUMAN-9' }))).toBe(false);
  });
});

describe('unblockedBy', () => {
  it('reads the forward direction — the HUMAN card names what it unblocks', () => {
    const cards = [
      human({ related: ['JDB-090', 'JDB-191'] }),
      makeCard({ filename: 'a.md', taskId: 'JDB-090' }),
      makeCard({ filename: 'b.md', taskId: 'JDB-191' }),
    ];
    expect(unblockedBy(cards).get('HUMAN-001')!.map((c) => c.taskId)).toEqual(['JDB-090', 'JDB-191']);
  });

  it('reads the reverse direction — a blocked card names the HUMAN card', () => {
    const cards = [
      human(),
      makeCard({ filename: 'a.md', taskId: 'JDB-090', related: ['HUMAN-001'] }),
    ];
    expect(unblockedBy(cards).get('HUMAN-001')!.map((c) => c.taskId)).toEqual(['JDB-090']);
  });

  it('does not list a card twice when both directions are written, as the skill asks', () => {
    const cards = [
      human({ related: ['JDB-090'] }),
      makeCard({ filename: 'a.md', taskId: 'JDB-090', related: ['HUMAN-001'] }),
    ];
    expect(unblockedBy(cards).get('HUMAN-001')!.map((c) => c.taskId)).toEqual(['JDB-090']);
  });

  it('ignores a related id no card in this backlog answers to', () => {
    const cards = [human({ related: ['JDB-999'] })];
    expect(unblockedBy(cards).get('HUMAN-001')).toEqual([]);
  });

  it('never lists the HUMAN card itself', () => {
    const cards = [human({ related: ['HUMAN-001'] })];
    expect(unblockedBy(cards).get('HUMAN-001')).toEqual([]);
  });

  it('gives every HUMAN card an entry, so the lane needs no existence check', () => {
    const index = unblockedBy([human(), human({ filename: 'h2.md', taskId: 'HUMAN-002' }), makeCard()]);
    expect([...index.keys()]).toEqual(['HUMAN-001', 'HUMAN-002']);
  });
});

describe('diffForHumanEvents', () => {
  it('says nothing on the initial load — every card there is pre-existing', () => {
    expect(diffForHumanEvents(null, [human(), human({ filename: 'h2.md', taskId: 'HUMAN-002' })]))
      .toEqual({ newHuman: [], closedHuman: [] });
  });

  it('reports a HUMAN card that was not there before', () => {
    const before = [makeCard()];
    const after = [makeCard(), human()];
    const events = diffForHumanEvents(before, after);
    expect(events.newHuman.map((c) => c.taskId)).toEqual(['HUMAN-001']);
    expect(events.closedHuman).toEqual([]);
  });

  it('ignores a non-HUMAN card appearing', () => {
    expect(diffForHumanEvents([], [makeCard()]).newHuman).toEqual([]);
  });

  it('does not announce a HUMAN card that arrives already closed', () => {
    expect(diffForHumanEvents([], [human({ status: 'deploy' })]).newHuman).toEqual([]);
  });

  it('reports a HUMAN card that moved to deploy', () => {
    const before = [human({ status: 'todo' })];
    const after = [human({ status: 'deploy' })];
    const events = diffForHumanEvents(before, after);
    expect(events.closedHuman.map((c) => c.taskId)).toEqual(['HUMAN-001']);
    expect(events.newHuman).toEqual([]);
  });

  it('does not re-report a card that was already in deploy', () => {
    expect(diffForHumanEvents([human({ status: 'deploy' })], [human({ status: 'deploy' })]).closedHuman)
      .toEqual([]);
  });

  it('reports nothing when nothing changed', () => {
    const cards = [human(), makeCard()];
    expect(diffForHumanEvents(cards, cards)).toEqual({ newHuman: [], closedHuman: [] });
  });
});

describe('announceHumanEvents', () => {
  beforeEach(() => {
    useDesktopStore.setState(useDesktopStore.getInitialState(), true);
    useFluxorStore.setState(useFluxorStore.getInitialState(), true);
    (window as unknown as { fluxorAPI?: unknown }).fluxorAPI = { showNotification: vi.fn() };
  });

  it('raises a notification, a toast and an OS notification for a new HUMAN card', () => {
    announceHumanEvents({ newHuman: [human()], closedHuman: [] }, [human()]);
    expect(useDesktopStore.getState().notifications[0].message)
      .toBe('Needs you: HUMAN-001 Set a secret on the server');
    expect(useFluxorStore.getState().toasts[0].message)
      .toBe('Needs you: HUMAN-001 Set a secret on the server');
    expect(window.fluxorAPI!.showNotification).toHaveBeenCalledWith({
      title: 'Needs you', body: 'HUMAN-001 — Set a secret on the server',
    });
  });

  it('names what a closed HUMAN card just unblocked — a toast only, no notification', () => {
    const cards = [
      human({ status: 'deploy', related: ['JDB-090'] }),
      makeCard({ filename: 'a.md', taskId: 'JDB-090' }),
    ];
    announceHumanEvents({ newHuman: [], closedHuman: [cards[0]] }, cards);
    expect(useFluxorStore.getState().toasts[0]).toMatchObject({
      message: 'HUMAN-001 done · unblocks JDB-090', type: 'success',
    });
    expect(useDesktopStore.getState().notifications).toHaveLength(0);
  });

  it('does not invent an unblocks clause when the card unblocks nothing', () => {
    const card = human({ status: 'deploy' });
    announceHumanEvents({ newHuman: [], closedHuman: [card] }, [card]);
    expect(useFluxorStore.getState().toasts[0].message).toBe('HUMAN-001 done');
  });

  it('touches nothing at all when there is nothing to announce', () => {
    announceHumanEvents({ newHuman: [], closedHuman: [] }, []);
    expect(useDesktopStore.getState().notifications).toHaveLength(0);
    expect(useFluxorStore.getState().toasts).toHaveLength(0);
  });
});
