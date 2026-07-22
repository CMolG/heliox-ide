import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDesktopStore } from '@/renderer/store/desktop-store';
import { useHarnessStore } from '@/renderer/store/harness-store';
import { launchAutoflow, launchExistingFlow } from './launchActions';
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
