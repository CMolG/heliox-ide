/**
 * SettingsModal.tsx — Renderer Modal Component
 *
 * Responsibility:
 * - Renders the SettingsModal surface in the renderer layer.
 * - Encapsulates Modal dialog composition and modal-scoped interactions.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/SettingsModal.tsx — App settings modal (white/light theme)
import React, { useCallback, useEffect, useState } from 'react';
import { useHelioxStore } from '../../store';
import { useDesktopStore } from '../../store/desktop-store';
import { ToggleSetting } from './ToggleSetting';
import { ProvidersSection } from './ProvidersSection';
import type { TutorialScenarioId } from '@/types/tutorial';
import { TUTORIAL_SCENARIOS } from '../desktop/tutorial/TutorialScenarios';

function RemoteControlSection() {
  const {
    bridgeRunning, bridgePin, bridgeUrl, bridgeQrDataUrl, bridgeLocalIp, bridgePort,
    setBridgeState, clearBridgeState, addToast,
  } = useHelioxStore();
  const [loading, setLoading] = useState(false);

  const handleToggle = async () => {
    if (!window.helioxAPI) return;
    setLoading(true);
    try {
      if (bridgeRunning) {
        await window.helioxAPI.bridgeStop();
        clearBridgeState();
        addToast('Remote bridge stopped', 'info');
      } else {
        const result = await window.helioxAPI.bridgeStart();
        if (result.success) {
          setBridgeState({
            running: true,
            pin: result.pin,
            url: result.url,
            qrDataUrl: result.qrDataUrl,
            localIp: result.localIp,
            port: result.port,
          });
          addToast('Remote bridge started — scan QR to connect', 'success');
        } else {
          addToast(`Bridge failed: ${result.error}`, 'error');
        }
      }
    } catch {
      addToast('Failed to toggle bridge', 'error');
    }
    setLoading(false);
  };

  const handleRefreshPin = async () => {
    if (!window.helioxAPI || !bridgeRunning) return;
    setLoading(true);
    try {
      // Restart to get a new PIN
      await window.helioxAPI.bridgeStop();
      const result = await window.helioxAPI.bridgeStart();
      if (result.success) {
        setBridgeState({
          running: true,
          pin: result.pin,
          url: result.url,
          qrDataUrl: result.qrDataUrl,
          localIp: result.localIp,
          port: result.port,
        });
        addToast('PIN refreshed', 'info');
      }
    } catch {
      addToast('Failed to refresh PIN', 'error');
    }
    setLoading(false);
  };

  return (
    <div className="settings-section">
      <span className="settings-section-label">Remote Control</span>
      <div className="settings-row" style={{ alignItems: 'flex-start' }}>
        <div className="settings-row-copy" style={{ flex: 1 }}>
          <span className="settings-toggle-label">Mobile Bridge</span>
          <span className="settings-toggle-desc">
            Access sessions from your phone via local WiFi
          </span>
        </div>
        <button
          className={`settings-outline-btn ${bridgeRunning ? 'settings-bridge-active' : ''}`}
          onClick={handleToggle}
          disabled={loading}
          data-testid="settings-bridge-toggle"
          style={{
            borderColor: bridgeRunning ? '#4caf50' : undefined,
            color: bridgeRunning ? '#4caf50' : undefined,
          }}
        >
          {loading ? '...' : bridgeRunning ? 'Stop' : 'Start'}
        </button>
      </div>

      {bridgeRunning && bridgeQrDataUrl && (
        <div
          className="settings-bridge-qr"
          data-testid="settings-bridge-qr"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
            marginTop: 12,
            padding: 16,
            borderRadius: 12,
            background: '#0a0a0f',
            border: '1px solid #1e1e28',
          }}
        >
          <img
            src={bridgeQrDataUrl}
            alt="QR code for mobile companion"
            style={{ width: 180, height: 180, borderRadius: 8 }}
          />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: '#6b6b80', marginBottom: 4 }}>
              Scan with your phone camera
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#e0e0e8', wordBreak: 'break-all' }}>
              {bridgeUrl}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: '#6b6b80', textTransform: 'uppercase', letterSpacing: 1 }}>PIN</div>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 20,
                fontWeight: 700,
                letterSpacing: 4,
                color: '#e0e0e8',
              }}>
                {bridgePin}
              </div>
            </div>
            <button
              className="settings-outline-btn"
              onClick={handleRefreshPin}
              disabled={loading}
              style={{ fontSize: 10, padding: '3px 8px', borderColor: '#333', color: '#888' }}
            >
              Refresh PIN
            </button>
          </div>
          <div style={{ fontSize: 10, color: '#6b6b80' }}>
            {bridgeLocalIp}:{bridgePort}
          </div>
        </div>
      )}
    </div>
  );
}

const TUTORIAL_GROUPS: { label: string; ids: TutorialScenarioId[] }[] = [
  { label: 'Workspace', ids: ['workspace'] },
  { label: 'Market Items', ids: ['roles', 'mods', 'flows'] },
  { label: 'Apps', ids: ['chat', 'file-explorer', 'backlog', 'marketplace', 'diff-viewer', 'file-viewer'] },
];

export function SettingsModal() {
  const { appSettings, updateAppSettings, showSettings, setShowSettings, addToast } = useHelioxStore();
  const desktopSettings = useDesktopStore(s => s.settings);
  const updateDesktopSettings = useDesktopStore(s => s.updateSettings);
  const setActiveTutorial = useDesktopStore(s => s.setActiveTutorial);
  const [confirmReset, setConfirmReset] = React.useState(false);

  const handleClose = useCallback(() => {
    setShowSettings(false);
  }, [setShowSettings]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [handleClose]);

  if (!showSettings) return null;

  return (
    <div
      className="settings-modal-backdrop"
      data-testid="settings-modal-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        className="settings-modal"
        data-testid="settings-modal"
      >
        {/* Header */}
        <div className="settings-modal-header">
          <span id="settings-modal-title" className="settings-modal-title">Settings</span>
          <button
            onClick={handleClose}
            className="settings-modal-close"
            aria-label="Close settings"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M1 1l10 10M11 1l-10 10" stroke="#888" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Provider Picker — runs through OpenCode */}
        <ProvidersSection
          selectedProvider={appSettings.selectedProvider ?? 'opencode'}
          selectedModel={appSettings.selectedModel ?? 'opencode/claude-sonnet-4-6'}
          onSelect={(providerId, model) => {
            updateAppSettings({ selectedProvider: providerId, selectedModel: model });
            useDesktopStore.getState().setCliProvider(providerId);
          }}
        />

        <div className="settings-divider" />

        {/* Behavior Toggles */}
        <div className="settings-section">
          <span className="settings-section-label">Behavior</span>
          <ToggleSetting
            label="Auto-commit after agent run"
            description="Automatically git commit changes when the agent completes"
            value={appSettings.autoCommit}
            onChange={(v) => updateAppSettings({ autoCommit: v })}
          />
          <ToggleSetting
            label="Run E2E validation"
            description="Run E2E flow snapshots after agent changes"
            value={appSettings.runE2E}
            onChange={(v) => updateAppSettings({ runE2E: v })}
          />
          <ToggleSetting
            label="Send on Enter"
            description="Send messages with Enter key instead of Shift+Enter"
            value={appSettings.sendOnEnter}
            onChange={(v) => updateAppSettings({ sendOnEnter: v })}
          />
          <ToggleSetting
            label="Stupidity Mode"
            description="Force AI outputs to the +3σ extreme of the quality bell curve — genius-level answers explained simply"
            value={appSettings.stupidityMode}
            onChange={(v) => updateAppSettings({ stupidityMode: v })}
          />
        </div>

        <div className="settings-divider" />

        {/* Desktop / Canvas */}
        <div className="settings-section">
          <span className="settings-section-label">Desktop</span>
          <ToggleSetting
            label="Canvas click animation"
            description="Show wave animation when clicking the desktop background"
            value={desktopSettings.canvasClickAnimation}
            onChange={(v) => updateDesktopSettings({ canvasClickAnimation: v })}
            testId="settings-toggle-click-anim"
          />
        </div>

        <div className="settings-divider" />

        {/* Tutorials */}
        <div className="settings-section">
          <div className="settings-row-copy" style={{ marginBottom: 8 }}>
            <span className="settings-toggle-label">Tutorials</span>
            <span className="settings-toggle-desc">Replay guided walkthroughs for workspace, market items, and apps</span>
          </div>
          {TUTORIAL_GROUPS.map(group => (
            <div key={group.label} style={{ marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: '#888', display: 'block', marginBottom: 4 }}>
                {group.label}
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {group.ids.map(id => {
                  const sc = TUTORIAL_SCENARIOS[id];
                  if (!sc) return null;
                  const completed = desktopSettings.tutorialCompleted?.[id];
                  return (
                    <button
                      key={id}
                      className="settings-outline-btn"
                      data-testid={`settings-tutorial-${id}`}
                      style={{
                        fontSize: 11,
                        padding: '4px 10px',
                        borderColor: completed ? '#ccc' : '#111',
                        color: completed ? '#999' : '#111',
                      }}
                      onClick={() => {
                        // Reset this scenario + global tourCompleted if workspace
                        const updatedProgress = { ...desktopSettings.tutorialCompleted, [id]: false };
                        const patch: any = { tutorialCompleted: updatedProgress };
                        if (id === 'workspace') patch.tourCompleted = false;
                        updateDesktopSettings(patch);
                        setActiveTutorial(id);
                        handleClose();
                        addToast(`Starting ${sc.label} tutorial`, 'info');
                      }}
                    >
                      {sc.label} {completed ? '✓' : ''}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <button
            className="settings-outline-btn"
            data-testid="settings-repeat-tour"
            style={{ marginTop: 4 }}
            onClick={() => {
              updateDesktopSettings({ tourCompleted: false, tutorialCompleted: {} });
              setActiveTutorial('workspace');
              handleClose();
              addToast('Quick tour will start now', 'info');
            }}
          >
            Replay all tutorials
          </button>
        </div>

        <div className="settings-divider" />

        {/* Onboarding */}
        <div className="settings-section settings-row">
          <div className="settings-row-copy">
            <span className="settings-toggle-label">Onboarding tips</span>
            <span className="settings-toggle-desc">Re-show the getting-started walkthrough</span>
          </div>
          <button
            className="settings-outline-btn"
            onClick={() => {
              updateAppSettings({ onboardingDone: false });
              addToast('Tips will show on next project open', 'info');
            }}
          >
            Show tips again
          </button>
        </div>

        <div className="settings-divider" />

        {/* Remote Control */}
        <RemoteControlSection />

        <div className="settings-divider" />

        {/* Danger Zone — Hard Reset */}
        <div className="settings-section settings-row">
          <div className="settings-row-copy">
            <span className="settings-toggle-label" style={{ color: '#ef4444' }}>Hard Reset</span>
            <span className="settings-toggle-desc">
              Wipe all databases &amp; settings. Use when you hit migration issues or want a clean slate.
            </span>
          </div>
          {confirmReset ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                className="settings-outline-btn"
                style={{ borderColor: '#ef4444', color: '#ef4444' }}
                data-testid="settings-hard-reset-confirm"
                onClick={async () => {
                  // Delete electron-store config + app.db via IPC (backend first)
                  try { await window.helioxAPI?.appHardReset?.(); } catch (_) {}
                  // Use Zustand's persist API to clear storage and prevent writeback
                  useDesktopStore.persist.clearStorage();
                  useHelioxStore.persist.clearStorage();
                  // Belt-and-suspenders: also wipe all localStorage
                  localStorage.clear();
                  window.location.reload();
                }}
              >
                Confirm
              </button>
              <button
                className="settings-outline-btn"
                onClick={() => setConfirmReset(false)}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              className="settings-outline-btn"
              style={{ borderColor: '#ef4444', color: '#ef4444' }}
              data-testid="settings-hard-reset-btn"
              onClick={() => setConfirmReset(true)}
            >
              Reset all
            </button>
          )}
        </div>

        <div className="settings-divider" />

        {/* Footer */}
        <div className="settings-footer">
          <div>
            <span className="settings-footer-brand">
              Heliox <span className="settings-footer-sub">(HeO₂)</span>
            </span>
            <span className="settings-footer-version">v0.1.0 — AI Agent IDE</span>
          </div>
          <button className="settings-done-btn" onClick={handleClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
