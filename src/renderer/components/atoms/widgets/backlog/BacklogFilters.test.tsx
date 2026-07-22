import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BacklogFilters } from './BacklogFilters';

describe('BacklogFilters', () => {
  it('calls onSearchChange when typing in the search input', () => {
    const onSearchChange = vi.fn();
    render(<BacklogFilters searchTerm="" onSearchChange={onSearchChange} activeStatuses={[]} onToggleStatus={() => {}} />);
    fireEvent.change(screen.getByLabelText('Search backlog'), { target: { value: 'auth' } });
    expect(onSearchChange).toHaveBeenCalledWith('auth');
  });

  it('calls onToggleStatus with the status id when a chip is clicked', () => {
    const onToggleStatus = vi.fn();
    render(<BacklogFilters searchTerm="" onSearchChange={() => {}} activeStatuses={['todo']} onToggleStatus={onToggleStatus} />);
    fireEvent.click(screen.getByRole('button', { name: /to do/i }));
    expect(onToggleStatus).toHaveBeenCalledWith('todo');
  });

  it('renders all 6 status chips sorted by workflow order (deploy first, refine last)', () => {
    render(<BacklogFilters searchTerm="" onSearchChange={() => {}} activeStatuses={[]} onToggleStatus={() => {}} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(6);
    expect(buttons[0]).toHaveTextContent('Deploy');
    expect(buttons[1]).toHaveTextContent('Review');
    expect(buttons[2]).toHaveTextContent('In Progress');
    expect(buttons[3]).toHaveTextContent('Ready');
    expect(buttons[4]).toHaveTextContent('To Do');
    expect(buttons[5]).toHaveTextContent('Refine');
  });

  it('marks active statuses with aria-pressed=true and inactive ones false', () => {
    render(<BacklogFilters searchTerm="" onSearchChange={() => {}} activeStatuses={['deploy']} onToggleStatus={() => {}} />);
    const deployBtn = screen.getByRole('button', { name: /deploy/i });
    const reviewBtn = screen.getByRole('button', { name: /review/i });
    expect(deployBtn).toHaveAttribute('aria-pressed', 'true');
    expect(reviewBtn).toHaveAttribute('aria-pressed', 'false');
  });
});
