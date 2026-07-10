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
import { MarketplaceApp, buildFlowAssembly } from './MarketplaceApp';
import { useDesktopStore } from '@/renderer/store/desktop-store';
import type { Plugin } from '@/types/desktop';
import type { MarketFlow, MarketInventory } from '@/types/market';

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

// A flow with no authored `steps[]` — exercises the mono-step fallback path
// (e.g. brainstorm-cards in the real market/inventory.json).
const FLOW_PLUGIN_NO_STEPS: Plugin = {
  id: 'flow-idea-crystallizer',
  name: 'Idea Crystallizer',
  description: 'Turns a rough idea into structured requirements.',
  iconName: 'MdLightbulb',
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
      steps: [
        { id: 'scan-target', prompt: 'Scan the target files for the refactor.' },
        {
          id: 'apply-refactor',
          prompt: 'Apply the refactor across all affected files.',
          roleId: 'frontend-engineer',
          modIds: ['strict-linting'],
        },
      ],
    },
    {
      name: 'idea-crystallizer',
      betterOn: 'opencode/claude-sonnet-4-6',
      recommendedComplexity: 'low',
      cost: 'low',
      icon: 'MdLightbulb',
      iconLibrary: 'react-icons/md',
      description: 'Turns a rough idea into structured requirements.',
      tags: ['discovery'],
      // No `steps` — this flow should fall back to a single mono-step.
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
      FLOW_PLUGIN_NO_STEPS,
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

// ─── Flows copy to the board as real steps (F0 decision 4) ──────────────
//
// A market flow is no longer an attachable spawned onto the canvas — its
// sheet CTA builds a PipelineAssembly straight from the flow's authored
// steps[] and materializes it via `insertPipelineAssembly` (the SAME seam
// the auto-chat panel uses), landing real, independently-editable step nodes
// on the board. deployPlugin is NOT called for a flow.

describe('MarketplaceApp — flows materialize onto the board', () => {
  function stepNodes() {
    // Loosely typed like desktop-store.test.ts — the step node's `data`
    // carries prompt/roles/mods (see insertPipelineAssembly).
    return useDesktopStore.getState().mentalNodes.filter((n: any) => n.type === 'step') as any[];
  }
  function frameNodes() {
    return useDesktopStore.getState().mentalNodes.filter((n: any) => n.type === 'frame');
  }

  it('labels the flow sheet CTA "Add to board", not "Deploy"', () => {
    seedStore();
    render(<MarketplaceApp />);
    fireEvent.click(screen.getByTestId(`plugin-card-${FLOW_PLUGIN.id}`));

    expect(screen.getByRole('button', { name: /add to board/i })).toBeInTheDocument();
    // The flow CTA is NOT the generic "Deploy" — that word only survives for
    // non-flow categories (roles/mods/steps/tools).
    expect(screen.queryByRole('button', { name: 'Deploy' })).not.toBeInTheDocument();
  });

  it('"Add to board" inserts a frame + one step per authored flow step — not an attachable — and closes the marketplace', () => {
    seedStore();
    render(<MarketplaceApp />);
    fireEvent.click(screen.getByTestId(`plugin-card-${FLOW_PLUGIN.id}`));
    fireEvent.click(screen.getByTestId(`plugin-deploy-${FLOW_PLUGIN.id}`));

    expect(frameNodes()).toHaveLength(1);
    expect(stepNodes()).toHaveLength(2); // karpathy-loop fixture has 2 authored steps

    // Real steps on the board, NOT a canvas attachable (the retired form).
    expect(useDesktopStore.getState().attachables).toHaveLength(0);
    expect(useDesktopStore.getState().showMarketplace).toBe(false);
  });

  it('carries the flow\'s authored prompts, seed role and seed mods onto the steps', () => {
    seedStore();
    render(<MarketplaceApp />);
    fireEvent.click(screen.getByTestId(`plugin-card-${FLOW_PLUGIN.id}`));
    fireEvent.click(screen.getByTestId(`plugin-deploy-${FLOW_PLUGIN.id}`));

    const prompts = stepNodes().map((s) => s.data.prompt);
    expect(prompts).toContain('Scan the target files for the refactor.');
    expect(prompts).toContain('Apply the refactor across all affected files.');

    const applyStep = stepNodes().find((s) => s.data.prompt === 'Apply the refactor across all affected files.');
    expect(applyStep.data.roles.map((r: any) => r.name)).toEqual(['frontend-engineer']);
    expect(applyStep.data.mods.map((m: any) => m.name)).toEqual(['strict-linting']);
  });

  it('falls back to a single mono-step (description as prompt) for a flow with no authored steps', () => {
    seedStore();
    render(<MarketplaceApp />);
    fireEvent.click(screen.getByTestId(`plugin-card-${FLOW_PLUGIN_NO_STEPS.id}`));
    fireEvent.click(screen.getByTestId(`plugin-deploy-${FLOW_PLUGIN_NO_STEPS.id}`));

    const steps = stepNodes();
    expect(steps).toHaveLength(1);
    expect(steps[0].data.prompt).toBe('Turns a rough idea into structured requirements.');
    // Still NOT deployed as an attachable.
    expect(useDesktopStore.getState().attachables).toHaveLength(0);
  });
});

// ─── buildFlowAssembly (pure) ───────────────────────────────────────────

describe('buildFlowAssembly', () => {
  function makeFlow(overrides: Partial<MarketFlow>): MarketFlow {
    return {
      name: 'sample-flow',
      betterOn: 'x',
      recommendedComplexity: 'low',
      cost: 'low',
      icon: 'MdBolt',
      iconLibrary: 'react-icons/md',
      description: 'A sample flow.',
      tags: [],
      ...overrides,
    };
  }

  it('title-cases the flow name into the frame title', () => {
    expect(buildFlowAssembly(makeFlow({ name: 'auto-feature-engineer' })).frameTitle)
      .toBe('Auto Feature Engineer');
  });

  it('maps authored steps to a linear chain (prevStepIds follows array order)', () => {
    const assembly = buildFlowAssembly(makeFlow({
      steps: [
        { id: 'a', prompt: 'A' },
        { id: 'b', prompt: 'B' },
        { id: 'c', prompt: 'C' },
      ],
    }));
    expect(assembly.steps.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(assembly.steps[0].prevStepIds).toEqual([]);
    expect(assembly.steps[1].prevStepIds).toEqual(['a']);
    expect(assembly.steps[2].prevStepIds).toEqual(['b']);
  });

  it('preserves an explicit prevStepIds graph and a loopBackTo edge (infinite-loop flow)', () => {
    const assembly = buildFlowAssembly(makeFlow({
      cost: 'infinite',
      steps: [
        { id: 'profile', prompt: 'P' },
        { id: 'fix', prompt: 'F', prevStepIds: ['profile'], loopBackTo: { stepId: 'profile', maxIterations: 3 } },
      ],
    }));
    expect(assembly.steps[1].prevStepIds).toEqual(['profile']);
    expect(assembly.steps[1].loopBackTo).toEqual({ stepId: 'profile', maxIterations: 3 });
  });

  it('defaults roleId to "" and modIds to [] when a step omits them', () => {
    const assembly = buildFlowAssembly(makeFlow({ steps: [{ id: 'only', prompt: 'Do it' }] }));
    expect(assembly.steps[0].roleId).toBe('');
    expect(assembly.steps[0].modIds).toEqual([]);
    expect(assembly.steps[0].loopBackTo).toBeUndefined();
  });

  it('falls back to a single mono-step carrying the description for a flow with no steps', () => {
    const assembly = buildFlowAssembly(makeFlow({ description: 'Turns an idea into cards.' }));
    expect(assembly.steps).toHaveLength(1);
    expect(assembly.steps[0].prompt).toBe('Turns an idea into cards.');
    expect(assembly.steps[0].prevStepIds).toEqual([]);
    expect(assembly.missingCapabilitiesRequested).toEqual([]);
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
