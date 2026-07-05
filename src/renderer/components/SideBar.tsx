/**
 * SideBar.tsx — Renderer Composite Component
 *
 * Responsibility:
 * - Renders the SideBar surface in the renderer layer.
 * - Encapsulates Feature-level composition used by the renderer shell and panels.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
import React from 'react';
import { NodeTree } from './NodeTree';
import { LucideIcon } from './desktop/LucideIcon';
import { CollapseSideBarButton } from '@/renderer/components/CollapseSideBarButton';
import { theme } from '@/renderer/logic/theme';
import { useDesktopStore } from '@/renderer/store/desktop-store';

// ─── SideBar ────────────────────────────────────────────────────

export function SideBar() {
  const windows = useDesktopStore(s => s.windows);
  const connections = useDesktopStore(s => s.connections);
  // Counts frames with a manual loop rather than `.filter(...).length`, which
  // would allocate a throwaway array on every store `set()` (pan/zoom/drag
  // ticks included) just to read its length. The selector still RECOMPUTES
  // on every tick — that part's unavoidable, we need the fresh count to know
  // whether it moved — but returning a primitive means SideBar only
  // RE-RENDERS when the flow count itself actually changes, not on every
  // unrelated mentalNodes mutation (step drags, mental-card edits, etc).
  const frameCount = useDesktopStore(s => {
    let count = 0;
    for (const node of s.mentalNodes) if (node.type === 'frame') count++;
    return count;
  });

  return (
    <div
      className="panel-border-r"
      data-testid="window-navigator"
      style={{
        height: '100%', display: 'flex', flexDirection: 'column',
        background: theme.bgDeep, overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        role="heading"
        aria-level={2}
        style={{
          padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 6,
          borderBottom: `1px solid ${theme.borderLight}`,
          fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
          letterSpacing: '0.05em', color: theme.textMuted,
        }}
      >
        <LucideIcon name="Blocks" size={13} />
        Components
        <span style={{
          marginLeft: 'auto', fontSize: 10, fontWeight: 400,
          color: theme.textGhost, marginRight: 4,
        }}>
          {windows.length + frameCount}
        </span>
      </div>

      {/* Tree */}
      <NodeTree />

      {/* Footer */}
      <div style={{
        padding: '6px 12px', borderTop: `1px solid ${theme.borderLight}`,
        fontSize: 10, color: theme.textGhost, display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span>{Math.round(useDesktopStore.getState().canvasZoom * 100)}%</span>
        <span>{connections.length} connections</span>
        <span style={{ marginLeft: 'auto' }}>
          <CollapseSideBarButton />
        </span>
      </div>
    </div>
  );
}
