import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cardFileFor, markCardRunning, settleCard } from './card-writeback';
import { useFluxorStore } from '../store';
import type { AgentSessionMeta } from '@/types/desktop';
import type { BacklogCard } from '@/types/market';

function meta(overrides: Partial<AgentSessionMeta> = {}): AgentSessionMeta {
  return {
    sessionId: 's1',
    vendor: 'claude',
    cwd: '/proj',
    projectRoot: '/proj',
    mode: 'attached',
    cardId: 'JDB-001',
    backlogDir: '/proj/.backlog',
    cardFilename: 'JDB-001-probe.md',
    logPath: '/data/sessions/s1.log',
    launchedAt: 1,
    ptyStarted: true,
    attention: 'running',
    ...overrides,
  };
}

function card(overrides: Partial<BacklogCard> = {}): BacklogCard {
  return {
    filename: 'JDB-001-probe.md', taskId: 'JDB-001', targetAgent: '', targetModule: '',
    priority: 'medium', status: 'doing', runState: 'running', order: 0,
    tags: [], estimate: 0, assignees: [], related: [],
    createdAt: '2026-09-08T00:00:00.000Z', updatedAt: '2026-09-08T00:00:00.000Z',
    title: 'Probe', description: '', comments: [], attachments: [],
    ...overrides,
  };
}

let updateBacklogCardStatus: ReturnType<typeof vi.fn>;
let updateBacklogCardContent: ReturnType<typeof vi.fn>;
let readBacklogDir: ReturnType<typeof vi.fn>;

beforeEach(() => {
  useFluxorStore.setState(useFluxorStore.getInitialState(), true);
  updateBacklogCardStatus = vi.fn().mockResolvedValue({ success: true });
  updateBacklogCardContent = vi.fn().mockResolvedValue({ success: true });
  readBacklogDir = vi.fn().mockResolvedValue([card()]);
  (window as unknown as { fluxorAPI?: unknown }).fluxorAPI = {
    updateBacklogCardStatus, updateBacklogCardContent, readBacklogDir,
  };
});

describe('cardFileFor — the one file, two keys rule', () => {
  it('attached: the card in the main tree', () => {
    expect(cardFileFor(meta())).toEqual({ dir: '/proj/.backlog', filename: 'JDB-001-probe.md' });
  });

  it('worktree: the worktree\'s own checkout of the same card, same relative layout', () => {
    expect(cardFileFor(meta({ mode: 'worktree', worktreePath: '/proj/.claude/worktrees/jdb-001' })))
      .toEqual({ dir: '/proj/.claude/worktrees/jdb-001/.backlog', filename: 'JDB-001-probe.md' });
  });

  it('worktree before the worktree exists: nothing to write to yet, so the main tree', () => {
    expect(cardFileFor(meta({ mode: 'worktree' })))
      .toEqual({ dir: '/proj/.backlog', filename: 'JDB-001-probe.md' });
  });

  it('external backlog: there is no worktree copy, so it stays the main tree', () => {
    const ref = cardFileFor(meta({
      mode: 'worktree', worktreePath: '/proj/.claude/worktrees/jdb-001', isExternalBacklog: true,
    }));
    expect(ref).toEqual({ dir: '/proj/.backlog', filename: 'JDB-001-probe.md' });
  });

  it('joins with the separator the path already uses', () => {
    expect(cardFileFor(meta({ mode: 'worktree', worktreePath: 'C:\\proj\\.claude\\worktrees\\jdb-001' })))
      .toEqual({ dir: 'C:\\proj\\.claude\\worktrees\\jdb-001\\.backlog', filename: 'JDB-001-probe.md' });
  });

  it('is null for a session with no card behind it', () => {
    expect(cardFileFor(meta({ cardId: undefined, backlogDir: undefined, cardFilename: undefined }))).toBeNull();
  });
});

describe('markCardRunning', () => {
  it('writes runState only — status belongs to the agent', async () => {
    await markCardRunning(meta());
    expect(updateBacklogCardStatus)
      .toHaveBeenCalledWith('/proj/.backlog', 'JDB-001-probe.md', undefined, undefined, 'running');
  });

  it('writes into the worktree\'s copy in worktree mode', async () => {
    await markCardRunning(meta({ mode: 'worktree', worktreePath: '/wt' }));
    expect(updateBacklogCardStatus)
      .toHaveBeenCalledWith('/wt/.backlog', 'JDB-001-probe.md', undefined, undefined, 'running');
  });

  it('does nothing for a session with no card', async () => {
    await markCardRunning(meta({ cardFilename: undefined }));
    expect(updateBacklogCardStatus).not.toHaveBeenCalled();
  });

  it('is best effort: a refused write becomes a toast, never a throw', async () => {
    updateBacklogCardStatus.mockResolvedValue({ success: false, error: 'No frontmatter found' });
    await expect(markCardRunning(meta())).resolves.toBeUndefined();
    expect(useFluxorStore.getState().toasts[0]).toMatchObject({ type: 'error' });
    expect(useFluxorStore.getState().toasts[0].message).toContain('No frontmatter found');
  });

  it('is best effort: a thrown IPC becomes a toast too', async () => {
    updateBacklogCardStatus.mockRejectedValue(new Error('EACCES'));
    await expect(markCardRunning(meta())).resolves.toBeUndefined();
    expect(useFluxorStore.getState().toasts[0].message).toContain('EACCES');
  });
});

describe('settleCard', () => {
  it('completed when the agent left the card in review, with no comment added', async () => {
    readBacklogDir.mockResolvedValue([card({ status: 'review' })]);
    await settleCard(meta(), 0);
    expect(updateBacklogCardStatus)
      .toHaveBeenCalledWith('/proj/.backlog', 'JDB-001-probe.md', undefined, undefined, 'completed');
    expect(updateBacklogCardContent).not.toHaveBeenCalled();
  });

  it('completed for deploy as well — the user may have promoted it mid-session', async () => {
    readBacklogDir.mockResolvedValue([card({ status: 'deploy' })]);
    await settleCard(meta(), 0);
    expect(updateBacklogCardStatus)
      .toHaveBeenCalledWith('/proj/.backlog', 'JDB-001-probe.md', undefined, undefined, 'completed');
  });

  it('failed when the card is still open — exit 0 is not a verdict about the work', async () => {
    readBacklogDir.mockResolvedValue([card({ status: 'doing' })]);
    await settleCard(meta(), 0);
    expect(updateBacklogCardStatus)
      .toHaveBeenCalledWith('/proj/.backlog', 'JDB-001-probe.md', undefined, undefined, 'failed');
  });

  it('a failed settle carries a Cockpit comment naming the vendor, the exit and the transcript', async () => {
    readBacklogDir.mockResolvedValue([card({ status: 'todo' })]);
    await settleCard(meta(), 3);
    expect(updateBacklogCardContent).toHaveBeenCalledWith('/proj/.backlog', 'JDB-001-probe.md', {
      newComment: {
        author: 'Cockpit',
        text: 'Session claude ended (exit 3) without closing the card. Transcript: /data/sessions/s1.log',
      },
    });
  });

  it('says "unknown" rather than inventing an exit code, and admits an unrecorded transcript', async () => {
    readBacklogDir.mockResolvedValue([card({ status: 'todo' })]);
    await settleCard(meta({ logPath: undefined }), null);
    expect(updateBacklogCardContent.mock.calls[0][2].newComment.text)
      .toBe('Session claude ended (exit unknown) without closing the card. Transcript: not recorded');
  });

  it('re-reads the worktree\'s directory in worktree mode', async () => {
    await settleCard(meta({ mode: 'worktree', worktreePath: '/wt' }), 0);
    expect(readBacklogDir).toHaveBeenCalledWith('/wt/.backlog');
  });

  it('is best effort when the card file is gone: a toast, no write, no throw', async () => {
    readBacklogDir.mockResolvedValue([]);
    await expect(settleCard(meta(), 0)).resolves.toBeUndefined();
    expect(updateBacklogCardStatus).not.toHaveBeenCalled();
    expect(useFluxorStore.getState().toasts[0].message).toContain('no longer in /proj/.backlog');
  });

  it('is best effort when the directory read throws', async () => {
    readBacklogDir.mockRejectedValue(new Error('ENOENT'));
    await expect(settleCard(meta(), 0)).resolves.toBeUndefined();
    expect(useFluxorStore.getState().toasts[0].message).toContain('ENOENT');
  });

  it('does not comment when the runState write itself failed — one failure, one report', async () => {
    readBacklogDir.mockResolvedValue([card({ status: 'doing' })]);
    updateBacklogCardStatus.mockResolvedValue({ success: false, error: 'read-only' });
    await settleCard(meta(), 1);
    expect(updateBacklogCardContent).not.toHaveBeenCalled();
  });

  it('does nothing for a session with no card', async () => {
    await settleCard(meta({ cardId: undefined, cardFilename: undefined }), 0);
    expect(readBacklogDir).not.toHaveBeenCalled();
  });
});
