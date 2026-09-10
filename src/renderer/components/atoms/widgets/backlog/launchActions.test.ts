import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDesktopStore } from '@/renderer/store/desktop-store';
import { useHarnessStore } from '@/renderer/store/harness-store';
import { cardPathForPrompt, launchAgentSession, launchAutoflow, launchEpicFlow, launchExistingFlow } from './launchActions';
import type { BacklogCard } from '@/types/market';
import type { PipelineAssembly } from '@/types/meta-agent';

function makeCard(overrides: Partial<BacklogCard> = {}): BacklogCard {
  return {
    filename: 't1.md', taskId: 'TASK-1', targetAgent: '', targetModule: '',
    priority: 'medium', status: 'todo', runState: 'idle', order: 0,
    tags: [], estimate: 4, assignees: [], related: [],
    createdAt: '2026-07-08T00:00:00.000Z', updatedAt: '2026-07-08T00:00:00.000Z',
    title: 'Ship auth', description: 'Add 2FA support.',
    comments: [], attachments: [],
    ...overrides,
  };
}

function makeAssembly(): PipelineAssembly {
  return {
    frameTitle: 'Ship auth',
    description: 'A deterministic two-step flow.',
    missingCapabilitiesRequested: [],
    steps: [
      { id: 'root', prompt: 'Root step', roleId: '', modIds: [], prevStepIds: [] },
      { id: 'next', prompt: 'Next step', roleId: '', modIds: [], prevStepIds: ['root'] },
    ],
  };
}

beforeEach(() => {
  useDesktopStore.setState(useDesktopStore.getInitialState(), true);
  useHarnessStore.setState(useHarnessStore.getInitialState(), true);
  delete window.fluxorAPI;
});

describe('launchExistingFlow (F3 mode 1 — en flow existente)', () => {
  it('injects the card as context onto the frame\'s compiled flow and optimistically marks it doing/running', async () => {
    const desktop = useDesktopStore.getState();
    const rootId = desktop.addStepNode({ id: 'step-root', title: 'Root', prompt: 'Root prompt' });
    const frameId = desktop.addFrameNode({ position: { x: 0, y: 0 }, width: 400, height: 300, title: 'Flow', childIds: [rootId] });
    const card = makeCard();
    useDesktopStore.setState({ backlogCards: [card] });

    const startHarness = vi.fn().mockResolvedValue({ success: true });
    const updateBacklogCardStatus = vi.fn().mockResolvedValue({ success: true });
    window.fluxorAPI = { startHarness, onHarnessEvent: vi.fn(() => vi.fn()), updateBacklogCardStatus } as any;

    await launchExistingFlow(card, frameId, '/proj/.backlog');

    expect(startHarness).toHaveBeenCalledTimes(1);
    const dispatchedFlow = startHarness.mock.calls[0][0];
    expect(dispatchedFlow.stepsRecord[rootId].prompt).toBe('Ship auth\n\nAdd 2FA support.\n\n---\n\nRoot prompt');

    expect(updateBacklogCardStatus).toHaveBeenCalledWith('/proj/.backlog', 't1.md', 'doing', undefined, 'running');
    expect(useDesktopStore.getState().backlogCards[0]).toMatchObject({ status: 'doing', runState: 'running' });
    // No canvas node created by the launcher itself.
    expect(useDesktopStore.getState().mentalNodes).toHaveLength(2); // the pre-existing step + frame only
  });

  it('registers the frame\'s root step in backlogRunCorrelation before dispatch (F4)', async () => {
    const desktop = useDesktopStore.getState();
    const rootId = desktop.addStepNode({ id: 'step-root', title: 'Root' });
    const frameId = desktop.addFrameNode({ position: { x: 0, y: 0 }, width: 400, height: 300, title: 'Flow', childIds: [rootId] });
    const card = makeCard();
    useDesktopStore.setState({ backlogCards: [card] });
    window.fluxorAPI = {
      startHarness: vi.fn().mockResolvedValue({ success: true }),
      onHarnessEvent: vi.fn(() => vi.fn()),
      updateBacklogCardStatus: vi.fn().mockResolvedValue({ success: true }),
    } as any;

    await launchExistingFlow(card, frameId, '/proj/.backlog');

    expect(useDesktopStore.getState().backlogRunCorrelation[rootId]).toEqual({
      backlogDir: '/proj/.backlog', filename: 't1.md',
    });
  });

  it('does not register a correlation entry when backlogDir is unknown (null)', async () => {
    const desktop = useDesktopStore.getState();
    const rootId = desktop.addStepNode({ id: 'step-root', title: 'Root' });
    const frameId = desktop.addFrameNode({ position: { x: 0, y: 0 }, width: 400, height: 300, title: 'Flow', childIds: [rootId] });
    window.fluxorAPI = {
      startHarness: vi.fn().mockResolvedValue({ success: true }),
      onHarnessEvent: vi.fn(() => vi.fn()),
    } as any;

    await launchExistingFlow(makeCard(), frameId, null);

    expect(useDesktopStore.getState().backlogRunCorrelation).toEqual({});
  });

  it('does not register a correlation entry when the frame cannot be found', async () => {
    window.fluxorAPI = {
      startHarness: vi.fn().mockResolvedValue({ success: true }),
      onHarnessEvent: vi.fn(() => vi.fn()),
    } as any;

    await launchExistingFlow(makeCard(), 'does-not-exist', '/proj/.backlog');

    expect(useDesktopStore.getState().backlogRunCorrelation).toEqual({});
  });

  it('patches an open canvasModalCard in place when it matches the launched card', async () => {
    const desktop = useDesktopStore.getState();
    const rootId = desktop.addStepNode({ id: 'step-root', title: 'Root' });
    const frameId = desktop.addFrameNode({ position: { x: 0, y: 0 }, width: 400, height: 300, title: 'Flow', childIds: [rootId] });
    const card = makeCard();
    useDesktopStore.setState({ backlogCards: [card], canvasModalCard: card });
    window.fluxorAPI = {
      startHarness: vi.fn().mockResolvedValue({ success: true }),
      onHarnessEvent: vi.fn(() => vi.fn()),
      updateBacklogCardStatus: vi.fn().mockResolvedValue({ success: true }),
    } as any;

    await launchExistingFlow(card, frameId, null);

    expect(useDesktopStore.getState().canvasModalCard).toMatchObject({ status: 'doing', runState: 'running' });
  });

  it('does not call updateBacklogCardStatus when backlogDir is unknown (null)', async () => {
    const desktop = useDesktopStore.getState();
    const rootId = desktop.addStepNode({ id: 'step-root', title: 'Root' });
    const frameId = desktop.addFrameNode({ position: { x: 0, y: 0 }, width: 400, height: 300, title: 'Flow', childIds: [rootId] });
    const updateBacklogCardStatus = vi.fn();
    window.fluxorAPI = {
      startHarness: vi.fn().mockResolvedValue({ success: true }),
      onHarnessEvent: vi.fn(() => vi.fn()),
      updateBacklogCardStatus,
    } as any;

    await launchExistingFlow(makeCard(), frameId, null);

    expect(updateBacklogCardStatus).not.toHaveBeenCalled();
  });

  it('does not optimistically mark the card running when the frame cannot be found (dispatch never started)', async () => {
    const card = makeCard();
    useDesktopStore.setState({ backlogCards: [card] });
    const updateBacklogCardStatus = vi.fn();
    window.fluxorAPI = {
      startHarness: vi.fn().mockResolvedValue({ success: true }),
      onHarnessEvent: vi.fn(() => vi.fn()),
      updateBacklogCardStatus,
    } as any;

    await launchExistingFlow(card, 'does-not-exist', '/proj/.backlog');

    expect(updateBacklogCardStatus).not.toHaveBeenCalled();
    expect(useDesktopStore.getState().backlogCards[0].status).toBe('todo');
    expect(useHarnessStore.getState().executionStatus).toBe('error');
  });
});

describe('launchAutoflow (F3 mode 2 — autoflow)', () => {
  it('assembles via the Meta-Agent, materializes through insertPipelineAssembly, and runs from the root step', async () => {
    const assembly = makeAssembly();
    const assemblePipeline = vi.fn().mockResolvedValue({ success: true, data: assembly });
    const startHarness = vi.fn().mockResolvedValue({ success: true });
    const updateBacklogCardStatus = vi.fn().mockResolvedValue({ success: true });
    window.fluxorAPI = { assemblePipeline, startHarness, onHarnessEvent: vi.fn(() => vi.fn()), updateBacklogCardStatus } as any;

    const card = makeCard();
    useDesktopStore.setState({ backlogCards: [card] });
    await launchAutoflow(card, '/proj/.backlog');

    expect(assemblePipeline).toHaveBeenCalledWith('Ship auth\n\nAdd 2FA support.');
    expect(startHarness).toHaveBeenCalledTimes(1);

    const frame = useDesktopStore.getState().mentalNodes.find((n) => n.type === 'frame');
    expect(frame).toBeDefined();
    const dispatchedFlow = startHarness.mock.calls[0][0];
    expect(dispatchedFlow.rootStepId).toBe(`${frame!.id}-root`);
    expect(new Set(Object.keys(dispatchedFlow.stepsRecord))).toEqual(new Set([`${frame!.id}-root`, `${frame!.id}-next`]));

    expect(updateBacklogCardStatus).toHaveBeenCalledWith('/proj/.backlog', 't1.md', 'doing', undefined, 'running');
    expect(useDesktopStore.getState().backlogCards[0]).toMatchObject({ status: 'doing', runState: 'running' });
  });

  it('registers EVERY materialized step in backlogRunCorrelation, all mapped to the one originating card (F4)', async () => {
    const assembly = makeAssembly();
    const assemblePipeline = vi.fn().mockResolvedValue({ success: true, data: assembly });
    const startHarness = vi.fn().mockResolvedValue({ success: true });
    window.fluxorAPI = { assemblePipeline, startHarness, onHarnessEvent: vi.fn(() => vi.fn()), updateBacklogCardStatus: vi.fn().mockResolvedValue({ success: true }) } as any;

    const card = makeCard();
    useDesktopStore.setState({ backlogCards: [card] });
    await launchAutoflow(card, '/proj/.backlog');

    const frame = useDesktopStore.getState().mentalNodes.find((n) => n.type === 'frame')!;
    expect(useDesktopStore.getState().backlogRunCorrelation).toEqual({
      [`${frame.id}-root`]: { backlogDir: '/proj/.backlog', filename: 't1.md' },
      [`${frame.id}-next`]: { backlogDir: '/proj/.backlog', filename: 't1.md' },
    });
  });

  it('does not register any correlation entry when backlogDir is unknown (null)', async () => {
    const assembly = makeAssembly();
    const assemblePipeline = vi.fn().mockResolvedValue({ success: true, data: assembly });
    window.fluxorAPI = { assemblePipeline, startHarness: vi.fn().mockResolvedValue({ success: true }), onHarnessEvent: vi.fn(() => vi.fn()) } as any;

    const card = makeCard();
    useDesktopStore.setState({ backlogCards: [card] });
    await launchAutoflow(card, null);

    expect(useDesktopStore.getState().backlogRunCorrelation).toEqual({});
  });

  it('throws when the Meta-Agent assembly fails, without touching the canvas or the card', async () => {
    const assemblePipeline = vi.fn().mockResolvedValue({ success: false, error: 'boom' });
    window.fluxorAPI = { assemblePipeline, startHarness: vi.fn(), onHarnessEvent: vi.fn(() => vi.fn()) } as any;

    const card = makeCard();
    useDesktopStore.setState({ backlogCards: [card] });

    await expect(launchAutoflow(card, '/proj/.backlog')).rejects.toThrow('boom');
    expect(useDesktopStore.getState().mentalNodes).toHaveLength(0);
    expect(useDesktopStore.getState().backlogCards[0].status).toBe('todo');
  });

  it('still centers the viewport (frame is materialized) but skips the optimistic write when the harness bridge is unavailable', async () => {
    const assembly = makeAssembly();
    const assemblePipeline = vi.fn().mockResolvedValue({ success: true, data: assembly });
    const updateBacklogCardStatus = vi.fn();
    // No startHarness/onHarnessEvent on the bridge -> executeFlow's own guard sets executionStatus:'error'.
    window.fluxorAPI = { assemblePipeline, updateBacklogCardStatus } as any;

    const card = makeCard();
    useDesktopStore.setState({ backlogCards: [card] });
    await launchAutoflow(card, '/proj/.backlog');

    expect(useDesktopStore.getState().mentalNodes.some((n) => n.type === 'frame')).toBe(true);
    expect(updateBacklogCardStatus).not.toHaveBeenCalled();
    expect(useDesktopStore.getState().backlogCards[0].status).toBe('todo');
  });
});

describe('launchEpicFlow (F3 mode 3 — flow por épica)', () => {
  it('gathers every card sharing the epic, materializes via insertPipelineAssembly, runs from the root, and marks only the root card running', async () => {
    const startHarness = vi.fn().mockResolvedValue({ success: true });
    const updateBacklogCardStatus = vi.fn().mockResolvedValue({ success: true });
    window.fluxorAPI = { startHarness, onHarnessEvent: vi.fn(() => vi.fn()), updateBacklogCardStatus } as any;

    const high = makeCard({ filename: 'high.md', taskId: 'HIGH', priority: 'high', epic: 'Security' });
    const low = makeCard({ filename: 'low.md', taskId: 'LOW', priority: 'low', epic: 'Security' });
    const other = makeCard({ filename: 'other.md', taskId: 'OTHER', epic: 'Billing' });
    useDesktopStore.setState({ backlogCards: [low, high, other] });

    await launchEpicFlow('Security', '/proj/.backlog');

    // Only the 2 Security cards became steps — Billing's card is excluded.
    expect(startHarness).toHaveBeenCalledTimes(1);
    const dispatchedFlow = startHarness.mock.calls[0][0];
    expect(Object.keys(dispatchedFlow.stepsRecord)).toHaveLength(2);

    const frame = useDesktopStore.getState().mentalNodes.find((n) => n.type === 'frame');
    expect(frame).toBeDefined();
    // HIGH sorts first (superHigh/high before low) -> it is the DAG root.
    expect(dispatchedFlow.rootStepId).toBe(`${frame!.id}-high`);

    expect(updateBacklogCardStatus).toHaveBeenCalledTimes(1);
    expect(updateBacklogCardStatus).toHaveBeenCalledWith('/proj/.backlog', 'high.md', 'doing', undefined, 'running');
    const cards = useDesktopStore.getState().backlogCards;
    expect(cards.find((c) => c.filename === 'high.md')).toMatchObject({ status: 'doing', runState: 'running' });
    // The non-root epic member is untouched — it waits for its own StepStatusChanged (F4).
    expect(cards.find((c) => c.filename === 'low.md')).toMatchObject({ status: 'todo', runState: 'idle' });
    expect(cards.find((c) => c.filename === 'other.md')).toMatchObject({ status: 'todo', runState: 'idle' });
  });

  it('registers EVERY epic-member step in backlogRunCorrelation, each mapped to its OWN card (F4)', async () => {
    const startHarness = vi.fn().mockResolvedValue({ success: true });
    window.fluxorAPI = { startHarness, onHarnessEvent: vi.fn(() => vi.fn()), updateBacklogCardStatus: vi.fn().mockResolvedValue({ success: true }) } as any;

    const high = makeCard({ filename: 'high.md', taskId: 'HIGH', priority: 'high', epic: 'Security' });
    const low = makeCard({ filename: 'low.md', taskId: 'LOW', priority: 'low', epic: 'Security' });
    const other = makeCard({ filename: 'other.md', taskId: 'OTHER', epic: 'Billing' });
    useDesktopStore.setState({ backlogCards: [low, high, other] });

    await launchEpicFlow('Security', '/proj/.backlog');

    const frame = useDesktopStore.getState().mentalNodes.find((n) => n.type === 'frame')!;
    expect(useDesktopStore.getState().backlogRunCorrelation).toEqual({
      [`${frame.id}-high`]: { backlogDir: '/proj/.backlog', filename: 'high.md' },
      [`${frame.id}-low`]: { backlogDir: '/proj/.backlog', filename: 'low.md' },
    });
  });

  it('does not register any correlation entry when backlogDir is unknown (null)', async () => {
    window.fluxorAPI = { startHarness: vi.fn().mockResolvedValue({ success: true }), onHarnessEvent: vi.fn(() => vi.fn()) } as any;
    const high = makeCard({ filename: 'high.md', taskId: 'HIGH', epic: 'Security' });
    useDesktopStore.setState({ backlogCards: [high] });

    await launchEpicFlow('Security', null);

    expect(useDesktopStore.getState().backlogRunCorrelation).toEqual({});
  });

  it('is a no-op when no card carries the given epic', async () => {
    const startHarness = vi.fn();
    window.fluxorAPI = { startHarness, onHarnessEvent: vi.fn(() => vi.fn()) } as any;
    useDesktopStore.setState({ backlogCards: [makeCard({ epic: 'Other' })] });

    await launchEpicFlow('Security', '/proj/.backlog');

    expect(startHarness).not.toHaveBeenCalled();
    expect(useDesktopStore.getState().mentalNodes).toHaveLength(0);
  });
});

describe('launchAgentSession (Cockpit F3 mode 4 — the card opens a vendor CLI)', () => {
  function agentCard(overrides: Partial<BacklogCard> = {}): BacklogCard {
    return makeCard({
      filename: 'JDB-001-probe.md', taskId: 'JDB-001',
      title: 'Probe the launcher end to end', ...overrides,
    });
  }

  function sessionOf(windowId: string) {
    return useDesktopStore.getState().windows.find((w) => w.id === windowId)?.agentSession;
  }

  it('opens an agent-session window on the project, with the card and its prompt', () => {
    const windowId = launchAgentSession(agentCard(), '/proj/.backlog', {
      vendor: 'claude', mode: 'worktree', isExternal: false,
    });
    const meta = sessionOf(windowId)!;
    expect(meta.vendor).toBe('claude');
    expect(meta.projectRoot).toBe('/proj');
    expect(meta.cwd).toBe('/proj');
    expect(meta.cardId).toBe('JDB-001');
    expect(meta.backlogDir).toBe('/proj/.backlog');
    expect(meta.cardFilename).toBe('JDB-001-probe.md');
    expect(meta.prompt).toContain('The card file is .backlog/JDB-001-probe.md');
  });

  it('titles the window with the card id and the vendor, not with a directory', () => {
    const windowId = launchAgentSession(agentCard(), '/proj/.backlog', {
      vendor: 'codex', mode: 'attached', isExternal: false,
    });
    expect(useDesktopStore.getState().windows.find((w) => w.id === windowId)?.title)
      .toBe('JDB-001 · codex');
  });

  it('names the worktree after the card and cuts a branch from the id and a capped title slug', () => {
    const windowId = launchAgentSession(agentCard(), '/proj/.backlog', {
      vendor: 'claude', mode: 'worktree', isExternal: false,
    });
    const meta = sessionOf(windowId)!;
    expect(meta.worktreeName).toBe('jdb-001');
    expect(meta.branch).toBe('jdb-001/probe-the-launcher-end-to-end');
    expect(meta.branch!.split('/')[1].length).toBeLessThanOrEqual(40);
  });

  it('caps a long title slug at 40 characters and leaves no trailing dash', () => {
    const windowId = launchAgentSession(
      agentCard({ title: 'A really quite extraordinarily long card title that keeps going' }),
      '/proj/.backlog', { vendor: 'claude', mode: 'worktree', isExternal: false },
    );
    const slug = sessionOf(windowId)!.branch!.split('/')[1];
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('registers the session against the card so the pile can show its overlay', () => {
    const windowId = launchAgentSession(agentCard(), '/proj/.backlog', {
      vendor: 'claude', mode: 'attached', isExternal: false,
    });
    const sessionId = sessionOf(windowId)!.sessionId;
    expect(useDesktopStore.getState().backlogSessionCorrelation[sessionId]).toEqual({
      backlogDir: '/proj/.backlog', filename: 'JDB-001-probe.md', cardId: 'JDB-001',
    });
  });

  it('forces attached for an external backlog — a worktree has no copy of the card', () => {
    const windowId = launchAgentSession(agentCard(), '/data/fluxor/proj/.backlog', {
      vendor: 'claude', mode: 'worktree', isExternal: true, projectRoot: '/proj',
    });
    const meta = sessionOf(windowId)!;
    expect(meta.mode).toBe('attached');
    expect(meta.isExternalBacklog).toBe(true);
    expect(meta.projectRoot).toBe('/proj');
    // Outside the project, so the prompt names it absolutely or the agent looks
    // for a `.backlog` that is not there.
    expect(meta.prompt).toContain('/data/fluxor/proj/.backlog/JDB-001-probe.md');
  });

  it('writes NOTHING to the card at launch — status is the agent\'s, runState waits for a real PTY', async () => {
    window.fluxorAPI = { updateBacklogCardStatus: vi.fn() } as unknown as typeof window.fluxorAPI;
    useDesktopStore.setState({ backlogCards: [agentCard()] });
    launchAgentSession(agentCard(), '/proj/.backlog', {
      vendor: 'claude', mode: 'attached', isExternal: false,
    });
    expect(window.fluxorAPI!.updateBacklogCardStatus).not.toHaveBeenCalled();
    expect(useDesktopStore.getState().backlogCards[0]).toMatchObject({ status: 'todo', runState: 'idle' });
  });

  it('creates no canvas node and starts no flow — it is not one of the three flow launchers', () => {
    launchAgentSession(agentCard(), '/proj/.backlog', {
      vendor: 'claude', mode: 'worktree', isExternal: false,
    });
    expect(useDesktopStore.getState().mentalNodes).toHaveLength(0);
    expect(useHarnessStore.getState().executionStatus).toBe(useHarnessStore.getInitialState().executionStatus);
  });
});

describe('cardPathForPrompt', () => {
  it('relativises an in-tree backlog against the project root', () => {
    expect(cardPathForPrompt('/proj', '/proj/.backlog', 'a.md')).toBe('.backlog/a.md');
  });

  it('tolerates a trailing separator on the project root', () => {
    expect(cardPathForPrompt('/proj/', '/proj/.backlog', 'a.md')).toBe('.backlog/a.md');
  });

  it('keeps an out-of-tree backlog absolute', () => {
    expect(cardPathForPrompt('/proj', '/data/fluxor/proj/.backlog', 'a.md'))
      .toBe('/data/fluxor/proj/.backlog/a.md');
  });
});
