import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BacklogCardModal } from './BacklogCardModal';
import { useDesktopStore } from '@/renderer/store/desktop-store';
import type { BacklogCard } from '@/types/market';

function makeCard(overrides: Partial<BacklogCard> = {}): BacklogCard {
  return {
    filename: 't1.md', taskId: 'TASK-1', targetAgent: '', targetModule: '',
    priority: 'medium', status: 'todo', runState: 'idle', order: 0,
    tags: [], estimate: 4, assignees: [], related: [],
    createdAt: '2026-07-08T00:00:00.000Z', updatedAt: '2026-07-08T00:00:00.000Z',
    title: 'Sample task', description: 'Full description text.',
    comments: [], attachments: [],
    ...overrides,
  };
}

beforeEach(() => {
  useDesktopStore.setState(useDesktopStore.getInitialState(), true);
  (window as any).fluxorAPI = {
    updateBacklogCardContent: vi.fn().mockResolvedValue({ success: true }),
  };
});

describe('BacklogCardModal', () => {
  it('renders nothing when no card is open', () => {
    render(<BacklogCardModal />);
    expect(screen.queryByTestId('backlog-card-modal')).not.toBeInTheDocument();
  });

  it('opens with the correct title/description/status/priority', () => {
    const card = makeCard({ title: 'Ship the thing', description: 'Do the work.' });
    useDesktopStore.setState({ canvasModalCard: card, activeBacklogDir: '/proj/.backlog' });
    render(<BacklogCardModal />);
    expect(screen.getByTestId('backlog-card-modal')).toBeInTheDocument();
    expect(screen.getByText('Ship the thing')).toBeInTheDocument();
    expect(screen.getByText('Do the work.')).toBeInTheDocument();
    expect(screen.getByText('Medium')).toBeInTheDocument();
    expect(screen.getByText('To Do')).toBeInTheDocument();
  });

  it('edit -> save round-trips through updateBacklogCardContent and shows the new title', async () => {
    const card = makeCard({ title: 'Old title' });
    useDesktopStore.setState({ canvasModalCard: card, activeBacklogDir: '/proj/.backlog', backlogCards: [card] });
    render(<BacklogCardModal />);

    fireEvent.click(screen.getByLabelText('Edit card'));
    const titleInput = screen.getByDisplayValue('Old title');
    fireEvent.change(titleInput, { target: { value: 'New title' } });
    fireEvent.click(screen.getByLabelText('Save edit'));

    await waitFor(() => {
      expect(window.fluxorAPI!.updateBacklogCardContent).toHaveBeenCalledWith(
        '/proj/.backlog', 't1.md', expect.objectContaining({ title: 'New title' }),
      );
    });
    expect(await screen.findByText('New title')).toBeInTheDocument();
    expect(useDesktopStore.getState().backlogCards[0].title).toBe('New title');
  });

  it('clicking a related task swaps canvasModalCard in place (same modal)', () => {
    const cardA = makeCard({ filename: 'a.md', taskId: 'A', title: 'Card A', related: ['B'] });
    const cardB = makeCard({ filename: 'b.md', taskId: 'B', title: 'Card B' });
    useDesktopStore.setState({ canvasModalCard: cardA, backlogCards: [cardA, cardB], activeBacklogDir: '/proj/.backlog' });
    render(<BacklogCardModal />);

    expect(screen.getByText('Tareas Relacionadas')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Card B'));
    expect(useDesktopStore.getState().canvasModalCard?.filename).toBe('b.md');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Card B');
  });

  it('submitting a comment appends it and clears the input', async () => {
    const card = makeCard({ comments: [] });
    useDesktopStore.setState({ canvasModalCard: card, backlogCards: [card], activeBacklogDir: '/proj/.backlog' });
    render(<BacklogCardModal />);

    const input = screen.getByPlaceholderText('Escribe un comentario...');
    fireEvent.change(input, { target: { value: 'Looks good' } });
    fireEvent.click(screen.getByLabelText('Send comment'));

    await waitFor(() => {
      expect(window.fluxorAPI!.updateBacklogCardContent).toHaveBeenCalledWith(
        '/proj/.backlog', 't1.md', { newComment: { author: 'Tú', text: 'Looks good' } },
      );
    });
    expect(await screen.findByText('Looks good')).toBeInTheDocument();
    expect((input as HTMLTextAreaElement).value).toBe('');
  });

  it('Escape closes the modal', () => {
    const card = makeCard();
    useDesktopStore.setState({ canvasModalCard: card });
    render(<BacklogCardModal />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useDesktopStore.getState().canvasModalCard).toBeNull();
  });

  it('clicking the backdrop closes the modal, clicking inside does not', () => {
    const card = makeCard();
    useDesktopStore.setState({ canvasModalCard: card });
    render(<BacklogCardModal />);
    fireEvent.click(screen.getByText('Sample task'));
    expect(useDesktopStore.getState().canvasModalCard).not.toBeNull();
    fireEvent.click(screen.getByTestId('backlog-card-modal'));
    expect(useDesktopStore.getState().canvasModalCard).toBeNull();
  });

  it('shows the runState overlay in the header next to the status shape (F4)', () => {
    const card = makeCard({ runState: 'failed' });
    useDesktopStore.setState({ canvasModalCard: card });
    render(<BacklogCardModal />);
    expect(screen.getByTestId('run-state-overlay')).toHaveAttribute('data-run-state', 'failed');
  });

  it('shows no runState overlay when idle', () => {
    const card = makeCard({ runState: 'idle' });
    useDesktopStore.setState({ canvasModalCard: card });
    render(<BacklogCardModal />);
    expect(screen.queryByTestId('run-state-overlay')).not.toBeInTheDocument();
  });
});
