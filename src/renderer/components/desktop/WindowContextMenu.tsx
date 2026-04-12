/**
 * WindowContextMenu.tsx — Renderer Desktop Surface Component
 *
 * Responsibility:
 * - Renders the WindowContextMenu surface in the renderer layer.
 * - Encapsulates Desktop canvas/window composition within the renderer workspace.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/desktop/WindowContextMenu.tsx — Right-click context menu for windows
import React from 'react';
import { LucideIcon } from './LucideIcon';
import { theme } from '../../logic/theme';

export interface ContextMenuItem {
  label: string;
  action: () => void;
  icon: string;
  color?: string;
}

export function WindowContextMenu({ items, position, onClose }: {
  items: ContextMenuItem[];
  position: { x: number; y: number };
  onClose: () => void;
}) {
  return (
    <div
      data-testid="window-context-menu"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 10001 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute', left: position.x, top: position.y,
          background: theme.surfaceCard, borderRadius: 8,
          border: `1px solid ${theme.borderLight}`,
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          padding: '4px 0', minWidth: 180,
        }}
      >
        {items.map((item, i) => (
          <button
            key={i}
            data-testid={`ctx-menu-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
            onClick={() => { item.action(); onClose(); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              width: '100%', padding: '7px 12px',
              background: 'none', border: 'none', cursor: 'pointer',
              color: item.color ?? theme.textSecondary,
              fontSize: 12, fontFamily: theme.fontInter,
              textAlign: 'left',
            }}
            onMouseEnter={(e) => { (e.target as HTMLElement).style.background = `rgba(255,255,255,0.05)`; }}
            onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'none'; }}
          >
            <LucideIcon name={item.icon} size={13} style={{ opacity: 0.7, flexShrink: 0 }} />
            {item.label}
          </button>
        ))}
        {items.length === 0 && (
          <div style={{ padding: '8px 12px', color: theme.textGhost, fontSize: 12 }}>
            No actions available
          </div>
        )}
      </div>
    </div>
  );
}
