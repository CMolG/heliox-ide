/**
 * MarketplaceApp.test.tsx — Component tests for the marketplace product sheet
 *
 * Covers the intermediate "product sheet" flow: clicking a plugin card must
 * OPEN a detail sheet (not deploy), and only the sheet's "Deploy" button may
 * call `deployPlugin`. Also covers the sheet's inventory-derived metadata,
 * the Back/X back paths, Escape handling, and focus management.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { MarketplaceApp } from './MarketplaceApp';
import { useDesktopStore } from '@/renderer/store/desktop-store';
import type { Plugin } from '@/types/desktop';
import type { MarketInventory } from '@/types/market';

// ─── Fixtures ───────────────────────────────────────────────────────

const ROLE_PLUGIN: Plugin = {
  id: 'inv-role-frontend-engineer',
  name: 'Frontend Engineer',
  description: 'Builds accessible, performant UI with React and strict TypeScript.',
  iconName: 'MdWeb',
  category: 'roles',
  author: 'Fluxor Market',
  installed: true,
};

const MOD_PLUGIN: Plugin = {
  id: 'inv-mod-strict-linting',
  name: 'Strict Linting',
  description: 'Enforces zero-warning lint output before any commit.',
  iconName: 'MdBuild',
  category: 'modifiers',
  author: 'Fluxor Market',
  installed: true,
};

const FLOW_PLUGIN: Plugin = {
  id: 'flow-karpathy-loop',
  name: 'Karpathy Loop',
  description: 'An autonomous, self-correcting execution loop for large refactors.',
  iconName: 'MdBolt',
  category: 'flows',
  author: 'Fluxor Market',
  installed: true,
};

const INVENTORY: MarketInventory = {
  flows: [
    {
      name: 'karpathy-loop',
      betterOn: 'large multi-file refactors',
      recommendedComplexity: 'high',
      cost: 'high',
      icon: 'MdBolt',
      iconLibrary: 'react-icons/md',
      description: 'An autonomous, self-correcting execution loop for large refactors.',
      tags: ['autonomous', 'refactor'],
    },
  ],
  roles: [
    {
      name: 'frontend-engineer',
      icon: 'MdWeb',
      iconLibrary: 'react-icons/md',
      description: 'Builds accessible, performant UI with React and strict TypeScript.',
      tags: ['react', 'accessibility'],
      betterOn: 'small, well-scoped UI changes',
      domains: ['frontend', 'web'],
    },
  ],
  mods: [
    {
      name: 'strict-linting',
      icon: 'MdBuild',
      iconLibrary: 'react-icons/md',
      description: 'Enforces zero-warning lint output before any commit.',
      tags: ['quality'],
      incompatibleWith: ['loose-linting'],
      exclusiveGroup: 'linting',
      domains: ['frontend', 'backend'],
    },
  ],
  steps: [],
};

function seedStore() {
  useDesktopStore.setState({
    showMarketplace: true,
    availablePlugins: [
      ...useDesktopStore.getState().availablePlugins,
      ROLE_PLUGIN,
      MOD_PLUGIN,
      FLOW_PLUGIN,
    ],
    marketInventory: INVENTORY,
  });
}

beforeEach(() => {
  useDesktopStore.setState(useDesktopStore.getInitialState(), true);
});

// ─── Card click opens the sheet, never deploys ───────────────────────

describe('MarketplaceApp — card click opens the product sheet', () => {
  it('renders plugin cards in the grid', () => {
    seedStore();
    render(<MarketplaceApp />);
    expect(screen.getByTestId(`plugin-card-${ROLE_PLUGIN.id}`)).toBeInTheDocument();
  });

  it('clicking a card opens the sheet instead of deploying', () => {
    seedStore();
    render(<MarketplaceApp />);
    fireEvent.click(screen.getByTestId(`plugin-card-${ROLE_PLUGIN.id}`));

    // The sheet is showing: full description visible, grid gone.
    expect(screen.getByTestId('plugin-sheet')).toBeInTheDocument();
    expect(screen.getByText(ROLE_PLUGIN.description)).toBeInTheDocument();
    expect(screen.queryByTestId(`plugin-card-${ROLE_PLUGIN.id}`)).not.toBeInTheDocument();

    // Nothing was deployed yet.
    expect(useDesktopStore.getState().attachables).toHaveLength(0);
    expect(useDesktopStore.getState().showMarketplace).toBe(true);
  });

  it('shows category badge, author, and inventory tags on the sheet', () => {
    seedStore();
    render(<MarketplaceApp />);
    fireEvent.click(screen.getByTestId(`plugin-card-${ROLE_PLUGIN.id}`));

    expect(screen.getByText('Role')).toBeInTheDocument();
    expect(screen.getByText(/by Fluxor Market/)).toBeInTheDocument();
    expect(screen.getByText('react')).toBeInTheDocument();
    expect(screen.getByText('accessibility')).toBeInTheDocument();
  });

  it('shows flow metadata (betterOn / cost / recommendedComplexity)', () => {
    seedStore();
    render(<MarketplaceApp />);
    fireEvent.click(screen.getByTestId(`plugin-card-${FLOW_PLUGIN.id}`));

    expect(screen.getByText('large multi-file refactors')).toBeInTheDocument();
    // cost AND recommendedComplexity are both 'high' in this fixture — two dd's.
    expect(screen.getAllByText('high').length).toBe(2);
  });

  it('shows mod metadata (incompatibleWith / exclusiveGroup / domains)', () => {
    seedStore();
    render(<MarketplaceApp />);
    fireEvent.click(screen.getByTestId(`plugin-card-${MOD_PLUGIN.id}`));

    expect(screen.getByText('linting')).toBeInTheDocument();
    expect(screen.getByText('loose-linting')).toBeInTheDocument();
    expect(screen.getByText('Domains')).toBeInTheDocument();
    expect(screen.getByText('frontend, backend')).toBeInTheDocument();
  });

  it('shows role metadata (betterOn / domains) when present in the fixture', () => {
    seedStore();
    render(<MarketplaceApp />);
    fireEvent.click(screen.getByTestId(`plugin-card-${ROLE_PLUGIN.id}`));

    expect(screen.getByText('Better on')).toBeInTheDocument();
    expect(screen.getByText('small, well-scoped UI changes')).toBeInTheDocument();
    expect(screen.getByText('Domains')).toBeInTheDocument();
    expect(screen.getByText('frontend, web')).toBeInTheDocument();
  });

  it('omits Better on / Domains rows when the role fixture lacks that (optional) metadata', () => {
    useDesktopStore.setState({
      showMarketplace: true,
      availablePlugins: [...useDesktopStore.getState().availablePlugins, ROLE_PLUGIN],
      marketInventory: {
        ...INVENTORY,
        roles: [
          {
            name: 'frontend-engineer',
            icon: 'MdWeb',
            iconLibrary: 'react-icons/md',
            description: 'Builds accessible, performant UI with React and strict TypeScript.',
            tags: ['react', 'accessibility'],
            // no betterOn, no domains — degrades cleanly, no dl rendered.
          },
        ],
      },
    });
    render(<MarketplaceApp />);
    fireEvent.click(screen.getByTestId(`plugin-card-${ROLE_PLUGIN.id}`));

    expect(screen.getByTestId('plugin-sheet')).toBeInTheDocument();
    expect(screen.queryByText('Better on')).not.toBeInTheDocument();
    expect(screen.queryByText('Domains')).not.toBeInTheDocument();
  });

  it('gracefully falls back to the plugin\'s own fields when there is no inventory match', () => {
    seedStore();
    // Built-in tool plugins have no inventory equivalent at all.
    const toolPlugin = useDesktopStore.getState().availablePlugins.find(p => p.category === 'tools')!;
    render(<MarketplaceApp />);
    fireEvent.click(screen.getByTestId(`plugin-card-${toolPlugin.id}`));

    expect(screen.getByTestId('plugin-sheet')).toBeInTheDocument();
    expect(screen.getByText(toolPlugin.description)).toBeInTheDocument();
    // No tags/metadata section should throw or render bogus content.
    expect(screen.getByRole('button', { name: 'Deploy' })).toBeInTheDocument();
  });
});

// ─── Deploy is the only control that deploys ─────────────────────────

describe('MarketplaceApp — Deploy deploys, Back/X do not', () => {
  it('Deploy calls deployPlugin and closes the sheet + marketplace', () => {
    seedStore();
    render(<MarketplaceApp />);
    fireEvent.click(screen.getByTestId(`plugin-card-${ROLE_PLUGIN.id}`));

    fireEvent.click(screen.getByTestId(`plugin-deploy-${ROLE_PLUGIN.id}`));

    expect(useDesktopStore.getState().attachables.some(a => a.name === 'frontend-engineer')).toBe(true);
    expect(useDesktopStore.getState().showMarketplace).toBe(false);
  });

  it('Back returns to the grid without deploying', () => {
    seedStore();
    render(<MarketplaceApp />);
    fireEvent.click(screen.getByTestId(`plugin-card-${ROLE_PLUGIN.id}`));
    fireEvent.click(screen.getByRole('button', { name: /back/i }));

    expect(screen.getByTestId(`plugin-card-${ROLE_PLUGIN.id}`)).toBeInTheDocument();
    expect(screen.queryByTestId('plugin-sheet')).not.toBeInTheDocument();
    expect(useDesktopStore.getState().attachables).toHaveLength(0);
    expect(useDesktopStore.getState().showMarketplace).toBe(true);
  });

  it('header close (X) returns to the grid — without deploying — while the sheet is open', () => {
    seedStore();
    render(<MarketplaceApp />);
    fireEvent.click(screen.getByTestId(`plugin-card-${ROLE_PLUGIN.id}`));
    fireEvent.click(screen.getByRole('button', { name: 'Close marketplace' }));

    expect(screen.getByTestId(`plugin-card-${ROLE_PLUGIN.id}`)).toBeInTheDocument();
    expect(useDesktopStore.getState().attachables).toHaveLength(0);
    expect(useDesktopStore.getState().showMarketplace).toBe(true);
  });

  it('header close (X) closes the whole marketplace when viewing the grid', () => {
    seedStore();
    render(<MarketplaceApp />);
    fireEvent.click(screen.getByRole('button', { name: 'Close marketplace' }));
    expect(useDesktopStore.getState().showMarketplace).toBe(false);
  });

  it('re-opening the marketplace after Deploy starts fresh at the grid (no stale sheet)', () => {
    seedStore();
    const { rerender } = render(<MarketplaceApp />);
    fireEvent.click(screen.getByTestId(`plugin-card-${ROLE_PLUGIN.id}`));
    fireEvent.click(screen.getByTestId(`plugin-deploy-${ROLE_PLUGIN.id}`));
    expect(useDesktopStore.getState().showMarketplace).toBe(false);

    useDesktopStore.getState().setShowMarketplace(true);
    rerender(<MarketplaceApp />);
    expect(screen.queryByTestId('plugin-sheet')).not.toBeInTheDocument();
    expect(screen.getByTestId('marketplace-search')).toBeInTheDocument();
  });
});

// ─── Escape ───────────────────────────────────────────────────────────

describe('MarketplaceApp — Escape returns to the grid, not the whole marketplace', () => {
  it('Escape while the sheet is open closes the sheet but keeps the marketplace open', () => {
    seedStore();
    render(<MarketplaceApp />);
    fireEvent.click(screen.getByTestId(`plugin-card-${ROLE_PLUGIN.id}`));
    expect(screen.getByTestId('plugin-sheet')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByTestId('plugin-sheet')).not.toBeInTheDocument();
    expect(screen.getByTestId(`plugin-card-${ROLE_PLUGIN.id}`)).toBeInTheDocument();
    expect(useDesktopStore.getState().showMarketplace).toBe(true);
  });
});

// ─── Focus management ──────────────────────────────────────────────────

describe('MarketplaceApp — focus management', () => {
  it('moves focus to Back when the sheet opens', () => {
    seedStore();
    render(<MarketplaceApp />);
    fireEvent.click(screen.getByTestId(`plugin-card-${ROLE_PLUGIN.id}`));

    expect(document.activeElement).toBe(screen.getByRole('button', { name: /back/i }));
  });

  it('restores focus to the originating card after Back', async () => {
    seedStore();
    render(<MarketplaceApp />);
    const card = screen.getByTestId(`plugin-card-${ROLE_PLUGIN.id}`);
    fireEvent.click(card);
    fireEvent.click(screen.getByRole('button', { name: /back/i }));

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId(`plugin-card-${ROLE_PLUGIN.id}`));
    });
  });
});
