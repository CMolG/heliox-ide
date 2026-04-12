/**
 * FlowDeckCard.tsx — Renderer Widget Component
 *
 * Responsibility:
 * - Renders the FlowDeckCard surface in the renderer layer.
 * - Encapsulates Widget card/board behavior for dashboard-style interactions.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
import React, { useCallback } from 'react';
import { useDesktopStore } from '@/renderer/store/desktop-store';
import { useHelioxStore } from '@/renderer/store';
import { LucideIcon } from '@/renderer/components/desktop/LucideIcon';
import { PRIORITY_LABELS } from './BacklogKanbanWidget';
import type { BacklogCard } from '@/types/market';

export function FlowDeckCard({
  card,
  expanded,
  onToggle,
  onOpenModal,
  onExecute,
  finiteFlows,
  laneName,
  isSelected,
  onSelect,
}: {
  card: BacklogCard;
  expanded: boolean;
  onToggle: () => void;
  onOpenModal: () => void;
  onExecute: () => void;
  finiteFlows: { name: string; description: string }[];
  laneName: string;
  isSelected?: boolean;
  onSelect?: (filename: string, event: React.MouseEvent) => void;
}) {
  const addWindow = useDesktopStore(s => s.addWindow);
  const connectFlow = useDesktopStore(s => s.connectFlow);
  const addSession = useHelioxStore(s => s.addSession);
  const setBacklogCards = useDesktopStore(s => s.setBacklogCards);
  const backlogCards = useDesktopStore(s => s.backlogCards);

  const launchFlow = useCallback((flowName: string) => {
    const sessionId = addSession();
    const windowId = addWindow('chat', {
      title: `${flowName} → ${card.targetModule}`,
      iconName: 'Zap',
      sessionId,
    });
    connectFlow(windowId, flowName);
  }, [card, addSession, addWindow, connectFlow]);

  const deleteCard = useCallback(() => {
    setBacklogCards(backlogCards.filter(c => c.filename !== card.filename));
  }, [card.filename, backlogCards, setBacklogCards]);

  const prioInfo = PRIORITY_LABELS[card.priority] ?? { label: 'Medium', cssClass: 'med' };

  return (
    <div
      className={`fd-card${isSelected ? ' fd-selected' : ''}`}
      role="listitem"
      aria-label={`Task: ${card.title}`}
      aria-selected={isSelected}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) {
          e.stopPropagation();
          onSelect?.(card.filename, e);
        } else {
          onOpenModal();
        }
      }}
    >
      <div className="fd-cardTopRow">
        <span className={`fd-badge ${prioInfo.cssClass}`}>{prioInfo.label}</span>
        <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          {(card.status === 'pending' || card.status === 'failed') && (
            <button
              className="fd-exec"
              type="button"
              aria-label={`Execute ${card.title}`}
              title={`Execute with ${card.targetAgent}`}
              onClick={(e) => { e.stopPropagation(); onExecute(); }}
            >
              <LucideIcon name="Play" size={11} />
            </button>
          )}
          <button
            className="fd-del"
            type="button"
            aria-label="Delete card"
            onClick={(e) => { e.stopPropagation(); deleteCard(); }}
          >
            ✕
          </button>
        </div>
      </div>
      <h3>{card.title}</h3>
      {card.body && <p>{card.body.slice(0, 120)}{card.body.length > 120 ? '…' : ''}</p>}
      <div className="fd-cardFooter">
        <span>{laneName.toUpperCase().replace('_', ' ')}</span>
        <span>{card.targetAgent} → {card.targetModule}</span>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="fd-cardExpanded">
          {card.body && card.body.length > 120 && (
            <p className="fd-cardBody">{card.body}</p>
          )}
          {card.status === 'pending' && finiteFlows.length > 0 && (
            <div className="fd-cardFlows">
              {finiteFlows.map(flow => (
                <button
                  key={flow.name}
                  onClick={(e) => { e.stopPropagation(); launchFlow(flow.name); }}
                  aria-label={`Launch ${flow.name} for ${card.title}`}
                  title={flow.description}
                  className="fd-btn fd-ghost"
                  type="button"
                  style={{ fontSize: 11, padding: '4px 8px' }}
                >
                  <LucideIcon name="Play" size={10} /> {flow.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
