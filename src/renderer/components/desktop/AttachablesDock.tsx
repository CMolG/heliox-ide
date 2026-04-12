/**
 * AttachablesDock.tsx — Renderer Desktop Surface Component
 *
 * Responsibility:
 * - Renders the AttachablesDock surface in the renderer layer.
 * - Encapsulates Desktop canvas/window composition within the renderer workspace.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/desktop/AttachablesDock.tsx — Secondary dock for roles/mods/flows
import React, { useRef, useState, useCallback } from 'react';
import { useDesktopStore } from '../../store/desktop-store';
import { LucideIcon } from './LucideIcon';

const TYPE_COLORS: Record<string, string> = {
  flows: '#A78BFA',
  roles: '#E87040',
  modifiers: '#4285F4',
};

export function AttachablesDock() {
  const availablePlugins = useDesktopStore(s => s.availablePlugins);
  const deployPlugin = useDesktopStore(s => s.deployPlugin);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Only show roles, mods, flows (not tools)
  const items = availablePlugins.filter(p =>
    p.category === 'roles' || p.category === 'modifiers' || p.category === 'flows'
  );

  const scroll = useCallback((dir: number) => {
    scrollRef.current?.scrollBy({ left: dir * 160, behavior: 'smooth' });
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="attachables-dock" data-testid="attachables-dock" role="toolbar" aria-label="Attachables dock">
      {/* Prev arrow */}
      <button
        className="attachables-dock-nav"
        onClick={() => scroll(-1)}
        aria-label="Scroll left"
      >
        <LucideIcon name="ChevronLeft" size={14} />
      </button>

      {/* Scrollable items */}
      <div className="attachables-dock-scroll" ref={scrollRef}>
        {items.map(item => {
          const borderColor = TYPE_COLORS[item.category] ?? '#888';
          return (
            <button
              key={item.id}
              className="attachables-dock-item"
              style={{ borderColor }}
              aria-label={item.name}
              onClick={() => deployPlugin(item.id)}
              onMouseEnter={() => setHoveredId(item.id)}
              onMouseLeave={() => setHoveredId(null)}
              data-testid={`attachable-dock-${item.id}`}
            >
              <LucideIcon name={item.iconName} size={18} />
              {hoveredId === item.id && (
                <div className="attachables-dock-tooltip" role="tooltip">
                  {item.name}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Next arrow */}
      <button
        className="attachables-dock-nav"
        onClick={() => scroll(1)}
        aria-label="Scroll right"
      >
        <LucideIcon name="ChevronRight" size={14} />
      </button>
    </div>
  );
}
