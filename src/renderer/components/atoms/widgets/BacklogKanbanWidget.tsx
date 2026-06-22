/**
 * BacklogKanbanWidget.tsx — Renderer Widget Component
 *
 * Responsibility:
 * - Renders the BacklogKanbanWidget surface in the renderer layer.
 * - Encapsulates Widget card/board behavior for dashboard-style interactions.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 *
 * TODO(design): The board + card visuals are scheduled for a full redesign.
 * Keep this widget's behavior layer (filters, DnD wiring, store hooks) stable;
 * the redesign should land as a pure styling/layout swap on top of the
 * existing data flow. Coupled files: DraggableCard, FlowDeckCard,
 * KanbanColumn, BacklogCardModal.
 */
// src/renderer/components/atoms/widgets/BacklogKanbanWidget.tsx — Multi-project Kanban with DnD & animations
import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core';
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core';
import { sortableKeyboardCoordinates, arrayMove } from '@dnd-kit/sortable';
import { useDesktopStore } from '../../../store/desktop-store';
import { useHelioxStore } from '../../../store';
import { LucideIcon } from '../../desktop/LucideIcon';
import { KanbanColumn } from './KanbanColumn';
import type { BacklogCard, BacklogStatus, BacklogPriority } from '@/types/market';
import type { ChatMessage } from '@/types';

const STATUS_COLUMNS: { key: BacklogStatus; label: string; icon: string; color: string }[] = [
  { key: 'pending', label: 'Backlog', icon: 'Clock', color: '#00e676' },
  { key: 'in_progress', label: 'In Progress', icon: 'Loader', color: '#818cf8' },
  { key: 'completed', label: 'Done', icon: 'CheckCircle', color: '#00e676' },
  { key: 'failed', label: 'Failed', icon: 'XCircle', color: '#f87171' },
];

export const PRIORITY_LABELS: Record<string, { label: string; cssClass: string }> = {
  critical: { label: 'Critical', cssClass: 'high' },
  high: { label: 'High', cssClass: 'high' },
  medium: { label: 'Medium', cssClass: 'med' },
  low: { label: 'Low', cssClass: 'low' },
};

const PRIORITY_ORDER: Record<BacklogPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

interface BacklogProject {
  projectPath: string;
  projectName: string;
  backlogPath: string;
  cardCount: number;
  isExternal: boolean;
}

interface BacklogKanbanProps {
  windowId: string;
}

// ─── Main Widget ──────────────────────────────────────────────────

export function BacklogKanbanWidget({ windowId }: BacklogKanbanProps) {
  const projectPath = useHelioxStore(s => s.projectPath);
  const backlogCards = useDesktopStore(s => s.backlogCards);
  const setBacklogCards = useDesktopStore(s => s.setBacklogCards);
  const marketInventory = useDesktopStore(s => s.marketInventory);

  // View state: 'picker' shows project list, 'kanban' shows the board
  const [view, setView] = useState<'picker' | 'kanban'>('picker');
  const [backlogs, setBacklogs] = useState<BacklogProject[]>([]);
  const [projectsWithout, setProjectsWithout] = useState<Array<{ projectPath: string; projectName: string }>>([]);
  const [selectedBacklog, setSelectedBacklog] = useState<BacklogProject | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const openCanvasModal = useDesktopStore(s => s.openCanvasModal);
  // Track cards that just moved for animation
  const [animatingCards, setAnimatingCards] = useState<Set<string>>(new Set());
  // Multi-select state for batch drag
  const [selectedCards, setSelectedCards] = useState<Set<string>>(new Set());
  // Track last clicked card for shift-range selection
  const lastClickedRef = useRef<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Scan the opened project folder for child project dirs with/without backlogs
  const scanForBacklogs = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    setError(null);
    try {
      const [found, missing] = await Promise.all([
        window.helioxAPI?.scanBacklogs(projectPath),
        window.helioxAPI?.listProjectsWithoutBacklog(projectPath),
      ]);
      const foundList = (found ?? []) as BacklogProject[];
      setBacklogs(foundList);
      setProjectsWithout(missing ?? []);

      // Auto-select if only one backlog
      if (foundList.length === 1) {
        setSelectedBacklog(foundList[0]);
        setView('kanban');
      } else if (foundList.length > 1) {
        setView('picker');
      } else {
        setView('picker');
      }
    } catch {
      setError('Failed to scan projects');
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  // Load cards for selected backlog
  const loadCards = useCallback(async () => {
    if (!selectedBacklog) return;
    setLoading(true);
    setError(null);
    try {
      const cards = await window.helioxAPI?.readBacklogDir(selectedBacklog.backlogPath);
      setBacklogCards((cards ?? []) as BacklogCard[]);
    } catch {
      setError('Failed to read backlog');
    } finally {
      setLoading(false);
    }
  }, [selectedBacklog, setBacklogCards]);

  useEffect(() => { scanForBacklogs(); }, [scanForBacklogs]);
  useEffect(() => { if (selectedBacklog) loadCards(); }, [loadCards, selectedBacklog]);

  // Auto-switch to kanban when cards are externally populated (e.g. via store)
  useEffect(() => {
    if (view === 'picker' && !selectedBacklog && backlogCards.length > 0) {
      setView('kanban');
    }
  }, [view, selectedBacklog, backlogCards.length]);

  // Card selection handler (Shift+click for range, Cmd/Ctrl+click for toggle)
  const handleCardSelect = useCallback((filename: string, event: React.MouseEvent) => {
    if (event.metaKey || event.ctrlKey) {
      // Toggle individual card
      setSelectedCards(prev => {
        const next = new Set(prev);
        if (next.has(filename)) next.delete(filename);
        else next.add(filename);
        return next;
      });
      lastClickedRef.current = filename;
    } else if (event.shiftKey && lastClickedRef.current) {
      // Range select within same column
      const lastCard = backlogCards.find(c => c.filename === lastClickedRef.current);
      const curCard = backlogCards.find(c => c.filename === filename);
      if (lastCard && curCard && lastCard.status === curCard.status) {
        const columnCards = backlogCards
          .filter(c => c.status === curCard.status)
          .sort((a, b) => a.order - b.order);
        const lastIdx = columnCards.findIndex(c => c.filename === lastClickedRef.current);
        const curIdx = columnCards.findIndex(c => c.filename === filename);
        const [from, to] = lastIdx < curIdx ? [lastIdx, curIdx] : [curIdx, lastIdx];
        setSelectedCards(prev => {
          const next = new Set(prev);
          for (let i = from; i <= to; i++) next.add(columnCards[i].filename);
          return next;
        });
      }
    } else {
      // Single click without modifier — don't interfere (opens modal)
    }
  }, [backlogCards]);

  // Helper: assign contiguous order values to cards in a column
  const assignColumnOrders = (cards: BacklogCard[]): Array<{ filename: string; order: number }> =>
    cards.map((c, i) => ({ filename: c.filename, order: i }));

  // DnD handlers
  const handleDragStart = useCallback((event: DragStartEvent) => {
    const draggedId = event.active.id as string;
    setActiveCardId(draggedId);
    // If dragging an unselected card, clear the selection
    if (!selectedCards.has(draggedId)) {
      setSelectedCards(new Set());
    }
  }, [selectedCards]);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    setActiveCardId(null);
    const { active, over } = event;
    if (!over) return;

    const cardFilename = active.id as string;
    const card = backlogCards.find(c => c.filename === cardFilename);
    if (!card) return;

    const validStatuses: BacklogStatus[] = ['pending', 'in_progress', 'completed', 'failed'];
    const overId = over.id as string;

    let targetStatus: BacklogStatus;
    let targetIndex: number;

    if (validStatuses.includes(overId as BacklogStatus)) {
      // Dropped on column → append to end
      targetStatus = overId as BacklogStatus;
      const colCards = backlogCards.filter(c => c.status === targetStatus).sort((a, b) => a.order - b.order);
      targetIndex = colCards.length;
    } else {
      // Dropped on another card → insert at that card's position
      const overCard = backlogCards.find(c => c.filename === overId);
      if (!overCard) return;
      targetStatus = overCard.status;
      const colCards = backlogCards.filter(c => c.status === targetStatus).sort((a, b) => a.order - b.order);
      targetIndex = colCards.findIndex(c => c.filename === overId);
      if (targetIndex === -1) targetIndex = colCards.length;
    }

    // Determine which cards are being dragged (multi-select or single)
    const draggedFilenames = selectedCards.has(cardFilename) && selectedCards.size > 1
      ? Array.from(selectedCards)
      : [cardFilename];

    const prevCards = backlogCards;

    // Build new card list
    let newCards = [...backlogCards];

    // Remove dragged cards from their current positions
    const draggedSet = new Set(draggedFilenames);
    const dragged = newCards.filter(c => draggedSet.has(c.filename));
    newCards = newCards.filter(c => !draggedSet.has(c.filename));

    // Update dragged cards' status
    const updatedDragged = dragged.map(c => ({ ...c, status: targetStatus }));

    // Get target column without dragged cards, sorted
    const targetCol = newCards.filter(c => c.status === targetStatus).sort((a, b) => a.order - b.order);
    const otherCards = newCards.filter(c => c.status !== targetStatus);

    // Clamp target index
    const insertAt = Math.min(targetIndex, targetCol.length);

    // Insert dragged cards at target position
    targetCol.splice(insertAt, 0, ...updatedDragged);

    // Reassign orders for the target column
    const targetOrders = assignColumnOrders(targetCol);
    const targetColWithOrders = targetCol.map((c, i) => ({ ...c, order: i }));

    // Reassign orders for source column if different
    const sourceStatus = card.status;
    let sourceOrders: Array<{ filename: string; order: number }> = [];
    let sourceColWithOrders: BacklogCard[] = [];
    if (sourceStatus !== targetStatus) {
      sourceColWithOrders = otherCards.filter(c => c.status === sourceStatus).sort((a, b) => a.order - b.order);
      sourceOrders = assignColumnOrders(sourceColWithOrders);
      sourceColWithOrders = sourceColWithOrders.map((c, i) => ({ ...c, order: i }));
    }

    // Rebuild full card list
    const untouchedStatuses = new Set([targetStatus, sourceStatus]);
    const untouched = otherCards.filter(c => !untouchedStatuses.has(c.status));
    const reorderedCards = [...untouched, ...targetColWithOrders];
    if (sourceStatus !== targetStatus) {
      reorderedCards.push(...sourceColWithOrders);
    }

    // Animate moved cards
    for (const fn of draggedFilenames) {
      setAnimatingCards(prev => new Set(prev).add(fn));
    }
    setTimeout(() => {
      setAnimatingCards(prev => {
        const next = new Set(prev);
        for (const fn of draggedFilenames) next.delete(fn);
        return next;
      });
    }, 500);

    // Optimistic update
    setBacklogCards(reorderedCards);
    setSelectedCards(new Set());

    // Persist via IPC
    if (selectedBacklog) {
      try {
        const updates: Array<{ filename: string; status?: string; order?: number }> = [];
        for (const o of targetOrders) {
          const wasSource = draggedSet.has(o.filename);
          updates.push({
            filename: o.filename,
            order: o.order,
            ...(wasSource ? { status: targetStatus } : {}),
          });
        }
        for (const o of sourceOrders) {
          updates.push({ filename: o.filename, order: o.order });
        }
        if (updates.length > 0) {
          await window.helioxAPI?.updateBacklogCards(selectedBacklog.backlogPath, updates);
        }
      } catch {
        setBacklogCards(prevCards);
        setError('Failed to update card positions');
      }
    }
  }, [backlogCards, selectedBacklog, setBacklogCards, selectedCards]);

  // Reorder all cards by priority within each column
  const reorderByPriority = useCallback(async () => {
    const updates: Array<{ filename: string; order: number }> = [];
    const byStatus = new Map<BacklogStatus, BacklogCard[]>();
    for (const card of backlogCards) {
      if (!byStatus.has(card.status)) byStatus.set(card.status, []);
      byStatus.get(card.status)!.push(card);
    }
    for (const cards of byStatus.values()) {
      cards.sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2));
      cards.forEach((card, i) => {
        updates.push({ filename: card.filename, order: i });
      });
    }

    // Optimistic update
    const reordered = backlogCards.map(c => {
      const u = updates.find(u => u.filename === c.filename);
      return u ? { ...c, order: u.order } : c;
    });
    setBacklogCards(reordered);

    // Persist
    if (selectedBacklog) {
      try {
        await window.helioxAPI?.updateBacklogCards(selectedBacklog.backlogPath, updates);
      } catch {
        setBacklogCards(backlogCards);
        setError('Failed to reorder cards');
      }
    }
  }, [backlogCards, selectedBacklog, setBacklogCards]);

  // Initialize backlog for a project
  const handleInitBacklog = useCallback(async (projPath: string) => {
    try {
      const result = await window.helioxAPI?.initBacklog(projPath);
      if (result?.success) {
        await scanForBacklogs();
      } else {
        setError(result?.error ?? 'Failed to initialize backlog');
      }
    } catch {
      setError('Failed to initialize backlog');
    }
  }, [scanForBacklogs]);

  const selectBacklog = useCallback((bl: BacklogProject) => {
    setSelectedBacklog(bl);
    setView('kanban');
  }, []);

  const goBack = useCallback(() => {
    setView('picker');
    setSelectedBacklog(null);
    setBacklogCards([]);
  }, [setBacklogCards]);

  // ─── Execute a backlog card via its assigned agent ────────────────
  const executeCard = useCallback(async (card: BacklogCard) => {
    if (!window.helioxAPI || !projectPath) return;

    const flowMeta = marketInventory?.flows.find(f => f.name === card.targetAgent);
    if (!flowMeta) {
      setError(`Flow "${card.targetAgent}" not found in inventory`);
      return;
    }

    const flowPrompt = await window.helioxAPI.readMarketPrompt(projectPath, 'flows', card.targetAgent);
    if (!flowPrompt) {
      setError(`Flow prompt for "${card.targetAgent}" not found`);
      return;
    }

    // Resolve absolute paths for the wrapper prompt
    const taskAbsPath = selectedBacklog
      ? `${selectedBacklog.backlogPath}/${card.filename}`
      : `${projectPath}/.backlog/${card.filename}`;
    const flowAbsPath = `${projectPath}/market/flows/${card.targetAgent}.md`;

    const taskContent = await window.helioxAPI.readFile(taskAbsPath);
    if (!taskContent) {
      setError(`Task file not found: ${taskAbsPath}`);
      return;
    }

    // Wrapper prompt (displayed to user)
    const wrapperPrompt = `Read the @${flowAbsPath} and begin the @${taskAbsPath}`;

    // Full instruction with inlined content
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
    const effectiveCwd = selectedBacklog?.projectPath || projectPath;

    const sessionId = store.addSession();
    const windowId = dStore.addWindow('chat', {
      title: `${card.targetAgent} → ${card.title}`,
      iconName: 'Zap',
      sessionId,
      childProjectPath: selectedBacklog?.projectPath !== projectPath ? selectedBacklog?.projectPath : undefined,
    });
    dStore.connectFlow(windowId, card.targetAgent);

    const model = flowMeta.betterOn || 'opencode/claude-sonnet-4-6';
    store.setSessionModel(sessionId, model);

    const createdSession = useHelioxStore.getState().sessions.find(s => s.id === sessionId);
    if (window.helioxAPI && projectPath && createdSession) {
      window.helioxAPI.contextMapUpsertSessionNode(projectPath, {
        sessionId,
        label: `Session #${createdSession.number}: ${card.title}`,
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
    store.updateSessionDescription(sessionId, card.title);
    dStore.updateWindowTitle(windowId, card.title);

    // Optimistic status update
    const updatedCards = backlogCards.map(c =>
      c.filename === card.filename ? { ...c, status: 'in_progress' as BacklogStatus } : c
    );
    setBacklogCards(updatedCards);
    if (selectedBacklog) {
      await window.helioxAPI.updateBacklogCardStatus(
        selectedBacklog.backlogPath, card.filename, 'in_progress'
      );
    }

    try {
      await window.helioxAPI.runAgent({
        agentId: sessionId,
        instruction,
        flows: store.flows,
        cwd: effectiveCwd,
        contextProjectPath: projectPath,
        model,
        effort,
        aiAdapter: store.appSettings.aiAdapter,
        autoCommit: store.appSettings.autoCommit,
        runE2E: store.appSettings.runE2E,
      });
    } catch (err) {
      store.updateSessionStatus(sessionId, 'error');
      setError(`Agent error: ${err}`);
    }
  }, [projectPath, selectedBacklog, marketInventory, backlogCards, setBacklogCards]);

  // ─── Launch the auto-architect to generate backlog cards ──────────
  const launchAutoArchitect = useCallback(async () => {
    if (!window.helioxAPI || !projectPath) return;

    const architectFlow = marketInventory?.flows.find(f => f.name === 'auto-architect');
    if (!architectFlow) {
      setError('auto-architect flow not found in inventory');
      return;
    }

    const flowPrompt = await window.helioxAPI.readMarketPrompt(projectPath, 'flows', 'auto-architect');
    if (!flowPrompt) {
      setError('auto-architect flow prompt not found');
      return;
    }

    const flowAbsPath = `${projectPath}/market/flows/auto-architect.md`;
    const wrapperPrompt = `Read the @${flowAbsPath} and begin architectural analysis of this project.`;

    const instruction = [
      `--- ${flowAbsPath} ---`,
      flowPrompt,
      `--- end ${flowAbsPath} ---`,
      '',
      wrapperPrompt,
    ].join('\n');

    const store = useHelioxStore.getState();
    const dStore = useDesktopStore.getState();
    const effectiveCwd = selectedBacklog?.projectPath || projectPath;
    const projectName = selectedBacklog?.projectName || 'Project';

    const sessionId = store.addSession();
    const windowId = dStore.addWindow('chat', {
      title: `auto-architect → ${projectName}`,
      iconName: 'Zap',
      sessionId,
      childProjectPath: selectedBacklog?.projectPath !== projectPath ? selectedBacklog?.projectPath : undefined,
    });
    dStore.connectFlow(windowId, 'auto-architect');

    const model = architectFlow.betterOn || 'claude-opus-4.6';
    store.setSessionModel(sessionId, model);

    const createdSession = useHelioxStore.getState().sessions.find(s => s.id === sessionId);
    if (window.helioxAPI && projectPath && createdSession) {
      window.helioxAPI.contextMapUpsertSessionNode(projectPath, {
        sessionId,
        label: `Session #${createdSession.number}: Auto-Architect ${projectName}`,
        status: 'running',
        roleId: createdSession.roleId,
      }).catch(() => {});
    }

    store.addSessionMessage(sessionId, {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: wrapperPrompt,
      timestamp: Date.now(),
    });
    store.updateSessionStatus(sessionId, 'running');
    store.updateSessionDescription(sessionId, `Auto-Architect: ${projectName}`);
    dStore.updateWindowTitle(windowId, `Auto-Architect: ${projectName}`);

    try {
      await window.helioxAPI.runAgent({
        agentId: sessionId,
        instruction,
        flows: store.flows,
        cwd: effectiveCwd,
        contextProjectPath: projectPath,
        model,
        effort: 'high',
        aiAdapter: store.appSettings.aiAdapter,
        autoCommit: store.appSettings.autoCommit,
        runE2E: store.appSettings.runE2E,
      });
    } catch (err) {
      store.updateSessionStatus(sessionId, 'error');
      setError(`Auto-architect error: ${err}`);
    }
  }, [projectPath, selectedBacklog, marketInventory]);

  const cardsByStatus = (status: BacklogStatus) =>
    backlogCards.filter(c => c.status === status).sort((a, b) => a.order - b.order);

  const finiteFlows = marketInventory?.flows.filter(f =>
    f.usableBy?.includes('agentic-task')
  ) ?? [];

  const activeCard = activeCardId ? backlogCards.find(c => c.filename === activeCardId) : null;

  return (
    <div
      className="backlog-kanban fd-app"
      role="region"
      aria-label="Backlog kanban board"
    >
      {/* FlowDeck header */}
      <header className="fd-top">
        <div className="fd-brand">
          <div className="fd-logo">
            <LucideIcon name="KanbanSquare" size={18} />
          </div>
          <div>
            <h1 className="fd-title">Backlog</h1>
            <p className="fd-subtitle">
              {selectedBacklog
                ? `${selectedBacklog.projectName} · ${backlogCards.length} card${backlogCards.length !== 1 ? 's' : ''}`
                : view === 'kanban' && backlogCards.length > 0
                  ? `${backlogCards.length} card${backlogCards.length !== 1 ? 's' : ''}`
                  : 'Kanban board with drag & drop'}
            </p>
          </div>
        </div>
        <div className="fd-actions">
          {view === 'kanban' && backlogs.length > 1 && (
            <button className="fd-btn fd-ghost" onClick={goBack} type="button">
              <LucideIcon name="ArrowLeft" size={12} /> Back
            </button>
          )}
          {view === 'kanban' && (
            <>
            <button
              className="fd-btn fd-ghost"
              onClick={reorderByPriority}
              type="button"
              title="Reorder cards by priority within each column"
              aria-label="Reorder by Priority"
            >
              <LucideIcon name="ArrowUpDown" size={12} /> Sort
            </button>
            <button
              className="fd-btn fd-accent"
              onClick={launchAutoArchitect}
              type="button"
              title="Launch auto-architect to analyze the project and generate backlog cards"
              aria-label="Launch Auto-Architect"
            >
              <LucideIcon name="Brain" size={12} /> Auto-Architect
            </button>
            </>
          )}
          <button
            className="fd-btn"
            onClick={view === 'kanban' ? loadCards : scanForBacklogs}
            type="button"
            aria-label="Refresh"
          >
            <LucideIcon name="RefreshCw" size={12} /> Refresh
          </button>
        </div>
      </header>

      {/* Error */}
      {error && (
        <div role="alert" className="fd-error">{error}</div>
      )}

      {/* Loading */}
      {loading && (
        <div aria-live="polite" className="fd-loading">Loading…</div>
      )}

      {/* ─── PROJECT PICKER VIEW ─── */}
      {view === 'picker' && !loading && (
        <div className="fd-picker">
          {!projectPath && (
            <div className="fd-empty">
              <LucideIcon name="FolderOpen" size={28} style={{ margin: '0 auto 8px', display: 'block', opacity: 0.35 }} />
              Open a project to scan for backlogs
            </div>
          )}

          {/* Projects with backlogs */}
          {backlogs.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div className="fd-section-label">Projects with backlogs</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {backlogs.map(bl => (
                  <button
                    key={bl.projectPath}
                    onClick={() => selectBacklog(bl)}
                    className="fd-picker-btn"
                  >
                    <LucideIcon name="KanbanSquare" size={16} style={{ color: '#00e676', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="fd-picker-name">{bl.projectName}</div>
                      <div className="fd-picker-meta">
                        {bl.isExternal ? 'Stored in Heliox data' : 'In-project .backlog/'}
                      </div>
                    </div>
                    <span className="fd-count">{bl.cardCount}</span>
                    <LucideIcon name="ChevronRight" size={14} style={{ color: '#404040', flexShrink: 0 }} />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Projects without backlogs */}
          {projectsWithout.length > 0 && (
            <div>
              <div className="fd-section-label">No backlog — initialize?</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {projectsWithout.map(p => (
                  <div key={p.projectPath} className="fd-picker-row">
                    <LucideIcon name="Folder" size={16} style={{ color: '#404040', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="fd-picker-name" style={{ color: 'rgba(245,245,247,0.62)' }}>{p.projectName}</div>
                    </div>
                    <button onClick={() => handleInitBacklog(p.projectPath)} className="fd-btn fd-ghost" type="button">
                      <LucideIcon name="Plus" size={11} /> Init
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {projectPath && backlogs.length === 0 && projectsWithout.length === 0 && !error && (
            <div className="fd-empty">
              No project subdirectories found in the opened folder.
            </div>
          )}
        </div>
      )}

      {/* ─── KANBAN VIEW (FlowDeck-style) ─── */}
      {view === 'kanban' && !loading && (
        <>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          {/* Empty state */}
          {backlogCards.length === 0 && !error && (
            <div className="fd-empty">
              <LucideIcon name="Inbox" size={24} style={{ margin: '0 auto 8px', display: 'block', opacity: 0.5 }} />
              No backlog cards found.
              <br />
              <span style={{ fontSize: 11, color: 'rgba(245,245,247,0.4)' }}>
                Create <code>.md</code> files in the backlog folder to get started.
              </span>
            </div>
          )}

          {/* FlowDeck board */}
          {backlogCards.length > 0 && (
            <section className="fd-boardWrap" aria-label="Kanban board">
              <div className="fd-board" role="list" aria-label="Kanban columns">
                {STATUS_COLUMNS.map(col => (
                  <KanbanColumn
                    key={col.key}
                    column={col}
                    cards={cardsByStatus(col.key)}
                    expandedCard={expandedCard}
                    onToggleCard={(fn) => setExpandedCard(expandedCard === fn ? null : fn)}
                    onOpenModal={(card) => openCanvasModal(card)}
                    onExecute={executeCard}
                    finiteFlows={finiteFlows}
                    animatingCards={animatingCards}
                    selectedCards={selectedCards}
                    onSelect={handleCardSelect}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Drag overlay */}
          <DragOverlay dropAnimation={null}>
            {activeCard && (
              <div className="fd-dragOverlay" style={{ position: 'relative' }}>
                {selectedCards.has(activeCard.filename) && selectedCards.size > 1 && (
                  <span className="fd-multi-drag-count">{selectedCards.size}</span>
                )}
                <div className="fd-cardTopRow">
                  <span className={`fd-badge ${(PRIORITY_LABELS[activeCard.priority] ?? { cssClass: 'med' }).cssClass}`}>
                    {(PRIORITY_LABELS[activeCard.priority] ?? { label: 'Medium' }).label}
                  </span>
                </div>
                <h3>{activeCard.title}</h3>
                <div className="fd-cardFooter">
                  <span>{activeCard.status.toUpperCase().replace('_', ' ')}</span>
                  <span>{activeCard.targetAgent} → {activeCard.targetModule}</span>
                </div>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </>
      )}
    </div>
  );
}
