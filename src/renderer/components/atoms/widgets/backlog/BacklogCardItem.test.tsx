import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BacklogCardItem, formatCardDate } from './BacklogCardItem';
import { useDesktopStore } from '@/renderer/store/desktop-store';
import type { BacklogCard } from '@/types/market';
import type { AgentSessionMeta } from '@/types/desktop';

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

describe('runState overlay (F4 — write-back overlay, F0 spec §3.1)', () => {
  it('renders nothing for idle (no explicit override)', () => {
    render(<BacklogCardItem card={makeCard({ runState: 'idle' })} onOpen={() => {}} isSelected={false} onSelect={() => {}} />);
    expect(screen.queryByTestId('run-state-overlay')).not.toBeInTheDocument();
  });

  it('renders a spinner overlay for running', () => {
    render(<BacklogCardItem card={makeCard({ runState: 'running' })} onOpen={() => {}} isSelected={false} onSelect={() => {}} />);
    expect(screen.getByTestId('run-state-overlay')).toHaveAttribute('data-run-state', 'running');
  });

  it('renders a check overlay for completed', () => {
    render(<BacklogCardItem card={makeCard({ runState: 'completed' })} onOpen={() => {}} isSelected={false} onSelect={() => {}} />);
    expect(screen.getByTestId('run-state-overlay')).toHaveAttribute('data-run-state', 'completed');
  });

  it('renders a cross overlay for failed', () => {
    render(<BacklogCardItem card={makeCard({ runState: 'failed' })} onOpen={() => {}} isSelected={false} onSelect={() => {}} />);
    expect(screen.getByTestId('run-state-overlay')).toHaveAttribute('data-run-state', 'failed');
  });

  it('an explicit runStateOverlay prop still overrides the computed default', () => {
    render(
      <BacklogCardItem
        card={makeCard({ runState: 'running' })}
        onOpen={() => {}}
        isSelected={false}
        onSelect={() => {}}
        runStateOverlay={<span data-testid="overlay-slot">custom</span>}
      />
    );
    expect(screen.getByTestId('overlay-slot')).toBeInTheDocument();
    expect(screen.queryByTestId('run-state-overlay')).not.toBeInTheDocument();
  });
});

describe('session overlay (Cockpit F3 — a live session on the card)', () => {
  beforeEach(() => {
    useDesktopStore.setState(useDesktopStore.getInitialState(), true);
  });

  function withSession(meta: Partial<AgentSessionMeta>) {
    useDesktopStore.setState({
      windows: [{
        id: 'w1', type: 'agent-session', title: 'JDB-1 · claude', iconName: 'Terminal',
        position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, zIndex: 1,
        isMinimized: false, isMaximized: false,
        agentSession: {
          sessionId: 's1', vendor: 'claude', cwd: '/proj', projectRoot: '/proj',
          mode: 'attached', launchedAt: 1, ptyStarted: true, attention: 'running',
          cardFilename: 't1.md', cardId: 'TASK-1', ...meta,
        },
      }] as unknown as ReturnType<typeof useDesktopStore.getState>['windows'],
    });
  }

  it('replaces the runState icon with the session\'s state in WORDS', () => {
    withSession({ attention: 'running' });
    render(<BacklogCardItem card={makeCard({ runState: 'running' })} onOpen={() => {}} isSelected={false} onSelect={() => {}} />);
    const overlay = screen.getByTestId('run-state-overlay');
    expect(overlay).toHaveTextContent('running');
    expect(overlay).toHaveAttribute('title', 'session claude · attached');
    // One overlay, not two: the live session is the more specific answer.
    expect(screen.getAllByTestId('run-state-overlay')).toHaveLength(1);
  });

  it('appends the worktree\'s own status when it has moved ahead of the board\'s', () => {
    withSession({ mode: 'worktree', branch: 'task-1/probe', mirroredStatus: 'review' });
    render(<BacklogCardItem card={makeCard({ status: 'doing' })} onOpen={() => {}} isSelected={false} onSelect={() => {}} />);
    expect(screen.getByTestId('run-state-overlay')).toHaveTextContent('running · in worktree: review');
  });

  it('focuses the session window when clicked, without opening the card', () => {
    withSession({});
    const onOpen = vi.fn();
    render(<BacklogCardItem card={makeCard()} onOpen={onOpen} isSelected={false} onSelect={() => {}} />);
    fireEvent.click(screen.getByTestId('run-state-overlay'));
    expect(useDesktopStore.getState().activeWindowId).toBe('w1');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('leaves a card with no session showing its plain runState icon', () => {
    withSession({ cardFilename: 'someone-else.md' });
    render(<BacklogCardItem card={makeCard({ runState: 'completed' })} onOpen={() => {}} isSelected={false} onSelect={() => {}} />);
    expect(screen.getByTestId('run-state-overlay')).toHaveAttribute('data-run-state', 'completed');
  });
});
