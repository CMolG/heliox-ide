import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BacklogCardItem, formatCardDate } from './BacklogCardItem';
import type { BacklogCard } from '@/types/market';

function makeCard(overrides: Partial<BacklogCard> = {}): BacklogCard {
  return {
    filename: 't1.md', taskId: 'TASK-1', targetAgent: '', targetModule: '',
    priority: 'medium', status: 'todo', runState: 'idle', order: 0,
    tags: [], estimate: 4, assignees: [], related: [],
    createdAt: '2026-07-08T00:00:00.000Z', updatedAt: '2026-07-08T00:00:00.000Z',
    title: 'Sample task', description: 'First line of the description.\nMore detail below.',
    comments: [], attachments: [],
    ...overrides,
  };
}

describe('formatCardDate', () => {
  it('formats an ISO date as DD-MMM-YYYY', () => {
    expect(formatCardDate('2026-07-08T00:00:00.000Z')).toBe('08-JUL-2026');
  });
});

describe('BacklogCardItem', () => {
  it('renders title, the first-line excerpt, and tags', () => {
    render(
      <BacklogCardItem card={makeCard({ tags: ['Backend', 'Auth'] })} onOpen={() => {}} isSelected={false} onSelect={() => {}} />
    );
    expect(screen.getByText('Sample task')).toBeInTheDocument();
    expect(screen.getByText('First line of the description.')).toBeInTheDocument();
    expect(screen.getByText('#Backend')).toBeInTheDocument();
    expect(screen.getByText('#Auth')).toBeInTheDocument();
  });

  it('renders the epic badge only when epic is set', () => {
    const { rerender } = render(
      <BacklogCardItem card={makeCard({ epic: 'Security' })} onOpen={() => {}} isSelected={false} onSelect={() => {}} />
    );
    expect(screen.getByText('Epic: Security')).toBeInTheDocument();

    rerender(<BacklogCardItem card={makeCard({ epic: undefined })} onOpen={() => {}} isSelected={false} onSelect={() => {}} />);
    expect(screen.queryByText(/Epic:/)).not.toBeInTheDocument();
  });

  it('onOpen fires on a plain click', () => {
    const onOpen = vi.fn();
    render(<BacklogCardItem card={makeCard()} onOpen={onOpen} isSelected={false} onSelect={() => {}} />);
    fireEvent.click(screen.getByTestId('backlog-card'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('onSelect fires (not onOpen) on meta+click', () => {
    const onOpen = vi.fn();
    const onSelect = vi.fn();
    const card = makeCard();
    render(<BacklogCardItem card={card} onOpen={onOpen} isSelected={false} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('backlog-card'), { metaKey: true });
    expect(onSelect).toHaveBeenCalledWith(card.filename, expect.anything());
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('onSelect fires (not onOpen) on shift+click', () => {
    const onOpen = vi.fn();
    const onSelect = vi.fn();
    const card = makeCard();
    render(<BacklogCardItem card={card} onOpen={onOpen} isSelected={false} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('backlog-card'), { shiftKey: true });
    expect(onSelect).toHaveBeenCalledWith(card.filename, expect.anything());
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('shows a selection ring when isSelected is true', () => {
    render(<BacklogCardItem card={makeCard()} onOpen={() => {}} isSelected onSelect={() => {}} />);
    expect(screen.getByTestId('backlog-card')).toHaveClass('ring-2');
    expect(screen.getByTestId('backlog-card')).toHaveAttribute('aria-selected', 'true');
  });

  it('renders the runStateOverlay slot when provided', () => {
    render(
      <BacklogCardItem
        card={makeCard()}
        onOpen={() => {}}
        isSelected={false}
        onSelect={() => {}}
        runStateOverlay={<span data-testid="overlay-slot">running</span>}
      />
    );
    expect(screen.getByTestId('overlay-slot')).toBeInTheDocument();
  });
});
