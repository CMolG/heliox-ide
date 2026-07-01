/**
 * HelpModal.tsx — Renderer Modal Component
 *
 * Responsibility:
 * - Renders the HelpModal surface in the renderer layer.
 * - Encapsulates Modal dialog composition and modal-scoped interactions.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/HelpModal.tsx — IDE documentation with sidebar navigation
import React, { useState, useCallback, useEffect } from 'react';
import { useHelioxStore } from '../../store';
import { useDesktopStore } from '../../store/desktop-store';
import { VscRocket, VscComment, VscRefresh, VscPerson, VscSettingsGear, VscGraph, VscPlay } from 'react-icons/vsc';
import { FiCommand } from 'react-icons/fi';
import { theme } from '../../logic/theme';
import { SectionContent } from './HelpSectionContent';
import type { DocSection } from './HelpSectionContent';

const SECTIONS: { id: DocSection; label: string; icon: React.ReactNode }[] = [
  { id: 'overview', label: 'Getting Started', icon: <VscRocket size={14} /> },
  { id: 'sessions', label: 'Sessions', icon: <VscComment size={14} /> },
  { id: 'flows', label: 'E2E Flows', icon: <VscRefresh size={14} /> },
  { id: 'roles', label: 'Roles', icon: <VscPerson size={14} /> },
  { id: 'pipelines', label: 'Pipelines', icon: <VscGraph size={14} /> },
  { id: 'shortcuts', label: 'Shortcuts', icon: <FiCommand size={14} /> },
  { id: 'settings', label: 'Settings', icon: <VscSettingsGear size={14} /> },
];

export function HelpModal() {
  const { showHelp, setShowHelp } = useHelioxStore();
  const setActiveTutorial = useDesktopStore(s => s.setActiveTutorial);
  const updateDesktopSettings = useDesktopStore(s => s.updateSettings);
  const [activeSection, setActiveSection] = useState<DocSection>('overview');

  const handleClose = useCallback(() => {
    setShowHelp(false);
  }, [setShowHelp]);

  const handleTakeTour = useCallback(() => {
    // Same on-demand trigger Settings › Tutorials uses — the workspace tour
    // no longer auto-launches, so this is now the primary way to (re)start it.
    updateDesktopSettings({ tourCompleted: false, tutorialCompleted: {} });
    setActiveTutorial('workspace');
    handleClose();
  }, [updateDesktopSettings, setActiveTutorial, handleClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [handleClose]);

  if (!showHelp) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div
        className="w-190 max-h-[80vh] rounded-3xl flex overflow-hidden"
        style={{ background: theme.surfaceMid, border: `1px solid ${theme.borderMedium}` }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-modal-title"
      >
        {/* Sidebar */}
        <nav
          className="w-50 shrink-0 flex flex-col py-6 px-3 gap-1 overflow-y-auto"
          style={{ background: theme.bgDeep, borderRight: `1px solid ${theme.border}` }}
          aria-label="Help sections"
        >
          <div className="flex items-center gap-2 px-3 mb-4">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="4" fill="#a3a3a3" />
              <circle cx="10" cy="10" r="8" stroke="#a3a3a3" strokeWidth="1" opacity="0.3" />
            </svg>
            <span id="help-modal-title" className="text-sm font-bold" style={{ fontFamily: theme.fontGrotesk, color: theme.textSecondary }}>
              Heliox Docs
            </span>
          </div>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition"
              role="tab"
              aria-selected={activeSection === s.id}
              style={{
                background: activeSection === s.id ? 'rgba(214,211,209,0.08)' : 'transparent',
                color: activeSection === s.id ? theme.textPrimary : theme.textDim,
              }}
            >
              <span className="text-sm">{s.icon}</span>
              <span className="text-xs font-medium" style={{ fontFamily: theme.fontGrotesk }}>
                {s.label}
              </span>
            </button>
          ))}

          <div className="flex-1" />

          <button
            onClick={handleTakeTour}
            data-testid="help-take-the-tour"
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition hover:bg-white/3"
            style={{ color: theme.accentBlue }}
            aria-label="Take the guided workspace tour"
          >
            <span className="text-sm"><VscPlay size={14} /></span>
            <span className="text-xs font-medium" style={{ fontFamily: theme.fontGrotesk }}>Take the tour</span>
          </button>

          <button
            onClick={handleClose}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-left transition hover:bg-white/3"
            style={{ color: theme.textFaint }}
            aria-label="Close help"
          >
            <span className="text-sm">✕</span>
            <span className="text-xs" style={{ fontFamily: theme.fontInter }}>Close</span>
          </button>
        </nav>

        {/* Content */}
        <div className="flex-1 p-8 overflow-y-auto">
          <SectionContent section={activeSection} />
        </div>
      </div>
    </div>
  );
}
