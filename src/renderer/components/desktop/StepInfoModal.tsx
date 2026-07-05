/**
 * StepInfoModal.tsx — Renderer Desktop Surface Component
 *
 * Responsibility:
 * - Renders the read-only "Run evidence" popup for a pipeline step: an
 *   accessible dialog (`role="dialog"`, testid `step-info-modal`) that shows
 *   its current execution status, the WS2 "why this model" routing evidence,
 *   and its Connections/Loop summary.
 * - Owns the panel chrome only: overlay + header + status badge + the focus
 *   trap/Escape keyboard handling. The evidence content itself is delegated
 *   to `step-config/StepRunEvidence.tsx` (see Boundaries below).
 *
 * Phase 8: this modal used to also embed `StepConfigCore` (the editable
 * Instructions/Role/Mod/Execution surface) and was opened directly from
 * StepNode's context menu. Both moved to the right-side Inspector — see
 * `components/inspector/StepInspector.tsx`, which renders `StepConfigCore`
 * itself and opens THIS modal (now evidence-only) via its own "Run evidence"
 * button. StepNode no longer imports or opens this component at all.
 *
 * Boundaries:
 * - Owns: panel presentation and focus trap/keyboard handling.
 * - Does NOT own: the step-state mutations (`updateStepData`,
 *   `addRoleToStep`/`removeRoleFromStep`, `addModToStep`/`removeModFromStep`)
 *   or the Instructions/Role/Mod/Execution editing UI — those live in
 *   `step-config/StepConfigCore.tsx`, rendered by StepInspector, not by this
 *   file. Does NOT own the "Why this model" / Connections / Loop evidence
 *   cards — `step-config/StepRunEvidence.tsx` owns those. Does NOT own
 *   edge/connection data (computed by the caller via
 *   `mental/step-connections.ts`), dnd-kit drop-target wiring (StepNode owns
 *   that), or execution internals (harness-store owns `runStep`/
 *   `runFromStep`; StepConfigCore only invokes them).
 */
import React, { useEffect, useRef } from 'react';
import { LucideIcon } from './LucideIcon';
import { stepTypeMeta } from './mental/step-type-meta';
import { StepRunEvidence } from './step-config/StepRunEvidence';
import type { StepNodeData } from '@/types/desktop';
import type { AgenticExecutionStatus } from '@/types/harness';

// ─── Focus trap ─────────────────────────────────────────────────────

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

// ─── Status badge ─────────────────────────────────────────────────

function StatusBadge({ status }: { status?: AgenticExecutionStatus }) {
  const s = status ?? 'idle';
  return (
    <span
      className={`step-config-status step-config-status--${s}`}
      role="status"
      data-testid="step-info-status"
      aria-label={`Execution status: ${s}`}
    >
      {s}
    </span>
  );
}

// ─── Props ────────────────────────────────────────────────────────

export interface StepInfoModalProps {
  stepId: string;
  stepData: StepNodeData;
  connections: {
    incoming: string[];
    outgoing: string[];
    /** Present when this step is a loop edge's source (the later step) — it loops back to `toTitle` after completing. */
    loopOut?: { toTitle: string; maxIterations: number };
    /** Present when this step is a loop edge's target (the earlier step / loop entry point) — `fromTitle` loops back here. */
    loopIn?: { fromTitle: string; maxIterations: number };
  };
  status?: AgenticExecutionStatus;
  onClose: () => void;
}

// ─── Panel ────────────────────────────────────────────────────────

export function StepInfoModal({ stepId, stepData, connections, status, onClose }: StepInfoModalProps) {
  const meta = stepTypeMeta(stepData.stepType as string | undefined);
  const accent = meta.accent;

  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  // Focus the close button on mount for keyboard accessibility.
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  // Escape closes the panel; Tab / Shift+Tab is trapped inside it.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      // Every interactive element in this panel is either fully rendered or
      // fully unmounted (no CSS-hidden-but-present controls), so the
      // FOCUSABLE_SELECTOR query alone is a reliable focus-trap boundary —
      // deliberately not filtering by layout metrics (e.g. offsetParent),
      // which are meaningless in non-layout test environments (jsdom).
      // This query reaches into StepRunEvidence's rendered output too — safe,
      // since it doesn't portal its content and renders inside this
      // panelRef's DOM subtree. StepRunEvidence is read-only (no interactive
      // elements today), so in practice the close button below is the ONLY
      // focusable element this trap ever finds — Tab/Shift+Tab both just
      // keep it focused there (see StepInfoModal.test.tsx's keyboard
      // behavior suite for the degenerate-but-correct single-element case).
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (!active || !panel.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="step-config-overlay"
      data-testid="step-info-modal"
      role="dialog"
      aria-label={`Run evidence: ${stepData.title}`}
      aria-modal="true"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        className="step-config-panel"
        style={{ ['--step-accent' as string]: accent }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="step-config-header">
          <div className="step-config-icon" aria-hidden="true">
            <LucideIcon name={meta.icon} size={18} />
          </div>
          <div className="step-config-title-wrap">
            {/* Phase 8: this heading used to show the step's own title (the
                Inspector's StepInspector owns that identity now, via an
                editable input). This popup is reached only from there, so
                the step is always already visible on screen — the kicker
                below restates it for a quick confirmation, and the heading
                itself names what THIS popup is for. */}
            <h2 className="step-config-title">Run evidence</h2>
            <span className="step-config-kicker">{stepData.title}</span>
          </div>
          <StatusBadge status={status} />
          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Close step config panel"
            data-testid="step-info-modal-close"
            className="step-config-close"
          >
            <LucideIcon name="X" size={16} />
          </button>
        </div>

        <div className="step-config-body">
          <StepRunEvidence stepId={stepId} stepData={stepData} connections={connections} status={status} />
        </div>
      </div>
    </div>
  );
}
