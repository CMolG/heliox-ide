/**
 * LaunchMenu.tsx — the three agentic launchers dropdown (F3 Task 1).
 *
 * Net-new — NOT part of the frozen reference (the task's own scope note:
 * the mock has no launcher affordance at all). Offers up to three actions:
 * "Run on existing flow" (opens a nested frame-picker submenu populated from
 * `frames`), "Autoflow", and — only when the card carries an `epic` AND a
 * handler is supplied — "Run epic as flow". Rendered from both
 * `BacklogCardItem` (`variant="compact"`, an icon-only trigger) and
 * `BacklogCardModal` (`variant="full"`, a labeled header button, alongside
 * edit/close) — same component, two trigger chrome variants.
 *
 * Purely presentational: every action is a callback prop. The actual
 * materialization (`compileFlowFromCanvas`/`runFrameWithContext`,
 * `assemblePipeline`+`insertPipelineAssembly`+`runFromStep`,
 * `epicToPipelineAssembly`+`insertPipelineAssembly`+`runFromStep`) lives in
 * `launchActions.ts`, wired by the two consumer components — this component
 * never touches a store, an IPC call, or the harness directly (Gate 2: zero
 * new materializer, zero `runAgent`).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LucideIcon } from '@/renderer/components/desktop/LucideIcon';
import type { BacklogCard } from '@/types/market';

export interface LaunchMenuFrameOption {
  id: string;
  title: string;
}

export interface LaunchMenuProps {
  card: BacklogCard;
  /** Existing Frames on the canvas, offered as the "run on existing flow" submenu. */
  frames: LaunchMenuFrameOption[];
  onLaunchExisting: (frameId: string) => void;
  onLaunchAutoflow: () => void;
  onLaunchEpic?: () => void;
  /** 'compact' = icon-only trigger (pile card); 'full' = labeled button (modal header). Defaults to 'compact'. */
  variant?: 'compact' | 'full';
}

export function LaunchMenu({ card, frames, onLaunchExisting, onLaunchAutoflow, onLaunchEpic, variant = 'compact' }: LaunchMenuProps) {
  const [open, setOpen] = useState(false);
  const [showFramePicker, setShowFramePicker] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Bind once — see HudAutoChatPanel.tsx's own comment on why a locally
  // bound const (not a re-evaluated `card.epic` read) is what survives
  // narrowing into a closure.
  const epic = card.epic;
  const showEpicOption = Boolean(epic && onLaunchEpic);

  const closeAll = useCallback(() => {
    setOpen(false);
    setShowFramePicker(false);
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

  const toggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen((o) => !o);
    setShowFramePicker(false);
  }, []);

  const triggerClassName = variant === 'full'
    ? 'flex items-center gap-2 px-4 py-2 rounded-full border-2 border-black bg-white text-black text-xs font-extrabold uppercase hover:-translate-y-0.5 hover:shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] transition-all'
    : 'flex items-center justify-center p-1.5 rounded-full border border-black/20 bg-white text-black hover:border-black hover:bg-neutral-100 transition-colors';

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
          {!showFramePicker ? (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => setShowFramePicker(true)}
                className="w-full flex items-center gap-2 px-4 py-2 text-left text-xs font-extrabold uppercase text-black hover:bg-neutral-100 transition-colors"
              >
                <LucideIcon name="GitBranch" size={14} /> Run on existing flow
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => { closeAll(); onLaunchAutoflow(); }}
                className="w-full flex items-center gap-2 px-4 py-2 text-left text-xs font-extrabold uppercase text-black hover:bg-neutral-100 transition-colors"
              >
                <LucideIcon name="Sparkles" size={14} /> Autoflow
              </button>
              {showEpicOption && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { closeAll(); onLaunchEpic?.(); }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-left text-xs font-extrabold uppercase text-black hover:bg-neutral-100 transition-colors"
                >
                  <LucideIcon name="Workflow" size={14} /> Run epic as flow
                </button>
              )}
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setShowFramePicker(false)}
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
        </div>
      )}
    </div>
  );
}
