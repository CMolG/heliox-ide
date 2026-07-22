import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LaunchMenu } from './LaunchMenu';
import type { BacklogCard } from '@/types/market';

function makeCard(overrides: Partial<BacklogCard> = {}): BacklogCard {
  return {
    filename: 't1.md', taskId: 'TASK-1', targetAgent: '', targetModule: '',
    priority: 'medium', status: 'todo', runState: 'idle', order: 0,
    tags: [], estimate: 4, assignees: [], related: [],
    createdAt: '2026-07-08T00:00:00.000Z', updatedAt: '2026-07-08T00:00:00.000Z',
    title: 'Sample task', description: 'Some description.',
    comments: [], attachments: [],
    ...overrides,
  };
}

describe('LaunchMenu', () => {
  it('renders 2 menu items when the card has no epic', () => {
    render(
      <LaunchMenu card={makeCard()} frames={[]} onLaunchExisting={() => {}} onLaunchAutoflow={() => {}} />
    );
    fireEvent.click(screen.getByTestId('launch-menu-trigger'));
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
    expect(screen.getByText('Run on existing flow')).toBeInTheDocument();
    expect(screen.getByText('Autoflow')).toBeInTheDocument();
    expect(screen.queryByText('Run epic as flow')).not.toBeInTheDocument();
  });

  it('renders 3 menu items when the card has an epic and onLaunchEpic is provided', () => {
    render(
      <LaunchMenu
        card={makeCard({ epic: 'Security' })}
        frames={[]}
        onLaunchExisting={() => {}}
        onLaunchAutoflow={() => {}}
        onLaunchEpic={() => {}}
      />
    );
    fireEvent.click(screen.getByTestId('launch-menu-trigger'));
    expect(screen.getAllByRole('menuitem')).toHaveLength(3);
    expect(screen.getByText('Run epic as flow')).toBeInTheDocument();
  });

  it('does not render "Run epic as flow" when the card has an epic but no handler was supplied', () => {
    render(
      <LaunchMenu card={makeCard({ epic: 'Security' })} frames={[]} onLaunchExisting={() => {}} onLaunchAutoflow={() => {}} />
    );
    fireEvent.click(screen.getByTestId('launch-menu-trigger'));
    expect(screen.queryByText('Run epic as flow')).not.toBeInTheDocument();
  });

  it('clicking "Run on existing flow" opens a frame picker submenu populated from frames', () => {
    render(
      <LaunchMenu
        card={makeCard()}
        frames={[{ id: 'frame-1', title: 'Onboarding flow' }, { id: 'frame-2', title: 'Billing flow' }]}
        onLaunchExisting={() => {}}
        onLaunchAutoflow={() => {}}
      />
    );
    fireEvent.click(screen.getByTestId('launch-menu-trigger'));
    fireEvent.click(screen.getByText('Run on existing flow'));
    expect(screen.getByText('Onboarding flow')).toBeInTheDocument();
    expect(screen.getByText('Billing flow')).toBeInTheDocument();
    expect(screen.queryByText('Autoflow')).not.toBeInTheDocument();
  });

  it('selecting a frame in the picker calls onLaunchExisting with its id and closes the menu', () => {
    const onLaunchExisting = vi.fn();
    render(
      <LaunchMenu
        card={makeCard()}
        frames={[{ id: 'frame-1', title: 'Onboarding flow' }]}
        onLaunchExisting={onLaunchExisting}
        onLaunchAutoflow={() => {}}
      />
    );
    fireEvent.click(screen.getByTestId('launch-menu-trigger'));
    fireEvent.click(screen.getByText('Run on existing flow'));
    fireEvent.click(screen.getByText('Onboarding flow'));
    expect(onLaunchExisting).toHaveBeenCalledWith('frame-1');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('clicking Autoflow calls onLaunchAutoflow and closes the menu', () => {
    const onLaunchAutoflow = vi.fn();
    render(
      <LaunchMenu card={makeCard()} frames={[]} onLaunchExisting={() => {}} onLaunchAutoflow={onLaunchAutoflow} />
    );
    fireEvent.click(screen.getByTestId('launch-menu-trigger'));
    fireEvent.click(screen.getByText('Autoflow'));
    expect(onLaunchAutoflow).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('clicking the trigger does not bubble a click to an ancestor handler', () => {
    const onAncestorClick = vi.fn();
    render(
      <div onClick={onAncestorClick}>
        <LaunchMenu card={makeCard()} frames={[]} onLaunchExisting={() => {}} onLaunchAutoflow={() => {}} />
      </div>
    );
    fireEvent.click(screen.getByTestId('launch-menu-trigger'));
    expect(onAncestorClick).not.toHaveBeenCalled();
  });
});
