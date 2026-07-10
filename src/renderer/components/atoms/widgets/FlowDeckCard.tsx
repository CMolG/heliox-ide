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
 *
 * TODO(design): Card surface is provisional pending the upcoming visual
 * refresh. Hold the line on adding more inline styles — the redesign will
 * replace this layer wholesale. See DraggableCard.tsx for the broader anchor.
 */
import React, { useCallback } from 'react';
import { useDesktopStore } from '@/renderer/store/desktop-store';
import { useFluxorStore } from '@/renderer/store';
import { useHarnessStore } from '@/renderer/store/harness-store';
import { calculateSafeInsertionPoint } from '@/renderer/store/spatial-engine';
import { LucideIcon } from '@/renderer/components/desktop/LucideIcon';
import { PRIORITY_LABELS } from './BacklogKanbanWidget';
import type { BacklogCard } from '@/types/market';

// Mirrors DEFAULT_STEP_WIDTH/HEIGHT in desktop-store.ts — see
// BacklogKanbanWidget.tsx's identical constant for the full rationale.
const STEP_WIDTH = 300;
const STEP_HEIGHT = 190;

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
  const marketInventory = useDesktopStore(s => s.marketInventory);
  const projectPath = useFluxorStore(s => s.projectPath);
  const setBacklogCards = useDesktopStore(s => s.setBacklogCards);
  const backlogCards = useDesktopStore(s => s.backlogCards);

  // chats→steps re-architecture (F0 decision 2, 2026-07-10, Task L): used to
  // open a chat window (`addWindow('chat', …)`) with the flow merely
  // attached (`connectFlow`) as a ribbon — no message was ever auto-sent,
  // the user had to type one. Now materializes a real step onto the board,
  // pre-filled with the flow's own prompt (+ this card's title/body as
  // task context, from already-in-memory `card` data — no extra file read
  // needed) and runs it immediately through the harness-engine, matching
  // this button's Play-icon affordance (see the other 3 re-wired launchers
  // for the identical pattern — BacklogKanbanWidget.executeCard is the
  // canonical one).
  const launchFlow = useCallback(async (flowName: string) => {
    if (!window.fluxorAPI || !projectPath) return;

    const flowPrompt = await window.fluxorAPI.readMarketPrompt(projectPath, 'flows', flowName);
    const flowAbsPath = `${projectPath}/market/flows/${flowName}.md`;
    const wrapperPrompt = `Read the @${flowAbsPath} and begin the task "${card.title}".`;
    const instruction = [
      `--- ${flowAbsPath} ---`,
      flowPrompt ?? '(flow prompt unavailable)',
      `--- end ${flowAbsPath} ---`,
      '',
      `--- Task: ${card.title} ---`,
      card.body || '(no description)',
      `--- end task ---`,
      '',
      wrapperPrompt,
    ].join('\n');

    const dStore = useDesktopStore.getState();
    const position = calculateSafeInsertionPoint(dStore.mentalNodes, STEP_WIDTH, STEP_HEIGHT);
    const stepId = dStore.addStepNode({
      position,
      title: `${flowName} → ${card.targetModule}`,
      prompt: instruction,
    });
    const flowMeta = marketInventory?.flows.find(f => f.name === flowName);
    if (flowMeta?.betterOn) dStore.updateStepData(stepId, { model: flowMeta.betterOn });
    dStore.setSelectedMentalNodeIds([stepId]);
    dStore.updateSettings({ showInspector: true });

    await useHarnessStore.getState().runStep(stepId);
  }, [card, projectPath, marketInventory]);

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
