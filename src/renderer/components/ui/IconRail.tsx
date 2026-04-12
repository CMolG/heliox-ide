/**
 * IconRail.tsx — Renderer UI Primitive Component
 *
 * Responsibility:
 * - Renders the IconRail surface in the renderer layer.
 * - Encapsulates Reusable UI primitive used by higher-level panels and surfaces.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/IconRail.tsx — Left vertical icon sidebar connected to store tabs
import React from 'react';
import { useHelioxStore } from '../../store';
import type { NavTab } from '@/types';
import { theme } from '../../logic/theme';

interface IconButtonProps {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
}

const IconButton = React.memo(function IconButton({ icon, label, active, onClick }: IconButtonProps) {
  return (
    <button
      onClick={onClick}
      className="p-3 rounded-full transition-all cursor-pointer"
      role="tab"
      style={active ? {
        background: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 50%, rgba(255,255,255,0.06) 100%)',
        border: '1px solid rgba(255,255,255,0.12)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      } : undefined}
      aria-label={label}
      aria-selected={active}
    >
      {icon}
    </button>
  );
});

const TabIcon = React.memo(function TabIcon({ tab, active }: { tab: NavTab; active: boolean }) {
  const color = active ? theme.textTertiary : theme.textGhost;
  const size = active ? 20 : 18;

  switch (tab) {
    case 'sessions':
      return (
        <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
          <rect x="2" y="2" width="7" height="7" rx="2" fill={color} />
          <rect x="11" y="2" width="7" height="7" rx="2" fill={color} />
          <rect x="2" y="11" width="7" height="7" rx="2" fill={color} />
          <rect x="11" y="11" width="7" height="7" rx="2" fill={color} />
        </svg>
      );
    case 'flows':
      return (
        <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
          <circle cx="4" cy="4" r="2.5" stroke={color} strokeWidth="1.5"/>
          <circle cx="16" cy="10" r="2.5" stroke={color} strokeWidth="1.5"/>
          <circle cx="4" cy="16" r="2.5" stroke={color} strokeWidth="1.5"/>
          <path d="M6 5l8 4M6 15l8-4" stroke={color} strokeWidth="1.5"/>
        </svg>
      );
    case 'roles':
      return (
        <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="7" r="3.5" stroke={color} strokeWidth="1.5"/>
          <path d="M4 18c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      );
    case 'actions':
      return (
        <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
          <path d="M3 10c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2s-.9 2-2 2H5c-1.1 0-2-.9-2-2z" stroke={color} strokeWidth="1.5" fill="none"/>
          <path d="M10 3c0 0 4 3 4 7s-4 7-4 7" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
          <path d="M10 3c0 0-4 3-4 7s4 7 4 7" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      );
    case 'logs':
      return (
        <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
          <rect x="3" y="3" width="14" height="14" rx="2" stroke={color} strokeWidth="1.5"/>
          <path d="M3 8h14" stroke={color} strokeWidth="1.5"/>
          <path d="M6 12h4M6 15h6" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      );
  }
});

const TAB_LABELS: Record<NavTab, string> = {
  sessions: 'Sessions',
  flows: 'Flows',
  roles: 'Roles',
  actions: 'Actions',
  logs: 'Logs',
};

const TABS: NavTab[] = ['sessions', 'flows', 'roles', 'actions'];

export const IconRail = React.memo(function IconRail() {
  const activeTab = useHelioxStore((s) => s.activeTab);
  const setActiveTab = useHelioxStore((s) => s.setActiveTab);
  const setShowSettings = useHelioxStore((s) => s.setShowSettings);
  const projectPath = useHelioxStore((s) => s.projectPath);

  return (
    <nav
      aria-label="Main navigation"
      className="heliox-iconrail flex flex-col justify-between items-center py-8"
      style={{
        background: 'rgba(0, 0, 0, 0.6)',
        borderRight: `1px solid rgba(214, 211, 209, 0.05)`,
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
    >
      {/* Navigation tabs — only visible when a project is open */}
      <div className="flex flex-col items-center gap-8" role="tablist" aria-label="Navigation tabs">
        {projectPath && TABS.map((tab) => (
          <IconButton
            key={tab}
            icon={<TabIcon tab={tab} active={activeTab === tab} />}
            label={TAB_LABELS[tab]}
            active={activeTab === tab}
            onClick={() => setActiveTab(tab)}
          />
        ))}
      </div>

      <div className="flex flex-col items-center gap-6">
        {projectPath && (
          <IconButton
            icon={
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <circle cx="10" cy="10" r="3" stroke={theme.textGhost} strokeWidth="1.5"/>
                  <path d="M10 1v3M10 16v3M1 10h3M16 10h3M3.5 3.5l2 2M14.5 14.5l2 2M3.5 16.5l2-2M14.5 5.5l2-2" stroke={theme.textGhost} strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
            }
            label="Settings"
            onClick={() => setShowSettings(true)}
          />
        )}
      </div>
    </nav>
  );
});
