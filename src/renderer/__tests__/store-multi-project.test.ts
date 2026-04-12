/**
 * store-multi-project.test.ts — Renderer UI
 *
 * Architecture note:
 * This file follows the explanatory style used across the codebase:
 * explicit intent, clear boundaries, and behavior-preserving structure.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useHelioxStore } from '../store';

describe('Multi-project store', () => {
  beforeEach(() => {
    // Reset store state
    useHelioxStore.setState({
      projectPath: null,
      openProjects: [],
      sessions: [],
      nextSessionNumber: 1,
    });
  });

  it('setProjectPath adds to openProjects', () => {
    const store = useHelioxStore.getState();
    store.setProjectPath('/path/to/project-a');

    const state = useHelioxStore.getState();
    expect(state.projectPath).toBe('/path/to/project-a');
    expect(state.openProjects).toContain('/path/to/project-a');
  });

  it('addOpenProject sets as active', () => {
    const store = useHelioxStore.getState();
    store.addOpenProject('/path/to/project-b');

    const state = useHelioxStore.getState();
    expect(state.projectPath).toBe('/path/to/project-b');
    expect(state.openProjects).toContain('/path/to/project-b');
  });

  it('does not duplicate in openProjects', () => {
    const store = useHelioxStore.getState();
    store.addOpenProject('/path/to/project-a');
    store.addOpenProject('/path/to/project-a');

    const state = useHelioxStore.getState();
    expect(state.openProjects.filter(p => p === '/path/to/project-a')).toHaveLength(1);
  });

  it('removeOpenProject switches to next project', () => {
    const store = useHelioxStore.getState();
    store.addOpenProject('/path/a');
    store.addOpenProject('/path/b');

    // Active is /path/b (last added)
    expect(useHelioxStore.getState().projectPath).toBe('/path/b');

    store.removeOpenProject('/path/b');
    const state = useHelioxStore.getState();
    expect(state.openProjects).toEqual(['/path/a']);
    expect(state.projectPath).toBe('/path/a');
  });

  it('removeOpenProject sets null when last project removed', () => {
    const store = useHelioxStore.getState();
    store.addOpenProject('/path/a');
    store.removeOpenProject('/path/a');

    const state = useHelioxStore.getState();
    expect(state.openProjects).toEqual([]);
    expect(state.projectPath).toBeNull();
  });

  it('addSession associates projectId from current projectPath', () => {
    const store = useHelioxStore.getState();
    store.setProjectPath('/my/project');
    store.addSession();

    const state = useHelioxStore.getState();
    const session = state.sessions[0];
    expect(session).toBeDefined();
    expect(session.projectId).toBe('/my/project');
  });
});
