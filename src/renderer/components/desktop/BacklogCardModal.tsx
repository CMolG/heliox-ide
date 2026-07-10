/**
 * BacklogCardModal.tsx — Renderer Desktop Surface Component
 *
 * Responsibility:
 * - Renders the BacklogCardModal surface in the renderer layer.
 * - Encapsulates Desktop canvas/window composition within the renderer workspace.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 *
 * TODO(design): The current modal styling is a known weak point and will be
 * replaced as part of the backlog-card redesign. Don't pile on more inline
 * styles here — the redesign will rewrite this view from scratch.
 */
// src/renderer/components/desktop/BacklogCardModal.tsx — Canvas-level backlog card detail modal
import React, { useEffect, useCallback } from 'react';
import Markdown from 'react-markdown';
import { useDesktopStore } from '../../store/desktop-store';
import { useFluxorStore } from '../../store';
import { useHarnessStore } from '../../store/harness-store';
import { calculateSafeInsertionPoint } from '../../store/spatial-engine';
import { LucideIcon } from './LucideIcon';

// Mirrors DEFAULT_STEP_WIDTH/HEIGHT in desktop-store.ts — see
// BacklogKanbanWidget.tsx's identical constant for the full rationale.
const STEP_WIDTH = 300;
const STEP_HEIGHT = 190;

const PRIORITY_LABELS: Record<string, { label: string; cssClass: string }> = {
  critical: { label: 'Critical', cssClass: 'high' },
  high: { label: 'High', cssClass: 'high' },
  medium: { label: 'Medium', cssClass: 'med' },
  low: { label: 'Low', cssClass: 'low' },
};

export function BacklogCardModal() {
  const modalCard = useDesktopStore(s => s.canvasModalCard);
  const closeModal = useDesktopStore(s => s.closeCanvasModal);
  const marketInventory = useDesktopStore(s => s.marketInventory);
  const projectPath = useFluxorStore(s => s.projectPath);

  useEffect(() => {
    if (!modalCard) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeModal(); }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [modalCard, closeModal]);

  const executeFromModal = useCallback(async () => {
    if (!modalCard || !window.fluxorAPI || !projectPath) return;

    const flowMeta = marketInventory?.flows.find(f => f.name === modalCard.targetAgent);
    if (!flowMeta) return;

    const flowPrompt = await window.fluxorAPI.readMarketPrompt(projectPath, 'flows', modalCard.targetAgent);
    if (!flowPrompt) return;

    const taskAbsPath = `${projectPath}/.backlog/${modalCard.filename}`;
    const flowAbsPath = `${projectPath}/market/flows/${modalCard.targetAgent}.md`;
    const taskContent = await window.fluxorAPI.readFile(taskAbsPath);
    if (!taskContent) return;

    const wrapperPrompt = `Read the @${flowAbsPath} and begin the @${taskAbsPath}`;
    const instruction = [
      `--- ${flowAbsPath} ---`,
      flowPrompt,
      `--- end ${flowAbsPath} ---`,
      '',
      `--- ${taskAbsPath} ---`,
      taskContent,
      `--- end ${taskAbsPath} ---`,
      '',
      wrapperPrompt,
    ].join('\n');

    // chats→steps re-architecture (F0 decision 2, 2026-07-10, Task L) — same
    // re-wiring as BacklogKanbanWidget.executeCard (the canonical version of
    // this pattern): materialize a step carrying the flow's prompt + task
    // content, then run it through the harness-engine instead of opening a
    // chat window via the old agent-manager `runAgent` IPC.
    const dStore = useDesktopStore.getState();
    const position = calculateSafeInsertionPoint(dStore.mentalNodes, STEP_WIDTH, STEP_HEIGHT);
    const stepId = dStore.addStepNode({
      position,
      title: `${modalCard.targetAgent} → ${modalCard.title}`,
      prompt: instruction,
    });
    if (flowMeta.betterOn) dStore.updateStepData(stepId, { model: flowMeta.betterOn });
    dStore.setSelectedMentalNodeIds([stepId]);
    dStore.updateSettings({ showInspector: true });

    // Update card status
    const updatedCards = dStore.backlogCards.map(c =>
      c.filename === modalCard.filename ? { ...c, status: 'in_progress' as const } : c
    );
    dStore.setBacklogCards(updatedCards);

    closeModal();

    // Runs through the harness-engine (per-step run) — runStep never
    // throws; failures surface via harness-store's executionStatus, already
    // bridged to a toast in App.tsx.
    await useHarnessStore.getState().runStep(stepId);
  }, [modalCard, projectPath, marketInventory, closeModal]);

  if (!modalCard) return null;

  const canExecute = (modalCard.status === 'pending' || modalCard.status === 'failed')
    && !!marketInventory?.flows.find(f => f.name === modalCard.targetAgent);

  return (
    <div
      className="fd-modalBackdrop"
      data-testid="backlog-card-modal"
      onClick={closeModal}
    >
      <div
        className="fd-modal"
        style={{ position: 'relative' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="fd-modalClose"
          onClick={closeModal}
          aria-label="Close modal"
        >
          ✕
        </button>
        <h2>{modalCard.title}</h2>
        <div className="fd-modalMeta">
          <span className={`fd-badge ${(PRIORITY_LABELS[modalCard.priority] ?? { cssClass: 'med' }).cssClass}`}>
            {(PRIORITY_LABELS[modalCard.priority] ?? { label: 'Medium' }).label}
          </span>
          <span>{modalCard.status.toUpperCase().replace('_', ' ')}</span>
          <span>•</span>
          <span>{modalCard.targetAgent} → {modalCard.targetModule}</span>
        </div>
        {modalCard.body && (
          <div className="fd-modalBody">
            <Markdown>{modalCard.body}</Markdown>
          </div>
        )}
        <div className="fd-modalFooter">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="fd-modalLabel">
              <LucideIcon name="FileText" size={12} /> {modalCard.filename}
            </span>
            <span className="fd-modalLabel">
              <LucideIcon name="GitBranch" size={12} /> {modalCard.taskId}
            </span>
          </div>
          {canExecute && (
            <button
              className="fd-btn fd-accent"
              onClick={executeFromModal}
              type="button"
              aria-label={`Execute ${modalCard.title}`}
              title={`Execute with ${modalCard.targetAgent} on ${marketInventory?.flows.find(f => f.name === modalCard.targetAgent)?.betterOn ?? 'default model'}`}
            >
              <LucideIcon name="Play" size={12} /> Execute
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
