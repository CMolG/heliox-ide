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
    };
    useFluxorStore.setState({ projectPath: '/proj' });
    render(<BacklogBentoWidget windowId="w1" />);

    await screen.findByTestId('backlog-filters', {}, { timeout: 3000 });
    await waitFor(() => expect(readBacklogDir).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    await waitFor(() => expect(readBacklogDir).toHaveBeenCalledTimes(2));
  });
});
