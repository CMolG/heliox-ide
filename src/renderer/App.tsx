/**
 * App.tsx — Renderer Application Shell
 *
 * Responsibility:
 * - Composes the top-level Fluxor renderer shell and global panels.
 * - Coordinates renderer startup effects that sync UI state with preload APIs.
 *
 * Boundaries:
 * - Owns: renderer-level layout composition and startup orchestration in the React tree
 * - Does NOT own: main-process implementation details, IPC transport internals, and persistence drivers
 *
 * Architectural role:
 * - Orchestration component in the renderer process.
 */
// src/renderer/App.tsx — Main Fluxor IDE React component
import React, { useEffect, useCallback, useRef } from 'react';
import { TopBar } from './components/TopBar';
import { ProjectExplorer } from './components/ProjectExplorer';
import { ToastContainer } from './components/ui/ToastContainer';
import { SettingsModal } from './components/modals/SettingsModal';
import { HelpModal } from './components/modals/HelpModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SeamlessCanvas } from './components/desktop/SeamlessCanvas';
import { SideBar } from './components/SideBar';
import { ExpandSideBarButton } from './components/ExpandSideBarButton';
import { InspectorPanel } from './components/inspector/InspectorPanel';
import { ExpandInspectorButton } from './components/ExpandInspectorButton';
import { useFluxorStore } from './store';
import { useDesktopStore } from './store/desktop-store';
import { useHarnessStore, lastLogMessage } from './store/harness-store';
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
  } = useFluxorStore();

  const cliProvider = useDesktopStore(s => s.cliProvider);
  const addWindow = useDesktopStore(s => s.addWindow);
  const setShowMarketplace = useDesktopStore(s => s.setShowMarketplace);
  const setMarketInventory = useDesktopStore(s => s.setMarketInventory);
  // `!== false` (not truthy) so pre-Phase-8 persisted stores — which lack
  // `showInspector` entirely — still default to shown (see the field's doc
  // comment in desktop-store.ts).
  const settings = useDesktopStore(s => s.settings);
  const showInspector = settings.showInspector !== false;

  // Expose stores on window for E2E testing
  useEffect(() => {
    (window as any).__FLUXOR_STORE__ = useFluxorStore;
    (window as any).__DESKTOP_STORE__ = useDesktopStore;
  }, []);

  // Apply CLI theme on mount and when provider changes
  useEffect(() => {
    applyCliTheme(cliProvider);
  }, [cliProvider]);

  // Load project config when project opens
  useEffect(() => {
    if (!projectPath || !window.fluxorAPI) return;
    loadProjectConfig();
  }, [projectPath, loadProjectConfig]);

  // Load market inventory so marketplace shows all flows/roles/mods
  useEffect(() => {
    if (!projectPath || !window.fluxorAPI) return;
    window.fluxorAPI.readMarketInventory(projectPath).then((inventory: any) => {
      if (inventory) setMarketInventory(inventory);
    }).catch(() => {});
  }, [projectPath, setMarketInventory]);

  // Auto-create session + load models when project opens
  useEffect(() => {
    if (!projectPath || !window.fluxorAPI) return;

    // Auto-create a session so metadata is immediately visible
    const sessions = useFluxorStore.getState().sessions;
    if (sessions.length === 0) {
      addSession();
    }

    // Load available models from opencode (provider/model format)
    window.fluxorAPI.listModels().then((models) => {
      if (models && models.length > 0) setAvailableModels(models);
    }).catch(() => {
      // IPC handler already returns fallback, this is a safety net
    });
  }, [projectPath, addSession, setAvailableModels]);

  // Onboarding sequence on first project open. Trimmed from 5 toasts to 3:
  // dropped "Define E2E flows in the Flows tab" and "Create custom roles in
  // the Roles tab" — those tabs don't exist anymore (Roles/Mods/Flows moved
  // into the Marketplace + attachable Dock; see market/*/AGENTS.md). Stale
  // copy taught a wrong model of the UI. The remaining three still hold up:
  // "chat panel" is the same term HelpSectionContent.tsx still uses today,
  // and the ⌘K/⌘O/⌘N shortcuts are the real ones wired in
  // handleGlobalKeyDown below. (docs/competitive-analysis/experiment/ux-run/
  // 02-onboarding-disclosure.md §4)
  useEffect(() => {
    if (!projectPath || appSettings.onboardingDone) return;
    const tips = [
      { delay: 500, msg: 'Welcome to Fluxor IDE — your AI agent workspace' },
      { delay: 2500, msg: 'Type in the chat panel to start an agent session' },
      { delay: 4500, msg: '⌘K to focus chat · ⌘O to open project · ⌘N new session' },
    ];
    const timers = tips.map(({ delay, msg }) =>
      setTimeout(() => addToast(msg, 'info'), delay)
    );
    updateAppSettings({ onboardingDone: true });
    return () => timers.forEach(clearTimeout);
  }, [projectPath, appSettings.onboardingDone, addToast, updateAppSettings]);

  // Surface the harness execution error state via the existing toast system.
  // harness-store.ts's executeFlow sets `executionStatus: 'error'` on every
  // flow-start failure (missing IPC bridge, a start failure the main process
  // reports, a thrown exception), and compileCurrentCanvas/runStep/
  // runFromStep do the same for their own failures — but until now nothing
  // ever read it: no toast, no red state, nothing (docs/competitive-analysis/
  // experiment/ux-run/06-states-polish.md §1, §4). This reuses the same
  // addToast(msg, 'error') call already used elsewhere in this file (CLI
  // check below) and in useAgentEvents.ts, instead of inventing a new
  // notification system.
  //
  // Edge-triggered off prevExecutionStatusRef (was !== 'error', now ===
  // 'error') rather than level-triggered on executionStatus alone, so:
  //  - a run that fails on several steps (each StepStatusChanged keeps
  //    executionStatus at the same 'error' string) raises exactly one toast;
  //  - a second, independent failure after a successful retry (which passes
  //    back through 'compiling'/'running' first) still raises its own toast;
  //  - the clean compiling → running → completed happy path never toasts.
  // Not gated on `projectPath` — harness-store is a project-agnostic
  // singleton (see its own file header), so this stays a global safety net.
  const executionStatus = useHarnessStore((s) => s.executionStatus);
  const prevExecutionStatusRef = useRef(executionStatus);
  useEffect(() => {
    const prevStatus = prevExecutionStatusRef.current;
    prevExecutionStatusRef.current = executionStatus;
    if (executionStatus !== 'error' || prevStatus === 'error') return;
    const detail = lastLogMessage(useHarnessStore.getState().executionLogs);
    addToast(detail ? `Flow execution failed: ${detail}` : 'Flow execution failed.', 'error');
  }, [executionStatus, addToast]);

  // Check CLI availability when project opens
  useEffect(() => {
    if (!projectPath || !window.fluxorAPI) return;

    window.fluxorAPI.checkCli().then((status) => {
      if (!status.opencodeInstalled) {
        addLogEntry({
          timestamp: Date.now(),
          level: 'warn',
          message: 'opencode CLI not found. Install it: https://opencode.ai/docs/installation',
        });
        addToast('opencode CLI not installed — agent commands will fail', 'error');
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
        message: `CLI status: opencode=${status.opencodeInstalled ? `✓ ${status.opencodeVersion ?? ''}` : '✗'} git=${status.gitInstalled ? '✓' : '✗'} node=${status.nodeInstalled ? '✓' : '✗'}`,
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
      if (window.fluxorAPI) {
        window.fluxorAPI.shutdown();
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Handle open-project event (works even when a project is already open)
  useEffect(() => {
    const handler = async () => {
      if (!window.fluxorAPI) return;
      try {
        const path = await window.fluxorAPI.openFolderDialog();
        if (path) {
          setProjectPath(path);
          addRecentProject(path);
        }
      } catch { /* user cancelled */ }
    };
    window.addEventListener('fluxor:open-project', handler);
    return () => window.removeEventListener('fluxor:open-project', handler);
  }, [setProjectPath, addRecentProject]);

  // Handle close-project event
  useEffect(() => {
    const handler = () => {
      if (projectPath) {
        removeOpenProject(projectPath);
      }
    };
    window.addEventListener('fluxor:close-project', handler);
    return () => window.removeEventListener('fluxor:close-project', handler);
  }, [projectPath, removeOpenProject]);

  // Handle switch-project event (cycle to next open project)
  useEffect(() => {
    const handler = () => {
      if (openProjects.length <= 1 || !projectPath) return;
      const idx = openProjects.indexOf(projectPath);
      const next = openProjects[(idx + 1) % openProjects.length];
      setProjectPath(next);
    };
    window.addEventListener('fluxor:switch-project', handler);
    return () => window.removeEventListener('fluxor:switch-project', handler);
  }, [openProjects, projectPath, setProjectPath]);

  // M1 — Start/stop dev-server polling whenever the active project changes.
  // The main process polls candidate ports and pushes 'fluxor:dev-server-detected'
  // events; the companion effect below subscribes to those events.
  useEffect(() => {
    if (!projectPath || !window.fluxorAPI) return;
    window.fluxorAPI.startDevServerWatch(projectPath).catch(() => {/* non-critical */});
    return () => {
      window.fluxorAPI?.stopDevServerWatch().catch(() => {/* non-critical */});
    };
  }, [projectPath]);

  // M1 — Auto-open a web-preview window when a new dev server is detected.
  // Deduplication: if a 'web-preview' window is already bound to the same port
  // we skip spawning a second one (idempotent across React re-renders and hot
  // reloads that restart the dev server on the same port).
  useEffect(() => {
    if (!window.fluxorAPI) return;
    const unsub = window.fluxorAPI.onDevServerDetected(({ url, port }) => {
      const existing = useDesktopStore.getState().windows;
      const alreadyOpen = existing.some(
        w => w.type === 'web-preview' && w.boundPort === port,
      );
      if (alreadyOpen) return;
      addWindow('web-preview', { url, boundPort: port });
    });
    return unsub;
  }, [addWindow]);

  // Global keyboard shortcuts
  const handleGlobalKeyDown = useCallback((e: KeyboardEvent) => {
    const isMeta = e.metaKey || e.ctrlKey;
    const target = e.target as HTMLElement;
    const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

    // Escape — close any open modal / marketplace
    if (e.key === 'Escape') {
      const state = useFluxorStore.getState();
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
      window.dispatchEvent(new CustomEvent('fluxor:focus-chat'));
      return;
    }

    // Cmd+O — open project
    if (isMeta && e.key === 'o' && !isInput) {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('fluxor:open-project'));
      return;
    }

    // Cmd+B — toggle file explorer sidebar
    if (isMeta && e.key === 'b' && !isInput) {
      e.preventDefault();
      toggleSidebar();
      return;
    }

    // Cmd+. — toggle right-side inspector column. Reads/writes desktop-store
    // via .getState() (like the other desktop-store branches in this
    // handler) rather than the `settings` hook value above, so this
    // callback's dependency array doesn't need to change.
    if (isMeta && e.key === '.' && !isInput) {
      e.preventDefault();
      const dState = useDesktopStore.getState();
      dState.updateSettings({ showInspector: !(dState.settings.showInspector !== false) });
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
      const state = useFluxorStore.getState();
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
      <div className="fluxor-layout overflow-hidden" role="application" aria-label="Fluxor IDE">
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
      className="fluxor-layout overflow-hidden"
      data-sidebar={showSidebar}
      data-inspector={showInspector}
      role="application"
      aria-label="Fluxor IDE"
    >
      <TopBar />
      <div
        className="fluxor-explorer overflow-hidden transition-all duration-200"
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
      <div
        className="fluxor-inspector overflow-hidden transition-all duration-200"
        style={{
          width: showInspector ? '300px' : '0px',
          minWidth: showInspector ? '300px' : '0px',
          opacity: showInspector ? 1 : 0,
        }}
      >
        {showInspector && (
          <ErrorBoundary fallbackLabel="Inspector">
            <InspectorPanel />
          </ErrorBoundary>
        )}
      </div>
      {!showInspector && <ExpandInspectorButton />}
      <ToastContainer />
      <SettingsModal />
      <HelpModal />
    </div>
  );
}
