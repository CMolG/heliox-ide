/**
 * StepInspector.tsx — Inspector routing target for a single selected Step
 *
 * Responsibility:
 * - Renders the editable step identity fields (title, description) that live
 *   above `StepConfigCore` in the right-side Inspector, plus a "Run evidence"
 *   ghost button that opens the (now evidence-only) `StepInfoModal`.
 * - Owns the title/description local-draft editing state (committed on
 *   blur/Enter — see `commitTitle`/`commitDescription` below) and the
 *   evidence-modal open/close toggle.
 *
 * Boundaries:
 * - Owns: this file's own local UI state and the two field mutations it
 *   commits directly (`updateStepData` for `title`/`description`).
 * - Does NOT own: the Instructions/Role/Mod/Execution editing surface —
 *   `desktop/step-config/StepConfigCore.tsx` owns that (rendered here
 *   unchanged, same as it always was inside StepInfoModal pre-Phase-8). Does
 *   NOT own the evidence content itself — `StepInfoModal`/`StepRunEvidence`
 *   own that. Does NOT own the incoming/outgoing/loop MATH itself — that
 *   stays in the shared `mental/step-connections.ts` helpers this file calls.
 *
 * Performance (drag-tick perf fix — residual of the InspectorPanel fix):
 * - This component is mounted for as long as a Step stays selected, and the
 *   canvas fires a store `set()` on every drag frame of ANY node (see
 *   `updateMentalNode` in desktop-store.ts). It used to subscribe to the
 *   RAW `mentalNodes`/`mentalEdges` arrays and re-derive `connections` on
 *   every render — since `updateMentalNode` rebuilds the `mentalNodes` array
 *   via `.map()` on every drag tick (even though untouched nodes keep their
 *   old object reference), that raw-array subscription changed reference on
 *   every tick regardless of which node moved, so dragging ANYTHING re-rendered
 *   this panel whenever a step was selected.
 * - Fixed with two narrow, independently-bailing subscriptions instead:
 *   - Subscription A (`relevantEdges`): only this step's own edges, shallow-
 *     compared — see its comment below for why that's drag-stable.
 *   - Subscription B (`connectedTitles`): only the (at most two) connected
 *     step TITLES `connections` can actually surface — see its comment below
 *     for why `incoming`/`outgoing` need no title lookup at all.
 *   `connIds`/`connections` are then cheap local derivations (`useMemo`) off
 *   of those two subscriptions, not their own store reads.
 *
 * `key={stepId}` at the call site (InspectorPanel.tsx) is load-bearing: it
 * forces a full remount whenever the selected step changes, which is what
 * resets `titleDraft`/`descriptionDraft`/`showEvidence` back to fresh values
 * for the newly-selected step — no manual resync `useEffect` needed.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { LucideIcon } from '@/renderer/components/desktop/LucideIcon';
import { StepConfigCore } from '@/renderer/components/desktop/step-config/StepConfigCore';
import { StepInfoModal } from '@/renderer/components/desktop/StepInfoModal';
import { stepTypeMeta } from '@/renderer/components/desktop/mental/step-type-meta';
import { computeStepConnectionIds, stepTitleById } from '@/renderer/components/desktop/mental/step-connections';
import { useDesktopStore } from '@/renderer/store/desktop-store';
import type { StepNodeData } from '@/types/desktop';
import type { AgenticExecutionStatus } from '@/types/harness';

export interface StepInspectorProps {
  stepId: string;
  stepData: StepNodeData;
  status?: AgenticExecutionStatus;
}

export function StepInspector({ stepId, stepData, status }: StepInspectorProps) {
  const updateStepData = useDesktopStore((s) => s.updateStepData);

  // Subscription A: this step's own edges only (either direction), shallow-
  // compared. Dragging a node only ever calls `updateMentalNode`, which
  // rewrites `mentalNodes` — `mentalEdges` itself (and every edge OBJECT
  // inside it) keeps its exact reference across a drag tick. So `.filter()`
  // here re-runs every render but yields the SAME edge references (same
  // order) whenever no edge touching THIS step was added/removed/rewired —
  // `useShallow` bails out on that, and only lets through a change to this
  // step's own connection set.
  const relevantEdges = useDesktopStore(
    useShallow((s) => s.mentalEdges.filter((e) => e.sourceId === stepId || e.targetId === stepId)),
  );

  // Ids only — no store read, cheap enough to recompute every render.
  const connIds = useMemo(() => computeStepConnectionIds(stepId, relevantEdges), [stepId, relevantEdges]);

  // Subscription B: ONLY the connected-step title(s) `connections` can
  // actually surface — `loopIn.fromTitle`/`loopOut.toTitle`. `incoming`/
  // `outgoing` are passed through as raw ids below with no lookup at all:
  // StepRunEvidence.tsx only ever reads their `.length` ("N steps"), never a
  // title or id from inside them, so resolving titles for those would be
  // dead work. A plain string array shallow-compares by VALUE, and resolving
  // through `mentalNodes` here (rather than subscribing to it directly) means
  // dragging any node — connected or not — never invalidates this: titles
  // only change via `updateStepData`, and the connection set (which id(s) we
  // even look up) only changes via `connIds` above. Empty (the common,
  // loop-free case) short-circuits to `[]` every render, so this bails out
  // unconditionally for the vast majority of steps.
  const connectedTitles = useDesktopStore(
    useShallow((s) => {
      const titles: string[] = [];
      if (connIds.loopIn) titles.push(stepTitleById(connIds.loopIn.sourceId, s.mentalNodes));
      if (connIds.loopOut) titles.push(stepTitleById(connIds.loopOut.targetId, s.mentalNodes));
      return titles;
    }),
  );

  // Reassemble the exact `StepConnections` shape StepInfoModal/StepRunEvidence
  // expect, from `connIds` (ids + already-clamped maxIterations) and
  // `connectedTitles` (resolved above, same fixed order: loopIn then loopOut
  // — loopOut's title sits at index 1 only when loopIn also occupied index 0).
  const connections = useMemo(() => {
    const loopIn = connIds.loopIn
      ? { fromTitle: connectedTitles[0], maxIterations: connIds.loopIn.maxIterations }
      : undefined;
    const loopOut = connIds.loopOut
      ? { toTitle: connectedTitles[connIds.loopIn ? 1 : 0], maxIterations: connIds.loopOut.maxIterations }
      : undefined;
    return { incoming: connIds.incoming, outgoing: connIds.outgoing, loopIn, loopOut };
  }, [connIds, connectedTitles]);

  const [titleDraft, setTitleDraft] = useState(stepData.title);
  const [descriptionDraft, setDescriptionDraft] = useState(stepData.description ?? '');
  const [showEvidence, setShowEvidence] = useState(false);

  // Never commit a blank title — revert the draft to the last-known-good
  // value instead (mirrors NodeTree's rename guard: `if (renameValue.trim())`).
  const commitTitle = useCallback(() => {
    const trimmed = titleDraft.trim();
    if (trimmed) updateStepData(stepId, { title: trimmed });
    else setTitleDraft(stepData.title);
  }, [stepId, titleDraft, stepData.title, updateStepData]);

  // Description has no such guard — an empty description is a perfectly
  // valid "no description yet" state, unlike an empty title.
  const commitDescription = useCallback(() => {
    updateStepData(stepId, { description: descriptionDraft });
  }, [stepId, descriptionDraft, updateStepData]);

  const meta = stepTypeMeta(stepData.stepType as string | undefined);

  return (
    <div data-testid="inspector-step">
      <h3 className="step-config-section-label">Step</h3>
      <div className="inspector-title-row">
        <span
          className="inspector-step-icon"
          aria-hidden="true"
          style={{ ['--step-accent' as string]: meta.accent }}
        >
          <LucideIcon name={meta.icon} size={14} />
        </span>
        <input
          className="inspector-title-input"
          data-testid="inspector-step-title"
          aria-label="Step title"
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            } else if (e.key === 'Escape') {
              setTitleDraft(stepData.title);
            }
          }}
        />
      </div>

      <label htmlFor={`inspector-step-description-${stepId}`} className="step-config-label">
        Description
      </label>
      <textarea
        id={`inspector-step-description-${stepId}`}
        className="inspector-description-textarea"
        data-testid="inspector-step-description"
        value={descriptionDraft}
        onChange={(e) => setDescriptionDraft(e.target.value)}
        onBlur={commitDescription}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setDescriptionDraft(stepData.description ?? '');
        }}
        placeholder="A short note about this step's purpose…"
        rows={2}
      />

      <StepConfigCore stepId={stepId} stepData={stepData} status={status} />

      <div className="inspector-evidence-row">
        <button
          type="button"
          className="step-config-run-from-btn"
          data-testid="inspector-run-evidence-btn"
          onClick={() => setShowEvidence(true)}
        >
          <LucideIcon name="Eye" size={13} />
          Run evidence
        </button>
      </div>

      {showEvidence && createPortal(
        <StepInfoModal
          stepId={stepId}
          stepData={stepData}
          connections={connections}
          status={status}
          onClose={() => setShowEvidence(false)}
        />,
        document.body,
      )}
    </div>
  );
}
