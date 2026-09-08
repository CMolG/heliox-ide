import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

describe('LaunchMenu — "Open agent session" (Cockpit F3)', () => {
  const VENDORS = [
    { id: 'claude', label: 'Claude Code', available: true },
    { id: 'codex', label: 'Codex', available: true },
    { id: 'gemini', label: 'Gemini CLI', available: false },
  ];

  let detectAgents: ReturnType<typeof vi.fn>;
  let ptyLiveSessions: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    detectAgents = vi.fn().mockResolvedValue(VENDORS);
    ptyLiveSessions = vi.fn().mockResolvedValue([]);
    (window as unknown as { fluxorAPI?: unknown }).fluxorAPI = { detectAgents, ptyLiveSessions };
  });

  function renderMenu(props: Partial<React.ComponentProps<typeof LaunchMenu>> = {}) {
    return render(
      <LaunchMenu
        card={makeCard()}
        frames={[]}
        onLaunchExisting={() => {}}
        onLaunchAutoflow={() => {}}
        onLaunchAgent={() => {}}
        projectRoot="/proj"
        {...props}
      />,
    );
  }

  async function openAgentSubmenu(props: Partial<React.ComponentProps<typeof LaunchMenu>> = {}) {
    renderMenu(props);
    fireEvent.click(screen.getByTestId('launch-menu-trigger'));
    fireEvent.click(screen.getByTestId('launch-menu-agent'));
    await screen.findByTestId('launch-agent-submenu');
  }

  it('adds a fourth item when a handler is supplied', () => {
    renderMenu();
    fireEvent.click(screen.getByTestId('launch-menu-trigger'));
    expect(screen.getAllByRole('menuitem')).toHaveLength(3);
    expect(screen.getByText('Open agent session')).toBeInTheDocument();
  });

  it('offers it nowhere when no handler was supplied — same rule as the epic entry', () => {
    render(
      <LaunchMenu card={makeCard()} frames={[]} onLaunchExisting={() => {}} onLaunchAutoflow={() => {}} />,
    );
    fireEvent.click(screen.getByTestId('launch-menu-trigger'));
    expect(screen.queryByTestId('launch-menu-agent')).not.toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
  });

  it('opens a nested submenu listing the installed CLIs, the way the frame picker does', async () => {
    await openAgentSubmenu();
    expect(await screen.findByTestId('launch-agent-vendor-claude')).toBeEnabled();
    expect(screen.getByTestId('launch-agent-vendor-codex')).toBeEnabled();
    // The root items are gone while the submenu is up — one level at a time.
    expect(screen.queryByText('Autoflow')).not.toBeInTheDocument();
  });

  it('disables a vendor that is not installed, and SAYS so in the row', async () => {
    await openAgentSubmenu();
    const gemini = await screen.findByTestId('launch-agent-vendor-gemini');
    expect(gemini).toBeDisabled();
    expect(gemini).toHaveTextContent('not installed');
  });

  it('defaults to worktree and launches with the vendor and the selected mode', async () => {
    const onLaunchAgent = vi.fn();
    await openAgentSubmenu({ onLaunchAgent });
    fireEvent.click(await screen.findByTestId('launch-agent-vendor-claude'));
    expect(onLaunchAgent).toHaveBeenCalledWith('claude', 'worktree');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('launches attached once attached is picked', async () => {
    const onLaunchAgent = vi.fn();
    await openAgentSubmenu({ onLaunchAgent });
    fireEvent.click(screen.getByTestId('launch-agent-mode-attached'));
    fireEvent.click(await screen.findByTestId('launch-agent-vendor-claude'));
    expect(onLaunchAgent).toHaveBeenCalledWith('claude', 'attached');
  });

  it('disables attached WITH ITS REASON when a session already holds that project', async () => {
    ptyLiveSessions.mockResolvedValue([{ sessionId: 's-other', projectRoot: '/proj', mode: 'attached' }]);
    await openAgentSubmenu();
    const attached = screen.getByTestId('launch-agent-mode-attached');
    await waitFor(() => expect(attached).toBeDisabled());
    expect(attached).toHaveTextContent('another session holds this project');
    expect(screen.getByTestId('launch-agent-mode-worktree')).toBeEnabled();
  });

  it('leaves attached alone when the live session holds a DIFFERENT project', async () => {
    ptyLiveSessions.mockResolvedValue([{ sessionId: 's-other', projectRoot: '/elsewhere', mode: 'attached' }]);
    await openAgentSubmenu();
    await waitFor(() => expect(detectAgents).toHaveBeenCalled());
    expect(screen.getByTestId('launch-agent-mode-attached')).toBeEnabled();
  });

  it('disables worktree for an external backlog, and starts in attached', async () => {
    const onLaunchAgent = vi.fn();
    await openAgentSubmenu({ isExternalBacklog: true, onLaunchAgent });
    const worktree = screen.getByTestId('launch-agent-mode-worktree');
    expect(worktree).toBeDisabled();
    expect(worktree).toHaveTextContent('external backlog · attached only');
    fireEvent.click(await screen.findByTestId('launch-agent-vendor-claude'));
    expect(onLaunchAgent).toHaveBeenCalledWith('claude', 'attached');
  });

  it('probes the machine only when the submenu opens — not once per card on the pile', () => {
    renderMenu();
    expect(detectAgents).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('launch-menu-trigger'));
    expect(detectAgents).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('launch-menu-agent'));
    expect(detectAgents).toHaveBeenCalledTimes(1);
  });

  it('renders nothing at all for a card that is not launchable (a HUMAN card)', () => {
    renderMenu({ launchable: false });
    expect(screen.queryByTestId('launch-menu')).not.toBeInTheDocument();
    expect(screen.queryByTestId('launch-menu-trigger')).not.toBeInTheDocument();
  });
});
