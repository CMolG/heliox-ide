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
 */
// src/renderer/components/desktop/BacklogCardModal.tsx — Canvas-level backlog card detail modal
import React, { useEffect, useCallback } from 'react';
import Markdown from 'react-markdown';
import { useDesktopStore } from '../../store/desktop-store';
import { useHelioxStore } from '../../store';
import { LucideIcon } from './LucideIcon';
import type { ChatMessage } from '@/types';

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
  const projectPath = useHelioxStore(s => s.projectPath);

  useEffect(() => {
    if (!modalCard) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeModal(); }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [modalCard, closeModal]);

  const executeFromModal = useCallback(async () => {
    if (!modalCard || !window.helioxAPI || !projectPath) return;

    const flowMeta = marketInventory?.flows.find(f => f.name === modalCard.targetAgent);
    if (!flowMeta) return;

    const flowPrompt = await window.helioxAPI.readMarketPrompt(projectPath, 'flows', modalCard.targetAgent);
    if (!flowPrompt) return;

    const taskAbsPath = `${projectPath}/.backlog/${modalCard.filename}`;
    const flowAbsPath = `${projectPath}/market/flows/${modalCard.targetAgent}.md`;
    const taskContent = await window.helioxAPI.readFile(taskAbsPath);
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

    const store = useHelioxStore.getState();
    const dStore = useDesktopStore.getState();

    const sessionId = store.addSession();
    const windowId = dStore.addWindow('chat', {
      title: `${modalCard.targetAgent} → ${modalCard.title}`,
      iconName: 'Zap',
      sessionId,
    });
    dStore.connectFlow(windowId, modalCard.targetAgent);

    const model = flowMeta.betterOn || 'copilot';
    store.setSessionModel(sessionId, model);

    const createdSession = useHelioxStore.getState().sessions.find(s => s.id === sessionId);
    if (window.helioxAPI && projectPath && createdSession) {
      window.helioxAPI.contextMapUpsertSessionNode(projectPath, {
        sessionId,
        label: `Session #${createdSession.number}: ${modalCard.title}`,
        status: 'running',
        roleId: createdSession.roleId,
      }).catch(() => {});
    }

    const effort = (flowMeta.recommendedComplexity || 'medium') as 'low' | 'medium' | 'high';

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: wrapperPrompt,
      timestamp: Date.now(),
    };
    store.addSessionMessage(sessionId, userMsg);
    store.updateSessionStatus(sessionId, 'running');
    store.updateSessionDescription(sessionId, modalCard.title);
    dStore.updateWindowTitle(windowId, modalCard.title);

    // Update card status
    const updatedCards = dStore.backlogCards.map(c =>
      c.filename === modalCard.filename ? { ...c, status: 'in_progress' as const } : c
    );
    dStore.setBacklogCards(updatedCards);

    closeModal();

    try {
      await window.helioxAPI.runAgent({
        agentId: sessionId,
        instruction,
        flows: store.flows,
        cwd: projectPath,
        contextProjectPath: projectPath,
        model,
        effort,
        aiAdapter: store.appSettings.aiAdapter ?? store.appSettings.cliAdapter,
        customCliPath: store.appSettings.customCliPath,
        autoCommit: store.appSettings.autoCommit,
        runE2E: store.appSettings.runE2E,
      });
    } catch {
      store.updateSessionStatus(sessionId, 'error');
    }
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
