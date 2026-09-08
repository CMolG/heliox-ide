import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BacklogBentoWidget } from './BacklogBentoWidget';
import { useDesktopStore } from '@/renderer/store/desktop-store';
import { useFluxorStore } from '@/renderer/store';
import type { BacklogCard } from '@/types/market';

function makeCard(overrides: Partial<BacklogCard> = {}): BacklogCard {
  return {
    filename: 'x.md', taskId: 'X', targetAgent: '', targetModule: '',
    priority: 'medium', status: 'todo', runState: 'idle', order: 0,
    tags: [], estimate: 1, assignees: [], related: [],
    createdAt: '2026-07-08T00:00:00.000Z', updatedAt: '2026-07-08T00:00:00.000Z',
    title: 'A backlog card', description: 'desc', comments: [], attachments: [],
    ...overrides,
  };
}

beforeEach(() => {
  useDesktopStore.setState(useDesktopStore.getInitialState(), true);
  useFluxorStore.setState(useFluxorStore.getInitialState(), true);
});

describe('BacklogBentoWidget', () => {
  it('shows the "open a project" empty state when no project is open', async () => {
    (window as any).fluxorAPI = {
      scanBacklogs: vi.fn().mockResolvedValue([]),
      listProjectsWithoutBacklog: vi.fn().mockResolvedValue([]),
      watchBacklogDir: vi.fn().mockResolvedValue({ success: true }),
      unwatchBacklogDir: vi.fn().mockResolvedValue({ success: true }),
      onBacklogChanged: vi.fn(() => vi.fn()),
    };
    useFluxorStore.setState({ projectPath: null });
    render(<BacklogBentoWidget windowId="w1" />);
    expect(await screen.findByText('Open a project to scan for backlogs')).toBeInTheDocument();
  });

  it('auto-selects and shows the pile when exactly one backlog is found', async () => {
    (window as any).fluxorAPI = {
      scanBacklogs: vi.fn().mockResolvedValue([
        { projectPath: '/proj', projectName: 'Proj', backlogPath: '/proj/.backlog', cardCount: 1, isExternal: false },
      ]),
      listProjectsWithoutBacklog: vi.fn().mockResolvedValue([]),
      readBacklogDir: vi.fn().mockResolvedValue([makeCard()]),
      watchBacklogDir: vi.fn().mockResolvedValue({ success: true }),
      unwatchBacklogDir: vi.fn().mockResolvedValue({ success: true }),
      onBacklogChanged: vi.fn(() => vi.fn()),
    };
    useFluxorStore.setState({ projectPath: '/proj' });
    render(<BacklogBentoWidget windowId="w1" />);

    // The card only renders at the settled end-state (auto-select → loadCards
    // finished, loading=false). The `backlog-filters` testid, by contrast,
    // flashes during loadCards' loading toggle (mounts, unmounts, remounts), so
    // asserting on it directly races. Wait for the stable card first, then check
    // the sibling filters synchronously.
    expect(await screen.findByText('A backlog card', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByTestId('backlog-filters')).toBeInTheDocument();
    expect(useDesktopStore.getState().activeBacklogDir).toBe('/proj/.backlog');
  });

  it('shows the picker list when multiple backlogs are found, and switches to the pile on selection', async () => {
    (window as any).fluxorAPI = {
      scanBacklogs: vi.fn().mockResolvedValue([
        { projectPath: '/a', projectName: 'Proj A', backlogPath: '/a/.backlog', cardCount: 2, isExternal: false },
        { projectPath: '/b', projectName: 'Proj B', backlogPath: '/b/.backlog', cardCount: 0, isExternal: true },
      ]),
      listProjectsWithoutBacklog: vi.fn().mockResolvedValue([]),
      readBacklogDir: vi.fn().mockResolvedValue([]),
      watchBacklogDir: vi.fn().mockResolvedValue({ success: true }),
      unwatchBacklogDir: vi.fn().mockResolvedValue({ success: true }),
      onBacklogChanged: vi.fn(() => vi.fn()),
    };
    useFluxorStore.setState({ projectPath: '/root' });
    render(<BacklogBentoWidget windowId="w1" />);

    expect(await screen.findByTestId('backlog-picker')).toBeInTheDocument();
    expect(screen.getByText('Proj A')).toBeInTheDocument();
    expect(screen.getByText('Proj B')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Proj A'));
    expect(await screen.findByTestId('backlog-filters', {}, { timeout: 3000 })).toBeInTheDocument();
    await waitFor(() => expect(useDesktopStore.getState().activeBacklogDir).toBe('/a/.backlog'));

    // Back button appears once there is more than one known backlog.
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(await screen.findByTestId('backlog-picker')).toBeInTheDocument();
  });

  it('offers to initialize a backlog for projects without one', async () => {
    const initBacklog = vi.fn().mockResolvedValue({ success: true, backlogPath: '/c/.backlog' });
    (window as any).fluxorAPI = {
      scanBacklogs: vi.fn().mockResolvedValue([]),
      listProjectsWithoutBacklog: vi.fn().mockResolvedValue([{ projectPath: '/c', projectName: 'Proj C' }]),
      initBacklog,
      watchBacklogDir: vi.fn().mockResolvedValue({ success: true }),
      unwatchBacklogDir: vi.fn().mockResolvedValue({ success: true }),
      onBacklogChanged: vi.fn(() => vi.fn()),
    };
    useFluxorStore.setState({ projectPath: '/root' });
    render(<BacklogBentoWidget windowId="w1" />);

    expect(await screen.findByText('Proj C')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /init/i }));
    await waitFor(() => expect(initBacklog).toHaveBeenCalledWith('/c'));
  });

  it('Refresh re-reads the backlog directory', async () => {
    const readBacklogDir = vi.fn().mockResolvedValue([makeCard()]);
    (window as any).fluxorAPI = {
      scanBacklogs: vi.fn().mockResolvedValue([
        { projectPath: '/proj', projectName: 'Proj', backlogPath: '/proj/.backlog', cardCount: 1, isExternal: false },
      ]),
      listProjectsWithoutBacklog: vi.fn().mockResolvedValue([]),
      readBacklogDir,
      watchBacklogDir: vi.fn().mockResolvedValue({ success: true }),
      unwatchBacklogDir: vi.fn().mockResolvedValue({ success: true }),
      onBacklogChanged: vi.fn(() => vi.fn()),
    };
    useFluxorStore.setState({ projectPath: '/proj' });
    render(<BacklogBentoWidget windowId="w1" />);

    await screen.findByTestId('backlog-filters', {}, { timeout: 3000 });
    await waitFor(() => expect(readBacklogDir).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    await waitFor(() => expect(readBacklogDir).toHaveBeenCalledTimes(2));
  });

  it('watches the selected backlog directory on mount and unwatches + unsubscribes on unmount (F4)', async () => {
    const watchBacklogDir = vi.fn().mockResolvedValue({ success: true });
    const unwatchBacklogDir = vi.fn().mockResolvedValue({ success: true });
    const unsubscribe = vi.fn();
    const onBacklogChanged = vi.fn(() => unsubscribe);
    (window as any).fluxorAPI = {
      scanBacklogs: vi.fn().mockResolvedValue([
        { projectPath: '/proj', projectName: 'Proj', backlogPath: '/proj/.backlog', cardCount: 1, isExternal: false },
      ]),
      listProjectsWithoutBacklog: vi.fn().mockResolvedValue([]),
      readBacklogDir: vi.fn().mockResolvedValue([makeCard()]),
      watchBacklogDir,
      unwatchBacklogDir,
      onBacklogChanged,
    };
    useFluxorStore.setState({ projectPath: '/proj' });
    const { unmount } = render(<BacklogBentoWidget windowId="w1" />);

    await waitFor(() => expect(watchBacklogDir).toHaveBeenCalledWith('/proj/.backlog', '/proj'));
    await waitFor(() => expect(onBacklogChanged).toHaveBeenCalledTimes(1));

    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(unwatchBacklogDir).toHaveBeenCalledWith('/proj/.backlog');
  });

  it('merges a pushed onBacklogChanged payload into the store, ignoring pushes for a different backlogDir (F4)', async () => {
    let pushCallback: ((payload: { backlogDir: string; cards: BacklogCard[] }) => void) | undefined;
    (window as any).fluxorAPI = {
      scanBacklogs: vi.fn().mockResolvedValue([
        { projectPath: '/proj', projectName: 'Proj', backlogPath: '/proj/.backlog', cardCount: 1, isExternal: false },
      ]),
      listProjectsWithoutBacklog: vi.fn().mockResolvedValue([]),
      readBacklogDir: vi.fn().mockResolvedValue([makeCard()]),
      watchBacklogDir: vi.fn().mockResolvedValue({ success: true }),
      unwatchBacklogDir: vi.fn().mockResolvedValue({ success: true }),
      onBacklogChanged: vi.fn((cb: typeof pushCallback) => { pushCallback = cb; return vi.fn(); }),
    };
    useFluxorStore.setState({ projectPath: '/proj' });
    render(<BacklogBentoWidget windowId="w1" />);

    await screen.findByText('A backlog card');
    await waitFor(() => expect(pushCallback).toBeDefined());

    const pushedCard = makeCard({ filename: 'y.md', taskId: 'Y', title: 'Externally-edited card' });
    pushCallback!({ backlogDir: '/proj/.backlog', cards: [pushedCard] });
    expect(await screen.findByText('Externally-edited card')).toBeInTheDocument();
    // mergeBacklogCards replaces wholesale — the original auto-read card is gone.
    expect(screen.queryByText('A backlog card')).not.toBeInTheDocument();

    // A push for a DIFFERENT backlogDir (e.g. a stale subscription) is ignored.
    pushCallback!({ backlogDir: '/other/.backlog', cards: [makeCard({ filename: 'z.md', taskId: 'Z', title: 'Should not appear' })] });
    expect(screen.queryByText('Should not appear')).not.toBeInTheDocument();
  });
});

describe('BacklogBentoWidget — HUMAN card notifications (Cockpit F3)', () => {
  function human(overrides: Partial<BacklogCard> = {}): BacklogCard {
    return makeCard({
      filename: 'HUMAN-002-token.md', taskId: 'HUMAN-002', epic: 'HUMAN', tags: ['human'],
      title: 'Set the admin token on the server', ...overrides,
    });
  }

  /** Mounts the widget on a single auto-selected backlog and hands back the watcher's push. */
  async function mountWatching(initialCards: BacklogCard[]) {
    let push: ((payload: { backlogDir: string; cards: BacklogCard[] }) => void) | undefined;
    window.fluxorAPI = {
      scanBacklogs: vi.fn().mockResolvedValue([
        { projectPath: '/proj', projectName: 'Proj', backlogPath: '/proj/.backlog', cardCount: initialCards.length, isExternal: false },
      ]),
      listProjectsWithoutBacklog: vi.fn().mockResolvedValue([]),
      readBacklogDir: vi.fn().mockResolvedValue(initialCards),
      watchBacklogDir: vi.fn().mockResolvedValue({ success: true }),
      unwatchBacklogDir: vi.fn().mockResolvedValue({ success: true }),
      onBacklogChanged: vi.fn((cb: typeof push) => { push = cb; return vi.fn(); }),
      showNotification: vi.fn(),
    } as unknown as typeof window.fluxorAPI;
    useFluxorStore.setState({ projectPath: '/proj' });
    render(<BacklogBentoWidget windowId="w1" />);
    await screen.findByTestId('backlog-filters', {}, { timeout: 3000 });
    await waitFor(() => expect(push).toBeDefined());
    return (cards: BacklogCard[]) => push!({ backlogDir: '/proj/.backlog', cards });
  }

  it('says nothing about the HUMAN cards already on the board when it opens', async () => {
    await mountWatching([makeCard(), human()]);
    expect(useDesktopStore.getState().notifications).toHaveLength(0);
    expect(useFluxorStore.getState().toasts).toHaveLength(0);
  });

  it('raises a notification, a toast and an OS notification when a session writes a new HUMAN card', async () => {
    const pushCards = await mountWatching([makeCard()]);
    pushCards([makeCard(), human()]);

    await waitFor(() => expect(useDesktopStore.getState().notifications).toHaveLength(1));
    expect(useDesktopStore.getState().notifications[0].message)
      .toBe('Needs you: HUMAN-002 Set the admin token on the server');
    expect(useFluxorStore.getState().toasts[0].message).toContain('HUMAN-002');
    expect(window.fluxorAPI!.showNotification).toHaveBeenCalledWith({
      title: 'Needs you', body: 'HUMAN-002 — Set the admin token on the server',
    });
  });

  it('toasts what a closed HUMAN card just unblocked, without a notification', async () => {
    const blocked = makeCard({ filename: 'a.md', taskId: 'JDB-090', related: ['HUMAN-002'] });
    const pushCards = await mountWatching([human({ status: 'todo' }), blocked]);
    pushCards([human({ status: 'deploy' }), blocked]);

    await waitFor(() => expect(useFluxorStore.getState().toasts).toHaveLength(1));
    expect(useFluxorStore.getState().toasts[0]).toMatchObject({
      message: 'HUMAN-002 done · unblocks JDB-090', type: 'success',
    });
    expect(useDesktopStore.getState().notifications).toHaveLength(0);
  });

  it('stays quiet for an ordinary card appearing', async () => {
    const pushCards = await mountWatching([makeCard()]);
    pushCards([makeCard(), makeCard({ filename: 'b.md', taskId: 'JDB-002' })]);
    await waitFor(() => expect(useDesktopStore.getState().backlogCards).toHaveLength(2));
    expect(useDesktopStore.getState().notifications).toHaveLength(0);
    expect(useFluxorStore.getState().toasts).toHaveLength(0);
  });

  it('announces a HUMAN card once, not on every subsequent push', async () => {
    const pushCards = await mountWatching([makeCard()]);
    pushCards([makeCard(), human()]);
    await waitFor(() => expect(useDesktopStore.getState().notifications).toHaveLength(1));
    pushCards([makeCard(), human()]);
    pushCards([makeCard(), human()]);
    await waitFor(() => expect(useDesktopStore.getState().backlogCards).toHaveLength(2));
    expect(useDesktopStore.getState().notifications).toHaveLength(1);
  });

  it('records which project the open backlog belongs to, and whether it is external', async () => {
    await mountWatching([makeCard()]);
    expect(useDesktopStore.getState().activeBacklogProject)
      .toEqual({ projectPath: '/proj', isExternal: false });
  });
});
