import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BacklogPile, reorderBacklogCards } from './BacklogPile';
import { useDesktopStore } from '@/renderer/store/desktop-store';
import type { BacklogCard, BacklogStatus } from '@/types/market';

function makeCard(overrides: Partial<BacklogCard> = {}): BacklogCard {
  return {
    filename: 'x.md', taskId: 'X', targetAgent: '', targetModule: '',
    priority: 'medium', status: 'todo', runState: 'idle', order: 0,
    tags: [], estimate: 1, assignees: [], related: [],
    createdAt: '2026-07-08T00:00:00.000Z', updatedAt: '2026-07-08T00:00:00.000Z',
    title: 'x', description: 'y', comments: [], attachments: [],
    ...overrides,
  };
}

const ALL_STATUSES: BacklogStatus[] = ['refine', 'todo', 'ready', 'doing', 'review', 'deploy'];

beforeEach(() => {
  useDesktopStore.setState(useDesktopStore.getInitialState(), true);
  (window as any).fluxorAPI = { updateBacklogCards: vi.fn().mockResolvedValue({ success: true }) };
});

describe('reorderBacklogCards (pure)', () => {
  function c(filename: string, order: number, status: BacklogStatus = 'todo') {
    return makeCard({ filename, order, status });
  }

  it('moves a single card to sit before the target and reassigns dense order', () => {
    const cards = [c('a.md', 0), c('b.md', 1), c('c.md', 2)];
    const result = reorderBacklogCards(cards, ['c.md'], 'a.md');
    expect(result.map((x) => x.filename)).toEqual(['c.md', 'a.md', 'b.md']);
    expect(result.map((x) => x.order)).toEqual([0, 1, 2]);
  });

  it('moves a multi-selected batch together, preserving their relative order', () => {
    const cards = [c('a.md', 0), c('b.md', 1), c('c.md', 2), c('d.md', 3)];
    const result = reorderBacklogCards(cards, ['b.md', 'd.md'], 'a.md');
    expect(result.map((x) => x.filename)).toEqual(['b.md', 'd.md', 'a.md', 'c.md']);
  });

  it('never mutates status', () => {
    const cards = [c('a.md', 0, 'todo'), c('b.md', 1, 'doing')];
    const result = reorderBacklogCards(cards, ['b.md'], 'a.md');
    expect(result.find((x) => x.filename === 'b.md')!.status).toBe('doing');
  });

  it('appends at the end when the target is not found', () => {
    const cards = [c('a.md', 0), c('b.md', 1)];
    const result = reorderBacklogCards(cards, ['a.md'], 'missing.md');
    expect(result.map((x) => x.filename)).toEqual(['b.md', 'a.md']);
  });
});

describe('BacklogPile', () => {
  it('renders the empty state when no cards match', () => {
    useDesktopStore.setState({ backlogCards: [] });
    render(<BacklogPile searchTerm="" activeStatuses={ALL_STATUSES} backlogDir="/proj/.backlog" />);
    expect(screen.getByTestId('backlog-pile-empty')).toBeInTheDocument();
  });

  it('renders cards sorted by status order then card.order', () => {
    useDesktopStore.setState({
      backlogCards: [
        makeCard({ filename: 'a.md', status: 'todo', order: 0, title: 'A' }),
        makeCard({ filename: 'b.md', status: 'deploy', order: 0, title: 'B' }),
      ],
    });
    render(<BacklogPile searchTerm="" activeStatuses={ALL_STATUSES} backlogDir="/proj/.backlog" />);
    const cards = screen.getAllByTestId('backlog-card');
    expect(cards[0]).toHaveTextContent('B'); // deploy (order 1) sorts before todo (order 5)
    expect(cards[1]).toHaveTextContent('A');
  });

  it('filters by search term across title/description/tags', () => {
    useDesktopStore.setState({
      backlogCards: [
        makeCard({ filename: 'a.md', title: 'Alpha task', tags: ['x'] }),
        makeCard({ filename: 'b.md', title: 'Beta task', tags: ['findme'] }),
      ],
    });
    render(<BacklogPile searchTerm="findme" activeStatuses={ALL_STATUSES} backlogDir="/proj/.backlog" />);
    expect(screen.getAllByTestId('backlog-card')).toHaveLength(1);
    expect(screen.getByText('Beta task')).toBeInTheDocument();
  });

  it('hides cards whose status is filtered out', () => {
    useDesktopStore.setState({
      backlogCards: [
        makeCard({ filename: 'a.md', status: 'todo', title: 'A' }),
        makeCard({ filename: 'b.md', status: 'deploy', title: 'B' }),
      ],
    });
    render(<BacklogPile searchTerm="" activeStatuses={['todo']} backlogDir="/proj/.backlog" />);
    expect(screen.getAllByTestId('backlog-card')).toHaveLength(1);
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('exposes keyboard-sortable affordances (KeyboardSensor wiring via useSortable)', () => {
    useDesktopStore.setState({ backlogCards: [makeCard({ filename: 'a.md' })] });
    render(<BacklogPile searchTerm="" activeStatuses={ALL_STATUSES} backlogDir="/proj/.backlog" />);
    const card = screen.getAllByTestId('backlog-card')[0];
    const draggable = card.closest('[role="button"]');
    expect(draggable).not.toBeNull();
    expect(draggable).toHaveAttribute('tabindex', '0');
  });

  it('meta+click toggles multi-select without opening the modal', () => {
    useDesktopStore.setState({ backlogCards: [makeCard({ filename: 'a.md' })], canvasModalCard: null });
    render(<BacklogPile searchTerm="" activeStatuses={ALL_STATUSES} backlogDir="/proj/.backlog" />);
    fireEvent.click(screen.getByTestId('backlog-card'), { metaKey: true });
    expect(useDesktopStore.getState().canvasModalCard).toBeNull();
  });

  it('plain click opens the modal via openCanvasModal', () => {
    useDesktopStore.setState({ backlogCards: [makeCard({ filename: 'a.md' })] });
    render(<BacklogPile searchTerm="" activeStatuses={ALL_STATUSES} backlogDir="/proj/.backlog" />);
    fireEvent.click(screen.getByTestId('backlog-card'));
    expect(useDesktopStore.getState().canvasModalCard?.filename).toBe('a.md');
  });
});

describe('BacklogPile — the "Needs you" lane (Cockpit F3)', () => {
  function human(overrides: Partial<BacklogCard> = {}) {
    return makeCard({
      filename: 'HUMAN-001-needs-you.md', taskId: 'HUMAN-001', epic: 'HUMAN',
      tags: ['human'], title: 'Set a secret on the server', ...overrides,
    });
  }

  it('is absent entirely when there is no HUMAN card', () => {
    useDesktopStore.setState({ backlogCards: [makeCard({ filename: 'a.md', taskId: 'JDB-001' })] });
    render(<BacklogPile searchTerm="" activeStatuses={ALL_STATUSES} backlogDir="/proj/.backlog" />);
    expect(screen.queryByTestId('needs-you-lane')).not.toBeInTheDocument();
  });

  it('pins HUMAN cards above the pile and counts them in its header', () => {
    useDesktopStore.setState({
      backlogCards: [
        makeCard({ filename: 'a.md', taskId: 'JDB-001', title: 'Ordinary work' }),
        human(),
      ],
    });
    render(<BacklogPile searchTerm="" activeStatuses={ALL_STATUSES} backlogDir="/proj/.backlog" />);
    const lane = screen.getByTestId('needs-you-lane');
    expect(lane).toHaveTextContent('Needs you · 1');
    expect(lane).toHaveTextContent('Set a secret on the server');
  });

  it('takes them OUT of the flat list — a card is in one place, not two', () => {
    useDesktopStore.setState({
      backlogCards: [makeCard({ filename: 'a.md', taskId: 'JDB-001', title: 'Ordinary work' }), human()],
    });
    render(<BacklogPile searchTerm="" activeStatuses={ALL_STATUSES} backlogDir="/proj/.backlog" />);
    const lane = screen.getByTestId('needs-you-lane');
    const outside = screen.getAllByTestId('backlog-card').filter((c) => !lane.contains(c));
    expect(outside).toHaveLength(1);
    expect(outside[0]).toHaveTextContent('Ordinary work');
  });

  it('renders no launcher on a lane card — an agent cannot start it', () => {
    useDesktopStore.setState({ backlogCards: [human()] });
    render(<BacklogPile searchTerm="" activeStatuses={ALL_STATUSES} backlogDir="/proj/.backlog" />);
    expect(screen.getByTestId('needs-you-lane').querySelector('[data-testid="launch-menu-trigger"]')).toBeNull();
  });

  it('says what each lane card unblocks, from BOTH directions of related[]', () => {
    useDesktopStore.setState({
      backlogCards: [
        human({ related: ['JDB-090'] }),
        makeCard({ filename: 'a.md', taskId: 'JDB-090' }),
        makeCard({ filename: 'b.md', taskId: 'JDB-191', related: ['HUMAN-001'] }),
      ],
    });
    render(<BacklogPile searchTerm="" activeStatuses={ALL_STATUSES} backlogDir="/proj/.backlog" />);
    expect(screen.getByTestId('needs-you-unblocks')).toHaveTextContent('unblocks: JDB-090, JDB-191');
  });

  it('ignores the status filters — being needed by a person is not a status', () => {
    useDesktopStore.setState({ backlogCards: [human({ status: 'todo' })] });
    render(<BacklogPile searchTerm="" activeStatuses={['deploy']} backlogDir="/proj/.backlog" />);
    expect(screen.getByTestId('needs-you-lane')).toHaveTextContent('Set a secret on the server');
  });

  it('respects the search box — a search that cannot find what it shows is a bug', () => {
    useDesktopStore.setState({ backlogCards: [human()] });
    render(<BacklogPile searchTerm="something else" activeStatuses={ALL_STATUSES} backlogDir="/proj/.backlog" />);
    expect(screen.queryByTestId('needs-you-lane')).not.toBeInTheDocument();
  });

  it('drops a HUMAN card that reached deploy — it is done, and it needs nobody', () => {
    useDesktopStore.setState({ backlogCards: [human({ status: 'deploy' })] });
    render(<BacklogPile searchTerm="" activeStatuses={ALL_STATUSES} backlogDir="/proj/.backlog" />);
    expect(screen.queryByTestId('needs-you-lane')).not.toBeInTheDocument();
  });

  it('opens the modal on a lane card, like any other card', () => {
    useDesktopStore.setState({ backlogCards: [human()] });
    render(<BacklogPile searchTerm="" activeStatuses={ALL_STATUSES} backlogDir="/proj/.backlog" />);
    fireEvent.click(screen.getByTestId('backlog-card'));
    expect(useDesktopStore.getState().canvasModalCard?.filename).toBe('HUMAN-001-needs-you.md');
  });
});
