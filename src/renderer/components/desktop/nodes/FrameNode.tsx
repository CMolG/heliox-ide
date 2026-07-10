import React, { useCallback } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { FrameNodeData, StepGraphNode } from '@/types/desktop';
import type { AgenticExecutionStatus } from '@/types/harness';
import type { ModelPolicy, SelectionStrategy } from '@/types/ipc-events';
import { useDesktopStore } from '../../../store/desktop-store';
import { useHarnessStore } from '../../../store/harness-store';
import { useFluxorStore } from '../../../store';
import { exportActiveFlow } from '../../../logic/flow-actions';
import { LucideIcon } from '../LucideIcon';
import { FluxorSpinner } from '../../brand/FluxorSpinner';

function isStepNode(n: { type?: string }): n is StepGraphNode {
  return n.type === 'step';
}

// `completed`/`error`/`paused` used to fall through to the same plain "Run"
// button as `idle` — states-polish.md §1: "a failed flow looks exactly like
// one that never ran." index.css already carries this exact color
// vocabulary for the same three statuses on .step-node-shell
// (index.css:2306-2329 — completed=green/34,197,94, error=red/248,113,113,
// paused=amber/250,204,21), but index.css and StepNode.tsx are P1a's this
// round, so this reuses those hues via inline style instead of a new
// .pipeline-frame-run.is-execution-* class. idle/compiling/running are
// intentionally absent (looks up as `undefined` -> no inline style at all),
// so their existing CSS-driven look — including the amber `:disabled` state
// — is pixel-identical to before.
const STATUS_RUN_ACCENTS: Partial<Record<AgenticExecutionStatus, React.CSSProperties>> = {
  completed: {
    borderColor: 'rgba(34, 197, 94, 0.85)',
    background: 'rgba(34, 197, 94, 0.14)',
    color: '#bbf7d0',
  },
  error: {
    borderColor: 'rgba(248, 113, 113, 0.85)',
    background: 'rgba(248, 113, 113, 0.14)',
    color: '#fecaca',
  },
  paused: {
    borderColor: 'rgba(250, 204, 21, 0.75)',
    background: 'rgba(250, 204, 21, 0.14)',
    color: '#fde68a',
  },
};

// ─── WS2: model-policy select — pure value<->ModelPolicy mapping ───
//
// A native <select>'s value can only be a flat string, so `smart-local`
// policies are encoded as `smart-local:<strategy>`. Pure + exported so the
// mapping is unit-testable independent of the store/DOM.
const FIXED_POLICY: ModelPolicy = { mode: 'fixed' };

export function policyToValue(policy: ModelPolicy | undefined): string {
  if (!policy) return 'fixed';
  if (policy.mode === 'smart-local') return `smart-local:${policy.strategy}`;
  return policy.mode; // 'fixed' | 'smart-external'
}

export function valueToPolicy(value: string): ModelPolicy {
  if (value === 'smart-external') return { mode: 'smart-external' };
  if (value.startsWith('smart-local:')) {
    return { mode: 'smart-local', strategy: value.slice('smart-local:'.length) as SelectionStrategy };
  }
  return { mode: 'fixed' };
}

const POLICY_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'fixed', label: 'Fixed' },
  { value: 'smart-local:best-score', label: 'Smart · best score' },
  { value: 'smart-local:cheapest', label: 'Smart · cheapest' },
  { value: 'smart-local:fastest', label: 'Smart · fastest' },
  { value: 'smart-local:best-value', label: 'Smart · best value' },
  { value: 'smart-external', label: 'Smart · External (OpenRouter)' },
];

// ─── Rosetta context-mode select — flow-level toggle (spec:
// docs/superpowers/specs/2026-07-10-rosetta-context-manifest.md) ───
//
// Pure value<->contextMode mapping, exported so it's unit-testable in
// isolation (same rationale as policyToValue/valueToPolicy above). Only one
// direction is needed — the <select>'s value IS already exactly
// 'blind' | 'feedback' (no composite encoding like modelPolicy's
// `smart-local:<strategy>`), so the onChange handler below casts
// `event.target.value` directly instead of round-tripping through a decoder.
export function contextModeToValue(mode: FrameNodeData['contextMode']): 'blind' | 'feedback' {
  return mode === 'feedback' ? 'feedback' : 'blind';
}

const CONTEXT_MODE_OPTIONS: ReadonlyArray<{ value: 'blind' | 'feedback'; label: string }> = [
  { value: 'blind', label: 'Blind (default)' },
  { value: 'feedback', label: 'Feedback' },
];

// Quiet power-user affordance, not a headline — a native <select> keeps full
// keyboard/AT support for free (same rationale as StepInfoModal's AtomPicker).
// No dedicated CSS class exists for it (this file is CSS-change-restricted
// this round), so it echoes .pipeline-frame-export's dark-pill treatment
// (index.css:2025-2044) via inline style instead of touching index.css.
const POLICY_WRAP_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 28,
  padding: '0 8px',
  borderRadius: 7,
  border: '1px solid rgba(244, 244, 245, 0.14)',
  background: 'rgba(10, 10, 10, 0.72)',
  color: 'rgba(228, 228, 231, 0.8)',
};

const POLICY_SELECT_STYLE: React.CSSProperties = {
  appearance: 'none',
  WebkitAppearance: 'none',
  background: 'transparent',
  border: 'none',
  color: 'inherit',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.01em',
  cursor: 'pointer',
  outline: 'none',
  maxWidth: 148,
};

export const FrameNode = React.memo(function FrameNode({ id, data }: NodeProps) {
  const frameData = data as unknown as FrameNodeData;
  // Narrowed from a raw `s.mentalNodes` subscription (perf fix, 2026-07-05
  // canvas/inspector plan Phase 3): every frame used to subscribe to the
  // ENTIRE nodes array just to re-derive `roleCount` on every render, so
  // moving/editing ANY node on the canvas re-rendered every frame. Only the
  // primitive count is ever displayed, so a plain (non-`useShallow`) selector
  // is enough — it bails via `Object.is` whenever the count itself repeats.
  const roleCount = useDesktopStore((s) => {
    const uniqueRoleNames = new Set<string>();
    for (const n of s.mentalNodes) {
      if (isStepNode(n) && (n as StepGraphNode).parentId === id) {
        for (const role of (n as StepGraphNode).data.roles ?? []) {
          uniqueRoleNames.add(role.name);
        }
      }
    }
    return uniqueRoleNames.size;
  });
  const bringMentalToFront = useDesktopStore((s) => s.bringMentalToFront);
  const modelPolicy = useDesktopStore((s) => s.settings?.modelPolicy) ?? FIXED_POLICY;
  const setModelPolicy = useDesktopStore((s) => s.setModelPolicy);
  const updateFrameData = useDesktopStore((s) => s.updateFrameData);
  const compileCurrentCanvas = useHarnessStore((s) => s.compileCurrentCanvas);
  const startExecution = useHarnessStore((s) => s.startExecution);
  const executionStatus = useHarnessStore((s) => s.executionStatus);
  const addToast = useFluxorStore((s) => s.addToast);

  // WS2: writes settings.modelPolicy, consumed by harness-store's executeFlow
  // on the NEXT dispatch of this flow (startExecution/runStep/runFromStep) —
  // this control only ever writes the policy, never triggers a run itself.
  const handlePolicyChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    setModelPolicy(valueToPolicy(event.target.value));
  }, [setModelPolicy]);

  // Writes FrameNodeData.contextMode directly (this Frame's own canvas data),
  // NOT settings.modelPolicy above — contextMode is per-flow, not global. The
  // full chain: this toggle -> FrameNodeData.contextMode -> harness-compiler.ts
  // copies it onto the compiled AgenticFlow -> the executor reads
  // AgenticFlow.contextMode to decide blind vs feedback.
  const handleContextModeChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    updateFrameData(id, { contextMode: event.target.value as 'blind' | 'feedback' });
  }, [id, updateFrameData]);

  const isBusy = executionStatus === 'compiling' || executionStatus === 'running';

  // Run the pipeline straight from the Flow header (replaces the old harness dock).
  const handleRun = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    const flow = compileCurrentCanvas();
    if (flow) void startExecution();
  }, [compileCurrentCanvas, startExecution]);

  // Export the compiled pipeline to the portable fluxor-flow.json interchange
  // format (src/main/flow-export/fluxor-flow.ts) via a native save dialog.
  // Delegates to `exportActiveFlow` (logic/flow-actions.ts, extracted in
  // Phase 11) so the Inspector's FlowInspector can trigger the identical
  // compile -> export -> toast path without duplicating it. Zero behavioral
  // change from this component's perspective.
  const handleExport = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    void exportActiveFlow(addToast);
  }, [addToast]);

  const stepCount = frameData.childIds.length;
  const stepLabel = stepCount === 1 ? '1 step' : `${stepCount} steps`;

  // roleCount (unique roles across this frame's child steps) is now resolved
  // by the narrowed `mentalNodes` selector above.
  const roleLabel = roleCount === 1 ? '1 role' : `${roleCount} roles`;

  const runLabel = executionStatus === 'running'
    ? 'Running'
    : executionStatus === 'compiling'
      ? 'Compiling'
      : executionStatus === 'completed'
        ? 'Completed'
        : executionStatus === 'error'
          ? 'Failed'
          : executionStatus === 'paused'
            ? 'Paused'
            : 'Run';

  const runAriaLabel = isBusy
    ? 'Pipeline running'
    : executionStatus === 'completed'
      ? 'Pipeline completed — run again'
      : executionStatus === 'error'
        ? 'Pipeline failed — retry'
        : executionStatus === 'paused'
          ? 'Pipeline paused — resume'
          : 'Run pipeline';

  const runAccentStyle = STATUS_RUN_ACCENTS[executionStatus];

  // Frames intentionally render NO connection handles — frame edges have no
  // compile semantics (`compileFlowFromCanvas` in harness-compiler.ts only
  // wires step↔step; a frame edge would resolve to a dashed "attachment"
  // MentalEdge in MentalGraphCanvas's rfEdges memo and be silently dropped by
  // the compiler). Unlike StepNode/MentalNode, this component has no
  // `<Handle>` elements at all.
  return (
    <section
      className="pipeline-frame-node"
      data-testid={`pipeline-frame-${id}`}
      aria-label={`Pipeline frame ${frameData.title}`}
      onPointerDownCapture={() => bringMentalToFront(id)}
    >
      <div className="pipeline-frame-title">
        <span className="pipeline-frame-workflow-icon" aria-hidden="true">
          <LucideIcon name="Workflow" size={13} />
        </span>
        <span className="pipeline-frame-kicker">Flow</span>
        <strong>{frameData.title}</strong>
        <span className="pipeline-frame-count">{stepLabel}</span>
        {roleCount > 0 && (
          <span className="pipeline-frame-role-count" aria-label={`${roleLabel} assigned`}>
            <LucideIcon name="User" size={9} />
            {roleLabel}
          </span>
        )}
      </div>

      {/* Header action cluster: Export + Run, anchored top-right as one flex
          group so Export stays flush next to Run regardless of Run's label
          width (Run/Compiling/Running/Completed/Failed/Paused). */}
      <div className="pipeline-frame-actions">
        {/* Rosetta context-mode select — flow-level toggle for the context
            system (docs/superpowers/specs/2026-07-10-rosetta-context-manifest.md).
            Placed leftmost, before Model policy: it's a structural, set-once-
            per-flow-design choice (in 'feedback', the executor injects a
            <flow_awareness> block + per-step context files; 'blind' — the
            default — stays byte-identical to today), vs. Model policy's more
            frequently re-tuned routing choice. Reading left to right: "how
            this flow's steps see each other" -> "which model runs them" ->
            Export/Run. */}
        <div
          className="pipeline-frame-context-mode nodrag"
          title="Context mode for this flow"
        >
          <LucideIcon name="Eye" size={11} />
          <select
            className="pipeline-frame-context-mode-select"
            data-testid={`pipeline-frame-context-mode-${id}`}
            aria-label="Context mode for this flow"
            value={contextModeToValue(frameData.contextMode)}
            onChange={handleContextModeChange}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            {CONTEXT_MODE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* WS2 model-policy select — a quiet power-user affordance next to
            Export/Run, not a headline. Placed leftmost so Export stays flush
            next to Run (see the comment above this cluster). */}
        <div
          className="pipeline-frame-policy nodrag"
          style={POLICY_WRAP_STYLE}
          title="Model policy for this flow"
        >
          <LucideIcon name="Sparkles" size={11} />
          <select
            className="pipeline-frame-policy-select"
            data-testid={`pipeline-frame-policy-${id}`}
            aria-label="Model policy for this flow"
            value={policyToValue(modelPolicy)}
            onChange={handlePolicyChange}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            style={POLICY_SELECT_STYLE}
          >
            {POLICY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <button
          type="button"
          className="pipeline-frame-export nodrag"
          data-testid={`pipeline-frame-export-${id}`}
          aria-label={`Export "${frameData.title}" as a portable flow file`}
          title="Export flow (.flow.json)"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={handleExport}
        >
          <LucideIcon name="Download" size={12} />
        </button>

        {/* Run control — contextual to this pipeline (Figma-style). Wrapped in
            a role="status"/aria-live region (states-polish.md §6 — currently
            absent) so screen readers hear "Failed"/"Completed"/"Paused"/
            "Running" as the status changes; mirrors the role="status"
            aria-live="polite" pattern ArenaButton.tsx already uses for its own
            run-status notice. */}
        <div role="status" aria-live="polite">
          <button
            type="button"
            className="pipeline-frame-run nodrag"
            data-testid={`pipeline-frame-run-${id}`}
            aria-label={runAriaLabel}
            disabled={isBusy}
            style={runAccentStyle}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={handleRun}
          >
            {executionStatus === 'running' ? (
              <FluxorSpinner size={12} speed={1.4} />
            ) : executionStatus === 'completed' ? (
              <LucideIcon name="CheckCircle" size={11} />
            ) : executionStatus === 'error' ? (
              <LucideIcon name="XCircle" size={11} />
            ) : (
              <LucideIcon name="Play" size={11} />
            )}
            <span>{runLabel}</span>
          </button>
        </div>
      </div>

      {frameData.description && (
        <div className="pipeline-frame-meta">
          <p className="pipeline-frame-desc">{frameData.description}</p>
        </div>
      )}
      {frameData.missingCapabilitiesRequested && frameData.missingCapabilitiesRequested.length > 0 && (
        <div className="pipeline-frame-missing" aria-label="Missing capabilities requested">
          {frameData.missingCapabilitiesRequested.length}
        </div>
      )}
    </section>
  );
});
