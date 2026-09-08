/**
 * LaunchMenu.tsx — the launchers dropdown (F3 Task 1; fourth entry: Cockpit F3).
 *
 * Net-new — NOT part of the frozen reference (the task's own scope note:
 * the mock has no launcher affordance at all). Offers up to four actions:
 * "Run on existing flow" (opens a nested frame-picker submenu populated from
 * `frames`), "Autoflow", "Run epic as flow" — only when the card carries an
 * `epic` AND a handler is supplied — and "Open agent session", which opens a
 * vendor CLI in a terminal instead of materializing a flow. Rendered from both
 * `BacklogCardItem` (`variant="compact"`, an icon-only trigger) and
 * `BacklogCardModal` (`variant="full"`, a labeled header button, alongside
 * edit/close) — same component, two trigger chrome variants.
 *
 * The first three actions are pure callback props: the materialization
 * (`compileFlowFromCanvas`/`runFrameWithContext`,
 * `assemblePipeline`+`insertPipelineAssembly`+`runFromStep`,
 * `epicToPipelineAssembly`+`insertPipelineAssembly`+`runFromStep`) lives in
 * `launchActions.ts` (Gate 2: zero new materializer, zero `runAgent`), and so
 * does the fourth's (`launchAgentSession`).
 *
 * The one thing this component DOES read for itself is which vendor CLIs are
 * installed and which project already has an attached session. Those are FACTS
 * ABOUT THE MACHINE, not decisions: they are read where they are rendered, once,
 * lazily, when the agent submenu opens — because the alternative is both
 * consumers growing their own copy of the same two probes, which is precisely
 * the drift this file's own frame-picker avoided by taking `frames` as a prop.
 *
 * Not rendered AT ALL when `launchable` is false, which is how a HUMAN card
 * gets no launcher: the work is a person's, and offering an agent a card it
 * cannot start is a dead end dressed up as an affordance
 * (`.harness/skills/backlog/SKILL.md` § HUMAN cards — `next` skips them for the
 * same reason).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LucideIcon } from '@/renderer/components/desktop/LucideIcon';
import type { BacklogCard } from '@/types/market';
import type { AgentVendorId } from '@/types/desktop';

export interface LaunchMenuFrameOption {
  id: string;
  title: string;
}

export type AgentSessionMode = 'attached' | 'worktree';

/** Mirrors `VendorAvailability` (src/main/pty/vendors.ts) — declared structurally because the renderer cannot import that module. */
interface VendorRow {
  id: AgentVendorId;
  label: string;
  available: boolean;
}

export interface LaunchMenuProps {
  card: BacklogCard;
  /** Existing Frames on the canvas, offered as the "run on existing flow" submenu. */
  frames: LaunchMenuFrameOption[];
  onLaunchExisting: (frameId: string) => void;
  onLaunchAutoflow: () => void;
  onLaunchEpic?: () => void;
  /** F3 — opens a vendor CLI on this card. Absent = the entry is not offered. */
  onLaunchAgent?: (vendor: AgentVendorId, mode: AgentSessionMode) => void;
  /** The project the session would run in — needed to tell whether IT already has an attached session. */
  projectRoot?: string | null;
  /** An external backlog has no copy of the card inside a worktree, so only `attached` applies. */
  isExternalBacklog?: boolean;
  /** False on HUMAN cards: the whole component renders nothing. Defaults to true. */
  launchable?: boolean;
  /** 'compact' = icon-only trigger (pile card); 'full' = labeled button (modal header). Defaults to 'compact'. */
  variant?: 'compact' | 'full';
}

type MenuView = 'root' | 'frames' | 'agent';

const MENU_ITEM_CLASS = 'w-full flex items-center gap-2 px-4 py-2 text-left text-xs font-extrabold uppercase text-black hover:bg-neutral-100 transition-colors';
const DISABLED_ITEM_CLASS = 'w-full flex items-center gap-2 px-4 py-2 text-left text-xs font-extrabold uppercase text-neutral-400 cursor-not-allowed';

export function LaunchMenu({
  card, frames, onLaunchExisting, onLaunchAutoflow, onLaunchEpic, onLaunchAgent,
  projectRoot, isExternalBacklog = false, launchable = true, variant = 'compact',
}: LaunchMenuProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<MenuView>('root');
  const [vendors, setVendors] = useState<VendorRow[] | null>(null);
  const [attachedHolder, setAttachedHolder] = useState<string | null>(null);
  // A worktree is the default because it is the mode that never collides: two
  // agents in one tree share a git index and a build cache, and neither is told.
  // An external backlog has no worktree copy of the card, so it starts attached.
  const [mode, setMode] = useState<AgentSessionMode>(isExternalBacklog ? 'attached' : 'worktree');
  const containerRef = useRef<HTMLDivElement>(null);

  // Bind once — see HudAutoChatPanel.tsx's own comment on why a locally
  // bound const (not a re-evaluated `card.epic` read) is what survives
  // narrowing into a closure.
  const epic = card.epic;
  const showEpicOption = Boolean(epic && onLaunchEpic);

  const closeAll = useCallback(() => {
    setOpen(false);
    setView('root');
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) closeAll();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAll();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open, closeAll]);

  // Probed when the submenu opens, not on mount: `which` runs four times and a
  // pile of forty cards must not run it a hundred and sixty.
  useEffect(() => {
    if (view !== 'agent') return;
    let cancelled = false;
    void (async () => {
      const detected = await window.fluxorAPI?.detectAgents?.();
      if (!cancelled && detected) setVendors(detected as VendorRow[]);
      const live = await window.fluxorAPI?.ptyLiveSessions?.();
      if (cancelled || !live || !projectRoot) return;
      const holder = live.find((s) => s.mode === 'attached' && s.projectRoot === projectRoot);
      setAttachedHolder(holder?.sessionId ?? null);
    })();
    return () => { cancelled = true; };
  }, [view, projectRoot]);

  const toggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen((o) => !o);
    setView('root');
  }, []);

  // A HUMAN card gets no launcher at all — see the module doc.
  if (!launchable) return null;

  const triggerClassName = variant === 'full'
    ? 'flex items-center gap-2 px-4 py-2 rounded-full border-2 border-black bg-white text-black text-xs font-extrabold uppercase hover:-translate-y-0.5 hover:shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] transition-all'
    : 'flex items-center justify-center p-1.5 rounded-full border border-black/20 bg-white text-black hover:border-black hover:bg-neutral-100 transition-colors';

  // Every disabled control says WHY, in the row itself rather than only in a
  // tooltip: a greyed-out row with no reason reads as broken, not as guarded.
  const attachedDisabledReason = attachedHolder ? 'another session holds this project' : null;
  const worktreeDisabledReason = isExternalBacklog ? 'external backlog · attached only' : null;

  const modeRow = (value: AgentSessionMode, reason: string | null) => (
    <button
      key={value}
      type="button"
      onClick={() => setMode(value)}
      disabled={!!reason}
      aria-pressed={mode === value}
      data-testid={`launch-agent-mode-${value}`}
      title={reason ? `Not available: ${reason}` : `Run this session ${value === 'worktree' ? 'in its own git worktree' : 'in the project’s working tree'}`}
      className={`flex-1 px-2 py-1 rounded-lg border text-[10px] font-extrabold uppercase transition-colors ${
        reason ? 'border-black/10 text-neutral-400 cursor-not-allowed'
          : mode === value ? 'border-black bg-black text-white'
          : 'border-black/20 text-black hover:bg-neutral-100'
      }`}
    >
      {value}{reason ? ` — ${reason}` : ''}
    </button>
  );

  return (
    <div
      ref={containerRef}
      className="relative inline-flex"
      data-testid="launch-menu"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={toggle}
        aria-label="Launch agentic run"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="launch-menu-trigger"
        className={triggerClassName}
      >
        <LucideIcon name="Zap" size={variant === 'full' ? 16 : 14} strokeWidth={2.5} />
        {variant === 'full' && 'Launch'}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Launch options"
          className="absolute right-0 top-full mt-2 z-50 min-w-[200px] bg-white border border-black rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] py-1.5"
        >
          {view === 'root' && (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => setView('frames')}
                className={MENU_ITEM_CLASS}
              >
                <LucideIcon name="GitBranch" size={14} /> Run on existing flow
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => { closeAll(); onLaunchAutoflow(); }}
                className={MENU_ITEM_CLASS}
              >
                <LucideIcon name="Sparkles" size={14} /> Autoflow
              </button>
              {showEpicOption && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { closeAll(); onLaunchEpic?.(); }}
                  className={MENU_ITEM_CLASS}
                >
                  <LucideIcon name="Workflow" size={14} /> Run epic as flow
                </button>
              )}
              {onLaunchAgent && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => setView('agent')}
                  data-testid="launch-menu-agent"
                  className={MENU_ITEM_CLASS}
                >
                  <LucideIcon name="Terminal" size={14} /> Open agent session
                </button>
              )}
            </>
          )}

          {view === 'frames' && (
            <>
              <button
                type="button"
                onClick={() => setView('root')}
                className="w-full flex items-center gap-2 px-4 py-2 text-left text-[10px] font-extrabold uppercase text-neutral-500 hover:bg-neutral-100 transition-colors border-b border-black/10 mb-1"
              >
                <LucideIcon name="ArrowLeft" size={12} /> Back
              </button>
              {frames.length === 0 ? (
                <div className="px-4 py-2 text-xs font-bold text-neutral-400 italic">No flows on the canvas.</div>
              ) : (
                frames.map((frame) => (
                  <button
                    key={frame.id}
                    type="button"
                    role="menuitem"
                    onClick={() => { closeAll(); onLaunchExisting(frame.id); }}
                    className="w-full flex items-center gap-2 px-4 py-2 text-left text-xs font-bold text-black hover:bg-neutral-100 transition-colors truncate"
                  >
                    {frame.title}
                  </button>
                ))
              )}
            </>
          )}

          {view === 'agent' && (
            <div data-testid="launch-agent-submenu">
              <button
                type="button"
                onClick={() => setView('root')}
                className="w-full flex items-center gap-2 px-4 py-2 text-left text-[10px] font-extrabold uppercase text-neutral-500 hover:bg-neutral-100 transition-colors border-b border-black/10 mb-1"
              >
                <LucideIcon name="ArrowLeft" size={12} /> Back
              </button>

              {/* Mode first: it changes what picking a vendor will DO, so it is
                  decided before the action, not after it. */}
              <div className="flex gap-1.5 px-3 pb-2 pt-1">
                {modeRow('worktree', worktreeDisabledReason)}
                {modeRow('attached', attachedDisabledReason)}
              </div>

              {vendors === null ? (
                <div className="px-4 py-2 text-xs font-bold text-neutral-400 italic">Looking for installed CLIs…</div>
              ) : vendors.length === 0 ? (
                <div className="px-4 py-2 text-xs font-bold text-neutral-400 italic">No agent CLI found.</div>
              ) : (
                vendors.map((vendor) => (
                  <button
                    key={vendor.id}
                    type="button"
                    role="menuitem"
                    disabled={!vendor.available}
                    data-testid={`launch-agent-vendor-${vendor.id}`}
                    onClick={() => { closeAll(); onLaunchAgent?.(vendor.id, mode); }}
                    title={vendor.available
                      ? `Open ${vendor.label} on this card, ${mode}`
                      : `${vendor.label} is not installed on this machine`}
                    className={vendor.available ? MENU_ITEM_CLASS : DISABLED_ITEM_CLASS}
                  >
                    <LucideIcon name="Terminal" size={14} />
                    {vendor.label}{vendor.available ? '' : ' — not installed'}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
