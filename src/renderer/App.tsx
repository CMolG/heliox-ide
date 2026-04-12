/**
 * App.tsx — Renderer Application Shell
 *
 * Responsibility:
 * - Composes the top-level Heliox renderer shell and global panels.
 * - Coordinates renderer startup effects that sync UI state with preload APIs.
 *
 * Boundaries:
 * - Owns: renderer-level layout composition and startup orchestration in the React tree
 * - Does NOT own: main-process implementation details, IPC transport internals, and persistence drivers
 *
 * Architectural role:
 * - Orchestration component in the renderer process.
 */
// src/renderer/App.tsx — Main Heliox IDE React component
import React, { useEffect, useCallback } from 'react';
import { TopBar } from './components/TopBar';
import { ProjectExplorer } from './components/ProjectExplorer';
import { ToastContainer } from './components/ui/ToastContainer';
import { SettingsModal } from './components/modals/SettingsModal';
import { HelpModal } from './components/modals/HelpModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SeamlessCanvas } from './components/desktop/SeamlessCanvas';
import { SideBar } from './components/SideBar';
import { ExpandSideBarButton } from './components/ExpandSideBarButton';
import { useHelioxStore } from './store';
import { useDesktopStore } from './store/desktop-store';
import { useAgentEvents } from '@/renderer/logic/hooks/useAgentEvents';
import { applyCliTheme } from './logic/theme';

export function App() {
  const {
    addToast, addLogEntry,
    projectPath, loadProjectConfig, setProjectPath, addRecentProject,
    addSession, setAvailableModels, appSettings, updateAppSettings,
    showSidebar, toggleSidebar,
    setSelectedSessionId, setShowSettings, setShowHelp,
    openProjects, removeOpenProject,
  } = useHelioxStore();

  const cliProvider = useDesktopStore(s => s.cliProvider);
  const addWindow = useDesktopStore(s => s.addWindow);
  const setShowMarketplace = useDesktopStore(s => s.setShowMarketplace);
  const setMarketInventory = useDesktopStore(s => s.setMarketInventory);

  // Expose stores on window for E2E testing
  useEffect(() => {
    (window as any).__HELIOX_STORE__ = useHelioxStore;
    (window as any).__DESKTOP_STORE__ = useDesktopStore;
  }, []);

  // Apply CLI theme on mount and when provider changes
  useEffect(() => {
    applyCliTheme(cliProvider);
  }, [cliProvider]);

  // Load project config when project opens
  useEffect(() => {
    if (!projectPath || !window.helioxAPI) return;
    loadProjectConfig();
  }, [projectPath, loadProjectConfig]);

  // Load market inventory so marketplace shows all flows/roles/mods
  useEffect(() => {
    if (!projectPath || !window.helioxAPI) return;
    window.helioxAPI.readMarketInventory(projectPath).then((inventory: any) => {
      if (inventory) setMarketInventory(inventory);
    }).catch(() => {});
  }, [projectPath, setMarketInventory]);

  // Auto-create session + load models when project opens
  useEffect(() => {
    if (!projectPath || !window.helioxAPI) return;

    // Auto-create a session so metadata is immediately visible
    const sessions = useHelioxStore.getState().sessions;
    if (sessions.length === 0) {
      addSession();
    }

    // Load available models from copilot CLI
    window.helioxAPI.listModels().then((models) => {
      if (models && models.length > 0) setAvailableModels(models);
    }).catch(() => {
      // IPC handler already returns fallback, this is a safety net
    });
  }, [projectPath, addSession, setAvailableModels]);

  // Onboarding sequence on first project open
  useEffect(() => {
    if (!projectPath || appSettings.onboardingDone) return;
    const tips = [
      { delay: 500, msg: 'Welcome to Heliox IDE — your AI agent workspace' },
      { delay: 2500, msg: 'Type in the chat panel to start an agent session' },
      { delay: 4500, msg: 'Define E2E flows in the Flows tab for validation' },
      { delay: 6500, msg: 'Create custom roles in the Roles tab' },
      { delay: 8500, msg: '⌘K to focus chat · ⌘O to open project · ⌘N new session' },
    ];
    const timers = tips.map(({ delay, msg }) =>
      setTimeout(() => addToast(msg, 'info'), delay)
    );
    updateAppSettings({ onboardingDone: true });
    return () => timers.forEach(clearTimeout);
  }, [projectPath, appSettings.onboardingDone, addToast, updateAppSettings]);

  // Check CLI availability when project opens
  useEffect(() => {
    if (!projectPath || !window.helioxAPI) return;

    window.helioxAPI.checkCli().then((status) => {
      if (!status.copilotInstalled && !status.ghInstalled) {
        addLogEntry({
          timestamp: Date.now(),
          level: 'warn',
          message: 'GitHub CLI (gh) not found. Install it: https://cli.github.com/',
        });
        addToast('GitHub CLI not installed — agent commands will fail', 'error');
      } else if (!status.ghCopilotInstalled) {
        addLogEntry({
          timestamp: Date.now(),
          level: 'warn',
          message: 'GitHub Copilot CLI extension not found. Install: gh extension install github/gh-copilot',
        });
        addToast('Copilot CLI extension missing — run: gh extension install github/gh-copilot', 'error');
      }
      if (!status.gitInstalled) {
        addLogEntry({
          timestamp: Date.now(),
          level: 'warn',
          message: 'Git not found. Version control features will be unavailable.',
        });
      }
      addLogEntry({
        timestamp: Date.now(),
        level: 'info',
        message: `CLI status: copilot=${status.copilotInstalled ? '✓' : '✗'} gh=${status.ghInstalled ? '✓' : '✗'} copilot-ext=${status.ghCopilotInstalled ? '✓' : '✗'} git=${status.gitInstalled ? '✓' : '✗'} node=${status.nodeInstalled ? '✓' : '✗'}`,
      });
    }).catch(() => {
      // Non-critical — silently ignore check failures
    });
  }, [projectPath, addLogEntry, addToast]);

  // Agent event listener — extracted to useAgentEvents hook
  useAgentEvents();

  // Graceful shutdown
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (window.helioxAPI) {
        window.helioxAPI.shutdown();
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Handle open-project event (works even when a project is already open)
  useEffect(() => {
    const handler = async () => {
      if (!window.helioxAPI) return;
      try {
        const path = await window.helioxAPI.openFolderDialog();
        if (path) {
          setProjectPath(path);
          addRecentProject(path);
        }
      } catch { /* user cancelled */ }
    };
    window.addEventListener('heliox:open-project', handler);
    return () => window.removeEventListener('heliox:open-project', handler);
  }, [setProjectPath, addRecentProject]);

  // Handle close-project event
  useEffect(() => {
    const handler = () => {
      if (projectPath) {
        removeOpenProject(projectPath);
      }
    };
    window.addEventListener('heliox:close-project', handler);
    return () => window.removeEventListener('heliox:close-project', handler);
  }, [projectPath, removeOpenProject]);

  // Handle switch-project event (cycle to next open project)
  useEffect(() => {
    const handler = () => {
      if (openProjects.length <= 1 || !projectPath) return;
      const idx = openProjects.indexOf(projectPath);
      const next = openProjects[(idx + 1) % openProjects.length];
      setProjectPath(next);
    };
    window.addEventListener('heliox:switch-project', handler);
    return () => window.removeEventListener('heliox:switch-project', handler);
  }, [openProjects, projectPath, setProjectPath]);

  // Global keyboard shortcuts
  const handleGlobalKeyDown = useCallback((e: KeyboardEvent) => {
    const isMeta = e.metaKey || e.ctrlKey;
    const target = e.target as HTMLElement;
    const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

    // Escape — close any open modal / marketplace
    if (e.key === 'Escape') {
      const state = useHelioxStore.getState();
      const dState = useDesktopStore.getState();
      if (dState.showMarketplace) { e.preventDefault(); dState.setShowMarketplace(false); return; }
      if (state.showSettings) { e.preventDefault(); state.setShowSettings(false); return; }
      if (state.showHelp) { e.preventDefault(); state.setShowHelp(false); return; }
      return;
    }

    // Cmd+N — new chat window (show project picker)
    if (isMeta && e.key === 'n' && !isInput) {
      e.preventDefault();
      useDesktopStore.getState().setShowProjectPicker(true, null);
      return;
    }

    // Cmd+K — focus active window chat input
    if (isMeta && e.key === 'k') {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('heliox:focus-chat'));
      return;
    }

    // Cmd+O — open project
    if (isMeta && e.key === 'o' && !isInput) {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('heliox:open-project'));
      return;
    }

    // Cmd+B — toggle file explorer sidebar
    if (isMeta && e.key === 'b' && !isInput) {
      e.preventDefault();
      toggleSidebar();
      return;
    }

    // Cmd+W — close active window
    if (isMeta && e.key === 'w' && !isInput) {
      e.preventDefault();
      const dState = useDesktopStore.getState();
      if (dState.activeWindowId) {
        dState.removeWindow(dState.activeWindowId);
      }
      return;
    }

    // Cmd+Shift+M — toggle marketplace
    if (isMeta && e.shiftKey && e.key.toLowerCase() === 'm') {
      e.preventDefault();
      setShowMarketplace(!useDesktopStore.getState().showMarketplace);
      return;
    }

    // Cmd+` — cycle windows
    if (isMeta && e.key === '`' && !isInput) {
      e.preventDefault();
      const dState = useDesktopStore.getState();
      const visible = dState.windows.filter(w => w.state !== 'minimized');
      if (visible.length <= 1) return;
      const idx = visible.findIndex(w => w.id === dState.activeWindowId);
      const next = visible[(idx + 1) % visible.length];
      if (next) dState.focusWindow(next.id);
      return;
    }

    // Cmd+/ — toggle help
    if (isMeta && e.key === '/') {
      e.preventDefault();
      const state = useHelioxStore.getState();
      state.setShowHelp(!state.showHelp);
      return;
    }

    // Cmd+C — copy active/selected windows
    if (isMeta && e.key === 'c' && !isInput) {
      const dState = useDesktopStore.getState();
      if (dState.activeWindowId || dState.selectedWindowIds.length > 0) {
        e.preventDefault();
        dState.copyWindows();
      }
      return;
    }

    // Cmd+V — paste copied windows
    if (isMeta && e.key === 'v' && !isInput) {
      const dState = useDesktopStore.getState();
      if (dState.clipboardWindows.length > 0) {
        e.preventDefault();
        dState.pasteWindows();
      }
      return;
    }
  }, [toggleSidebar, addSession, addWindow, setShowMarketplace]);

  useEffect(() => {
    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, [handleGlobalKeyDown]);

  // No project open — show project explorer
  if (!projectPath) {
    return (
      <div className="heliox-layout overflow-hidden" role="application" aria-label="Heliox IDE">
        <TopBar />
        <main>
          <ProjectExplorer />
        </main>
        <ToastContainer />
        <SettingsModal />
        <HelpModal />
      </div>
    );
  }

  return (
    <div
      className="heliox-layout overflow-hidden"
      data-sidebar={showSidebar}
      role="application"
      aria-label="Heliox IDE"
    >
      <TopBar />
      <div
        className="heliox-explorer overflow-hidden transition-all duration-200"
        style={{
          width: showSidebar ? '280px' : '0px',
          minWidth: showSidebar ? '280px' : '0px',
          opacity: showSidebar ? 1 : 0,
        }}
      >
        {showSidebar && (
          <ErrorBoundary fallbackLabel="Navigator">
            <SideBar />
          </ErrorBoundary>
        )}
      </div>
      {!showSidebar && <ExpandSideBarButton />}
      <main>
        <ErrorBoundary fallbackLabel="Desktop">
          <SeamlessCanvas />
        </ErrorBoundary>
      </main>
      <ToastContainer />
      <SettingsModal />
      <HelpModal />
    </div>
  );
}
