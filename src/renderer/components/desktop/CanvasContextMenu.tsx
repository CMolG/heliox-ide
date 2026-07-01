/**
 * CanvasContextMenu.tsx — Renderer Desktop Surface Component
 *
 * Responsibility:
 * - Renders the CanvasContextMenu surface in the renderer layer.
 * - Encapsulates Desktop canvas/window composition within the renderer workspace.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
import React from 'react';
import { LucideIcon } from './LucideIcon';
import { theme } from '../../logic/theme';

export interface CanvasContextMenuAction {
  label: string;
  icon: string;
  action: string;
  dividerAfter?: boolean;
}

const CANVAS_ACTIONS: CanvasContextMenuAction[] = [
  { label: 'New Chat Window', icon: 'MessageSquare', action: 'new-chat' },
  { label: 'New File Explorer', icon: 'FileText', action: 'file-explorer' },
  { label: 'New Backlog Board', icon: 'KanbanSquare', action: 'backlog' },
  { label: 'Enable Mental Authoring', icon: 'PenTool', action: 'mental-draw-toggle', dividerAfter: true },
  { label: 'Open Marketplace', icon: 'Store', action: 'marketplace', dividerAfter: true },
  ...(import.meta.env.DEV ? [
    { label: 'Prompt Dev Zone', icon: 'FlaskConical', action: 'prompt-dev-zone', dividerAfter: true } as CanvasContextMenuAction,
  ] : []),
  { label: 'Arrange Components', icon: 'Grid2x2', action: 'arrange' },
  { label: 'Stack Components', icon: 'Layers', action: 'stack' },
  { label: 'Reset Canvas View', icon: 'Maximize2', action: 'reset-view' },
];

interface CanvasContextMenuProps {
  position: { x: number; y: number };
  onAction: (action: string) => void;
  onClose: () => void;
}

export function CanvasContextMenu({ position, onAction, onClose }: CanvasContextMenuProps) {
  return (
    <div
      data-testid="canvas-context-menu-backdrop"
      onClick={onClose}
      onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 10001 }}
    >
      <div
        data-testid="canvas-context-menu"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          left: position.x,
          top: position.y,
          background: theme.surfaceCard,
          borderRadius: 10,
          border: `1px solid ${theme.borderLight}`,
          boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
          padding: '4px 0',
          minWidth: 200,
        }}
      >
        {CANVAS_ACTIONS.map((item) => (
          <React.Fragment key={item.action}>
            <button
              data-testid={`canvas-ctx-${item.action}`}
              onClick={() => { onAction(item.action); onClose(); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                padding: '8px 14px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: theme.textSecondary,
                fontSize: 12,
                fontFamily: theme.fontInter,
                textAlign: 'left',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
            >
              <LucideIcon name={item.icon} size={14} style={{ opacity: 0.6, flexShrink: 0 }} />
              {item.label}
            </button>
            {item.dividerAfter && (
              <div style={{ height: 1, margin: '4px 10px', background: theme.borderLight }} />
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
