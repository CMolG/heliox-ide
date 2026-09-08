import { describe, it, expect, beforeEach } from 'vitest';
import type { PipelineAssembly } from '@/types/meta-agent';
import { LOOP_DEFAULT_MAX_ITERATIONS, LOOP_MAX_ITERATIONS_CAP } from '@/types/harness';
import type { BacklogCard } from '@/types/market';
import { useDesktopStore, getStepMentalAttachments } from '../store/desktop-store';
import { compileFlowFromCanvas } from '../lib/harness-compiler';

// Reset store to pristine state before each test
beforeEach(() => {
  useDesktopStore.setState(useDesktopStore.getInitialState(), true);
});

// ─── Helpers ─────────────────────────────────────────────────────

// Was `addChat` (created a 'chat' window) — 'chat' is retired as a window
// type (chats→steps re-architecture, F0 decision 2, 2026-07-10). The vast
// majority of this file's tests only ever needed "a generic window with no
// type-specific behavior" as a fixture, so this now backs onto 'plugin' —
// the ternary's own fallthrough/default case in `addWindow` (desktop-store.ts)
// — rather than every one of this helper's ~65 call sites needing a
// per-test type decision.
function addTestWindow(opts?: { title?: string; iconName?: string; sessionId?: string }) {
  return useDesktopStore.getState().addWindow('plugin', opts);
}

function getWindow(id: string) {
  return useDesktopStore.getState().windows.find(w => w.id === id);
}

// ─── Window CRUD ─────────────────────────────────────────────────

describe('Window CRUD', () => {
  it('addWindow creates a plugin window with defaults', () => {
    // Was "addWindow creates a chat window with defaults" — asserted the
    // CLI-provider-themed title/icon `addWindow` used to default to for
    // 'chat' windows specifically. That branch is retired along with 'chat'
    // itself (see addWindow's ternary chain, desktop-store.ts) — there is no
    // replacement behavior to assert for it. This instead covers the
    // ternary's final fallthrough default (title 'Plugin' / icon 'Blocks'),
    // previously untested (the sibling test below always passes explicit
    // opts, never exercising the no-opts default).
    const id = useDesktopStore.getState().addWindow('plugin');
    const win = getWindow(id)!;
    expect(win).toBeDefined();
    expect(win.type).toBe('plugin');
    expect(win.title).toBe('Plugin');
    expect(win.iconName).toBe('Blocks');
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
    const id = addTestWindow();
    const state = useDesktopStore.getState();
    expect(state.activeWindowId).toBe(id);
    expect(state.nextZIndex).toBeGreaterThan(10);
  });

  it('removeWindow removes the window', () => {
    const id = addTestWindow();
    useDesktopStore.getState().removeWindow(id);
    expect(getWindow(id)).toBeUndefined();
    expect(useDesktopStore.getState().windows).toHaveLength(0);
  });

  it('removeWindow clears activeWindowId when removed window was active', () => {
    const id = addTestWindow();
    expect(useDesktopStore.getState().activeWindowId).toBe(id);
    useDesktopStore.getState().removeWindow(id);
    expect(useDesktopStore.getState().activeWindowId).toBeNull();
  });

  it('removeWindow preserves activeWindowId when a different window is removed', () => {
    const id1 = addTestWindow();
    const id2 = addTestWindow();
    expect(useDesktopStore.getState().activeWindowId).toBe(id2);
    useDesktopStore.getState().removeWindow(id1);
    expect(useDesktopStore.getState().activeWindowId).toBe(id2);
  });

  it('removeWindow also removes connections involving that window', () => {
    const id1 = addTestWindow();
    const id2 = addTestWindow();
    useDesktopStore.setState((s) => ({
      connections: [...s.connections, { id: 'c1', sourceWindowId: id1, sourcePort: 'right' as const, targetWindowId: id2, targetPort: 'left' as const }],
    }));
    expect(useDesktopStore.getState().connections).toHaveLength(1);
    useDesktopStore.getState().removeWindow(id1);
    expect(useDesktopStore.getState().connections).toHaveLength(0);
  });

  it('focusWindow updates activeWindowId and bumps zIndex', () => {
    const id1 = addTestWindow();
    const id2 = addTestWindow();
    const zBefore = getWindow(id1)!.zIndex;
    useDesktopStore.getState().focusWindow(id1);
    expect(useDesktopStore.getState().activeWindowId).toBe(id1);
    expect(getWindow(id1)!.zIndex).toBeGreaterThan(zBefore);
  });

  it('focusWindow restores a minimized window to normal', () => {
    const id = addTestWindow();
    useDesktopStore.getState().setWindowState(id, 'minimized');
    expect(getWindow(id)!.state).toBe('minimized');
    useDesktopStore.getState().focusWindow(id);
    expect(getWindow(id)!.state).toBe('normal');
  });

  it('moveWindow updates position', () => {
    const id = addTestWindow();
    useDesktopStore.getState().moveWindow(id, { x: 200, y: 300 });
    expect(getWindow(id)!.position).toEqual({ x: 200, y: 300 });
  });

  it('resizeWindow updates size', () => {
    const id = addTestWindow();
    useDesktopStore.getState().resizeWindow(id, { width: 800, height: 600 });
    expect(getWindow(id)!.size).toEqual({ width: 800, height: 600 });
  });

  it('resizeWindow enforces minimum size', () => {
    const id = addTestWindow();
    useDesktopStore.getState().resizeWindow(id, { width: 100, height: 50 });
    expect(getWindow(id)!.size).toEqual({ width: 320, height: 250 });
  });

  it('resizeWindow can also update position', () => {
    const id = addTestWindow();
    useDesktopStore.getState().resizeWindow(id, { width: 500, height: 400 }, { x: 10, y: 20 });
    expect(getWindow(id)!.position).toEqual({ x: 10, y: 20 });
    expect(getWindow(id)!.size).toEqual({ width: 500, height: 400 });
  });

  it('setWindowState sets minimized / maximized / normal', () => {
    const id = addTestWindow();
    useDesktopStore.getState().setWindowState(id, 'minimized');
    expect(getWindow(id)!.state).toBe('minimized');
    useDesktopStore.getState().setWindowState(id, 'maximized');
    expect(getWindow(id)!.state).toBe('maximized');
    useDesktopStore.getState().setWindowState(id, 'normal');
    expect(getWindow(id)!.state).toBe('normal');
  });

  it('updateWindowTitle changes the title', () => {
    const id = addTestWindow();
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
    // v16 inserts new-step + new-flow between mental-draw-toggle and marketplace;
    // v21 inserts new-agent-session right after new-flow (Cockpit F1);
    // v23 inserts cockpit right after new-agent-session (Cockpit F4) — the
    // preset sits next to the session it arranges.
    expect(actions).toEqual([
      'new-chat',
      'file-explorer',
      'backlog',
      'mental-draw-toggle',
      'new-step',
      'new-flow',
      'new-agent-session',
      'cockpit',
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
      // 'file-explorer' rather than the old 'chat' fixture type — this test
      // is about the v15 grid-strip migration, orthogonal to window type;
      // 'chat' would now be dropped entirely by the v19 migration (also
      // exercised here, since 14 < 19) before these assertions ever ran.
      windows: [
        { id: 'win-1', type: 'file-explorer', title: 'Files', gridId: 'grid-1', gridCellIndex: 0, gridColSpan: 1, gridRowSpan: 1, position: { x: 0, y: 0 }, size: { width: 300, height: 300 } },
        { id: 'win-2', type: 'file-explorer', title: 'Files 2', position: { x: 100, y: 100 }, size: { width: 300, height: 300 } },
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

// ─── v19/v20 migration — chats→steps re-architecture ─────────────
//
// F0 decision 2 (2026-07-10): 'chat' retired as a DesktopWindow['type'];
// 'text-to-flow' HUD widget renamed to 'auto-chat' in the same slot. This is
// THE migration/tombstone coverage for criterion 5 ("boards guardados con
// ventanas de chat antiguas cargan sin crash").
describe('v19 migration — chat window type retirement (legacy board load)', () => {
  it('drops persisted chat windows without crashing, keeps other windows, and adds a tombstone notification', () => {
    const migrate = useDesktopStore.persist.getOptions().migrate;
    expect(migrate).toBeDefined();

    const persisted = {
      windows: [
        { id: 'legacy-chat-1', type: 'chat', title: 'OpenCode / project', sessionId: 's1', cliProvider: 'opencode', position: { x: 0, y: 0 }, size: { width: 480, height: 500 } },
        { id: 'legacy-chat-2', type: 'chat', title: 'Anthropic / other', sessionId: 's2', position: { x: 50, y: 50 }, size: { width: 480, height: 500 } },
        { id: 'keep-file-explorer', type: 'file-explorer', title: 'Files', position: { x: 100, y: 100 }, size: { width: 400, height: 560 } },
      ],
      dockItems: [
        { id: 'dock-new-chat', type: 'action', label: 'New Chat', iconName: 'MessageSquare', action: 'new-chat' },
        { id: 'dock-marketplace', type: 'action', label: 'Marketplace', iconName: 'Store', action: 'marketplace' },
      ],
      grids: [],
    };

    // A very old session (pre-v18) exercises the FULL chain in one pass —
    // never crashes, and every intermediate migration still applies.
    const migrated = (migrate as (state: unknown, version: number) => any)(persisted, 15);

    // The tombstone: both legacy chat windows are gone, the survivor stays.
    expect(migrated.windows).toHaveLength(1);
    expect(migrated.windows[0].id).toBe('keep-file-explorer');
    expect(migrated.windows.some((w: { type: string }) => w.type === 'chat')).toBe(false);

    // Never a silent surprise — a notification documents what happened.
    expect(migrated.notifications).toBeDefined();
    expect(migrated.notifications).toHaveLength(1);
    expect(migrated.notifications[0].message).toMatch(/2 chat windows/);
    expect(migrated.notifications[0].message).toMatch(/Auto-Chat/);
    expect(migrated.notifications[0].read).toBe(false);
    expect(migrated.unreadCount).toBe(1);

    // The Dock's "New Chat" item survives (same id/action — no crash for
    // persisted dock arrays either) but is relabeled in place.
    const dockItem = migrated.dockItems.find((d: { action: string }) => d.action === 'new-chat');
    expect(dockItem).toBeDefined();
    expect(dockItem.id).toBe('dock-new-chat');
    expect(dockItem.label).toBe('Auto-Chat');

    // Board bootstrap (v18) still ran in the same pass — this migration
    // doesn't short-circuit the rest of the chain.
    expect(migrated.boards).toEqual([expect.objectContaining({ id: 'board-1' })]);
  });

  it('is a no-op when no chat windows are present (no spurious notification)', () => {
    const migrate = useDesktopStore.persist.getOptions().migrate;
    const persisted = {
      windows: [{ id: 'w1', type: 'file-explorer', title: 'Files', position: { x: 0, y: 0 }, size: { width: 400, height: 560 } }],
      dockItems: [],
      grids: [],
    };
    const migrated = (migrate as (state: unknown, version: number) => any)(persisted, 15);
    expect(migrated.windows).toHaveLength(1);
    expect(migrated.notifications).toBeUndefined();
    expect(migrated.unreadCount).toBeUndefined();
  });

  it('loading a legacy board through the full store (not just the raw migrate fn) never crashes and drops the chat window', () => {
    // Exercises persist's actual hydration path end-to-end (getInitialState
    // + setState, not the migrate function in isolation) for the same
    // "legacy board with a chat window" scenario, per this task's mandated
    // migration test.
    const migrate = useDesktopStore.persist.getOptions().migrate!;
    const persisted = {
      windows: [{ id: 'legacy-chat', type: 'chat', title: 'Chat', position: { x: 0, y: 0 }, size: { width: 480, height: 500 } }],
      dockItems: [],
      grids: [],
    };
    const migrated = (migrate as (state: unknown, version: number) => any)(persisted, 15);
    const merge = useDesktopStore.persist.getOptions().merge!;
    const currentState = useDesktopStore.getInitialState();
    expect(() => {
      const merged = (merge as (p: unknown, c: unknown) => any)(migrated, currentState);
      useDesktopStore.setState(merged, true);
    }).not.toThrow();
    expect(useDesktopStore.getState().windows).toHaveLength(0);
    expect(useDesktopStore.getState().windows.every(w => (w.type as string) !== 'chat')).toBe(true);
  });
});

describe('v20 migration — auto-chat HUD widget rename', () => {
  it('renames a persisted text-to-flow HUD widget to auto-chat, carrying its visibility/position', () => {
    const migrate = useDesktopStore.persist.getOptions().migrate;
    const persisted = {
      hudWidgets: [
        { type: 'text-to-flow', visible: false, position: { x: 42, y: 99 } },
        { type: 'agent-sessions', visible: true, position: { x: 1, y: 2 } },
      ],
      dockItems: [],
      grids: [],
    };
    const migrated = (migrate as (state: unknown, version: number) => any)(persisted, 19);
    const renamed = migrated.hudWidgets.find((w: { type: string }) => w.type === 'auto-chat');
    expect(renamed).toBeDefined();
    expect(renamed.visible).toBe(false);
    expect(renamed.position).toEqual({ x: 42, y: 99 });
    expect(migrated.hudWidgets.some((w: { type: string }) => w.type === 'text-to-flow')).toBe(false);
  });

  it('merge() aliases a legacy text-to-flow (or text-to-pipeline) type defensively even without migrate running', () => {
    // Defense-in-depth backstop, mirroring the pre-existing
    // text-to-pipeline→text-to-flow alias — see merge()'s own comment.
    const merge = useDesktopStore.persist.getOptions().merge;
    const currentState = useDesktopStore.getInitialState();
    const persistedState = { hudWidgets: [{ type: 'text-to-flow', visible: false, position: { x: 7, y: 8 } }] };
    const merged = (merge as (p: unknown, c: unknown) => any)(persistedState, currentState);
    const autoChat = merged.hudWidgets.find((w: { type: string }) => w.type === 'auto-chat');
    expect(autoChat.visible).toBe(false);
    expect(autoChat.position).toEqual({ x: 7, y: 8 });
  });
});

// ─── Role Assignment ─────────────────────────────────────────────

describe('Role assignment', () => {
  it('assignRole returns true and sets roleId on first assignment', () => {
    const id = addTestWindow();
    const result = useDesktopStore.getState().assignRole(id, 'role-ui');
    expect(result).toBe(true);
    expect(getWindow(id)!.roleId).toBe('role-ui');
  });

  it('assignRole returns false when window already has a role (exclusivity)', () => {
    const id = addTestWindow();
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
    const id = addTestWindow();
    useDesktopStore.getState().assignRole(id, 'role-ui');
    useDesktopStore.getState().removeRole(id);
    expect(getWindow(id)!.roleId).toBeUndefined();
  });

  it('assignRole works again after removeRole', () => {
    const id = addTestWindow();
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
    const id = addTestWindow();
    useDesktopStore.getState().addModifier(id, 'mod-verbose');
    expect(getWindow(id)!.modifierIds).toEqual(['mod-verbose']);
  });

  it('addModifier allows multiple modifiers', () => {
    const id = addTestWindow();
    useDesktopStore.getState().addModifier(id, 'mod-verbose');
    useDesktopStore.getState().addModifier(id, 'mod-docs');
    expect(getWindow(id)!.modifierIds).toEqual(['mod-verbose', 'mod-docs']);
  });

  it('addModifier does not duplicate an already-present modifier', () => {
    const id = addTestWindow();
    useDesktopStore.getState().addModifier(id, 'mod-verbose');
    useDesktopStore.getState().addModifier(id, 'mod-verbose');
    expect(getWindow(id)!.modifierIds).toEqual(['mod-verbose']);
  });

  it('removeModifier removes a specific modifier', () => {
    const id = addTestWindow();
    useDesktopStore.getState().addModifier(id, 'mod-verbose');
    useDesktopStore.getState().addModifier(id, 'mod-docs');
    useDesktopStore.getState().removeModifier(id, 'mod-verbose');
    expect(getWindow(id)!.modifierIds).toEqual(['mod-docs']);
  });

  it('removeModifier is a no-op for missing modifier', () => {
    const id = addTestWindow();
    useDesktopStore.getState().addModifier(id, 'mod-verbose');
    useDesktopStore.getState().removeModifier(id, 'mod-docs');
    expect(getWindow(id)!.modifierIds).toEqual(['mod-verbose']);
  });
});

// ─── Connections ─────────────────────────────────────────────────

describe('Connections', () => {
  it('removeConnection removes a connection by id', () => {
    const id1 = addTestWindow();
    const id2 = addTestWindow();
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
    const id = addTestWindow();
    const { guides } = useDesktopStore.getState().calculateSnapGuides(id, { x: 100, y: 100 }, { width: 480, height: 500 });
    expect(guides).toEqual([]);
  });

  it('calculateSnapGuides produces guides when windows left-edges align within threshold', () => {
    const id1 = useDesktopStore.getState().addWindow('plugin', { position: { x: 100, y: 100 }, size: { width: 480, height: 500 } });
    const id2 = useDesktopStore.getState().addWindow('plugin', { position: { x: 500, y: 300 }, size: { width: 480, height: 500 } });
    // Move id2 so its left edge is within snap threshold of id1's left edge (100)
    const { guides, snappedPos } = useDesktopStore.getState().calculateSnapGuides(id2, { x: 103, y: 300 }, { width: 480, height: 500 });
    expect(guides.length).toBeGreaterThan(0);
    const xGuide = guides.find(g => g.axis === 'x');
    expect(xGuide).toBeDefined();
    expect(snappedPos.x).not.toBe(103); // snapped away from 103
  });

  it('calculateSnapGuides returns no guides when windows are far apart', () => {
    const id1 = useDesktopStore.getState().addWindow('plugin', { position: { x: 100, y: 100 }, size: { width: 200, height: 200 } });
    const id2 = useDesktopStore.getState().addWindow('plugin', { position: { x: 900, y: 900 }, size: { width: 200, height: 200 } });
    const { guides } = useDesktopStore.getState().calculateSnapGuides(id2, { x: 900, y: 900 }, { width: 200, height: 200 });
    expect(guides).toHaveLength(0);
  });

  it('calculateSnapGuides ignores minimized windows', () => {
    const id1 = useDesktopStore.getState().addWindow('plugin', { position: { x: 100, y: 100 }, size: { width: 480, height: 500 } });
    const id2 = useDesktopStore.getState().addWindow('plugin', { position: { x: 500, y: 300 }, size: { width: 480, height: 500 } });
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
    addTestWindow();
    // addWindow uses globalTopZ which gives z = max(nextZIndex, 0, ...) + 1.
    // With nextZIndex=10 and no other windows, z = 11, then nextZIndex = z+1 = 12.
    expect(useDesktopStore.getState().nextZIndex).toBe(12);
    addTestWindow();
    // z = max(12, 11) + 1 = 13, nextZIndex = 14.
    expect(useDesktopStore.getState().nextZIndex).toBe(14);
  });

  it('focusWindow brings the window above its peers (and advances the counter)', () => {
    const id1 = addTestWindow();
    const id2 = addTestWindow();
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
    const id1 = addTestWindow();
    expect(useDesktopStore.getState().activeWindowId).toBe(id1);
    const id2 = addTestWindow();
    expect(useDesktopStore.getState().activeWindowId).toBe(id2);
  });

  it('activeWindowId updates on focusWindow', () => {
    const id1 = addTestWindow();
    const id2 = addTestWindow();
    expect(useDesktopStore.getState().activeWindowId).toBe(id2);
    useDesktopStore.getState().focusWindow(id1);
    expect(useDesktopStore.getState().activeWindowId).toBe(id1);
  });

  it('each window gets a unique incrementing zIndex', () => {
    const id1 = addTestWindow();
    const id2 = addTestWindow();
    const id3 = addTestWindow();
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
    const chatId = addTestWindow();
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

  it('file-explorer and plugin windows coexist', () => {
    // Was "file-explorer and chat windows coexist" — 'chat' is retired
    // (F0 decision 2); 'plugin' (via addTestWindow) exercises the same
    // "two distinct window types side by side" behavior.
    addTestWindow({ title: 'Plugin 1' });
    useDesktopStore.getState().addWindow('file-explorer', { title: 'Files' });
    addTestWindow({ title: 'Plugin 2' });
    useDesktopStore.getState().addWindow('file-explorer', { title: 'Files 2' });

    const { windows } = useDesktopStore.getState();
    expect(windows.length).toBe(4);
    expect(windows.filter(w => w.type === 'plugin').length).toBe(2);
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
    const id = addTestWindow();
    useDesktopStore.getState().setHoveredWindowId(id);
    expect(useDesktopStore.getState().hoveredWindowId).toBe(id);
  });

  it('setHoveredWindowId can be cleared to null', () => {
    const id = addTestWindow();
    useDesktopStore.getState().setHoveredWindowId(id);
    useDesktopStore.getState().setHoveredWindowId(null);
    expect(useDesktopStore.getState().hoveredWindowId).toBeNull();
  });

  it('hoveredWindowId is independent of activeWindowId', () => {
    const id1 = addTestWindow({ title: 'A' });
    const id2 = addTestWindow({ title: 'B' });
    useDesktopStore.getState().focusWindow(id1);
    useDesktopStore.getState().setHoveredWindowId(id2);
    expect(useDesktopStore.getState().activeWindowId).toBe(id1);
    expect(useDesktopStore.getState().hoveredWindowId).toBe(id2);
  });
});

// ─── removeAttachedItem ──────────────────────────────────────────

describe('removeAttachedItem', () => {
  it('removes a role from a window without respawning', () => {
    const id = addTestWindow();
    useDesktopStore.getState().assignRole(id, 'frontend-engineer');
    expect(getWindow(id)!.roleId).toBe('frontend-engineer');

    useDesktopStore.getState().removeAttachedItem(id, 'role', 'frontend-engineer');
    expect(getWindow(id)!.roleId).toBeUndefined();
    // No attachable should be spawned
    expect(useDesktopStore.getState().attachables).toHaveLength(0);
  });

  it('removes a mod from a window without respawning', () => {
    const id = addTestWindow();
    useDesktopStore.getState().addModifier(id, 'strict-mode');
    expect(getWindow(id)!.modifierIds).toContain('strict-mode');

    useDesktopStore.getState().removeAttachedItem(id, 'mod', 'strict-mode');
    expect(getWindow(id)!.modifierIds).not.toContain('strict-mode');
    expect(useDesktopStore.getState().attachables).toHaveLength(0);
  });

  it('removes a flow from a window without respawning', () => {
    // Seeds flowId directly (bypassing connectFlow, which is retired below —
    // see 'Flow Connectors (retired)') to keep this test's actual subject
    // (removeAttachedItem's flow-removal path, via the ungated disconnectFlow)
    // isolated from that separate retirement.
    const id = addTestWindow();
    useDesktopStore.setState((s) => ({
      windows: s.windows.map(w => w.id === id ? { ...w, flowId: 'lighthouse-audit' } : w),
    }));
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
    const id = addTestWindow();
    useDesktopStore.getState().assignRole(id, 'frontend-engineer');

    // detachFromWindow should respawn
    useDesktopStore.getState().detachFromWindow(id, 'role', 'frontend-engineer');
    expect(getWindow(id)!.roleId).toBeUndefined();
    expect(useDesktopStore.getState().attachables).toHaveLength(1);
    expect(useDesktopStore.getState().attachables[0].name).toBe('frontend-engineer');
  });

});

// ─── Flow Connectors (retired) ────────────────────────────────────
//
// connectFlow/attachToWindow's window-scoped role/mod/flow attachment was
// only ever valid for chat windows — 'chat' is retired (F0 decision 2/4,
// 2026-07-10) alongside the market's own flow-as-attachable concept (flows
// become prebuilt pipelines copied to the board instead, market F4 task).
// These lock in the new "always fails, never mutates" contract so the
// retirement is an explicit, asserted fact rather than silently-dropped
// coverage — see the matching comments on connectFlow/attachToWindow in
// desktop-store.ts.
describe('connectFlow / attachToWindow (retired)', () => {
  it('connectFlow never attaches a flow to any window and returns false', () => {
    const id = addTestWindow();
    const success = useDesktopStore.getState().connectFlow(id, 'lighthouse-audit');
    expect(success).toBe(false);
    expect(getWindow(id)!.flowId).toBeUndefined();
  });

  it('attachToWindow never attaches a role/mod to any window and returns false', () => {
    const id = addTestWindow();
    const attachableId = useDesktopStore.getState().spawnAttachable('role', 'frontend-engineer', { x: 0, y: 0 });
    const success = useDesktopStore.getState().attachToWindow(attachableId, id);
    expect(success).toBe(false);
    expect(getWindow(id)!.roleId).toBeUndefined();
    // The attachable is untouched — attachToWindow never got far enough to remove it.
    expect(useDesktopStore.getState().attachables.some(a => a.id === attachableId)).toBe(true);
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

// ─── updateFrameData (Frame node data patches — Phase 11) ──────────

describe('updateFrameData', () => {
  it('updateFrameData patches frame fields immutably', () => {
    const store = useDesktopStore.getState();
    const frameId = store.addFrameNode({
      position: { x: 0, y: 0 }, width: 300, height: 200, title: 'My Flow', childIds: [],
    });

    const beforeNode = useDesktopStore.getState().mentalNodes.find((n: any) => n.id === frameId) as any;
    const beforeData = beforeNode.data;

    store.updateFrameData(frameId, { title: 'Renamed Flow', tags: ['alpha', 'beta'], author: 'Ada Lovelace', version: '2.0.0' });

    const afterNode = useDesktopStore.getState().mentalNodes.find((n: any) => n.id === frameId) as any;
    expect(afterNode).not.toBe(beforeNode);
    expect(afterNode.data).not.toBe(beforeData);
    expect(afterNode.data.title).toBe('Renamed Flow');
    expect(afterNode.data.tags).toEqual(['alpha', 'beta']);
    expect(afterNode.data.author).toBe('Ada Lovelace');
    expect(afterNode.data.version).toBe('2.0.0');
    // Unrelated fields survive the patch untouched.
    expect(afterNode.data.childIds).toEqual([]);

    // "Reopening" (re-reading store state fresh) still sees the persisted edit.
    expect(
      (useDesktopStore.getState().mentalNodes.find((n: any) => n.id === frameId) as any).data.title,
    ).toBe('Renamed Flow');
  });

  it('updateFrameData is a no-op for a frameId that does not exist', () => {
    const store = useDesktopStore.getState();
    const frameId = store.addFrameNode({
      position: { x: 0, y: 0 }, width: 300, height: 200, title: 'Untouched flow', childIds: [],
    });
    const beforeNode = useDesktopStore.getState().mentalNodes.find((n: any) => n.id === frameId);

    store.updateFrameData('no-such-frame', { title: 'unreachable' });

    const afterNodes = useDesktopStore.getState().mentalNodes;
    expect(afterNodes).toHaveLength(1);
    // The real node's reference is untouched — the map left it alone rather
    // than materializing a patch for an id that doesn't exist.
    expect(afterNodes.find((n: any) => n.id === frameId)).toBe(beforeNode);
  });

  it('updateFrameData is a no-op when the id names a Step node instead of a Frame', () => {
    const store = useDesktopStore.getState();
    const stepId = store.addStepNode({ position: { x: 0, y: 0 }, title: 'A step' });
    const beforeNode = useDesktopStore.getState().mentalNodes.find((n: any) => n.id === stepId);

    store.updateFrameData(stepId, { title: 'should not apply' });

    const afterNode = useDesktopStore.getState().mentalNodes.find((n: any) => n.id === stepId);
    expect(afterNode).toBe(beforeNode);
  });

  // ── Task U — Rosetta contextMode: the FULL data chain, end to end ──────────
  //
  // This is the same `updateFrameData(frameId, { contextMode: ... })` call
  // FrameNode.tsx's context-mode <select> onChange handler makes (see
  // FrameNode.test.tsx for proof the JSX wires that call correctly), chained
  // directly into the REAL `compileFlowFromCanvas` (no mocks anywhere in this
  // file) to prove the whole pipeline: toggle's store write ->
  // FrameNodeData.contextMode -> harness-compiler's owning-frame lookup ->
  // AgenticFlow.contextMode — the exact field the executor branches on.
  it('contextMode set via updateFrameData survives into the compiled AgenticFlow (toggle -> FrameNodeData -> harness-compiler -> AgenticFlow.contextMode)', () => {
    const store = useDesktopStore.getState();
    const frameId = store.addFrameNode({
      position: { x: 0, y: 0 }, width: 300, height: 200, title: 'Feedback Flow', childIds: [],
    });
    store.addStepNode({ position: { x: 0, y: 0 }, title: 'Root step', parentId: frameId });

    // The exact call FrameNode.tsx's handleContextModeChange makes when the
    // user picks "Feedback" from the select.
    store.updateFrameData(frameId, { contextMode: 'feedback' });

    // Same no-options call `compileCurrentCanvas` (harness-store.ts) makes on
    // "Run" — the single step with zero incoming edges auto-resolves as root.
    const { mentalNodes, mentalEdges } = useDesktopStore.getState();
    const flow = compileFlowFromCanvas(mentalNodes, mentalEdges);

    expect(flow.contextMode).toBe('feedback');
  });

  it('a Frame with no contextMode toggled compiles with the field omitted (criterion 1: byte-identical to today)', () => {
    const store = useDesktopStore.getState();
    const frameId = store.addFrameNode({
      position: { x: 0, y: 0 }, width: 300, height: 200, title: 'Untouched Flow', childIds: [],
    });
    store.addStepNode({ position: { x: 0, y: 0 }, title: 'Root step', parentId: frameId });

    const { mentalNodes, mentalEdges } = useDesktopStore.getState();
    const flow = compileFlowFromCanvas(mentalNodes, mentalEdges);

    expect(flow.contextMode).toBeUndefined();
    expect('contextMode' in flow).toBe(false);
  });
});

// ─── Phase grouping (Capa 1 spike) ─────────────────────────────────

describe('Phase grouping (Capa 1 spike)', () => {
  it('addPhaseNode creates a PhaseGraphNode owned by the given frame', () => {
    const store = useDesktopStore.getState();
    const frameId = store.addFrameNode({ position: { x: 0, y: 0 }, width: 400, height: 300, title: 'Flow' });
    const stepId = store.addStepNode({ parentId: frameId, title: 'Step A' });

    const phaseId = useDesktopStore.getState().addPhaseNode({
      parentId: frameId,
      position: { x: 20, y: 20 },
      width: 360,
      height: 220,
      title: 'Setup',
      childIds: [stepId],
    });

    const nodes = useDesktopStore.getState().mentalNodes;
    const phase = nodes.find((n) => n.id === phaseId);
    expect(phase?.type).toBe('phase');
    expect((phase as never as { parentId: string }).parentId).toBe(frameId);
    expect((phase as never as { data: { childIds: string[] } }).data.childIds).toEqual([stepId]);
  });

  it('addPhaseNode re-parents its named child steps from the frame to the new phase', () => {
    const store = useDesktopStore.getState();
    const frameId = store.addFrameNode({ position: { x: 0, y: 0 }, width: 400, height: 300, title: 'Flow' });
    const stepId = store.addStepNode({ parentId: frameId, title: 'Step A' });

    const phaseId = useDesktopStore.getState().addPhaseNode({
      parentId: frameId, position: { x: 0, y: 0 }, width: 360, height: 220, title: 'Setup', childIds: [stepId],
    });

    const step = useDesktopStore.getState().mentalNodes.find((n) => n.id === stepId);
    expect((step as never as { parentId: string }).parentId).toBe(phaseId);
  });

  it('splices the phase after its frame but before its child steps (React Flow parent-ordering invariant)', () => {
    // React Flow resolves `parentId` positionally: a parent must precede its
    // children in the nodes array. Appending the phase would place it after
    // the very steps it now parents, and they would render detached.
    const store = useDesktopStore.getState();
    const frameId = store.addFrameNode({ position: { x: 0, y: 0 }, width: 400, height: 300, title: 'Flow' });
    const stepId = store.addStepNode({ parentId: frameId, title: 'Step A' });

    const phaseId = useDesktopStore.getState().addPhaseNode({
      parentId: frameId, position: { x: 0, y: 0 }, width: 360, height: 220, title: 'Setup', childIds: [stepId],
    });

    const ids = useDesktopStore.getState().mentalNodes.map((n) => n.id);
    expect(ids.indexOf(frameId)).toBeLessThan(ids.indexOf(phaseId));
    expect(ids.indexOf(phaseId)).toBeLessThan(ids.indexOf(stepId));
  });

  it('updatePhaseData patches title/description on the phase node only', () => {
    const store = useDesktopStore.getState();
    const frameId = store.addFrameNode({ position: { x: 0, y: 0 }, width: 400, height: 300, title: 'Flow' });
    const phaseId = store.addPhaseNode({ parentId: frameId, position: { x: 0, y: 0 }, width: 360, height: 220, title: 'Setup' });

    useDesktopStore.getState().updatePhaseData(phaseId, { title: 'Renamed Phase' });

    const phase = useDesktopStore.getState().mentalNodes.find((n) => n.id === phaseId);
    expect((phase as never as { data: { title: string } }).data.title).toBe('Renamed Phase');
  });

  it('removeMentalNode on a phase re-parents its children to the owning frame instead of deleting them', () => {
    const store = useDesktopStore.getState();
    const frameId = store.addFrameNode({ position: { x: 0, y: 0 }, width: 400, height: 300, title: 'Flow' });
    const stepId = store.addStepNode({ parentId: frameId, title: 'Step A' });
    const phaseId = useDesktopStore.getState().addPhaseNode({
      parentId: frameId, position: { x: 0, y: 0 }, width: 360, height: 220, title: 'Setup', childIds: [stepId],
    });

    useDesktopStore.getState().removeMentalNode(phaseId);

    const nodes = useDesktopStore.getState().mentalNodes;
    expect(nodes.find((n) => n.id === phaseId)).toBeUndefined();
    const step = nodes.find((n) => n.id === stepId);
    expect(step).toBeDefined();
    expect((step as never as { parentId: string }).parentId).toBe(frameId);
  });

  it('removeMentalNode on a frame cascade-deletes transitively through a phase, leaving no dangling parentId', () => {
    // The frame cascade walks `parentId`, and addStepNode never registers the
    // step in the frame's own childIds — so once addPhaseNode re-parents a
    // step (frame > phase > step), a single-level scan would delete the phase
    // and strand its steps pointing at a node that no longer exists.
    const store = useDesktopStore.getState();
    const frameId = store.addFrameNode({ position: { x: 0, y: 0 }, width: 400, height: 300, title: 'Flow' });
    const stepId = store.addStepNode({ parentId: frameId, title: 'Step A' });
    const phaseId = useDesktopStore.getState().addPhaseNode({
      parentId: frameId, position: { x: 0, y: 0 }, width: 360, height: 220, title: 'Setup', childIds: [stepId],
    });

    useDesktopStore.getState().removeMentalNode(frameId);

    const nodes = useDesktopStore.getState().mentalNodes;
    expect(nodes.find((n) => n.id === frameId)).toBeUndefined();
    expect(nodes.find((n) => n.id === phaseId)).toBeUndefined();
    expect(nodes.find((n) => n.id === stepId)).toBeUndefined();
  });

  it('removeMentalNode on a frame still cascade-deletes its children (regression: Frame behavior unchanged)', () => {
    const store = useDesktopStore.getState();
    const frameId = store.addFrameNode({ position: { x: 0, y: 0 }, width: 400, height: 300, title: 'Flow' });
    const stepId = store.addStepNode({ parentId: frameId, title: 'Step A' });

    useDesktopStore.getState().removeMentalNode(frameId);

    const nodes = useDesktopStore.getState().mentalNodes;
    expect(nodes.find((n) => n.id === frameId)).toBeUndefined();
    expect(nodes.find((n) => n.id === stepId)).toBeUndefined();
  });
});

// ─── Loop-back edges (bounded refinement) ──────────────────────────

describe('Loop-back edges (bounded refinement)', () => {
  it('addMentalEdge on a loop edge clamps an over-cap maxIterations to LOOP_MAX_ITERATIONS_CAP', () => {
    const store = useDesktopStore.getState();
    const a = store.addMentalNode({ position: { x: 0, y: 0 }, width: 220, height: 120, text: '', color: '#EDE9FE', shape: 'square' });
    const b = store.addMentalNode({ position: { x: 300, y: 0 }, width: 220, height: 120, text: '', color: '#EDE9FE', shape: 'square' });

    const edgeId = store.addMentalEdge(a, b, 'loop', undefined, undefined, 99);
    expect(edgeId).toBeTruthy();
    const edge = useDesktopStore.getState().mentalEdges.find((e) => e.id === edgeId);
    expect(edge?.type).toBe('loop');
    expect(edge?.maxIterations).toBe(LOOP_MAX_ITERATIONS_CAP);
  });

  it('addMentalEdge on a loop edge defaults maxIterations to LOOP_DEFAULT_MAX_ITERATIONS when omitted', () => {
    const store = useDesktopStore.getState();
    const a = store.addMentalNode({ position: { x: 0, y: 0 }, width: 220, height: 120, text: '', color: '#EDE9FE', shape: 'square' });
    const b = store.addMentalNode({ position: { x: 300, y: 0 }, width: 220, height: 120, text: '', color: '#EDE9FE', shape: 'square' });

    const edgeId = store.addMentalEdge(a, b, 'loop');
    const edge = useDesktopStore.getState().mentalEdges.find((e) => e.id === edgeId);
    expect(edge?.maxIterations).toBe(LOOP_DEFAULT_MAX_ITERATIONS);
  });

  it('addMentalEdge on a non-loop edge never sets maxIterations', () => {
    const store = useDesktopStore.getState();
    const a = store.addMentalNode({ position: { x: 0, y: 0 }, width: 220, height: 120, text: '', color: '#EDE9FE', shape: 'square' });
    const b = store.addMentalNode({ position: { x: 300, y: 0 }, width: 220, height: 120, text: '', color: '#EDE9FE', shape: 'square' });

    const edgeId = store.addMentalEdge(a, b, 'link', undefined, undefined, 12);
    const edge = useDesktopStore.getState().mentalEdges.find((e) => e.id === edgeId);
    expect(edge?.maxIterations).toBeUndefined();
  });

  it('updateMentalEdgeData updates and clamps maxIterations', () => {
    const store = useDesktopStore.getState();
    const a = store.addMentalNode({ position: { x: 0, y: 0 }, width: 220, height: 120, text: '', color: '#EDE9FE', shape: 'square' });
    const b = store.addMentalNode({ position: { x: 300, y: 0 }, width: 220, height: 120, text: '', color: '#EDE9FE', shape: 'square' });
    const edgeId = store.addMentalEdge(a, b, 'loop')!;

    store.updateMentalEdgeData(edgeId, { maxIterations: 7 });
    expect(useDesktopStore.getState().mentalEdges.find((e) => e.id === edgeId)?.maxIterations).toBe(7);

    store.updateMentalEdgeData(edgeId, { maxIterations: 1000 });
    expect(useDesktopStore.getState().mentalEdges.find((e) => e.id === edgeId)?.maxIterations).toBe(LOOP_MAX_ITERATIONS_CAP);
  });

  it('updateMentalEdgeData leaves maxIterations untouched when the patch omits it', () => {
    const store = useDesktopStore.getState();
    const a = store.addMentalNode({ position: { x: 0, y: 0 }, width: 220, height: 120, text: '', color: '#EDE9FE', shape: 'square' });
    const b = store.addMentalNode({ position: { x: 300, y: 0 }, width: 220, height: 120, text: '', color: '#EDE9FE', shape: 'square' });
    const edgeId = store.addMentalEdge(a, b, 'loop', undefined, undefined, 5)!;

    store.updateMentalEdgeData(edgeId, {});
    expect(useDesktopStore.getState().mentalEdges.find((e) => e.id === edgeId)?.maxIterations).toBe(5);
  });

  it('updateMentalEdgeData no-ops for an unknown edge id', () => {
    const store = useDesktopStore.getState();
    const before = useDesktopStore.getState().mentalEdges;
    store.updateMentalEdgeData('nonexistent-edge', { maxIterations: 10 });
    expect(useDesktopStore.getState().mentalEdges).toEqual(before);
  });

  it('insertPipelineAssembly materializes a type:"loop" edge for a step carrying loopBackTo', () => {
    const assembly: PipelineAssembly = {
      frameTitle: 'Refine Loop Pipeline',
      description: 'Draft, critique, redraft up to a cap.',
      missingCapabilitiesRequested: [],
      steps: [
        { id: 'draft', prompt: 'Draft the initial document from the requirements.', roleId: 'confident-executor', modIds: [], prevStepIds: [] },
        { id: 'critique', prompt: 'Critique the draft against acceptance criteria.', roleId: 'confident-executor', modIds: [], prevStepIds: ['draft'] },
        { id: 'redraft', prompt: 'Apply the critique to produce an improved draft.', roleId: 'confident-executor', modIds: [], prevStepIds: ['critique'], loopBackTo: { stepId: 'draft', maxIterations: 4 } },
      ],
    };

    const result = useDesktopStore.getState().insertPipelineAssembly({
      assembly,
      position: { x: 0, y: 0 },
      frameWidth: 1200,
      frameHeight: 420,
    });

    const state = useDesktopStore.getState();
    const [draftId, , redraftId] = result.stepIds;
    const loopEdge = state.mentalEdges.find((e) => e.type === 'loop');
    expect(loopEdge).toBeDefined();
    expect(loopEdge).toMatchObject({
      sourceId: redraftId,
      targetId: draftId,
      type: 'loop',
      maxIterations: 4,
    });
    // 2 forward edges (draft->critique, critique->redraft) + 1 loop edge
    expect(state.mentalEdges).toHaveLength(3);
  });

  it('insertPipelineAssembly skips a loopBackTo target that is unknown or self-referencing', () => {
    const assembly: PipelineAssembly = {
      frameTitle: 'Broken Loop Pipeline',
      description: 'loopBackTo targets are invalid.',
      missingCapabilitiesRequested: [],
      steps: [
        { id: 'draft', prompt: 'Draft the initial document from the requirements.', roleId: 'confident-executor', modIds: [], prevStepIds: [] },
        { id: 'unknown-target', prompt: 'Redraft pointing at a step id that does not exist.', roleId: 'confident-executor', modIds: [], prevStepIds: ['draft'], loopBackTo: { stepId: 'ghost-step', maxIterations: 3 } },
        { id: 'self-loop', prompt: 'Redraft pointing at itself.', roleId: 'confident-executor', modIds: [], prevStepIds: ['unknown-target'], loopBackTo: { stepId: 'self-loop', maxIterations: 3 } },
      ],
    };

    const result = useDesktopStore.getState().insertPipelineAssembly({
      assembly,
      position: { x: 0, y: 0 },
      frameWidth: 900,
      frameHeight: 420,
    });

    const state = useDesktopStore.getState();
    expect(state.mentalEdges.some((e) => e.type === 'loop')).toBe(false);
    // Only the 2 forward edges: draft->unknown-target, unknown-target->self-loop
    expect(state.mentalEdges).toHaveLength(2);
    expect(result.stepIds).toHaveLength(3);
  });

  it('insertPipelineAssembly is a no-op loop-wise when no step carries loopBackTo', () => {
    const assembly: PipelineAssembly = {
      frameTitle: 'Plain Pipeline',
      description: 'No loop-backs here.',
      missingCapabilitiesRequested: [],
      steps: [
        { id: 'a', prompt: 'Do A with explicit context.', roleId: 'confident-executor', modIds: [], prevStepIds: [] },
        { id: 'b', prompt: 'Use A to do B with explicit output.', roleId: 'confident-executor', modIds: [], prevStepIds: ['a'] },
      ],
    };

    useDesktopStore.getState().insertPipelineAssembly({
      assembly,
      position: { x: 0, y: 0 },
      frameWidth: 900,
      frameHeight: 420,
    });

    expect(useDesktopStore.getState().mentalEdges.some((e) => e.type === 'loop')).toBe(false);
  });
});

// ─── invertMentalEdge (re-classifies link↔loop on reversal) ────────

describe('invertMentalEdge', () => {
  it('inverts a link edge: swaps sourceId/targetId and sourceHandle/targetHandle', () => {
    const store = useDesktopStore.getState();
    const a = store.addStepNode({ position: { x: 0, y: 0 }, title: 'A' });
    const b = store.addStepNode({ position: { x: 300, y: 0 }, title: 'B' });
    const edgeId = store.addMentalEdge(a, b, 'link', 'right', 'left')!;

    store.invertMentalEdge(edgeId);

    const edge = useDesktopStore.getState().mentalEdges.find((e) => e.id === edgeId);
    expect(edge?.sourceId).toBe(b);
    expect(edge?.targetId).toBe(a);
    expect(edge?.sourceHandle).toBe('left');
    expect(edge?.targetHandle).toBe('right');
    expect(edge?.type).toBe('link');
  });

  it('re-types a link edge to loop when its reversal points to an upstream step', () => {
    // A → B, B → C is the forward chain; A → C is a direct "shortcut" edge.
    // Inverting the shortcut (A → C becomes C → A) must be re-classified as a
    // loop: even with the shortcut itself excluded from the check, A still
    // forward-reaches C via B, so C → A would close a cycle (A→B→C→A).
    // (NB: inverting either edge of the plain 2-hop chain alone can never
    // trigger this branch — removing the sole A→B or B→C edge from the
    // "others" graph before the cycle check leaves no alternate path, so a
    // shortcut/diamond topology is required to exercise this branch at all.)
    const store = useDesktopStore.getState();
    const a = store.addStepNode({ position: { x: 0, y: 0 }, title: 'A' });
    const b = store.addStepNode({ position: { x: 300, y: 0 }, title: 'B' });
    const c = store.addStepNode({ position: { x: 600, y: 0 }, title: 'C' });
    store.addMentalEdge(a, b, 'link');
    store.addMentalEdge(b, c, 'link');
    const shortcutId = store.addMentalEdge(a, c, 'link')!;

    store.invertMentalEdge(shortcutId);

    const edge = useDesktopStore.getState().mentalEdges.find((e) => e.id === shortcutId);
    expect(edge?.sourceId).toBe(c);
    expect(edge?.targetId).toBe(a);
    expect(edge?.type).toBe('loop');
    expect(edge?.maxIterations).toBe(LOOP_DEFAULT_MAX_ITERATIONS);
  });

  it('re-types a loop edge to link and deletes maxIterations when its reversal no longer closes a cycle', () => {
    const store = useDesktopStore.getState();
    const a = store.addStepNode({ position: { x: 0, y: 0 }, title: 'A' });
    const b = store.addStepNode({ position: { x: 300, y: 0 }, title: 'B' });
    const edgeId = store.addMentalEdge(a, b, 'loop', undefined, undefined, 7)!;

    store.invertMentalEdge(edgeId);

    const edge = useDesktopStore.getState().mentalEdges.find((e) => e.id === edgeId);
    expect(edge?.sourceId).toBe(b);
    expect(edge?.targetId).toBe(a);
    expect(edge?.type).toBe('link');
    expect(edge?.maxIterations).toBeUndefined();
  });

  it('is a no-op for an unknown edge id', () => {
    const store = useDesktopStore.getState();
    const before = useDesktopStore.getState().mentalEdges;
    store.invertMentalEdge('nonexistent-edge');
    expect(useDesktopStore.getState().mentalEdges).toEqual(before);
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
    const winId = addTestWindow();
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
    const winId = addTestWindow();
    useDesktopStore.getState().attachMentalToWindow(winId, ['n1', 'n2', 'n3']);
    const w = getWindow(winId)!;
    expect(w.mentalAttachments).toHaveLength(1);
    expect(w.mentalAttachments![0].nodeIds).toEqual(['n1', 'n2', 'n3']);
    expect(w.mentalAttachments![0].attachedAt).toBeGreaterThan(0);
  });

  it('attachMentalToWindow accepts multiple distinct attachments', () => {
    const winId = addTestWindow();
    const store = useDesktopStore.getState();
    store.attachMentalToWindow(winId, ['n1', 'n2']);
    store.attachMentalToWindow(winId, ['n3']);
    store.attachMentalToWindow(winId, []); // whole map
    expect(getWindow(winId)!.mentalAttachments).toHaveLength(3);
  });

  it('attachMentalToWindow dedupes attachments with identical membership', () => {
    const winId = addTestWindow();
    const store = useDesktopStore.getState();
    store.attachMentalToWindow(winId, ['n1', 'n2']);
    store.attachMentalToWindow(winId, ['n2', 'n1']); // same set, different order
    expect(getWindow(winId)!.mentalAttachments).toHaveLength(1);
  });

  it('detachMentalAttachment removes only the targeted index', () => {
    const winId = addTestWindow();
    const store = useDesktopStore.getState();
    store.attachMentalToWindow(winId, ['a']);
    store.attachMentalToWindow(winId, ['b']);
    store.attachMentalToWindow(winId, ['c']);
    useDesktopStore.getState().detachMentalAttachment(winId, 1);
    const remaining = getWindow(winId)!.mentalAttachments!.map(a => a.nodeIds[0]);
    expect(remaining).toEqual(['a', 'c']);
  });

  it('detachMentalAttachment is a no-op for out-of-range indices', () => {
    const winId = addTestWindow();
    const store = useDesktopStore.getState();
    store.attachMentalToWindow(winId, ['a']);
    useDesktopStore.getState().detachMentalAttachment(winId, 99);
    useDesktopStore.getState().detachMentalAttachment(winId, -1);
    expect(getWindow(winId)!.mentalAttachments).toHaveLength(1);
  });

  it('clearMentalAttachments wipes all attachments on a window', () => {
    const winId = addTestWindow();
    const store = useDesktopStore.getState();
    store.attachMentalToWindow(winId, ['a']);
    store.attachMentalToWindow(winId, ['b']);
    useDesktopStore.getState().clearMentalAttachments(winId);
    expect(getWindow(winId)!.mentalAttachments).toEqual([]);
  });

  it('attachments survive when other windows mutate', () => {
    const chatA = addTestWindow();
    const chatB = addTestWindow();
    const store = useDesktopStore.getState();
    store.attachMentalToWindow(chatA, ['a1', 'a2']);
    store.attachMentalToWindow(chatB, ['b1']);
    useDesktopStore.getState().clearMentalAttachments(chatB);
    expect(getWindow(chatA)!.mentalAttachments).toHaveLength(1);
    expect(getWindow(chatB)!.mentalAttachments).toEqual([]);
  });

  it('attaching with an empty nodeIds array represents the whole-map sentinel', () => {
    const winId = addTestWindow();
    useDesktopStore.getState().attachMentalToWindow(winId, []);
    expect(getWindow(winId)!.mentalAttachments).toHaveLength(1);
    expect(getWindow(winId)!.mentalAttachments![0].nodeIds).toEqual([]);
  });
});

// ─── HUD Widgets slice ────────────────────────────────────────────

describe('HUD Widgets slice', () => {
  it('starts with the default predefined set (auto-chat visible, others hidden)', () => {
    const { hudWidgets } = useDesktopStore.getState();
    expect(hudWidgets).toHaveLength(3);
    const sessions = hudWidgets.find(w => w.type === 'agent-sessions');
    const pipeline = hudWidgets.find(w => w.type === 'auto-chat');
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
    useDesktopStore.getState().setHudWidgetVisible('auto-chat', false);
    const widget = useDesktopStore.getState().hudWidgets.find(w => w.type === 'auto-chat');
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
    useDesktopStore.getState().toggleHudWidget('auto-chat');
    const widget = useDesktopStore.getState().hudWidgets.find(w => w.type === 'auto-chat');
    expect(widget?.visible).toBe(false);
  });

  it('toggling does not affect other widget types', () => {
    useDesktopStore.getState().toggleHudWidget('notifications');
    const pipeline = useDesktopStore.getState().hudWidgets.find(w => w.type === 'auto-chat');
    expect(pipeline?.visible).toBe(true); // unchanged (still its own default)
  });

  it('all three widget types are present exactly once', () => {
    const types = useDesktopStore.getState().hudWidgets.map(w => w.type);
    expect(types).toContain('agent-sessions');
    expect(types).toContain('auto-chat');
    expect(types).toContain('notifications');
    expect(new Set(types).size).toBe(3);
  });
});

// ─── HUD Widgets — resizeHudWidget (Phase 3: user-resizing + persisted size) ──

describe('resizeHudWidget', () => {
  it('stores width/height for the given type only', () => {
    useDesktopStore.getState().resizeHudWidget('agent-sessions', { width: 400, height: 320 });
    const sessions = useDesktopStore.getState().hudWidgets.find(w => w.type === 'agent-sessions');
    expect(sessions?.size).toEqual({ width: 400, height: 320 });
    // Others remain unaffected (no stray size key)
    const notifs = useDesktopStore.getState().hudWidgets.find(w => w.type === 'notifications');
    expect(notifs?.size).toBeUndefined();
  });

  it('leaves values already within [min, viewport] untouched', () => {
    useDesktopStore.getState().resizeHudWidget('agent-sessions', { width: 500, height: 400 });
    const widget = useDesktopStore.getState().hudWidgets.find(w => w.type === 'agent-sessions');
    expect(widget?.size).toEqual({ width: 500, height: 400 });
  });

  it('clamps below the 216x144 minimum (grid-aligned — see hud-widget-policy.ts MIN_WIDGET_WIDTH/HEIGHT)', () => {
    useDesktopStore.getState().resizeHudWidget('notifications', { width: 50, height: 30 });
    const widget = useDesktopStore.getState().hudWidgets.find(w => w.type === 'notifications');
    expect(widget?.size).toEqual({ width: 216, height: 144 });
  });

  it('clamps above the current viewport bounds', () => {
    const hugeWidth = window.innerWidth + 5000;
    const hugeHeight = window.innerHeight + 5000;
    useDesktopStore.getState().resizeHudWidget('auto-chat', { width: hugeWidth, height: hugeHeight });
    const widget = useDesktopStore.getState().hudWidgets.find(w => w.type === 'auto-chat');
    expect(widget?.size).toEqual({ width: window.innerWidth, height: window.innerHeight });
  });
});

// ─── HUD Widgets — persistence merge carries size (Phase 3) ──────────────────

describe('HUD widget persistence merge — size', () => {
  it('carries a persisted size through merge for the matching widget type', () => {
    const merge = useDesktopStore.persist.getOptions().merge;
    expect(merge).toBeDefined();

    const persistedState = {
      hudWidgets: [
        { type: 'agent-sessions', visible: true, position: { x: 10, y: 20 }, size: { width: 400, height: 320 } },
      ],
    };
    const currentState = useDesktopStore.getInitialState();
    const merged = (merge as (p: unknown, c: unknown) => any)(persistedState, currentState);

    const sessions = merged.hudWidgets.find((w: { type: string }) => w.type === 'agent-sessions');
    expect(sessions.size).toEqual({ width: 400, height: 320 });
    expect(sessions.position).toEqual({ x: 10, y: 20 });

    // A widget with no persisted entry keeps its default (no size — component falls back to WIDGET_META)
    const pipeline = merged.hudWidgets.find((w: { type: string }) => w.type === 'auto-chat');
    expect(pipeline.size).toBeUndefined();
  });

  it('does not introduce a stray size key when the saved widget never had one', () => {
    const merge = useDesktopStore.persist.getOptions().merge;
    const persistedState = {
      hudWidgets: [
        { type: 'notifications', visible: true, position: { x: 5, y: 5 } },
      ],
    };
    const currentState = useDesktopStore.getInitialState();
    const merged = (merge as (p: unknown, c: unknown) => any)(persistedState, currentState);
    const notifs = merged.hudWidgets.find((w: { type: string }) => w.type === 'notifications');
    expect(notifs.size).toBeUndefined();
    expect('size' in notifs).toBe(false);
  });
});

// ─── Settings — modelPolicy (WS2 smart routing) ────────────────────

describe('Settings — modelPolicy (WS2)', () => {
  it('defaults to {mode: "fixed"} — today\'s behavior, unchanged', () => {
    expect(useDesktopStore.getState().settings.modelPolicy).toEqual({ mode: 'fixed' });
  });

  it('setModelPolicy updates settings.modelPolicy to smart-local with a strategy', () => {
    useDesktopStore.getState().setModelPolicy({ mode: 'smart-local', strategy: 'best-value' });
    expect(useDesktopStore.getState().settings.modelPolicy).toEqual({ mode: 'smart-local', strategy: 'best-value' });
  });

  it('setModelPolicy updates settings.modelPolicy to smart-external', () => {
    useDesktopStore.getState().setModelPolicy({ mode: 'smart-external' });
    expect(useDesktopStore.getState().settings.modelPolicy).toEqual({ mode: 'smart-external' });
  });

  it('setModelPolicy leaves the rest of the settings slice untouched', () => {
    useDesktopStore.getState().updateSettings({ tourCompleted: true });
    useDesktopStore.getState().setModelPolicy({ mode: 'smart-local', strategy: 'fastest' });
    const { settings } = useDesktopStore.getState();
    expect(settings.tourCompleted).toBe(true);
    expect(settings.modelPolicy).toEqual({ mode: 'smart-local', strategy: 'fastest' });
  });

  it('updateSettings can also set modelPolicy directly (generic patch path)', () => {
    useDesktopStore.getState().updateSettings({ modelPolicy: { mode: 'smart-external' } });
    expect(useDesktopStore.getState().settings.modelPolicy).toEqual({ mode: 'smart-external' });
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
    const winId = addTestWindow();
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
    const winId = addTestWindow();
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

    const winId = addTestWindow();
    const winZ = useDesktopStore.getState().windows.find(w => w.id === winId)!.zIndex!;
    expect(winZ).toBeGreaterThan(highMentalZ);
  });

  it('focusWindow (on existing window) rises above mentalZ', () => {
    const winId = addTestWindow();
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

// ─── Boards (Figma-like multiple canvases) ────────────────────────

describe('Boards — defaults', () => {
  it('starts with a single default board and activeBoardId pointing at it', () => {
    const { boards, activeBoardId } = useDesktopStore.getState();
    expect(boards).toHaveLength(1);
    expect(boards[0]).toMatchObject({ id: 'board-1', name: 'Board 1', snapshot: null });
    expect(activeBoardId).toBe('board-1');
  });
});

describe('Boards — switch round-trip', () => {
  it('createBoard empties the canvas (zoom 1, pan 0,0); switching back restores board-1 graph+pan+zoom, and board-2 keeps its edits', () => {
    const store = useDesktopStore.getState();

    // Seed board-1 (active by default) with a graph, pan, and zoom.
    const a = store.addMentalNode({ position: { x: 0, y: 0 }, width: 220, height: 120, text: 'A', color: '#EDE9FE', shape: 'square' });
    const b = store.addMentalNode({ position: { x: 300, y: 0 }, width: 220, height: 120, text: 'B', color: '#EDE9FE', shape: 'square' });
    store.addMentalEdge(a, b, 'link');
    store.setCanvasPan({ x: 50, y: 75 });
    store.setCanvasZoom(1.5);

    const board2Id = store.createBoard('Board 2');

    // createBoard switches into the new board immediately — canvas is empty.
    let state = useDesktopStore.getState();
    expect(state.activeBoardId).toBe(board2Id);
    expect(state.mentalNodes).toEqual([]);
    expect(state.mentalEdges).toEqual([]);
    expect(state.canvasPan).toEqual({ x: 0, y: 0 });
    expect(state.canvasZoom).toBe(1);

    // Edit board-2's canvas.
    const c = useDesktopStore.getState().addMentalNode({ position: { x: 10, y: 10 }, width: 220, height: 120, text: 'C', color: '#EDE9FE', shape: 'square' });
    useDesktopStore.getState().setCanvasPan({ x: 999, y: 999 });
    useDesktopStore.getState().setCanvasZoom(2);

    // Switch back to board-1 — its graph/pan/zoom must be intact.
    useDesktopStore.getState().switchBoard('board-1');
    state = useDesktopStore.getState();
    expect(state.activeBoardId).toBe('board-1');
    expect(state.mentalNodes.map(n => n.id).sort()).toEqual([a, b].sort());
    expect(state.mentalEdges).toHaveLength(1);
    expect(state.canvasPan).toEqual({ x: 50, y: 75 });
    expect(state.canvasZoom).toBe(1.5);

    // board-2's snapshot preserves the edits made while it was active.
    const board2 = state.boards.find(bd => bd.id === board2Id)!;
    expect(board2.snapshot).not.toBeNull();
    expect(board2.snapshot!.mentalNodes.map(n => n.id)).toEqual([c]);
    expect(board2.snapshot!.canvasPan).toEqual({ x: 999, y: 999 });
    expect(board2.snapshot!.canvasZoom).toBe(2);
  });

  it('switchBoard is a no-op for the currently-active board or an unknown id', () => {
    const store = useDesktopStore.getState();
    store.addMentalNode({ position: { x: 0, y: 0 }, width: 220, height: 120, text: 'keep', color: '#EDE9FE', shape: 'square' });

    useDesktopStore.getState().switchBoard('board-1'); // already active
    expect(useDesktopStore.getState().mentalNodes).toHaveLength(1);
    expect(useDesktopStore.getState().activeBoardId).toBe('board-1');

    useDesktopStore.getState().switchBoard('does-not-exist');
    const state = useDesktopStore.getState();
    expect(state.activeBoardId).toBe('board-1');
    expect(state.mentalNodes).toHaveLength(1); // untouched — no snapshot swap happened
    expect(state.boards).toHaveLength(1); // no phantom board created
  });

  it('createBoard and switchBoard reset selection, mentalZ, and editing id', () => {
    const store = useDesktopStore.getState();
    const nodeId = store.addMentalNode({ position: { x: 0, y: 0 }, width: 220, height: 120, text: '', color: '#EDE9FE', shape: 'square' });
    store.setSelectedMentalNodeIds([nodeId]);
    store.setMentalEditingNodeId(nodeId);
    store.bringMentalToFront(nodeId);
    expect(useDesktopStore.getState().selectedMentalNodeIds).toEqual([nodeId]);
    expect(useDesktopStore.getState().mentalEditingNodeId).toBe(nodeId);
    expect(useDesktopStore.getState().mentalZ[nodeId]).toBeDefined();

    store.createBoard();
    let state = useDesktopStore.getState();
    expect(state.selectedMentalNodeIds).toEqual([]);
    expect(state.mentalEditingNodeId).toBeNull();
    expect(state.mentalZ).toEqual({});

    // Switching back to board-1 also resets, even though board-2 has its own selection.
    const anotherNode = useDesktopStore.getState().addMentalNode({ position: { x: 0, y: 0 }, width: 220, height: 120, text: '', color: '#EDE9FE', shape: 'square' });
    useDesktopStore.getState().setSelectedMentalNodeIds([anotherNode]);
    useDesktopStore.getState().setMentalEditingNodeId(anotherNode);
    useDesktopStore.getState().switchBoard('board-1');
    state = useDesktopStore.getState();
    expect(state.selectedMentalNodeIds).toEqual([]);
    expect(state.mentalEditingNodeId).toBeNull();
    expect(state.mentalZ).toEqual({});
  });
});

describe('Boards — deleteBoard', () => {
  it('refuses to delete the last remaining board', () => {
    const store = useDesktopStore.getState();
    store.deleteBoard('board-1');
    const state = useDesktopStore.getState();
    expect(state.boards).toHaveLength(1);
    expect(state.boards[0].id).toBe('board-1');
    expect(state.activeBoardId).toBe('board-1');
  });

  it('deleting the active board switches to the previous neighbor and its data is gone', () => {
    const store = useDesktopStore.getState();
    const seededNodeId = store.addMentalNode({ position: { x: 0, y: 0 }, width: 220, height: 120, text: 'board1', color: '#EDE9FE', shape: 'square' });
    const board2Id = store.createBoard('Board 2'); // board-1 (inactive) now holds seededNodeId in its snapshot
    useDesktopStore.getState().addMentalNode({ position: { x: 1, y: 1 }, width: 220, height: 120, text: 'board2-only', color: '#EDE9FE', shape: 'square' });

    useDesktopStore.getState().deleteBoard(board2Id); // board2 is active — idx 1, prefers previous (board-1)
    const state = useDesktopStore.getState();
    expect(state.boards.find(b => b.id === board2Id)).toBeUndefined();
    expect(state.activeBoardId).toBe('board-1');
    // board-1's restored data is exactly what was seeded — board2's content is gone.
    expect(state.mentalNodes.map(n => n.id)).toEqual([seededNodeId]);
  });

  it('deleting the first (index 0) active board prefers the next neighbor', () => {
    const store = useDesktopStore.getState();
    const board2Id = store.createBoard('Board 2');
    useDesktopStore.getState().switchBoard('board-1'); // board-1 (index 0) is active again
    expect(useDesktopStore.getState().activeBoardId).toBe('board-1');

    useDesktopStore.getState().deleteBoard('board-1');
    const state = useDesktopStore.getState();
    expect(state.boards.find(b => b.id === 'board-1')).toBeUndefined();
    expect(state.activeBoardId).toBe(board2Id);
  });

  it('deleting an inactive board leaves the active board untouched', () => {
    const store = useDesktopStore.getState();
    const board2Id = store.createBoard('Board 2');
    const board3Id = useDesktopStore.getState().createBoard('Board 3'); // active is now board-3
    useDesktopStore.getState().addMentalNode({ position: { x: 5, y: 5 }, width: 220, height: 120, text: 'board3', color: '#EDE9FE', shape: 'square' });

    useDesktopStore.getState().deleteBoard(board2Id); // board2 is inactive
    const state = useDesktopStore.getState();
    expect(state.boards.find(b => b.id === board2Id)).toBeUndefined();
    expect(state.activeBoardId).toBe(board3Id);
    expect(state.mentalNodes).toHaveLength(1); // board-3's live content is untouched
  });
});

describe('Boards — duplicateBoard', () => {
  it('deep-copies an inactive board — mutating the copy does not affect the original, and does not switch to it', () => {
    const store = useDesktopStore.getState();
    const nodeId = store.addMentalNode({ position: { x: 0, y: 0 }, width: 220, height: 120, text: 'orig', color: '#EDE9FE', shape: 'square' });
    const board2Id = store.createBoard('Board 2'); // board-1 (inactive) now holds nodeId in its snapshot

    const copyId = useDesktopStore.getState().duplicateBoard('board-1');
    const state = useDesktopStore.getState();
    const copy = state.boards.find(b => b.id === copyId)!;
    expect(copy.name).toBe('Board 1 copy');
    expect(copy.snapshot!.mentalNodes).toHaveLength(1);
    expect(copy.snapshot!.mentalNodes[0].id).toBe(nodeId);
    expect(state.activeBoardId).toBe(board2Id); // unaffected — duplicateBoard never switches

    // Mutate the copy's node directly and confirm the original board-1 snapshot is unaffected (deep clone).
    copy.snapshot!.mentalNodes[0].text = 'mutated';
    const original = useDesktopStore.getState().boards.find(b => b.id === 'board-1')!;
    expect(original.snapshot!.mentalNodes[0].text).toBe('orig');
  });

  it('duplicating the ACTIVE board captures its LIVE top-level graph', () => {
    const store = useDesktopStore.getState();
    const nodeId = store.addMentalNode({ position: { x: 0, y: 0 }, width: 220, height: 120, text: 'live', color: '#EDE9FE', shape: 'square' });
    store.setCanvasPan({ x: 42, y: 24 });
    store.setCanvasZoom(1.75);

    const copyId = useDesktopStore.getState().duplicateBoard('board-1'); // board-1 is active
    const state = useDesktopStore.getState();
    const copy = state.boards.find(b => b.id === copyId)!;
    expect(copy.snapshot!.mentalNodes.map(n => n.id)).toEqual([nodeId]);
    expect(copy.snapshot!.canvasPan).toEqual({ x: 42, y: 24 });
    expect(copy.snapshot!.canvasZoom).toBe(1.75);
    // The live board is untouched — still active with the same data.
    expect(state.activeBoardId).toBe('board-1');
    expect(state.mentalNodes.map(n => n.id)).toEqual([nodeId]);
  });

  it('returns an empty string and does nothing for an unknown board id', () => {
    const boardsBefore = useDesktopStore.getState().boards.length;
    const result = useDesktopStore.getState().duplicateBoard('does-not-exist');
    expect(result).toBe('');
    expect(useDesktopStore.getState().boards).toHaveLength(boardsBefore);
  });
});

describe('Boards — renameBoard', () => {
  it('trims and applies the new name', () => {
    const store = useDesktopStore.getState();
    store.renameBoard('board-1', '  My Board  ');
    expect(useDesktopStore.getState().boards[0].name).toBe('My Board');
  });

  it('ignores an empty (or whitespace-only) name', () => {
    const store = useDesktopStore.getState();
    store.renameBoard('board-1', '   ');
    expect(useDesktopStore.getState().boards[0].name).toBe('Board 1');
  });
});

describe('Boards — v18 migration (boards + persisted canvasZoom)', () => {
  it('bootstraps board-1/activeBoardId and defaults canvasZoom while preserving prior fields', () => {
    const migrate = useDesktopStore.persist.getOptions().migrate;
    expect(migrate).toBeDefined();

    const persisted = {
      // 'file-explorer' rather than the old 'chat' fixture type — this test
      // is about the v18 boards-bootstrap migration, orthogonal to window
      // type; 'chat' would now be dropped entirely by the v19 migration
      // (also exercised here, since 17 < 19), which would break the
      // "prior fields survive untouched" assertion below for the wrong
      // reason (an unrelated migration, not a v18 regression).
      windows: [{ id: 'win-1', type: 'file-explorer', title: 'Files', position: { x: 0, y: 0 }, size: { width: 480, height: 500 } }],
      mentalNodes: [{ id: 'mn-1', type: 'mental', position: { x: 0, y: 0 }, width: 220, height: 120, text: 'legacy', color: '#EDE9FE', shape: 'square', createdAt: 1 }],
      mentalEdges: [],
      canvasPan: { x: 10, y: 20 },
      dockItems: [],
      grids: [],
    };

    const migrated = (migrate as (state: unknown, version: number) => any)(persisted, 17);

    expect(migrated.boards).toEqual([
      expect.objectContaining({ id: 'board-1', name: 'Board 1', snapshot: null }),
    ]);
    expect(migrated.activeBoardId).toBe('board-1');
    expect(migrated.canvasZoom).toBe(1);
    // Prior fields survive untouched — the v17 canvas becomes Board 1's live
    // top-level slices losslessly (active-slice pattern; snapshot: null).
    expect(migrated.windows).toEqual(persisted.windows);
    expect(migrated.mentalNodes).toEqual(persisted.mentalNodes);
    expect(migrated.canvasPan).toEqual({ x: 10, y: 20 });
  });

  it('does not override an already-numeric canvasZoom', () => {
    const migrate = useDesktopStore.persist.getOptions().migrate;
    const persisted = { canvasZoom: 2.5, dockItems: [], grids: [] };
    const migrated = (migrate as (state: unknown, version: number) => any)(persisted, 17);
    expect(migrated.canvasZoom).toBe(2.5);
  });

  it('chain-safe: a stale (<v14) persisted zoom is deleted by v14, then defaulted to 1 by v18 in the same pass', () => {
    const migrate = useDesktopStore.persist.getOptions().migrate;
    const persisted = {
      canvasZoom: 3, // stale zoom from a very old session
      dockItems: [
        { id: 'dock-new-chat', type: 'action', label: 'New Chat', iconName: 'MessageSquare', action: 'new-chat' },
      ],
      grids: [],
    };
    const migrated = (migrate as (state: unknown, version: number) => any)(persisted, 10);
    expect(migrated.canvasZoom).toBe(1);
    expect(migrated.boards).toEqual([expect.objectContaining({ id: 'board-1' })]);
    expect(migrated.activeBoardId).toBe('board-1');
  });
});

// ─── Backlog — F4 card<->run correlation + watcher merge ─────────

function makeBacklogCard(overrides: Partial<BacklogCard> = {}): BacklogCard {
  return {
    filename: 'card.md', taskId: 'T1', targetAgent: '', targetModule: '',
    priority: 'medium', status: 'todo', runState: 'idle', order: 0,
    tags: [], estimate: 0, assignees: [], related: [],
    createdAt: '2026-07-08T00:00:00.000Z', updatedAt: '2026-07-08T00:00:00.000Z',
    title: 'A card', description: 'Desc', comments: [], attachments: [],
    ...overrides,
  };
}

describe('mergeBacklogCards (F4 — watcher push)', () => {
  it('replaces backlogCards wholesale', () => {
    const before = [makeBacklogCard({ filename: 'a.md', taskId: 'A' })];
    const after = [makeBacklogCard({ filename: 'b.md', taskId: 'B' }), makeBacklogCard({ filename: 'c.md', taskId: 'C' })];
    useDesktopStore.setState({ backlogCards: before });
    useDesktopStore.getState().mergeBacklogCards(after);
    expect(useDesktopStore.getState().backlogCards).toEqual(after);
  });

  it('live-patches an open canvasModalCard in place when it is one of the updated cards', () => {
    const openCard = makeBacklogCard({ filename: 'open.md', taskId: 'OPEN', status: 'todo' });
    useDesktopStore.setState({ backlogCards: [openCard], canvasModalCard: openCard });

    const updated = { ...openCard, status: 'doing' as const, runState: 'running' as const };
    useDesktopStore.getState().mergeBacklogCards([updated]);

    expect(useDesktopStore.getState().canvasModalCard).toEqual(updated);
  });

  it('leaves a non-matching canvasModalCard alone (no surprise auto-close) when its card disappeared from the fresh set', () => {
    const openCard = makeBacklogCard({ filename: 'open.md', taskId: 'OPEN' });
    useDesktopStore.setState({ backlogCards: [openCard], canvasModalCard: openCard });

    const other = makeBacklogCard({ filename: 'other.md', taskId: 'OTHER' });
    useDesktopStore.getState().mergeBacklogCards([other]);

    expect(useDesktopStore.getState().canvasModalCard).toBe(openCard);
    expect(useDesktopStore.getState().backlogCards).toEqual([other]);
  });

  it('is a no-op for canvasModalCard when no modal is open', () => {
    useDesktopStore.getState().mergeBacklogCards([makeBacklogCard()]);
    expect(useDesktopStore.getState().canvasModalCard).toBeNull();
  });
});

describe('backlogRunCorrelation (F4 — card<->run correlation map)', () => {
  it('starts empty', () => {
    expect(useDesktopStore.getState().backlogRunCorrelation).toEqual({});
  });

  it('registerBacklogRunStep adds an entry keyed by stepId', () => {
    useDesktopStore.getState().registerBacklogRunStep('step-1', '/proj/.backlog', 'card.md');
    expect(useDesktopStore.getState().backlogRunCorrelation).toEqual({
      'step-1': { backlogDir: '/proj/.backlog', filename: 'card.md' },
    });
  });

  it('registerBacklogRunStep accumulates multiple entries without clobbering existing ones', () => {
    useDesktopStore.getState().registerBacklogRunStep('step-1', '/proj/.backlog', 'a.md');
    useDesktopStore.getState().registerBacklogRunStep('step-2', '/proj/.backlog', 'b.md');
    expect(useDesktopStore.getState().backlogRunCorrelation).toEqual({
      'step-1': { backlogDir: '/proj/.backlog', filename: 'a.md' },
      'step-2': { backlogDir: '/proj/.backlog', filename: 'b.md' },
    });
  });

  it('clearBacklogRunStep removes only the targeted entry', () => {
    useDesktopStore.getState().registerBacklogRunStep('step-1', '/proj/.backlog', 'a.md');
    useDesktopStore.getState().registerBacklogRunStep('step-2', '/proj/.backlog', 'b.md');
    useDesktopStore.getState().clearBacklogRunStep('step-1');
    expect(useDesktopStore.getState().backlogRunCorrelation).toEqual({
      'step-2': { backlogDir: '/proj/.backlog', filename: 'b.md' },
    });
  });

  it('clearBacklogRunStep is a no-op for an unknown stepId', () => {
    useDesktopStore.getState().registerBacklogRunStep('step-1', '/proj/.backlog', 'a.md');
    useDesktopStore.getState().clearBacklogRunStep('does-not-exist');
    expect(useDesktopStore.getState().backlogRunCorrelation).toEqual({
      'step-1': { backlogDir: '/proj/.backlog', filename: 'a.md' },
    });
  });
});
