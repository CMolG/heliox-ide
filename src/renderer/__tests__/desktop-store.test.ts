import { describe, it, expect, beforeEach } from 'vitest';
import type { PipelineAssembly } from '@/types/meta-agent';
import { useDesktopStore, getStepMentalAttachments } from '../store/desktop-store';

// Reset store to pristine state before each test
beforeEach(() => {
  useDesktopStore.setState(useDesktopStore.getInitialState(), true);
});

// ─── Helpers ─────────────────────────────────────────────────────

function addChat(opts?: { title?: string; iconName?: string; sessionId?: string }) {
  return useDesktopStore.getState().addWindow('chat', opts);
}

function getWindow(id: string) {
  return useDesktopStore.getState().windows.find(w => w.id === id);
}

// ─── Window CRUD ─────────────────────────────────────────────────

describe('Window CRUD', () => {
  it('addWindow creates a chat window with defaults', () => {
    const id = addChat();
    const win = getWindow(id)!;
    expect(win).toBeDefined();
    expect(win.type).toBe('chat');
    expect(win.title).toMatch(/^(OpenCode|Xiaomi|OpenRouter|Anthropic|OpenAI|Google|Provider)/);
    expect(win.iconName).toBe('Zap');
    expect(win.state).toBe('normal');
    expect(win.modifierIds).toEqual([]);
    expect(win.position).toEqual(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }));
    expect(win.size).toEqual({ width: 480, height: 500 });
  });

  it('addWindow creates a plugin window with custom opts', () => {
    const id = useDesktopStore.getState().addWindow('plugin', {
      title: 'My Plugin',
      iconName: 'Terminal',
      pluginId: 'p1',
    });
    const win = getWindow(id)!;
    expect(win.type).toBe('plugin');
    expect(win.title).toBe('My Plugin');
    expect(win.iconName).toBe('Terminal');
    expect(win.pluginId).toBe('p1');
  });

  it('addWindow sets activeWindowId and increments nextZIndex', () => {
    const id = addChat();
    const state = useDesktopStore.getState();
    expect(state.activeWindowId).toBe(id);
    expect(state.nextZIndex).toBeGreaterThan(10);
  });

  it('removeWindow removes the window', () => {
    const id = addChat();
    useDesktopStore.getState().removeWindow(id);
    expect(getWindow(id)).toBeUndefined();
    expect(useDesktopStore.getState().windows).toHaveLength(0);
  });

  it('removeWindow clears activeWindowId when removed window was active', () => {
    const id = addChat();
    expect(useDesktopStore.getState().activeWindowId).toBe(id);
    useDesktopStore.getState().removeWindow(id);
    expect(useDesktopStore.getState().activeWindowId).toBeNull();
  });

  it('removeWindow preserves activeWindowId when a different window is removed', () => {
    const id1 = addChat();
    const id2 = addChat();
    expect(useDesktopStore.getState().activeWindowId).toBe(id2);
    useDesktopStore.getState().removeWindow(id1);
    expect(useDesktopStore.getState().activeWindowId).toBe(id2);
  });

  it('removeWindow also removes connections involving that window', () => {
    const id1 = addChat();
    const id2 = addChat();
    useDesktopStore.setState((s) => ({
      connections: [...s.connections, { id: 'c1', sourceWindowId: id1, sourcePort: 'right' as const, targetWindowId: id2, targetPort: 'left' as const }],
    }));
    expect(useDesktopStore.getState().connections).toHaveLength(1);
    useDesktopStore.getState().removeWindow(id1);
    expect(useDesktopStore.getState().connections).toHaveLength(0);
  });

  it('focusWindow updates activeWindowId and bumps zIndex', () => {
    const id1 = addChat();
    const id2 = addChat();
    const zBefore = getWindow(id1)!.zIndex;
    useDesktopStore.getState().focusWindow(id1);
    expect(useDesktopStore.getState().activeWindowId).toBe(id1);
    expect(getWindow(id1)!.zIndex).toBeGreaterThan(zBefore);
  });

  it('focusWindow restores a minimized window to normal', () => {
    const id = addChat();
    useDesktopStore.getState().setWindowState(id, 'minimized');
    expect(getWindow(id)!.state).toBe('minimized');
    useDesktopStore.getState().focusWindow(id);
    expect(getWindow(id)!.state).toBe('normal');
  });

  it('moveWindow updates position', () => {
    const id = addChat();
    useDesktopStore.getState().moveWindow(id, { x: 200, y: 300 });
    expect(getWindow(id)!.position).toEqual({ x: 200, y: 300 });
  });

  it('resizeWindow updates size', () => {
    const id = addChat();
    useDesktopStore.getState().resizeWindow(id, { width: 800, height: 600 });
    expect(getWindow(id)!.size).toEqual({ width: 800, height: 600 });
  });

  it('resizeWindow enforces minimum size', () => {
    const id = addChat();
    useDesktopStore.getState().resizeWindow(id, { width: 100, height: 50 });
    expect(getWindow(id)!.size).toEqual({ width: 320, height: 250 });
  });

  it('resizeWindow can also update position', () => {
    const id = addChat();
    useDesktopStore.getState().resizeWindow(id, { width: 500, height: 400 }, { x: 10, y: 20 });
    expect(getWindow(id)!.position).toEqual({ x: 10, y: 20 });
    expect(getWindow(id)!.size).toEqual({ width: 500, height: 400 });
  });

  it('setWindowState sets minimized / maximized / normal', () => {
    const id = addChat();
    useDesktopStore.getState().setWindowState(id, 'minimized');
    expect(getWindow(id)!.state).toBe('minimized');
    useDesktopStore.getState().setWindowState(id, 'maximized');
    expect(getWindow(id)!.state).toBe('maximized');
    useDesktopStore.getState().setWindowState(id, 'normal');
    expect(getWindow(id)!.state).toBe('normal');
  });

  it('updateWindowTitle changes the title', () => {
    const id = addChat();
    useDesktopStore.getState().updateWindowTitle(id, 'Renamed');
    expect(getWindow(id)!.title).toBe('Renamed');
  });
});

describe('Persisted dock migrations', () => {
  it('v3 migration restores backlog and mind draw dock actions when missing; v15 strips grid', () => {
    const migrate = useDesktopStore.persist.getOptions().migrate;
    expect(migrate).toBeDefined();

    const persisted = {
      dockItems: [
        { id: 'dock-new-chat', type: 'action', label: 'New Chat', iconName: 'MessageSquare', action: 'new-chat' },
        { id: 'dock-file-explorer', type: 'action', label: 'Files', iconName: 'FileText', action: 'file-explorer' },
        { id: 'dock-grid', type: 'action', label: 'Grid', iconName: 'LayoutGrid', action: 'grid' },
        { id: 'dock-marketplace', type: 'action', label: 'Marketplace', iconName: 'Store', action: 'marketplace' },
      ],
      grids: [],
    };

    const migrated = (migrate as (state: unknown, version: number) => any)(persisted, 3);
    const actions = migrated.dockItems.map((item: { action: string }) => item.action);

    // v3→v4 inserts backlog + mental-draw-toggle; v15 removes the grid action;
    // v16 inserts new-step + new-flow between mental-draw-toggle and marketplace.
    expect(actions).toEqual([
      'new-chat',
      'file-explorer',
      'backlog',
      'mental-draw-toggle',
      'new-step',
      'new-flow',
      'marketplace',
    ]);
    // v15 migration also clears the grids array
    expect(migrated.grids).toEqual([]);
  });

  it('v15 migration strips grid dock item and clears stale gridId from windows', () => {
    const migrate = useDesktopStore.persist.getOptions().migrate;
    expect(migrate).toBeDefined();

    const persisted = {
      dockItems: [
        { id: 'dock-new-chat', type: 'action', label: 'New Chat', iconName: 'MessageSquare', action: 'new-chat' },
        { id: 'dock-grid', type: 'action', label: 'Grid', iconName: 'LayoutGrid', action: 'grid' },
        { id: 'dock-marketplace', type: 'action', label: 'Marketplace', iconName: 'Store', action: 'marketplace' },
      ],
      grids: [{ id: 'grid-1', position: { x: 0, y: 0 }, size: { width: 640, height: 480 }, columns: 2, rows: 2, cells: ['win-1', null, null, null] }],
      windows: [
        { id: 'win-1', type: 'chat', title: 'Chat', gridId: 'grid-1', gridCellIndex: 0, gridColSpan: 1, gridRowSpan: 1, position: { x: 0, y: 0 }, size: { width: 300, height: 300 } },
        { id: 'win-2', type: 'chat', title: 'Chat 2', position: { x: 100, y: 100 }, size: { width: 300, height: 300 } },
      ],
    };

    const migrated = (migrate as (state: unknown, version: number) => any)(persisted, 14);
    const actions = migrated.dockItems.map((item: { action: string }) => item.action);

    expect(actions).not.toContain('grid');
    expect(migrated.grids).toEqual([]);
    // win-1 should have gridId/gridCellIndex stripped
    const win1 = migrated.windows.find((w: { id: string }) => w.id === 'win-1');
    expect(win1.gridId).toBeUndefined();
    expect(win1.gridCellIndex).toBeUndefined();
    expect(win1.gridColSpan).toBeUndefined();
    expect(win1.gridRowSpan).toBeUndefined();
    // win-2 is unchanged
    const win2 = migrated.windows.find((w: { id: string }) => w.id === 'win-2');
    expect(win2.position).toEqual({ x: 100, y: 100 });
  });
});

describe('Mind map migration cleanup', () => {
  it('v4 migration removes legacy mind-map action and plugin windows', () => {
    const migrate = useDesktopStore.persist.getOptions().migrate;
    expect(migrate).toBeDefined();

    const persisted = {
      dockItems: [
        { id: 'dock-new-chat', type: 'action', label: 'New Chat', iconName: 'MessageSquare', action: 'new-chat' },
        { id: 'dock-mind-map', type: 'action', label: 'Mind Map', iconName: 'Brain', action: 'mind-map' },
      ],
      installedPlugins: [
        { id: 'tool-mind-map', name: 'Mind Map', iconName: 'Brain', category: 'tools', installed: true, componentKey: 'mind-map' },
        { id: 'tool-terminal', name: 'Terminal Output', iconName: 'Terminal', category: 'tools', installed: true, componentKey: 'terminal-panel' },
      ],
      windows: [
        { id: 'mm', type: 'plugin', pluginId: 'tool-mind-map', title: 'Mind Map' },
        { id: 'terminal', type: 'plugin', pluginId: 'tool-terminal', title: 'Terminal Output' },
      ],
      grids: [],
    };

    const migrated = (migrate as (state: unknown, version: number) => any)(persisted, 4);
    const dockActions = migrated.dockItems.map((item: { action: string }) => item.action);
    expect(dockActions).toContain('mental-draw-toggle');
    expect(dockActions).not.toContain('mind-map');
    expect(migrated.installedPlugins.some((plugin: { id: string }) => plugin.id === 'tool-mind-map')).toBe(false);
    expect(migrated.windows.some((w: { pluginId?: string }) => w.pluginId === 'tool-mind-map')).toBe(false);
    expect(migrated.mentalMode).toBeUndefined();
    // v11+ removes legacy mentalConnections entirely (xyflow is the only source).
    expect(migrated.mentalConnections).toBeUndefined();
  });
});

// ─── Role Assignment ─────────────────────────────────────────────

describe('Role assignment', () => {
  it('assignRole returns true and sets roleId on first assignment', () => {
    const id = addChat();
    const result = useDesktopStore.getState().assignRole(id, 'role-ui');
    expect(result).toBe(true);
    expect(getWindow(id)!.roleId).toBe('role-ui');
  });

  it('assignRole returns false when window already has a role (exclusivity)', () => {
    const id = addChat();
    useDesktopStore.getState().assignRole(id, 'role-ui');
    const result = useDesktopStore.getState().assignRole(id, 'role-backend');
    expect(result).toBe(false);
    expect(getWindow(id)!.roleId).toBe('role-ui');
  });

  it('assignRole returns false for non-existent window', () => {
    const result = useDesktopStore.getState().assignRole('bogus', 'role-ui');
    expect(result).toBe(false);
  });

  it('removeRole clears the roleId', () => {
    const id = addChat();
    useDesktopStore.getState().assignRole(id, 'role-ui');
    useDesktopStore.getState().removeRole(id);
    expect(getWindow(id)!.roleId).toBeUndefined();
  });

  it('assignRole works again after removeRole', () => {
    const id = addChat();
    useDesktopStore.getState().assignRole(id, 'role-ui');
    useDesktopStore.getState().removeRole(id);
    const result = useDesktopStore.getState().assignRole(id, 'role-backend');
    expect(result).toBe(true);
    expect(getWindow(id)!.roleId).toBe('role-backend');
  });
});

// ─── Modifier System ─────────────────────────────────────────────

describe('Modifier system', () => {
  it('addModifier adds a modifier to the window', () => {
    const id = addChat();
    useDesktopStore.getState().addModifier(id, 'mod-verbose');
    expect(getWindow(id)!.modifierIds).toEqual(['mod-verbose']);
  });

  it('addModifier allows multiple modifiers', () => {
    const id = addChat();
    useDesktopStore.getState().addModifier(id, 'mod-verbose');
    useDesktopStore.getState().addModifier(id, 'mod-docs');
    expect(getWindow(id)!.modifierIds).toEqual(['mod-verbose', 'mod-docs']);
  });

  it('addModifier does not duplicate an already-present modifier', () => {
    const id = addChat();
    useDesktopStore.getState().addModifier(id, 'mod-verbose');
    useDesktopStore.getState().addModifier(id, 'mod-verbose');
    expect(getWindow(id)!.modifierIds).toEqual(['mod-verbose']);
  });

  it('removeModifier removes a specific modifier', () => {
    const id = addChat();
    useDesktopStore.getState().addModifier(id, 'mod-verbose');
    useDesktopStore.getState().addModifier(id, 'mod-docs');
    useDesktopStore.getState().removeModifier(id, 'mod-verbose');
    expect(getWindow(id)!.modifierIds).toEqual(['mod-docs']);
  });

  it('removeModifier is a no-op for missing modifier', () => {
    const id = addChat();
    useDesktopStore.getState().addModifier(id, 'mod-verbose');
    useDesktopStore.getState().removeModifier(id, 'mod-docs');
    expect(getWindow(id)!.modifierIds).toEqual(['mod-verbose']);
  });
});

// ─── Connections ─────────────────────────────────────────────────

describe('Connections', () => {
  it('removeConnection removes a connection by id', () => {
    const id1 = addChat();
    const id2 = addChat();
    useDesktopStore.setState((s) => ({
      connections: [...s.connections, { id: 'c1', sourceWindowId: id1, sourcePort: 'right' as const, targetWindowId: id2, targetPort: 'left' as const }],
    }));
    useDesktopStore.getState().removeConnection('c1');
    expect(useDesktopStore.getState().connections).toHaveLength(0);
  });
});

// ─── Plugins / Marketplace ───────────────────────────────────────

describe('Plugins / Marketplace', () => {
  it('starts with built-in installed plugins', () => {
    const { installedPlugins, availablePlugins } = useDesktopStore.getState();
    expect(installedPlugins.length).toBeGreaterThan(0);
    expect(availablePlugins.length).toBeGreaterThan(0);
  });

  it('showMarketplace toggles', () => {
    expect(useDesktopStore.getState().showMarketplace).toBe(false);
    useDesktopStore.getState().setShowMarketplace(true);
    expect(useDesktopStore.getState().showMarketplace).toBe(true);
    useDesktopStore.getState().setShowMarketplace(false);
    expect(useDesktopStore.getState().showMarketplace).toBe(false);
  });

  it('setMarketplaceFilter changes the filter', () => {
    expect(useDesktopStore.getState().marketplaceFilter).toBe('all');
    useDesktopStore.getState().setMarketplaceFilter('roles');
    expect(useDesktopStore.getState().marketplaceFilter).toBe('roles');
    useDesktopStore.getState().setMarketplaceFilter('tools');
    expect(useDesktopStore.getState().marketplaceFilter).toBe('tools');
  });

  it('loadInventoryPlugins surfaces steps as deployable marketplace plugins', () => {
    useDesktopStore.setState({
      marketInventory: {
        flows: [],
        roles: [],
        mods: [],
        steps: [
          { name: 'landing-page', icon: 'MdWebAsset', iconLibrary: 'react-icons/md', description: 'Landing page step', tags: ['landing'] },
        ],
      },
    });
    useDesktopStore.getState().loadInventoryPlugins();
    const stepPlugin = useDesktopStore.getState().availablePlugins.find(p => p.category === 'steps');
    expect(stepPlugin).toBeDefined();
    expect(stepPlugin!.id).toBe('inv-step-landing-page');
    expect(stepPlugin!.name).toBe('Landing Page');
  });
});

// ─── CLI Theming ─────────────────────────────────────────────────

describe('CLI theming', () => {
  it('defaults to opencode', () => {
    expect(useDesktopStore.getState().cliProvider).toBe('opencode');
  });

  it('setCliProvider changes the provider', () => {
    useDesktopStore.getState().setCliProvider('claude');
    expect(useDesktopStore.getState().cliProvider).toBe('claude');
    useDesktopStore.getState().setCliProvider('openai');
    expect(useDesktopStore.getState().cliProvider).toBe('openai');
  });
});

// ─── Snap Guides ─────────────────────────────────────────────────

describe('Snap guides', () => {
  it('calculateSnapGuides returns empty when no other windows exist', () => {
    const id = addChat();
    const { guides } = useDesktopStore.getState().calculateSnapGuides(id, { x: 100, y: 100 }, { width: 480, height: 500 });
    expect(guides).toEqual([]);
  });

  it('calculateSnapGuides produces guides when windows left-edges align within threshold', () => {
    const id1 = useDesktopStore.getState().addWindow('chat', { position: { x: 100, y: 100 }, size: { width: 480, height: 500 } });
    const id2 = useDesktopStore.getState().addWindow('chat', { position: { x: 500, y: 300 }, size: { width: 480, height: 500 } });
    // Move id2 so its left edge is within snap threshold of id1's left edge (100)
    const { guides, snappedPos } = useDesktopStore.getState().calculateSnapGuides(id2, { x: 103, y: 300 }, { width: 480, height: 500 });
    expect(guides.length).toBeGreaterThan(0);
    const xGuide = guides.find(g => g.axis === 'x');
    expect(xGuide).toBeDefined();
    expect(snappedPos.x).not.toBe(103); // snapped away from 103
  });

  it('calculateSnapGuides returns no guides when windows are far apart', () => {
    const id1 = useDesktopStore.getState().addWindow('chat', { position: { x: 100, y: 100 }, size: { width: 200, height: 200 } });
    const id2 = useDesktopStore.getState().addWindow('chat', { position: { x: 900, y: 900 }, size: { width: 200, height: 200 } });
    const { guides } = useDesktopStore.getState().calculateSnapGuides(id2, { x: 900, y: 900 }, { width: 200, height: 200 });
    expect(guides).toHaveLength(0);
  });

  it('calculateSnapGuides ignores minimized windows', () => {
    const id1 = useDesktopStore.getState().addWindow('chat', { position: { x: 100, y: 100 }, size: { width: 480, height: 500 } });
    const id2 = useDesktopStore.getState().addWindow('chat', { position: { x: 500, y: 300 }, size: { width: 480, height: 500 } });
    useDesktopStore.getState().setWindowState(id1, 'minimized');
    const { guides } = useDesktopStore.getState().calculateSnapGuides(id2, { x: 100, y: 300 }, { width: 480, height: 500 });
    expect(guides).toHaveLength(0);
  });

  it('setActiveSnapGuides sets and clears guides', () => {
    const guide: { axis: 'x'; position: number; type: 'edge' } = { axis: 'x', position: 100, type: 'edge' };
    useDesktopStore.getState().setActiveSnapGuides([guide]);
    expect(useDesktopStore.getState().activeSnapGuides).toEqual([guide]);
    useDesktopStore.getState().setActiveSnapGuides([]);
    expect(useDesktopStore.getState().activeSnapGuides).toEqual([]);
  });
});

// ─── Window State Management ─────────────────────────────────────

describe('Window state management', () => {
  it('nextZIndex starts at 10 and increments with each addWindow', () => {
    expect(useDesktopStore.getState().nextZIndex).toBe(10);
    addChat();
    // addWindow uses globalTopZ which gives z = max(nextZIndex, 0, ...) + 1.
    // With nextZIndex=10 and no other windows, z = 11, then nextZIndex = z+1 = 12.
    expect(useDesktopStore.getState().nextZIndex).toBe(12);
    addChat();
    // z = max(12, 11) + 1 = 13, nextZIndex = 14.
    expect(useDesktopStore.getState().nextZIndex).toBe(14);
  });

  it('focusWindow brings the window above its peers (and advances the counter)', () => {
    const id1 = addChat();
    const id2 = addChat();
    // Focus the older (currently-behind) window — it must rise above id2 even if
    // the counter had drifted below the persisted zIndexes.
    useDesktopStore.getState().focusWindow(id1);
    const wins = useDesktopStore.getState().windows;
    const w1 = wins.find(w => w.id === id1)!;
    const w2 = wins.find(w => w.id === id2)!;
    expect(w1.zIndex).toBeGreaterThan(w2.zIndex);
    expect(useDesktopStore.getState().nextZIndex).toBeGreaterThan(w1.zIndex);
  });

  it('activeWindowId is set to last added window', () => {
    const id1 = addChat();
    expect(useDesktopStore.getState().activeWindowId).toBe(id1);
    const id2 = addChat();
    expect(useDesktopStore.getState().activeWindowId).toBe(id2);
  });

  it('activeWindowId updates on focusWindow', () => {
    const id1 = addChat();
    const id2 = addChat();
    expect(useDesktopStore.getState().activeWindowId).toBe(id2);
    useDesktopStore.getState().focusWindow(id1);
    expect(useDesktopStore.getState().activeWindowId).toBe(id1);
  });

  it('each window gets a unique incrementing zIndex', () => {
    const id1 = addChat();
    const id2 = addChat();
    const id3 = addChat();
    const z1 = getWindow(id1)!.zIndex;
    const z2 = getWindow(id2)!.zIndex;
    const z3 = getWindow(id3)!.zIndex;
    expect(z1).toBeLessThan(z2);
    expect(z2).toBeLessThan(z3);
  });
});

// ─── Deploy Plugin ───────────────────────────────────────────────

describe('Deploy plugin', () => {
  it('deployPlugin creates a window for tool plugins', () => {
    const toolPlugin = useDesktopStore.getState().availablePlugins.find(p => p.category === 'tools')!;
    useDesktopStore.getState().deployPlugin(toolPlugin.id);
    const win = useDesktopStore.getState().windows.find(w => w.pluginId === toolPlugin.id);
    expect(win).toBeDefined();
    expect(win!.type).toBe('plugin');
    expect(win!.title).toBe(toolPlugin.name);
  });

  it('deployPlugin focuses existing window for tool plugins', () => {
    const toolPlugin = useDesktopStore.getState().availablePlugins.find(p => p.category === 'tools')!;
    useDesktopStore.getState().deployPlugin(toolPlugin.id);
    const winBefore = useDesktopStore.getState().windows.filter(w => w.pluginId === toolPlugin.id);
    expect(winBefore.length).toBe(1);
    useDesktopStore.getState().deployPlugin(toolPlugin.id);
    const winAfter = useDesktopStore.getState().windows.filter(w => w.pluginId === toolPlugin.id);
    expect(winAfter.length).toBe(1);
    expect(useDesktopStore.getState().activeWindowId).toBe(winBefore[0].id);
  });

  it('deployPlugin closes marketplace for role plugins', () => {
    useDesktopStore.getState().setShowMarketplace(true);
    useDesktopStore.setState((s) => ({
      availablePlugins: [
        ...s.availablePlugins,
        {
          id: 'inv-role-test-role',
          name: 'Test Role',
          description: 'Role test fixture',
          iconName: 'User',
          category: 'roles',
          author: 'test',
          installed: true,
        },
      ],
    }));
    const rolePlugin = useDesktopStore.getState().availablePlugins.find(p => p.category === 'roles')!;
    useDesktopStore.getState().deployPlugin(rolePlugin.id);
    expect(useDesktopStore.getState().showMarketplace).toBe(false);
  });

  it('deployPlugin does nothing for unknown plugin id', () => {
    const windowsBefore = useDesktopStore.getState().windows.length;
    useDesktopStore.getState().deployPlugin('nonexistent-id');
    expect(useDesktopStore.getState().windows.length).toBe(windowsBefore);
  });

  it('deployPlugin spawns a step attachable on the canvas (not a window) and closes the marketplace', () => {
    useDesktopStore.getState().setShowMarketplace(true);
    const windowsBefore = useDesktopStore.getState().windows.length;
    useDesktopStore.setState((s) => ({
      availablePlugins: [
        ...s.availablePlugins,
        {
          id: 'inv-step-landing-page',
          name: 'Landing Page',
          description: 'Step test fixture',
          iconName: 'MdWebAsset',
          category: 'steps',
          author: 'test',
          installed: true,
        },
      ],
    }));
    useDesktopStore.getState().deployPlugin('inv-step-landing-page');
    const { attachables, windows, showMarketplace } = useDesktopStore.getState();
    const stepAtt = attachables.find(a => a.type === 'step');
    expect(stepAtt).toBeDefined();
    expect(stepAtt!.name).toBe('landing-page');
    expect(windows.length).toBe(windowsBefore);
    expect(showMarketplace).toBe(false);
  });
});

// ─── Canvas Zoom ─────────────────────────────────────────────────

describe('Canvas zoom', () => {
  it('defaults to zoom 1', () => {
    expect(useDesktopStore.getState().canvasZoom).toBe(1);
  });

  it('setCanvasZoom changes zoom level', () => {
    useDesktopStore.getState().setCanvasZoom(1.5);
    expect(useDesktopStore.getState().canvasZoom).toBe(1.5);
  });

  it('setCanvasZoom clamps to min 0.25', () => {
    useDesktopStore.getState().setCanvasZoom(0.1);
    expect(useDesktopStore.getState().canvasZoom).toBe(0.25);
  });

  it('setCanvasZoom clamps to max 3', () => {
    useDesktopStore.getState().setCanvasZoom(5);
    expect(useDesktopStore.getState().canvasZoom).toBe(3);
  });
});

// ─── Notifications ───────────────────────────────────────────────

describe('Notifications', () => {
  it('starts with empty notifications', () => {
    expect(useDesktopStore.getState().notifications).toEqual([]);
    expect(useDesktopStore.getState().unreadCount).toBe(0);
  });

  it('addNotification adds a notification and increments unread', () => {
    useDesktopStore.getState().addNotification('Test message', 'session-1');
    expect(useDesktopStore.getState().notifications.length).toBe(1);
    expect(useDesktopStore.getState().unreadCount).toBe(1);
    expect(useDesktopStore.getState().notifications[0].message).toBe('Test message');
    expect(useDesktopStore.getState().notifications[0].sessionId).toBe('session-1');
    expect(useDesktopStore.getState().notifications[0].read).toBe(false);
  });

  it('markAllRead sets all to read and resets unread count', () => {
    useDesktopStore.getState().addNotification('Msg 1');
    useDesktopStore.getState().addNotification('Msg 2');
    expect(useDesktopStore.getState().unreadCount).toBe(2);
    useDesktopStore.getState().markAllRead();
    expect(useDesktopStore.getState().unreadCount).toBe(0);
    expect(useDesktopStore.getState().notifications.every(n => n.read)).toBe(true);
  });

  it('clearNotifications empties the list', () => {
    useDesktopStore.getState().addNotification('Msg');
    useDesktopStore.getState().clearNotifications();
    expect(useDesktopStore.getState().notifications).toEqual([]);
    expect(useDesktopStore.getState().unreadCount).toBe(0);
  });

  it('showNotifications toggles', () => {
    expect(useDesktopStore.getState().showNotifications).toBe(false);
    useDesktopStore.getState().setShowNotifications(true);
    expect(useDesktopStore.getState().showNotifications).toBe(true);
  });
});

// ─── File-Explorer Windows ──────────────────────────────────────

describe('File-Explorer Windows', () => {
  it('creates a file-explorer window with defaults', () => {
    const id = useDesktopStore.getState().addWindow('file-explorer');
    const win = getWindow(id)!;
    expect(win).toBeDefined();
    expect(win.type).toBe('file-explorer');
    expect(win.title).toBe('Files');
    expect(win.iconName).toBe('FileText');
    expect(win.state).toBe('normal');
  });

  it('creates a file-explorer window with custom title', () => {
    const id = useDesktopStore.getState().addWindow('file-explorer', {
      title: 'MyProject',
      iconName: 'Package',
    });
    const win = getWindow(id)!;
    expect(win.title).toBe('MyProject');
    expect(win.iconName).toBe('Package');
  });

  it('file-explorer windows can be focused and tracked', () => {
    const chatId = addChat();
    const fileId = useDesktopStore.getState().addWindow('file-explorer');

    useDesktopStore.getState().focusWindow(chatId);
    expect(useDesktopStore.getState().activeWindowId).toBe(chatId);

    useDesktopStore.getState().focusWindow(fileId);
    expect(useDesktopStore.getState().activeWindowId).toBe(fileId);
  });

  it('file-explorer windows can be removed', () => {
    const id = useDesktopStore.getState().addWindow('file-explorer');
    expect(useDesktopStore.getState().windows.length).toBe(1);
    useDesktopStore.getState().removeWindow(id);
    expect(useDesktopStore.getState().windows.length).toBe(0);
  });

  it('file-explorer windows have no sessionId or pluginId', () => {
    const id = useDesktopStore.getState().addWindow('file-explorer');
    const win = getWindow(id)!;
    expect(win.sessionId).toBeUndefined();
    expect(win.pluginId).toBeUndefined();
  });

  it('file-explorer and chat windows coexist', () => {
    addChat({ title: 'Chat 1' });
    useDesktopStore.getState().addWindow('file-explorer', { title: 'Files' });
    addChat({ title: 'Chat 2' });
    useDesktopStore.getState().addWindow('file-explorer', { title: 'Files 2' });

    const { windows } = useDesktopStore.getState();
    expect(windows.length).toBe(4);
    expect(windows.filter(w => w.type === 'chat').length).toBe(2);
    expect(windows.filter(w => w.type === 'file-explorer').length).toBe(2);
  });

  it('setCanvasPan updates pan position for navigator', () => {
    useDesktopStore.getState().setCanvasPan({ x: 100, y: -200 });
    expect(useDesktopStore.getState().canvasPan).toEqual({ x: 100, y: -200 });
  });
});

// ─── Navigator Highlight ────────────────────────────────────────

describe('Navigator Highlight', () => {
  it('starts with null hoveredWindowId', () => {
    expect(useDesktopStore.getState().hoveredWindowId).toBeNull();
  });

  it('setHoveredWindowId updates the hovered window', () => {
    const id = addChat();
    useDesktopStore.getState().setHoveredWindowId(id);
    expect(useDesktopStore.getState().hoveredWindowId).toBe(id);
  });

  it('setHoveredWindowId can be cleared to null', () => {
    const id = addChat();
    useDesktopStore.getState().setHoveredWindowId(id);
    useDesktopStore.getState().setHoveredWindowId(null);
    expect(useDesktopStore.getState().hoveredWindowId).toBeNull();
  });

  it('hoveredWindowId is independent of activeWindowId', () => {
    const id1 = addChat({ title: 'A' });
    const id2 = addChat({ title: 'B' });
    useDesktopStore.getState().focusWindow(id1);
    useDesktopStore.getState().setHoveredWindowId(id2);
    expect(useDesktopStore.getState().activeWindowId).toBe(id1);
    expect(useDesktopStore.getState().hoveredWindowId).toBe(id2);
  });
});

// ─── removeAttachedItem ──────────────────────────────────────────

describe('removeAttachedItem', () => {
  it('removes a role from a window without respawning', () => {
    const id = addChat();
    useDesktopStore.getState().assignRole(id, 'frontend-engineer');
    expect(getWindow(id)!.roleId).toBe('frontend-engineer');

    useDesktopStore.getState().removeAttachedItem(id, 'role', 'frontend-engineer');
    expect(getWindow(id)!.roleId).toBeUndefined();
    // No attachable should be spawned
    expect(useDesktopStore.getState().attachables).toHaveLength(0);
  });

  it('removes a mod from a window without respawning', () => {
    const id = addChat();
    useDesktopStore.getState().addModifier(id, 'strict-mode');
    expect(getWindow(id)!.modifierIds).toContain('strict-mode');

    useDesktopStore.getState().removeAttachedItem(id, 'mod', 'strict-mode');
    expect(getWindow(id)!.modifierIds).not.toContain('strict-mode');
    expect(useDesktopStore.getState().attachables).toHaveLength(0);
  });

  it('removes a flow from a window without respawning', () => {
    const id = addChat();
    useDesktopStore.getState().connectFlow(id, 'lighthouse-audit');
    expect(getWindow(id)!.flowId).toBe('lighthouse-audit');

    useDesktopStore.getState().removeAttachedItem(id, 'flow', 'lighthouse-audit');
    expect(getWindow(id)!.flowId).toBeUndefined();
    expect(useDesktopStore.getState().attachables).toHaveLength(0);
  });

  it('is a no-op for non-existent window', () => {
    // Should not throw
    useDesktopStore.getState().removeAttachedItem('nonexistent', 'role', 'test');
    expect(useDesktopStore.getState().windows).toHaveLength(0);
  });

  it('differs from detachFromWindow which respawns attachable', () => {
    const id = addChat();
    useDesktopStore.getState().assignRole(id, 'frontend-engineer');

    // detachFromWindow should respawn
    useDesktopStore.getState().detachFromWindow(id, 'role', 'frontend-engineer');
    expect(getWindow(id)!.roleId).toBeUndefined();
    expect(useDesktopStore.getState().attachables).toHaveLength(1);
    expect(useDesktopStore.getState().attachables[0].name).toBe('frontend-engineer');
  });

});

describe('Mental authoring mode', () => {
  it('defaults to off mental mode', () => {
    expect(useDesktopStore.getState().mentalMode).toBe('off');
  });

  it('setMentalMode toggles authoring shape', () => {
    const store = useDesktopStore.getState();
    store.setMentalMode('square');
    expect(useDesktopStore.getState().mentalMode).toBe('square');
    store.setMentalMode('off');
    expect(useDesktopStore.getState().mentalMode).toBe('off');
  });
});

// ─── Mental Graph (React Flow directed edges) ────────────────────

describe('Mental Graph nodes and directed edges', () => {
  it('defaults to select mental tool', () => {
    expect(useDesktopStore.getState().mentalTool).toBe('select');
  });

  it('addModToStep replaces the step data object and mods array immutably', () => {
    const store = useDesktopStore.getState();
    const stepId = store.addStepNode({
      position: { x: 100, y: 120 },
      title: 'Plan step',
    });

    const beforeNode = useDesktopStore.getState().mentalNodes.find((n: any) => n.id === stepId) as any;
    const beforeData = beforeNode.data;
    const beforeMods = beforeNode.data.mods;

    const mod = {
      name: 'strict-linting',
      icon: 'MdRule',
      iconLibrary: 'md',
      description: 'Fail fast on lint drift',
      tags: ['quality'],
    };

    store.addModToStep(stepId, mod);

    const afterNode = useDesktopStore.getState().mentalNodes.find((n: any) => n.id === stepId) as any;
    expect(afterNode).not.toBe(beforeNode);
    expect(afterNode.data).not.toBe(beforeData);
    expect(afterNode.data.mods).not.toBe(beforeMods);
    expect(afterNode.data.mods).toEqual([mod]);

    const dataWithMod = afterNode.data;
    const modsWithMod = afterNode.data.mods;

    store.removeModFromStep(stepId, mod.name);

    const afterRemoveNode = useDesktopStore.getState().mentalNodes.find((n: any) => n.id === stepId) as any;
    expect(afterRemoveNode).not.toBe(afterNode);
    expect(afterRemoveNode.data).not.toBe(dataWithMod);
    expect(afterRemoveNode.data.mods).not.toBe(modsWithMod);
    expect(afterRemoveNode.data.mods).toEqual([]);
  });

  it('addRoleToStep and removeRoleFromStep update step roles immutably', () => {
    const store = useDesktopStore.getState();
    const stepId = store.addStepNode({
      position: { x: 100, y: 120 },
      title: 'Role step',
    });

    const beforeNode = useDesktopStore.getState().mentalNodes.find((n: any) => n.id === stepId) as any;
    const beforeData = beforeNode.data;
    const beforeRoles = beforeNode.data.roles;

    const role = {
      name: 'frontend-engineer',
      icon: 'MdCode',
      iconLibrary: 'md',
      description: 'Builds frontend systems',
      tags: ['frontend'],
      color: '#E87040',
    };

    store.addRoleToStep(stepId, role);

    const afterNode = useDesktopStore.getState().mentalNodes.find((n: any) => n.id === stepId) as any;
    expect(afterNode).not.toBe(beforeNode);
    expect(afterNode.data).not.toBe(beforeData);
    expect(afterNode.data.roles).not.toBe(beforeRoles);
    expect(afterNode.data.roles).toEqual([role]);

    const dataWithRole = afterNode.data;
    const rolesWithRole = afterNode.data.roles;

    store.removeRoleFromStep(stepId, role.name);

    const afterRemoveNode = useDesktopStore.getState().mentalNodes.find((n: any) => n.id === stepId) as any;
    expect(afterRemoveNode).not.toBe(afterNode);
    expect(afterRemoveNode.data).not.toBe(dataWithRole);
    expect(afterRemoveNode.data.roles).not.toBe(rolesWithRole);
    expect(afterRemoveNode.data.roles).toEqual([]);
  });

  it('addRoleToStep replaces an existing role — one role per step (mutually exclusive)', () => {
    const store = useDesktopStore.getState();
    const stepId = store.addStepNode({
      position: { x: 100, y: 120 },
      title: 'Exclusive role step',
    });

    const roleA = {
      name: 'frontend-engineer', icon: 'MdCode', iconLibrary: 'md',
      description: 'Builds frontend systems', tags: ['frontend'], color: '#E87040',
    };
    const roleB = {
      name: 'backend-engineer', icon: 'MdStorage', iconLibrary: 'md',
      description: 'Builds backend systems', tags: ['backend'], color: '#4285F4',
    };

    expect(store.addRoleToStep(stepId, roleA)).toBe(true);
    expect(
      (useDesktopStore.getState().mentalNodes.find((n: any) => n.id === stepId) as any).data.roles,
    ).toEqual([roleA]);

    // Attaching a different role replaces roleA — never coexists with it.
    expect(store.addRoleToStep(stepId, roleB)).toBe(true);
    const afterReplace = useDesktopStore.getState().mentalNodes.find((n: any) => n.id === stepId) as any;
    expect(afterReplace.data.roles).toEqual([roleB]);

    // Re-attaching the exact same already-sole role is a no-op.
    expect(store.addRoleToStep(stepId, roleB)).toBe(false);
    expect(
      (useDesktopStore.getState().mentalNodes.find((n: any) => n.id === stepId) as any).data.roles,
    ).toEqual([roleB]);
  });

  it('addModToStep rejects a mod that is incompatible with one already on the step', () => {
    const store = useDesktopStore.getState();
    const stepId = store.addStepNode({
      position: { x: 100, y: 120 },
      title: 'Compatibility step',
    });

    const designSystemA = {
      name: 'design-system-a', icon: 'MdPalette', iconLibrary: 'md',
      description: 'Design system A', tags: ['design'], incompatibleWith: ['design-system-b'],
    };
    const designSystemB = {
      name: 'design-system-b', icon: 'MdPalette', iconLibrary: 'md',
      description: 'Design system B', tags: ['design'], incompatibleWith: ['design-system-a'],
    };
    const strictLinting = {
      name: 'strict-linting', icon: 'MdRule', iconLibrary: 'md',
      description: 'Fail fast on lint drift', tags: ['quality'],
    };

    expect(store.addModToStep(stepId, designSystemA)).toBe(true);

    // Incompatible mod is rejected — no mutation happens.
    const beforeRejection = useDesktopStore.getState().mentalNodes.find((n: any) => n.id === stepId) as any;
    expect(store.addModToStep(stepId, designSystemB)).toBe(false);
    const afterRejection = useDesktopStore.getState().mentalNodes.find((n: any) => n.id === stepId) as any;
    expect(afterRejection).toBe(beforeRejection);
    expect(afterRejection.data.mods).toEqual([designSystemA]);

    // A compatible mod still attaches fine.
    expect(store.addModToStep(stepId, strictLinting)).toBe(true);
    const afterCompatible = useDesktopStore.getState().mentalNodes.find((n: any) => n.id === stepId) as any;
    expect(afterCompatible.data.mods).toEqual([designSystemA, strictLinting]);
  });

  it('updateStepData patches step fields immutably and persists the instructions prompt', () => {
    const store = useDesktopStore.getState();
    const stepId = store.addStepNode({
      position: { x: 100, y: 120 },
      title: 'Instructions step',
    });

    const beforeNode = useDesktopStore.getState().mentalNodes.find((n: any) => n.id === stepId) as any;
    const beforeData = beforeNode.data;

    store.updateStepData(stepId, { prompt: 'Summarize the repo README in three bullet points.' });

    const afterNode = useDesktopStore.getState().mentalNodes.find((n: any) => n.id === stepId) as any;
    expect(afterNode).not.toBe(beforeNode);
    expect(afterNode.data).not.toBe(beforeData);
    expect(afterNode.data.prompt).toBe('Summarize the repo README in three bullet points.');
    // Unrelated fields survive the patch untouched.
    expect(afterNode.data.title).toBe('Instructions step');

    // "Reopening" (re-reading store state fresh) still sees the persisted edit.
    expect(
      (useDesktopStore.getState().mentalNodes.find((n: any) => n.id === stepId) as any).data.prompt,
    ).toBe('Summarize the repo README in three bullet points.');
  });

  it('updateStepData is a no-op for a stepId that does not exist', () => {
    const store = useDesktopStore.getState();
    const stepId = store.addStepNode({ position: { x: 0, y: 0 }, title: 'Untouched step' });
    const beforeNode = useDesktopStore.getState().mentalNodes.find((n: any) => n.id === stepId);

    store.updateStepData('no-such-step', { prompt: 'unreachable' });

    const afterNodes = useDesktopStore.getState().mentalNodes;
    expect(afterNodes).toHaveLength(1);
    // The real node's reference is untouched — the map left it alone rather
    // than materializing a patch for an id that doesn't exist.
    expect(afterNodes.find((n: any) => n.id === stepId)).toBe(beforeNode);
  });

  it('addMentalNode creates a graph node with defaults', () => {
    const store = useDesktopStore.getState();
    const id = store.addMentalNode({
      position: { x: 100, y: 200 },
      width: 220,
      height: 120,
      text: 'Root idea',
      color: '#EDE9FE',
      shape: 'square',
    });
    const node = useDesktopStore.getState().mentalNodes.find((n) => n.id === id);
    expect(node).toBeDefined();
    expect(node!.text).toBe('Root idea');
    expect(node!.position).toEqual({ x: 100, y: 200 });
    expect(node!.createdAt).toBeGreaterThan(0);
  });

  it('updateMentalNode patches node fields', () => {
    const store = useDesktopStore.getState();
    const id = store.addMentalNode({
      position: { x: 0, y: 0 },
      width: 220,
      height: 120,
      text: '',
      color: '#EDE9FE',
      shape: 'square',
    });
    store.updateMentalNode(id, { text: 'Updated', color: '#FBCFE8' });
    const node = useDesktopStore.getState().mentalNodes.find((n) => n.id === id);
    expect(node!.text).toBe('Updated');
    expect(node!.color).toBe('#FBCFE8');
  });

  it('addMentalEdge creates directed edge and rejects self-edge', () => {
    const store = useDesktopStore.getState();
    const a = store.addMentalNode({ position: { x: 0, y: 0 }, width: 220, height: 120, text: '', color: '#EDE9FE', shape: 'square' });
    const b = store.addMentalNode({ position: { x: 300, y: 0 }, width: 220, height: 120, text: '', color: '#EDE9FE', shape: 'square' });

    const edgeId = store.addMentalEdge(a, b, 'link');
    expect(edgeId).toBeTruthy();
    expect(useDesktopStore.getState().mentalEdges).toHaveLength(1);

    // Self-edge rejected
    const selfEdge = store.addMentalEdge(a, a);
    expect(selfEdge).toBeNull();
  });

  it('rejects duplicate directed edge (same source→target)', () => {
    const store = useDesktopStore.getState();
    const a = store.addMentalNode({ position: { x: 0, y: 0 }, width: 220, height: 120, text: '', color: '#EDE9FE', shape: 'square' });
    const b = store.addMentalNode({ position: { x: 300, y: 0 }, width: 220, height: 120, text: '', color: '#EDE9FE', shape: 'square' });

    store.addMentalEdge(a, b);
    const dup = store.addMentalEdge(a, b);
    expect(dup).toBeNull();
    expect(useDesktopStore.getState().mentalEdges).toHaveLength(1);
  });

  it('allows reverse directed edge (b→a when a→b exists)', () => {
    const store = useDesktopStore.getState();
    const a = store.addMentalNode({ position: { x: 0, y: 0 }, width: 220, height: 120, text: '', color: '#EDE9FE', shape: 'square' });
    const b = store.addMentalNode({ position: { x: 300, y: 0 }, width: 220, height: 120, text: '', color: '#EDE9FE', shape: 'square' });

    store.addMentalEdge(a, b);
    const reverse = store.addMentalEdge(b, a);
    expect(reverse).toBeTruthy();
    expect(useDesktopStore.getState().mentalEdges).toHaveLength(2);
  });

  it('removeMentalNode cascade-deletes touching edges', () => {
    const store = useDesktopStore.getState();
    const a = store.addMentalNode({ position: { x: 0, y: 0 }, width: 220, height: 120, text: '', color: '#EDE9FE', shape: 'square' });
    const b = store.addMentalNode({ position: { x: 300, y: 0 }, width: 220, height: 120, text: '', color: '#EDE9FE', shape: 'square' });
    const c = store.addMentalNode({ position: { x: 150, y: 200 }, width: 220, height: 120, text: '', color: '#EDE9FE', shape: 'square' });

    store.addMentalEdge(a, b);
    store.addMentalEdge(b, c);
    store.addMentalEdge(a, c);
    expect(useDesktopStore.getState().mentalEdges).toHaveLength(3);

    store.removeMentalNode(b);
    // Only a→c should remain (a→b and b→c removed)
    const remaining = useDesktopStore.getState().mentalEdges;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].sourceId).toBe(a);
    expect(remaining[0].targetId).toBe(c);
  });

  it('createRamificationFromDrop creates child node + directed edge', () => {
    const store = useDesktopStore.getState();
    const source = store.addMentalNode({
      position: { x: 100, y: 100 },
      width: 220,
      height: 120,
      text: 'Parent',
      color: '#FBCFE8',
      shape: 'square',
    });

    const result = store.createRamificationFromDrop(source, { x: 300, y: 300 });
    expect(result).not.toBeNull();

    const state = useDesktopStore.getState();
    expect(state.mentalNodes).toHaveLength(2);
    expect(state.mentalEdges).toHaveLength(1);

    const child = state.mentalNodes.find((n) => n.id === result!.nodeId);
    expect(child).toBeDefined();
    expect(child!.position).toEqual({ x: 300, y: 300 });
    expect(child!.color).toBe('#FBCFE8'); // inherits parent color

    const edge = state.mentalEdges[0];
    expect(edge.sourceId).toBe(source);
    expect(edge.targetId).toBe(result!.nodeId);
    expect(edge.type).toBe('ramification');

    // Auto-focus set to child
    expect(state.mentalEditingNodeId).toBe(result!.nodeId);
  });

  it('createRamificationFromDrop returns null for non-existent source', () => {
    const store = useDesktopStore.getState();
    const result = store.createRamificationFromDrop('nonexistent', { x: 0, y: 0 });
    expect(result).toBeNull();
  });

  it('removeMentalNode clears mentalEditingNodeId when editing node is removed', () => {
    const store = useDesktopStore.getState();
    const id = store.addMentalNode({ position: { x: 0, y: 0 }, width: 220, height: 120, text: '', color: '#EDE9FE', shape: 'square' });
    store.setMentalEditingNodeId(id);
    expect(useDesktopStore.getState().mentalEditingNodeId).toBe(id);
    store.removeMentalNode(id);
    expect(useDesktopStore.getState().mentalEditingNodeId).toBeNull();
  });

  it('insertPipelineAssembly creates a frame with relative step children and dependency edges', () => {
    const assembly: PipelineAssembly = {
      frameTitle: 'Jira Delivery Pipeline',
      description: 'Ticket to tests to implementation.',
      missingCapabilitiesRequested: ['Jira integration'],
      steps: [
        { id: 'read-ticket', prompt: 'Extract acceptance criteria from the Jira ticket.', roleId: 'confident-executor', modIds: [], prevStepIds: [] },
        { id: 'write-tests', prompt: 'Write unit tests that encode the acceptance criteria.', roleId: 'confident-executor', modIds: ['anti-verification-interceptor'], prevStepIds: ['read-ticket'] },
        { id: 'implement-function', prompt: 'Implement the minimal function that satisfies the tests.', roleId: 'confident-executor', modIds: ['anti-verification-interceptor'], prevStepIds: ['write-tests'] },
      ],
    };

    const result = useDesktopStore.getState().insertPipelineAssembly({
      assembly,
      position: { x: 400, y: 120 },
      frameWidth: 1120,
      frameHeight: 420,
    });
    const state = useDesktopStore.getState();
    const frame = state.mentalNodes.find((node) => node.id === result.frameId);
    const steps = state.mentalNodes.filter((node) => result.stepIds.includes(node.id));

    expect(frame).toMatchObject({
      type: 'frame',
      position: { x: 400, y: 120 },
      width: 1120,
      height: 420,
      data: {
        title: 'Jira Delivery Pipeline',
        childIds: result.stepIds,
        missingCapabilitiesRequested: ['Jira integration'],
      },
    });
    expect(steps).toHaveLength(3);
    expect(steps.every((node) => 'parentId' in node && node.parentId === result.frameId)).toBe(true);
    expect(state.mentalEdges).toHaveLength(2);
    expect(state.mentalEdges[0]).toMatchObject({
      sourceId: result.stepIds[0],
      targetId: result.stepIds[1],
      sourceHandle: 'right',
      targetHandle: 'left',
    });
    expect(state.selectedMentalNodeIds).toEqual([result.frameId]);
  });

  it('removeMentalNode cascade-deletes frame children and their edges', () => {
    const result = useDesktopStore.getState().insertPipelineAssembly({
      assembly: {
        frameTitle: 'Pipeline',
        description: 'Two step pipeline.',
        missingCapabilitiesRequested: [],
        steps: [
          { id: 'a', prompt: 'Do A with explicit context.', roleId: 'confident-executor', modIds: [], prevStepIds: [] },
          { id: 'b', prompt: 'Use A to do B with explicit output.', roleId: 'confident-executor', modIds: [], prevStepIds: ['a'] },
        ],
      },
      position: { x: 400, y: 120 },
      frameWidth: 900,
      frameHeight: 420,
    });

    useDesktopStore.getState().removeMentalNode(result.frameId);

    const state = useDesktopStore.getState();
    expect(state.mentalNodes.some((node) => node.id === result.frameId)).toBe(false);
    expect(state.mentalNodes.some((node) => result.stepIds.includes(node.id))).toBe(false);
    expect(state.mentalEdges).toEqual([]);
    expect(state.selectedMentalNodeIds).toEqual([]);
  });

  it('updateMentalEdgeColor changes edge color', () => {
    const store = useDesktopStore.getState();
    const a = store.addMentalNode({ position: { x: 0, y: 0 }, width: 220, height: 120, text: '', color: '#EDE9FE', shape: 'square' });
    const b = store.addMentalNode({ position: { x: 300, y: 0 }, width: 220, height: 120, text: '', color: '#EDE9FE', shape: 'square' });
    const edgeId = store.addMentalEdge(a, b)!;
    store.updateMentalEdgeColor(edgeId, '#FF0000');
    const edge = useDesktopStore.getState().mentalEdges.find((e) => e.id === edgeId);
    expect(edge!.color).toBe('#FF0000');
  });
});

// ─── Mental Map: rectangle-draw creates React Flow node ───────────

describe('Mental map rectangle-draw creates React Flow nodes', () => {
  it('addMentalNode creates a node visible in mentalNodes (not attachables)', () => {
    const store = useDesktopStore.getState();
    const nodeId = store.addMentalNode({
      position: { x: 50, y: 100 },
      width: 200,
      height: 140,
      text: '',
      color: '#EDE9FE',
      shape: 'square',
    });

    const state = useDesktopStore.getState();
    // Node must be in mentalNodes
    expect(state.mentalNodes.find(n => n.id === nodeId)).toBeDefined();
    // Node must NOT be in attachables
    expect(state.attachables.find(a => a.id === nodeId)).toBeUndefined();
  });

  it('addMentalNode with explicit dimensions stores correct size', () => {
    const store = useDesktopStore.getState();
    const nodeId = store.addMentalNode({
      position: { x: 10, y: 20 },
      width: 300,
      height: 180,
      text: '',
      color: '#EDE9FE',
      shape: 'square',
    });

    const node = useDesktopStore.getState().mentalNodes.find(n => n.id === nodeId);
    expect(node!.width).toBe(300);
    expect(node!.height).toBe(180);
    expect(node!.position).toEqual({ x: 10, y: 20 });
  });

  it('setMentalEditingNodeId activates editing after node creation', () => {
    const store = useDesktopStore.getState();
    const nodeId = store.addMentalNode({
      position: { x: 0, y: 0 },
      width: 220,
      height: 120,
      text: '',
      color: '#EDE9FE',
      shape: 'square',
    });
    store.setMentalEditingNodeId(nodeId);
    expect(useDesktopStore.getState().mentalEditingNodeId).toBe(nodeId);
  });
});

// ─── Mental Map: mode switching (Shapes / Lines) ──────────────────

describe('Mental map mode switching (Square / Circle / Triangle)', () => {
  it('defaults to off mode', () => {
    expect(useDesktopStore.getState().mentalMode).toBe('off');
  });

  it('setMentalMode switches to circle', () => {
    useDesktopStore.getState().setMentalMode('circle');
    expect(useDesktopStore.getState().mentalMode).toBe('circle');
  });

  it('setMentalMode switches back to square', () => {
    useDesktopStore.getState().setMentalMode('circle');
    useDesktopStore.getState().setMentalMode('square');
    expect(useDesktopStore.getState().mentalMode).toBe('square');
  });

  it('mentalNodes persist across mode switches', () => {
    const store = useDesktopStore.getState();
    const nodeId = store.addMentalNode({
      position: { x: 100, y: 200 },
      width: 220,
      height: 120,
      text: 'Survives mode switch',
      color: '#EDE9FE',
      shape: 'square',
    });

    store.setMentalMode('circle');
    store.setMentalMode('triangle');

    const node = useDesktopStore.getState().mentalNodes.find(n => n.id === nodeId);
    expect(node).toBeDefined();
    expect(node!.text).toBe('Survives mode switch');
  });

  it('mentalEdges persist across mode switches', () => {
    const store = useDesktopStore.getState();
    const a = store.addMentalNode({ position: { x: 0, y: 0 }, width: 220, height: 120, text: '', color: '#EDE9FE', shape: 'square' });
    const b = store.addMentalNode({ position: { x: 300, y: 0 }, width: 220, height: 120, text: '', color: '#EDE9FE', shape: 'square' });
    store.addMentalEdge(a, b, 'link');

    store.setMentalMode('circle');
    store.setMentalMode('square');

    expect(useDesktopStore.getState().mentalEdges).toHaveLength(1);
  });

  it('mentalTool is independent of mentalMode', () => {
    const store = useDesktopStore.getState();
    store.setMentalTool('ramification');
    store.setMentalMode('circle');
    expect(useDesktopStore.getState().mentalTool).toBe('ramification');
    store.setMentalMode('square');
    expect(useDesktopStore.getState().mentalTool).toBe('ramification');
  });
});

// ─── Mental → Chat attachments (matrix per window) ──────────────────

describe('Mental → Chat attachments', () => {
  it('defaults to empty selection and no attachments', () => {
    const state = useDesktopStore.getState();
    expect(state.selectedMentalNodeIds).toEqual([]);
    const winId = addChat();
    expect(getWindow(winId)?.mentalAttachments).toBeUndefined();
  });

  it('setSelectedMentalNodeIds tracks the xyflow selection', () => {
    useDesktopStore.getState().setSelectedMentalNodeIds(['n1', 'n2']);
    expect(useDesktopStore.getState().selectedMentalNodeIds).toEqual(['n1', 'n2']);
  });

  it('setSelectedMentalNodeIds skips no-op writes (referential stability)', () => {
    const setter = useDesktopStore.getState().setSelectedMentalNodeIds;
    setter(['n1', 'n2']);
    const firstRef = useDesktopStore.getState().selectedMentalNodeIds;
    setter(['n1', 'n2']);
    const secondRef = useDesktopStore.getState().selectedMentalNodeIds;
    expect(secondRef).toBe(firstRef);
  });

  it('attachMentalToWindow stores a subgraph as a matrix entry', () => {
    const winId = addChat();
    useDesktopStore.getState().attachMentalToWindow(winId, ['n1', 'n2', 'n3']);
    const w = getWindow(winId)!;
    expect(w.mentalAttachments).toHaveLength(1);
    expect(w.mentalAttachments![0].nodeIds).toEqual(['n1', 'n2', 'n3']);
    expect(w.mentalAttachments![0].attachedAt).toBeGreaterThan(0);
  });

  it('attachMentalToWindow accepts multiple distinct attachments', () => {
    const winId = addChat();
    const store = useDesktopStore.getState();
    store.attachMentalToWindow(winId, ['n1', 'n2']);
    store.attachMentalToWindow(winId, ['n3']);
    store.attachMentalToWindow(winId, []); // whole map
    expect(getWindow(winId)!.mentalAttachments).toHaveLength(3);
  });

  it('attachMentalToWindow dedupes attachments with identical membership', () => {
    const winId = addChat();
    const store = useDesktopStore.getState();
    store.attachMentalToWindow(winId, ['n1', 'n2']);
    store.attachMentalToWindow(winId, ['n2', 'n1']); // same set, different order
    expect(getWindow(winId)!.mentalAttachments).toHaveLength(1);
  });

  it('detachMentalAttachment removes only the targeted index', () => {
    const winId = addChat();
    const store = useDesktopStore.getState();
    store.attachMentalToWindow(winId, ['a']);
    store.attachMentalToWindow(winId, ['b']);
    store.attachMentalToWindow(winId, ['c']);
    useDesktopStore.getState().detachMentalAttachment(winId, 1);
    const remaining = getWindow(winId)!.mentalAttachments!.map(a => a.nodeIds[0]);
    expect(remaining).toEqual(['a', 'c']);
  });

  it('detachMentalAttachment is a no-op for out-of-range indices', () => {
    const winId = addChat();
    const store = useDesktopStore.getState();
    store.attachMentalToWindow(winId, ['a']);
    useDesktopStore.getState().detachMentalAttachment(winId, 99);
    useDesktopStore.getState().detachMentalAttachment(winId, -1);
    expect(getWindow(winId)!.mentalAttachments).toHaveLength(1);
  });

  it('clearMentalAttachments wipes all attachments on a window', () => {
    const winId = addChat();
    const store = useDesktopStore.getState();
    store.attachMentalToWindow(winId, ['a']);
    store.attachMentalToWindow(winId, ['b']);
    useDesktopStore.getState().clearMentalAttachments(winId);
    expect(getWindow(winId)!.mentalAttachments).toEqual([]);
  });

  it('attachments survive when other windows mutate', () => {
    const chatA = addChat();
    const chatB = addChat();
    const store = useDesktopStore.getState();
    store.attachMentalToWindow(chatA, ['a1', 'a2']);
    store.attachMentalToWindow(chatB, ['b1']);
    useDesktopStore.getState().clearMentalAttachments(chatB);
    expect(getWindow(chatA)!.mentalAttachments).toHaveLength(1);
    expect(getWindow(chatB)!.mentalAttachments).toEqual([]);
  });

  it('attaching with an empty nodeIds array represents the whole-map sentinel', () => {
    const winId = addChat();
    useDesktopStore.getState().attachMentalToWindow(winId, []);
    expect(getWindow(winId)!.mentalAttachments).toHaveLength(1);
    expect(getWindow(winId)!.mentalAttachments![0].nodeIds).toEqual([]);
  });
});

// ─── HUD Widgets slice ────────────────────────────────────────────

describe('HUD Widgets slice', () => {
  it('starts with the default predefined set (text-to-flow visible, others hidden)', () => {
    const { hudWidgets } = useDesktopStore.getState();
    expect(hudWidgets).toHaveLength(3);
    const sessions = hudWidgets.find(w => w.type === 'agent-sessions');
    const pipeline = hudWidgets.find(w => w.type === 'text-to-flow');
    const notifs   = hudWidgets.find(w => w.type === 'notifications');
    expect(sessions?.visible).toBe(false);
    expect(pipeline?.visible).toBe(true);
    expect(notifs?.visible).toBe(false);
  });

  it('setHudWidgetVisible shows a hidden widget', () => {
    useDesktopStore.getState().setHudWidgetVisible('agent-sessions', true);
    const widget = useDesktopStore.getState().hudWidgets.find(w => w.type === 'agent-sessions');
    expect(widget?.visible).toBe(true);
  });

  it('setHudWidgetVisible hides a visible widget', () => {
    useDesktopStore.getState().setHudWidgetVisible('text-to-flow', false);
    const widget = useDesktopStore.getState().hudWidgets.find(w => w.type === 'text-to-flow');
    expect(widget?.visible).toBe(false);
  });

  it('setHudWidgetVisible is idempotent', () => {
    useDesktopStore.getState().setHudWidgetVisible('notifications', false);
    useDesktopStore.getState().setHudWidgetVisible('notifications', false);
    const widget = useDesktopStore.getState().hudWidgets.find(w => w.type === 'notifications');
    expect(widget?.visible).toBe(false);
  });

  it('moveHudWidget updates position for the given type only', () => {
    const newPos = { x: 500, y: 300 };
    useDesktopStore.getState().moveHudWidget('notifications', newPos);
    const notif = useDesktopStore.getState().hudWidgets.find(w => w.type === 'notifications');
    expect(notif?.position).toEqual(newPos);
    // Others unchanged
    const sessions = useDesktopStore.getState().hudWidgets.find(w => w.type === 'agent-sessions');
    expect(sessions?.position).not.toEqual(newPos);
  });

  it('toggleHudWidget flips visibility from false to true', () => {
    const before = useDesktopStore.getState().hudWidgets.find(w => w.type === 'agent-sessions');
    expect(before?.visible).toBe(false);
    useDesktopStore.getState().toggleHudWidget('agent-sessions');
    const after = useDesktopStore.getState().hudWidgets.find(w => w.type === 'agent-sessions');
    expect(after?.visible).toBe(true);
  });

  it('toggleHudWidget flips visibility from true to false', () => {
    useDesktopStore.getState().toggleHudWidget('text-to-flow');
    const widget = useDesktopStore.getState().hudWidgets.find(w => w.type === 'text-to-flow');
    expect(widget?.visible).toBe(false);
  });

  it('toggling does not affect other widget types', () => {
    useDesktopStore.getState().toggleHudWidget('notifications');
    const pipeline = useDesktopStore.getState().hudWidgets.find(w => w.type === 'text-to-flow');
    expect(pipeline?.visible).toBe(true); // unchanged (still its own default)
  });

  it('all three widget types are present exactly once', () => {
    const types = useDesktopStore.getState().hudWidgets.map(w => w.type);
    expect(types).toContain('agent-sessions');
    expect(types).toContain('text-to-flow');
    expect(types).toContain('notifications');
    expect(new Set(types).size).toBe(3);
  });
});

// ─── getStepMentalAttachments ─────────────────────────────────────

describe('getStepMentalAttachments', () => {
  it('returns empty array when step has no mental node edges', () => {
    const stepId = useDesktopStore.getState().addStepNode();
    expect(getStepMentalAttachments(stepId)).toEqual([]);
  });

  it('returns mental node ids connected to step via edge (both directions)', () => {
    const stepId = useDesktopStore.getState().addStepNode();
    const m1 = useDesktopStore.getState().addMentalNode({ position: { x: 0, y: 0 }, width: 220, height: 120, text: 'A', color: '#fff', shape: 'square' });
    const m2 = useDesktopStore.getState().addMentalNode({ position: { x: 0, y: 0 }, width: 220, height: 120, text: 'B', color: '#fff', shape: 'square' });
    useDesktopStore.getState().addMentalEdge(m1, stepId, 'link');   // mental → step
    useDesktopStore.getState().addMentalEdge(stepId, m2, 'link');   // step → mental
    const result = getStepMentalAttachments(stepId);
    expect(result).toHaveLength(2);
    expect(result).toContain(m1);
    expect(result).toContain(m2);
  });

  it('does not return step-to-step edges as attachments', () => {
    const stepA = useDesktopStore.getState().addStepNode();
    const stepB = useDesktopStore.getState().addStepNode();
    useDesktopStore.getState().addMentalEdge(stepA, stepB, 'link');
    expect(getStepMentalAttachments(stepA)).toEqual([]);
    expect(getStepMentalAttachments(stepB)).toEqual([]);
  });

  it('does not return unrelated mental node attachments', () => {
    const stepA = useDesktopStore.getState().addStepNode();
    const stepB = useDesktopStore.getState().addStepNode();
    const m1 = useDesktopStore.getState().addMentalNode({ position: { x: 0, y: 0 }, width: 220, height: 120, text: 'C', color: '#fff', shape: 'square' });
    useDesktopStore.getState().addMentalEdge(m1, stepB, 'link');  // attached to B, not A
    expect(getStepMentalAttachments(stepA)).toEqual([]);
  });
});

// ─── new-step and new-flow store operations ───────────────────────

describe('new-step and new-flow store operations', () => {
  it('addStepNode creates a step node with default llm_call type', () => {
    const id = useDesktopStore.getState().addStepNode();
    // Re-read state after mutation
    const node = useDesktopStore.getState().mentalNodes.find(n => n.id === id);
    expect(node).toBeDefined();
    expect(node!.type).toBe('step');
    expect((node as any).data.stepType).toBe('llm_call');
  });

  it('new-flow scaffold: two steps connected by a directed edge', () => {
    const initiatorId = useDesktopStore.getState().addStepNode({ title: 'Flow Start', stepType: 'llm_call' });
    const nextId = useDesktopStore.getState().addStepNode({ title: 'Next Step', stepType: 'llm_call' });
    const edgeId = useDesktopStore.getState().addMentalEdge(initiatorId, nextId, 'link', 'right', 'left');
    expect(edgeId).not.toBeNull();
    // Re-read state after mutations
    const edge = useDesktopStore.getState().mentalEdges.find(e => e.id === edgeId);
    expect(edge).toBeDefined();
    expect(edge!.sourceId).toBe(initiatorId);
    expect(edge!.targetId).toBe(nextId);
    expect(edge!.sourceHandle).toBe('right');
    expect(edge!.targetHandle).toBe('left');
  });

  it('flow edge between two steps: both ends are step nodes', () => {
    // Verifies the classification the rfEdges memo would use (step↔step = FlowEdge)
    const a = useDesktopStore.getState().addStepNode();
    const b = useDesktopStore.getState().addStepNode();
    useDesktopStore.getState().addMentalEdge(a, b, 'link');
    // Re-read state after mutations
    const state = useDesktopStore.getState();
    const stepIds = new Set(state.mentalNodes.filter(n => n.type === 'step').map(n => n.id));
    const edge = state.mentalEdges[state.mentalEdges.length - 1];
    expect(stepIds.has(edge.sourceId) && stepIds.has(edge.targetId)).toBe(true);
  });
});

// ─── Unified z-stack (mentalZ + recency) ─────────────────────────

describe('Unified z-stack: mentalZ and click-recency', () => {
  it('starts with empty mentalZ', () => {
    expect(useDesktopStore.getState().mentalZ).toEqual({});
  });

  it('addMentalNode assigns a mentalZ entry above any existing window zIndex', () => {
    const winId = addChat();
    const winZ = useDesktopStore.getState().windows.find(w => w.id === winId)!.zIndex!;
    const nodeId = useDesktopStore.getState().addMentalNode({
      position: { x: 0, y: 0 }, width: 220, height: 120, text: '', color: '#EDE9FE', shape: 'square',
    });
    const nodeZ = useDesktopStore.getState().mentalZ[nodeId];
    expect(nodeZ).toBeGreaterThan(winZ);
  });

  it('bringMentalToFront sets mentalZ[nodeId] above all window zIndexes', () => {
    const nodeId = useDesktopStore.getState().addMentalNode({
      position: { x: 0, y: 0 }, width: 220, height: 120, text: '', color: '#EDE9FE', shape: 'square',
    });
    const winId = addChat();
    const winZ = useDesktopStore.getState().windows.find(w => w.id === winId)!.zIndex!;
    useDesktopStore.getState().bringMentalToFront(nodeId);
    const nodeZ = useDesktopStore.getState().mentalZ[nodeId];
    expect(nodeZ).toBeGreaterThan(winZ);
  });

  it('focusWindow gives the window a zIndex above the highest mentalZ', () => {
    const nodeId = useDesktopStore.getState().addMentalNode({
      position: { x: 0, y: 0 }, width: 220, height: 120, text: '', color: '#EDE9FE', shape: 'square',
    });
    useDesktopStore.getState().bringMentalToFront(nodeId);
    const highMentalZ = useDesktopStore.getState().mentalZ[nodeId];

    const winId = addChat();
    const winZ = useDesktopStore.getState().windows.find(w => w.id === winId)!.zIndex!;
    expect(winZ).toBeGreaterThan(highMentalZ);
  });

  it('focusWindow (on existing window) rises above mentalZ', () => {
    const winId = addChat();
    const nodeId = useDesktopStore.getState().addMentalNode({
      position: { x: 0, y: 0 }, width: 220, height: 120, text: '', color: '#EDE9FE', shape: 'square',
    });
    // Bring mental to front first so its z is high
    useDesktopStore.getState().bringMentalToFront(nodeId);
    const mentalZ = useDesktopStore.getState().mentalZ[nodeId];
    // Then focus the window — it must rise above mentalZ
    useDesktopStore.getState().focusWindow(winId);
    const winZ = useDesktopStore.getState().windows.find(w => w.id === winId)!.zIndex!;
    expect(winZ).toBeGreaterThan(mentalZ);
  });

  it('bringMentalToFront includes connected component nodes', () => {
    const store = useDesktopStore.getState();
    const a = store.addMentalNode({ position: { x: 0, y: 0 }, width: 220, height: 120, text: '', color: '#EDE9FE', shape: 'square' });
    const b = store.addMentalNode({ position: { x: 300, y: 0 }, width: 220, height: 120, text: '', color: '#EDE9FE', shape: 'square' });
    store.addMentalEdge(a, b, 'link');
    store.bringMentalToFront(a);
    const state = useDesktopStore.getState();
    // Both nodes in the component get the same high z
    expect(state.mentalZ[a]).toBeDefined();
    expect(state.mentalZ[b]).toBeDefined();
    expect(state.mentalZ[a]).toBe(state.mentalZ[b]);
  });

  it('setSelectedMentalNodeIds does NOT change mentalZ (z is driven by pointer events only)', () => {
    const nodeId = useDesktopStore.getState().addMentalNode({
      position: { x: 0, y: 0 }, width: 220, height: 120, text: '', color: '#EDE9FE', shape: 'square',
    });
    const zBefore = useDesktopStore.getState().mentalZ[nodeId];
    useDesktopStore.getState().setSelectedMentalNodeIds([nodeId]);
    const zAfter = useDesktopStore.getState().mentalZ[nodeId];
    expect(zAfter).toBe(zBefore);
  });
});

// ─── v16 migration — new-step + new-flow dock injection ──────────

describe('v16 migration — new-step and new-flow dock injection', () => {
  it('injects new-step and new-flow for persisted users missing them', () => {
    const migrate = useDesktopStore.persist.getOptions().migrate;
    expect(migrate).toBeDefined();

    const persisted = {
      dockItems: [
        { id: 'dock-new-chat', type: 'action', label: 'New Chat', iconName: 'MessageSquare', action: 'new-chat' },
        { id: 'dock-file-explorer', type: 'action', label: 'Files', iconName: 'FileText', action: 'file-explorer' },
        { id: 'dock-backlog', type: 'action', label: 'Backlog', iconName: 'KanbanSquare', action: 'backlog' },
        { id: 'dock-mental-draw-toggle', type: 'action', label: 'Mental', iconName: 'PenTool', action: 'mental-draw-toggle' },
        { id: 'dock-marketplace', type: 'action', label: 'Marketplace', iconName: 'Store', action: 'marketplace' },
      ],
    };

    const migrated = (migrate as (state: unknown, version: number) => any)(persisted, 15);
    const actions = migrated.dockItems.map((item: { action: string }) => item.action);

    expect(actions).toContain('new-step');
    expect(actions).toContain('new-flow');
    // Must be inserted between mental-draw-toggle and marketplace
    const mentalIdx = actions.indexOf('mental-draw-toggle');
    const newStepIdx = actions.indexOf('new-step');
    const newFlowIdx = actions.indexOf('new-flow');
    const marketIdx = actions.indexOf('marketplace');
    expect(newStepIdx).toBeGreaterThan(mentalIdx);
    expect(newFlowIdx).toBeGreaterThan(mentalIdx);
    expect(newStepIdx).toBeLessThan(marketIdx);
    expect(newFlowIdx).toBeLessThan(marketIdx);
  });

  it('is idempotent — does not duplicate existing new-step/new-flow', () => {
    const migrate = useDesktopStore.persist.getOptions().migrate;
    expect(migrate).toBeDefined();

    const persisted = {
      dockItems: [
        { id: 'dock-new-chat', type: 'action', label: 'New Chat', iconName: 'MessageSquare', action: 'new-chat' },
        { id: 'dock-new-step', type: 'action', label: 'New Step', iconName: 'SquarePlus', action: 'new-step' },
        { id: 'dock-new-flow', type: 'action', label: 'New Flow', iconName: 'Workflow', action: 'new-flow' },
        { id: 'dock-marketplace', type: 'action', label: 'Marketplace', iconName: 'Store', action: 'marketplace' },
      ],
    };

    const migrated = (migrate as (state: unknown, version: number) => any)(persisted, 15);
    const actions = migrated.dockItems.map((item: { action: string }) => item.action);

    const newStepCount = actions.filter((a: string) => a === 'new-step').length;
    const newFlowCount = actions.filter((a: string) => a === 'new-flow').length;
    expect(newStepCount).toBe(1);
    expect(newFlowCount).toBe(1);
  });
});
