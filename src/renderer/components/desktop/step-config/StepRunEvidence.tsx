/**
 * StepRunEvidence.tsx — Execution evidence surface (routing + connections)
 *
 * Responsibility:
 * - Renders the read-only "Why this model" routing-evidence card (WS2 smart
 *   routing) and the Connections/Loop cards for a step.
 *
 * Boundaries:
 * - Owns: presentation of routing evidence (`harness-store.stepModels`) and
 *   of the connection/loop summary handed down by the caller.
 * - Does NOT own: any step-state mutation — this surface is purely
 *   read-only (see `StepConfigCore.tsx` for the editable
 *   Instructions/Role/Mod/Execution surface it's rendered alongside).
 *
 * Extracted verbatim from StepInfoModal.tsx (Phase 6 refactor) so a future
 * right-side inspector can host this surface without the modal chrome.
 * `stepData` is accepted for prop-signature symmetry with `StepConfigCore`
 * (both surfaces are handed the same `{ stepId, stepData }` pair by their
 * composing parent) even though this component doesn't read it today.
 */
import React from 'react';
import { LucideIcon } from '../LucideIcon';
import { useDesktopStore } from '../../../store/desktop-store';
import { useHarnessStore } from '../../../store/harness-store';
import { findOwningFrame } from '../../../lib/harness-compiler';
import type { StepNodeData } from '@/types/desktop';
import type { AgenticExecutionStatus } from '@/types/harness';
import type { RoutedModelEvidence } from '@/types/ipc-events';

// ─── "Why this model" evidence card (WS2 smart routing) ────────────
//
// No dedicated CSS exists for the "Benchmarked" seal yet (this file is
// CSS-change-restricted this round), so it's styled inline. The same style
// constant is duplicated in ArenaButton.tsx's RecommendationCard so the two
// surfaces read as one visual language — see the comment there. The seal
// word is "Benchmarked" — NEVER "verified" (product framing, see
// RoutedModelEvidence.sealed doc comment in src/types/ipc-events.ts).

const BENCHMARKED_PILL_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 9,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  padding: '2px 7px',
  borderRadius: 8,
  color: '#A0F695',
  background: 'rgba(160, 246, 149, 0.15)',
  border: '1px solid rgba(160, 246, 149, 0.3)',
  whiteSpace: 'nowrap',
};

const UNSEALED_NOTE_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  fontSize: 9,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  padding: '2px 7px',
  borderRadius: 8,
  color: 'rgba(161, 161, 170, 0.85)',
  background: 'rgba(161, 161, 170, 0.1)',
  border: '1px solid rgba(161, 161, 170, 0.2)',
  whiteSpace: 'nowrap',
};

const WHY_MODEL_HEADER_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
};

const WHY_MODEL_METRICS_STYLE: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 6,
  marginTop: 6,
  fontSize: 10,
  color: '#a8a8b0',
};

// ─── Rosetta context-mode badge (spec:
// docs/superpowers/specs/2026-07-10-rosetta-context-manifest.md) ───
//
// Reuses `.step-config-atom-tag` (the same generic accent-pill class the
// "Why this model" source tag above uses) rather than adding a new CSS rule
// — this is purely a `--atom-accent` value, not a new visual language. Violet
// ties it to the same "flow identity" hue FrameNode.tsx's workflow icon/
// export button/context-mode select already use, distinct from every
// status/routing color (green/amber/red/blue) this panel uses elsewhere.
const CONTEXT_MODE_ACCENT = '#A78BFA';

function formatLatency(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)} min`;
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(2)} s`;
  return `${Math.round(ms)} ms`;
}

function formatCost(usd: number): string {
  if (usd === 0) return 'free';
  if (usd < 0.0001) return `$${(usd * 1e6).toFixed(2)}µ`;
  return `$${usd.toFixed(4)}`;
}

/** Unsealed evidence still gets a muted, honest note — never "verified". */
function unsealedNote(evidence: RoutedModelEvidence): string {
  return evidence.source === 'external-router' ? 'External' : 'Unbenchmarked';
}

// ─── Props ────────────────────────────────────────────────────────

export interface StepRunEvidenceProps {
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
}

// ─── Evidence surface ───────────────────────────────────────────────

export function StepRunEvidence({ stepId, connections, status }: StepRunEvidenceProps) {
  // `?? {}`: defensive default for pre-existing test fixtures that mock
  // harness-store without `stepIterations` — only the live-iteration line in
  // the loop card below reads this.
  const stepIterations = useHarnessStore((s) => s.stepIterations) ?? {};
  const liveLoopIteration = status === 'running' ? stepIterations[stepId] : undefined;
  // Same defensive-default contract as stepIterations above, for the same
  // reason: pre-existing test fixtures may mock harness-store without
  // `stepModels`. Populated only once a run has actually routed this step —
  // the "Why this model" card below is absent until then.
  const stepModels = useHarnessStore((s) => s.stepModels) ?? {};
  const stepModelInfo = stepModels[stepId];

  // Rosetta context-mode badge: derived from this step's OWNING FRAME (canvas
  // data), not from `activeFlow` — a step-config surface must show the truth
  // before any compile/run has happened, and `findOwningFrame` is the exact
  // same lookup harness-compiler.ts uses to copy this value onto the compiled
  // AgenticFlow (see harness-compiler.ts's `flowContextMode`). Plain (non-
  // `useShallow`) selector returning a primitive — mirrors FrameNode.tsx's
  // `roleCount` selector: recomputing the `.find()` every render is cheap,
  // and returning just the primitive lets zustand's default `Object.is` bail
  // out re-renders whenever it doesn't actually change.
  const contextMode = useDesktopStore((s) => findOwningFrame(stepId, s.mentalNodes)?.data.contextMode);

  return (
    <>
      {/* ── Rosetta context mode (feedback-only; absent in blind — no clutter
          for the default/today's-behavior case) ── */}
      {contextMode === 'feedback' && (
        <div
          className="step-config-connection-card"
          data-testid="step-info-context-mode-card"
          style={{ marginBottom: 10 }}
        >
          <div className="step-config-connection-label">Context</div>
          <span
            className="step-config-atom-tag"
            data-testid="step-info-context-mode-badge"
            style={{ ['--atom-accent' as string]: CONTEXT_MODE_ACCENT }}
          >
            Feedback mode
          </span>
          <p className="step-config-hint">
            This flow's steps read and write shared context files under .fluxor/run-context during the run.
          </p>
        </div>
      )}

      {/* ── Why this model (WS2 routing evidence) ── */}
      {stepModelInfo && (
        <div
          className="step-config-connection-card"
          data-testid="step-info-why-model"
          style={{ marginTop: 10 }}
        >
          <div style={WHY_MODEL_HEADER_STYLE}>
            <span className="step-config-connection-label" style={{ marginBottom: 0 }}>
              Why this model
            </span>
            {stepModelInfo.evidence?.sealed ? (
              <span data-testid="step-info-benchmarked-pill" style={BENCHMARKED_PILL_STYLE}>
                <LucideIcon name="ShieldCheck" size={10} />
                Benchmarked
              </span>
            ) : stepModelInfo.evidence ? (
              <span style={UNSEALED_NOTE_STYLE}>{unsealedNote(stepModelInfo.evidence)}</span>
            ) : null}
          </div>
          <div className="step-config-connection-value" style={{ marginTop: 4 }}>
            {stepModelInfo.modelId}
          </div>
          {stepModelInfo.evidence?.reason && (
            <p className="step-config-hint">{stepModelInfo.evidence.reason}</p>
          )}
          {stepModelInfo.evidence && (
            <div style={WHY_MODEL_METRICS_STYLE}>
              {stepModelInfo.evidence.score !== undefined && <span>Score {stepModelInfo.evidence.score}</span>}
              {stepModelInfo.evidence.costPerRun !== undefined && (
                <span>{formatCost(stepModelInfo.evidence.costPerRun)}</span>
              )}
              {stepModelInfo.evidence.latencyMs !== undefined && (
                <span>{formatLatency(stepModelInfo.evidence.latencyMs)}</span>
              )}
              <span className="step-config-atom-tag" style={{ ['--atom-accent' as string]: '#4285F4' }}>
                {stepModelInfo.evidence.source}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Connections ── */}
      <h3 className="step-config-section-label">Connections</h3>
      <div className="step-config-connections">
        <div className="step-config-connection-card">
          <div className="step-config-connection-label">Incoming</div>
          {connections.incoming.length === 0 ? (
            <span className="step-config-connection-value--empty">None (root)</span>
          ) : (
            <span className="step-config-connection-value">
              {connections.incoming.length} step{connections.incoming.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="step-config-connection-card">
          <div className="step-config-connection-label">Outgoing</div>
          {connections.outgoing.length === 0 ? (
            <span className="step-config-connection-value--empty">None (terminal)</span>
          ) : (
            <span className="step-config-connection-value">
              {connections.outgoing.length} step{connections.outgoing.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        {(connections.loopOut || connections.loopIn) && (
          <div
            className="step-config-connection-card"
            data-testid="step-info-loop-card"
            style={{ gridColumn: '1 / -1', borderColor: 'rgba(245, 158, 11, 0.25)' }}
          >
            <div className="step-config-connection-label">Loop</div>
            {connections.loopOut && (
              <div className="step-config-connection-value" data-testid="step-info-loop-out">
                Repeats ×{connections.loopOut.maxIterations} — back to "{connections.loopOut.toTitle}"
              </div>
            )}
            {connections.loopIn && (
              <div className="step-config-connection-value" data-testid="step-info-loop-in">
                Loop entry ×{connections.loopIn.maxIterations} — from "{connections.loopIn.fromTitle}"
              </div>
            )}
            {liveLoopIteration && (
              <div
                className="step-config-connection-value"
                data-testid="step-info-loop-live"
                role="status"
                aria-live="polite"
              >
                Now running — iteration {liveLoopIteration.iteration} of {liveLoopIteration.total}
              </div>
            )}
            <p className="step-config-hint">Edit the iteration count on the loop edge itself.</p>
          </div>
        )}
      </div>
    </>
  );
}
