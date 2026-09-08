/**
 * BacklogBentoWidget.tsx — the bento pile widget (F2 Task 10, full
 * build-out — replaces the Task 1 cutover shell).
 *
 * Composition (filters card + single scrollable pile) is the frozen
 * reference's own outer chrome
 * (docs/superpowers/specs/2026-07-08-backlog-bento-reference.tsx:565-611),
 * ported 1:1 via BacklogFilters + BacklogPile. Doto is applied at the root
 * via `theme.fontDisplay` (Gate 1 deviation #1 — no Google-Fonts `<link>`,
 * the font is already vendored and imported at the app entry).
 * `min-h-screen` -> `flex-1 min-h-0` (Gate 1 deviation #2 — wrapper-relative,
 * not viewport-relative): this widget is mounted inside `.window-content`
 * (`display:flex; flex-direction:column; overflow:hidden` —
 * DesktopWindow.tsx), so THIS component's own root must both grow to fill
 * that flex slot (`flex-1`) and own its internal scroll (`overflow-y-auto`),
 * rather than assuming the page viewport.
 *
 * Preserves the behavior layer the old widget's own TODO(design) comment
 * said to keep (multi-project picker, scan/init backlog, Refresh) —
 * `scanForBacklogs`/`loadCards`/`handleInitBacklog`/`selectBacklog`/
 * `goBack` ported unchanged in behavior from the deleted
 * `BacklogKanbanWidget.tsx` (git history, commit a0e6e657). The picker view
 * and the thin back/refresh row have no reference counterpart (the frozen
 * mock is single-project) — they are NOT under the 1:1 gate, kept minimal
 * and in the same visual language (white/black-border islands on the
 * neutral-200 canvas) rather than redesigned.
 *
 * `executeCard`/`launchAutoArchitect`/`reorderByPriority` (the old ad-hoc
 * `addStepNode`+`runStep` materialization + its "Auto-Architect"/"Sort"
 * header buttons) are intentionally NOT ported — retired by the F2 Task 1
 * cutover, replaced later by F3's three canonical launchers (out of this
 * task's scope; the frozen reference has no such buttons either).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useDesktopStore } from '@/renderer/store/desktop-store';
import { useFluxorStore } from '@/renderer/store';
import { announceHumanEvents, diffForHumanEvents } from '@/renderer/lib/human-cards';
import { LucideIcon } from '@/renderer/components/desktop/LucideIcon';
import { theme } from '@/renderer/logic/theme';
import { BacklogFilters } from './BacklogFilters';
import { BacklogPile } from './BacklogPile';
import { STATUS_CONFIG } from './statusConfig';
import type { BacklogCard, BacklogStatus } from '@/types/market';

interface BacklogProject {
  projectPath: string;
  projectName: string;
  backlogPath: string;
  cardCount: number;
  isExternal: boolean;
}

const ALL_STATUSES = Object.keys(STATUS_CONFIG) as BacklogStatus[];

export function BacklogBentoWidget({ windowId }: { windowId: string }) {
  const projectPath = useFluxorStore((s) => s.projectPath);
  const backlogCards = useDesktopStore((s) => s.backlogCards);
  const setBacklogCards = useDesktopStore((s) => s.setBacklogCards);
  const setActiveBacklogDir = useDesktopStore((s) => s.setActiveBacklogDir);
  const setActiveBacklogProject = useDesktopStore((s) => s.setActiveBacklogProject);

  const [view, setView] = useState<'picker' | 'pile'>('picker');
  const [backlogs, setBacklogs] = useState<BacklogProject[]>([]);
  const [projectsWithout, setProjectsWithout] = useState<Array<{ projectPath: string; projectName: string }>>([]);
  const [selectedBacklog, setSelectedBacklog] = useState<BacklogProject | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [activeStatuses, setActiveStatuses] = useState<BacklogStatus[]>(ALL_STATUSES);

  /**
   * The previous reading of this directory, for F3's HUMAN-card diff.
   *
   * `null` until the first read lands, which is what makes the initial load
   * silent: announcing the eleven HUMAN cards already on a board every time the
   * widget mounts is how a notification channel gets ignored by the end of the
   * day. Seeded by `loadCards` rather than by the first watcher push, so the
   * FIRST push — which is usually a real change, since the watcher only fires
   * on one — is already a comparison against something.
   */
  const prevCardsRef = useRef<BacklogCard[] | null>(null);

  // ─── Preserved behavior layer (picker / scan / init / refresh) ─────────
  const scanForBacklogs = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    setError(null);
    try {
      const [found, missing] = await Promise.all([
        window.fluxorAPI?.scanBacklogs(projectPath),
        window.fluxorAPI?.listProjectsWithoutBacklog(projectPath),
      ]);
      const foundList = (found ?? []) as BacklogProject[];
      setBacklogs(foundList);
      setProjectsWithout(missing ?? []);

      if (foundList.length === 1) {
        setSelectedBacklog(foundList[0]);
        setView('pile');
      } else {
        setView('picker');
      }
    } catch {
      setError('Failed to scan projects');
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  const loadCards = useCallback(async () => {
    if (!selectedBacklog) return;
    setLoading(true);
    setError(null);
    try {
      const cards = await window.fluxorAPI?.readBacklogDir(selectedBacklog.backlogPath);
      setBacklogCards((cards ?? []) as BacklogCard[]);
      prevCardsRef.current = (cards ?? []) as BacklogCard[];
    } catch {
      setError('Failed to read backlog');
    } finally {
      setLoading(false);
    }
  }, [selectedBacklog, setBacklogCards]);

  useEffect(() => { scanForBacklogs(); }, [scanForBacklogs]);
  useEffect(() => { if (selectedBacklog) loadCards(); }, [loadCards, selectedBacklog]);

  // Canvas-level BacklogCardModal (mounted outside this widget's own
  // wrapper) needs to know which directory backs the open backlog to
  // persist edits — see desktop-store.ts's activeBacklogDir doc comment.
  useEffect(() => {
    setActiveBacklogDir(selectedBacklog?.backlogPath ?? null);
    // Its sibling: which project this backlog belongs to and whether it lives
    // outside the tree — both needed by F3's agent-session launcher, and
    // neither derivable from the directory alone (an external backlog's path
    // is inside the IDE's own config directory).
    setActiveBacklogProject(selectedBacklog
      ? { projectPath: selectedBacklog.projectPath, isExternal: selectedBacklog.isExternal }
      : null);
  }, [selectedBacklog, setActiveBacklogDir, setActiveBacklogProject]);

  // F4 — watcher wiring: external `.backlog` edits reflect without a manual
  // Refresh. The main-process watcher (src/main/backlog/watcher.ts) re-reads
  // + re-parses the directory itself on every fs event and pushes the fresh,
  // already-parsed BacklogCard[] over `fluxor:backlog-changed`; mergeBacklogCards
  // (desktop-store.ts) replaces backlogCards wholesale and live-patches an
  // already-open canvasModalCard in place (never auto-closing it if its card
  // disappeared from the fresh set).
  useEffect(() => {
    if (!selectedBacklog) return;
    const dir = selectedBacklog.backlogPath;
    const root = projectPath ?? selectedBacklog.projectPath;
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      await window.fluxorAPI?.watchBacklogDir(dir, root);
      if (cancelled) return;
      unsubscribe = window.fluxorAPI?.onBacklogChanged(({ backlogDir, cards }) => {
        if (backlogDir !== dir) return;
        const fresh = cards as BacklogCard[];
        // F3 — the reverse channel. A session that hits a wall only a person
        // can clear writes a HUMAN card; this is the moment that card exists,
        // and it is the only moment at which telling someone still helps.
        announceHumanEvents(diffForHumanEvents(prevCardsRef.current, fresh), fresh);
        prevCardsRef.current = fresh;
        useDesktopStore.getState().mergeBacklogCards(fresh);
      });
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
      void window.fluxorAPI?.unwatchBacklogDir(dir);
    };
  }, [selectedBacklog, projectPath]);

  // Auto-switch to the pile when cards are externally populated (e.g. store).
  useEffect(() => {
    if (view === 'picker' && !selectedBacklog && backlogCards.length > 0) {
      setView('pile');
    }
  }, [view, selectedBacklog, backlogCards.length]);

  const handleInitBacklog = useCallback(async (projPath: string) => {
    try {
      const result = await window.fluxorAPI?.initBacklog(projPath);
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
    setView('pile');
  }, []);

  const goBack = useCallback(() => {
    setView('picker');
    setSelectedBacklog(null);
    setBacklogCards([]);
    // A different backlog is a different board: its own HUMAN cards are all
    // pre-existing to us, so the next selection starts silent again.
    prevCardsRef.current = null;
  }, [setBacklogCards]);

  const toggleStatus = useCallback((status: BacklogStatus) => {
    setActiveStatuses((prev) => (prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]));
  }, []);

  return (
    <div
      className="flex-1 min-h-0 w-full overflow-y-auto bg-neutral-200 p-4 md:p-8 flex flex-col items-center font-bold"
      style={{ fontFamily: theme.fontDisplay }}
      role="region"
      aria-label="Backlog"
      data-window-id={windowId}
      data-testid="backlog-bento-widget"
    >
      {error && (
        <div role="alert" className="w-full max-w-4xl mb-4 p-3 bg-red-100 border border-red-400 text-red-800 rounded-xl font-bold text-sm">
          {error}
        </div>
      )}

      {loading && (
        <div aria-live="polite" className="mb-4 text-neutral-600 font-bold text-sm">Loading…</div>
      )}

      {/* ─── PROJECT PICKER VIEW (no reference counterpart — preserved
          multi-project behavior layer, not under the 1:1 gate) ─── */}
      {view === 'picker' && !loading && (
        <div className="w-full max-w-4xl" data-testid="backlog-picker">
          {!projectPath && (
            <div className="text-center py-20 bg-white border border-dashed border-black rounded-3xl">
              <LucideIcon name="FolderOpen" size={28} style={{ margin: '0 auto 8px', display: 'block', opacity: 0.35 }} />
              <p className="text-neutral-500 font-extrabold uppercase tracking-widest text-sm">Open a project to scan for backlogs</p>
            </div>
          )}

          {backlogs.length > 0 && (
            <div className="mb-6">
              <div className="text-sm font-extrabold text-neutral-500 uppercase tracking-widest mb-2">Projects with backlogs</div>
              <div className="flex flex-col gap-2">
                {backlogs.map((bl) => (
                  <button
                    key={bl.projectPath}
                    onClick={() => selectBacklog(bl)}
                    type="button"
                    className="flex items-center gap-3 p-3 bg-white border border-black rounded-2xl hover:-translate-y-0.5 hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-all text-left"
                  >
                    <LucideIcon name="KanbanSquare" size={18} className="text-emerald-600 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-black text-black truncate">{bl.projectName}</div>
                      <div className="text-xs text-neutral-500 font-bold">
                        {bl.isExternal ? 'Stored in Fluxor data' : 'In-project .backlog/'}
                      </div>
                    </div>
                    <span className="text-xs font-black bg-black text-white px-2 py-1 rounded-full">{bl.cardCount}</span>
                    <LucideIcon name="ChevronRight" size={16} className="text-neutral-400 shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {projectsWithout.length > 0 && (
            <div>
              <div className="text-sm font-extrabold text-neutral-500 uppercase tracking-widest mb-2">No backlog — initialize?</div>
              <div className="flex flex-col gap-2">
                {projectsWithout.map((p) => (
                  <div key={p.projectPath} className="flex items-center gap-3 p-3 bg-white border border-neutral-300 rounded-2xl">
                    <LucideIcon name="Folder" size={18} className="text-neutral-400 shrink-0" />
                    <div className="flex-1 min-w-0 font-bold text-neutral-500 truncate">{p.projectName}</div>
                    <button
                      onClick={() => handleInitBacklog(p.projectPath)}
                      type="button"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border-2 border-black text-xs font-extrabold uppercase bg-white hover:bg-neutral-100 transition-all"
                    >
                      <LucideIcon name="Plus" size={12} /> Init
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {projectPath && backlogs.length === 0 && projectsWithout.length === 0 && !error && (
            <div className="text-center py-20 bg-white border border-dashed border-black rounded-3xl">
              <p className="text-neutral-500 font-extrabold uppercase tracking-widest text-sm">No project subdirectories found in the opened folder.</p>
            </div>
          )}
        </div>
      )}

      {/* ─── PILE VIEW (frozen reference, 1:1) ─── */}
      {view === 'pile' && !loading && (
        <>
          <div className="w-full max-w-4xl flex items-center justify-between mb-2">
            {backlogs.length > 1 && (
              <button
                onClick={goBack}
                type="button"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border-2 border-transparent text-xs font-extrabold uppercase text-neutral-500 hover:text-black transition-all"
              >
                <LucideIcon name="ArrowLeft" size={12} /> Back
              </button>
            )}
            <button
              onClick={loadCards}
              type="button"
              aria-label="Refresh"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border-2 border-transparent text-xs font-extrabold uppercase text-neutral-500 hover:text-black transition-all ml-auto"
            >
              <LucideIcon name="RefreshCw" size={12} /> Refresh
            </button>
          </div>

          <BacklogFilters
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            activeStatuses={activeStatuses}
            onToggleStatus={toggleStatus}
          />

          <BacklogPile
            searchTerm={searchTerm}
            activeStatuses={activeStatuses}
            backlogDir={selectedBacklog?.backlogPath ?? ''}
          />
        </>
      )}
    </div>
  );
}
