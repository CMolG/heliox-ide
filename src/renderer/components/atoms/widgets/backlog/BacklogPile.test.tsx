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
