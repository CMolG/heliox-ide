/**
 * StepThinkingPopover.tsx — Cursor-following pseudomodal for step deltas
 *
 * Responsibility:
 * - Renders a glass popover anchored to cursor position via requestAnimationFrame,
 *   showing live delta thinkings (reasoning/text/tool-calls) while a step runs,
 *   or a static idle summary when the step is not executing.
 *
 * Boundaries:
 * - Owns: presentation and cursor-tracking only (pointer-events: none).
 * - Does NOT own: store mutations, drag behavior, or canvas interactions.
 */
import React, { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { StepNodeData } from '@/types/desktop';
import { useHarnessStore } from '../../../store/harness-store';
import { LucideIcon } from '../LucideIcon';
import { stepTypeMeta } from './step-type-meta';

const POPOVER_OFFSET_X = 18;
const POPOVER_OFFSET_Y = 14;
const POPOVER_WIDTH = 320;
const POPOVER_HEIGHT = 320;
const VIEWPORT_MARGIN = 12;

interface StepThinkingPopoverProps {
  stepId: string;
  stepData: StepNodeData;
  /** Initial cursor position (clientX/clientY) captured on mouse-enter */
  initialAnchor: { x: number; y: number };
}

export function StepThinkingPopover({ stepId, stepData, initialAnchor }: StepThinkingPopoverProps) {
  const divRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const cursorRef = useRef<{ x: number; y: number }>(initialAnchor);

  // Fine-grained store selectors — avoid re-render on unrelated state changes
  const thinkings = useHarnessStore((s) => s.stepThinkings[stepId]);
  const status = useHarnessStore((s) => s.stepStatuses[stepId]);

  const isRunning = status === 'running';
  const hasThinkings = thinkings && thinkings.length > 0;

  // -------------------------------------------------------------------
  // Cursor tracking via RAF — never calls setState, purely DOM mutation
  // -------------------------------------------------------------------
  const applyPosition = useCallback(() => {
    const el = divRef.current;
    if (!el) return;

    const { x, y } = cursorRef.current;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Measure the actual rendered element — the popover is usually far
    // shorter/narrower than the CSS max-size, so flipping against the
    // hardcoded constants overshoots the cursor by a wide margin. The
    // constants remain only as a pre-measure fallback (first paint).
    const w = el.offsetWidth || POPOVER_WIDTH;
    const h = el.offsetHeight || POPOVER_HEIGHT;

    let left = x + POPOVER_OFFSET_X;
    let top = y + POPOVER_OFFSET_Y;

    // Flip only when the measured size doesn't actually fit
    if (left + w + VIEWPORT_MARGIN > vw) {
      left = x - w - POPOVER_OFFSET_X;
    }
    if (top + h + VIEWPORT_MARGIN > vh) {
      top = y - h - POPOVER_OFFSET_Y;
    }

    // Clamp both bounds on both axes so the popover never renders off-screen,
    // even when the flipped position still overflows (e.g. narrow viewport).
    left = Math.min(Math.max(VIEWPORT_MARGIN, left), vw - w - VIEWPORT_MARGIN);
    top = Math.min(Math.max(VIEWPORT_MARGIN, top), vh - h - VIEWPORT_MARGIN);

    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, []);

  useEffect(() => {
    // Apply initial position immediately
    applyPosition();

    const handleMouseMove = (e: MouseEvent) => {
      cursorRef.current = { x: e.clientX, y: e.clientY };
      if (rafRef.current !== null) return; // already scheduled
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        applyPosition();
      });
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });

    // Content grows as a step streams thinking deltas — re-flip/clamp
    // against the new measured size even without cursor movement.
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && divRef.current) {
      resizeObserver = new ResizeObserver(() => {
        applyPosition();
      });
      resizeObserver.observe(divRef.current);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      resizeObserver?.disconnect();
    };
  }, [applyPosition]);

  // Auto-scroll to bottom when new thinkings arrive
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [thinkings]);

  const meta = stepTypeMeta(stepData.stepType as string | undefined);

  const popoverContent = (
    <div
      ref={divRef}
      className="step-thinking-popover"
      aria-hidden="true"
      style={{ position: 'fixed', top: 0, left: 0 }}
    >
      {/* Header */}
      <div
        className="step-thinking-popover-header"
        style={{ ['--stp-accent' as string]: meta.accent }}
      >
        <div className="step-thinking-popover-type-icon">
          <LucideIcon name={meta.icon} size={12} />
        </div>
        <span className="step-thinking-popover-type-label">{meta.label}</span>
        <span className="step-thinking-popover-title">{stepData.title}</span>
      </div>

      {/* Body */}
      {isRunning || hasThinkings ? (
        <div ref={scrollRef} className="step-thinking-popover-scroll">
          {hasThinkings && thinkings.map((entry, i) => (
            <p
              key={i}
              className={`step-thinking-entry step-thinking-entry--${entry.kind}`}
            >
              {entry.kind === 'tool' && (
                <span className="step-thinking-entry-tool-prefix">⚙ </span>
              )}
              {entry.text}
            </p>
          ))}
          {isRunning && (
            <div className="step-thinking-thinking-indicator">
              <span className="step-thinking-dot" />
              <span className="step-thinking-dot" />
              <span className="step-thinking-dot" />
              <span className="step-thinking-thinking-label">thinking…</span>
            </div>
          )}
        </div>
      ) : (
        /* Idle summary */
        <div className="step-thinking-popover-idle">
          <div className="step-thinking-idle-chips">
            {(stepData.roles ?? []).length > 0 && (
              <span className="step-thinking-idle-chip step-thinking-idle-chip--role">
                <LucideIcon name="User" size={10} />
                {(stepData.roles ?? []).length} role{(stepData.roles ?? []).length !== 1 ? 's' : ''}
              </span>
            )}
            {(stepData.mods ?? []).length > 0 && (
              <span className="step-thinking-idle-chip step-thinking-idle-chip--mod">
                <LucideIcon name="Wrench" size={10} />
                {(stepData.mods ?? []).length} mod{(stepData.mods ?? []).length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          {(stepData.prompt ?? stepData.description) && (
            <p className="step-thinking-idle-prompt">
              {(stepData.prompt ?? stepData.description ?? '').slice(0, 280)}
              {(stepData.prompt ?? stepData.description ?? '').length > 280 ? '…' : ''}
            </p>
          )}
          {!(stepData.prompt ?? stepData.description) && (
            <p className="step-thinking-idle-empty">No prompt configured</p>
          )}
        </div>
      )}
    </div>
  );

  return createPortal(popoverContent, document.body);
}
