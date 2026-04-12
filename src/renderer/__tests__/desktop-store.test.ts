import { describe, it, expect, beforeEach } from 'vitest';
import { useDesktopStore } from '../store/desktop-store';

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
    expect(win.title).toMatch(/^(Copilot|claude|google|openai|custom)/);
    expect(win.iconName).toBe('Github');
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
  it('v3 migration restores backlog and mind draw dock actions when missing', () => {
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

    expect(actions).toEqual([
      'new-chat',
      'file-explorer',
      'backlog',
      'grid',
      'mental-draw-toggle',
      'marketplace',
    ]);
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
    expect(Array.isArray(migrated.mentalConnections)).toBe(true);
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
});

// ─── CLI Theming ─────────────────────────────────────────────────

describe('CLI theming', () => {
  it('defaults to copilot', () => {
    expect(useDesktopStore.getState().cliProvider).toBe('copilot');
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
    expect(useDesktopStore.getState().nextZIndex).toBe(11);
    addChat();
    expect(useDesktopStore.getState().nextZIndex).toBe(12);
  });

  it('focusWindow increments nextZIndex', () => {
    const id = addChat();
    const zBefore = useDesktopStore.getState().nextZIndex;
    useDesktopStore.getState().focusWindow(id);
    expect(useDesktopStore.getState().nextZIndex).toBe(zBefore + 1);
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

  it('spawnAttachable stores mental shape dimensions and keeps it detached from windows', () => {
    const store = useDesktopStore.getState();
    const id = store.spawnAttachable(
      'mental',
      'mental-note',
      { x: 40, y: 80 },
      { mental: { width: 300, height: 140 } }
    );
    const mental = useDesktopStore.getState().attachables.find(a => a.id === id);
    expect(mental).toBeDefined();
    expect(mental!.type).toBe('mental');
    expect(mental!.mental).toEqual({
      width: 300,
      height: 140,
      text: '',
      color: '#EDE9FE',
      shape: 'square',
    });

    const chatId = addChat();
    const attached = useDesktopStore.getState().attachToWindow(id, chatId);
    expect(attached).toBe(false);
  });
});

describe('Mental cards and line connections', () => {
  it('defaults to off mental mode', () => {
    expect(useDesktopStore.getState().mentalMode).toBe('off');
  });

  it('updates mental card text and color', () => {
    const store = useDesktopStore.getState();
    const id = store.spawnAttachable('mental', 'mental-note', { x: 20, y: 30 }, { mental: { width: 260, height: 130 } });
    store.updateMentalAttachableText(id, 'Architecture note');
    store.updateMentalAttachableColor(id, '#A855F7');
    const mental = useDesktopStore.getState().attachables.find((a) => a.id === id);
    expect(mental?.mental?.text).toBe('Architecture note');
    expect(mental?.mental?.color).toBe('#A855F7');
  });

  it('creates undirected connections and rejects duplicates/self-links', () => {
    const store = useDesktopStore.getState();
    const a = store.spawnAttachable('mental', 'a', { x: 0, y: 0 });
    const b = store.spawnAttachable('mental', 'b', { x: 200, y: 100 });
    const first = store.addMentalConnection(a, b);
    expect(first).toBeTruthy();
    const duplicateReverse = store.addMentalConnection(b, a);
    const self = store.addMentalConnection(a, a);
    expect(duplicateReverse).toBeNull();
    expect(self).toBeNull();
    expect(useDesktopStore.getState().mentalConnections).toHaveLength(1);
  });

  it('removes touching lines when removing a mental card', () => {
    const store = useDesktopStore.getState();
    const a = store.spawnAttachable('mental', 'a', { x: 0, y: 0 });
    const b = store.spawnAttachable('mental', 'b', { x: 200, y: 100 });
    const connId = store.addMentalConnection(a, b);
    expect(connId).toBeTruthy();
    expect(useDesktopStore.getState().mentalConnections).toHaveLength(1);
    store.removeAttachable(a);
    expect(useDesktopStore.getState().mentalConnections).toHaveLength(0);
  });
});

// ─── Mental Graph (React Flow directed edges) ────────────────────

describe('Mental Graph nodes and directed edges', () => {
  it('defaults to select mental tool', () => {
    expect(useDesktopStore.getState().mentalTool).toBe('select');
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
