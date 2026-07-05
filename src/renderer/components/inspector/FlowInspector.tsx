/**
 * FlowInspector.tsx — Inspector routing target for a single selected Frame (Flow)
 *
 * Responsibility:
 * - Renders the editable flow identity fields (title, description, tags,
 *   author, version) that used to be a placeholder card ("Flow tools land in
 *   the next phase") — Phase 11 fills that placeholder in for real.
 * - Owns the title/description/tags/author/version local-draft editing state
 *   (committed on blur/Enter, reverted on Escape — same conventions as
 *   `StepInspector.tsx`'s title/description fields).
 * - Renders the flow's step count + a clickable child-step list (resolves
 *   `childIds` to live Step nodes; clicking one moves the canvas selection to
 *   that step, same as clicking it directly on the canvas would).
 * - Renders the Actions row: Run (clones FrameNode's `handleRun` semantics),
 *   Export Flow, and Export Markdown (both delegate to `logic/flow-actions.ts`
 *   so the exact same compile -> IPC -> toast path FrameNode's header button
 *   uses is shared, not duplicated).
 *
 * Boundaries:
 * - Owns: this file's own local UI state and the field mutations it commits
 *   directly (`updateFrameData` for title/description/tags/author/version).
 * - Does NOT own: compilation (`harness-store.compileCurrentCanvas`), the
 *   export IPC calls themselves (`logic/flow-actions.ts`), or Markdown
 *   rendering (`lib/flow-markdown.ts`).
 *
 * `key={frameId}` at the call site (InspectorPanel.tsx) is load-bearing, same
 * reason as StepInspector: it forces a full remount whenever the selected
 * frame changes, resetting every draft back to the newly-selected frame's
 * current values with no manual resync `useEffect` needed.
 *
 * Compile scope note: like FrameNode's header Run/Export buttons, everything
 * here compiles the WHOLE canvas, not just this flow's own steps — that is
 * pre-existing `compileCurrentCanvas` semantics, unchanged by this file.
 */
import React, { useCallback, useState } from 'react';
import { LucideIcon } from '@/renderer/components/desktop/LucideIcon';
import { stepTypeMeta } from '@/renderer/components/desktop/mental/step-type-meta';
import { useDesktopStore } from '@/renderer/store/desktop-store';
import { useHarnessStore } from '@/renderer/store/harness-store';
import { useHelioxStore } from '@/renderer/store';
import { exportActiveFlow, exportActiveFlowMarkdown } from '@/renderer/logic/flow-actions';
import { theme } from '@/renderer/logic/theme';
import type { FrameNodeData, StepGraphNode } from '@/types/desktop';

export interface FlowInspectorProps {
  frameId: string;
  frameData: FrameNodeData;
}

/** Splits a comma-separated tags string into a trimmed, non-empty string[]. */
function parseTags(value: string): string[] {
  return value.split(',').map((t) => t.trim()).filter(Boolean);
}

const CHILD_ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '6px 8px',
  borderRadius: 7,
  border: `1px solid ${theme.border}`,
  background: theme.surfaceCard,
  color: theme.textPrimary,
  fontFamily: theme.fontInter,
  fontSize: 12,
  textAlign: 'left',
  cursor: 'pointer',
};

export function FlowInspector({ frameId, frameData }: FlowInspectorProps) {
  const updateFrameData = useDesktopStore((s) => s.updateFrameData);
  const mentalNodes = useDesktopStore((s) => s.mentalNodes);
  const setSelectedMentalNodeIds = useDesktopStore((s) => s.setSelectedMentalNodeIds);
  const compileCurrentCanvas = useHarnessStore((s) => s.compileCurrentCanvas);
  const startExecution = useHarnessStore((s) => s.startExecution);
  const executionStatus = useHarnessStore((s) => s.executionStatus);
  const addToast = useHelioxStore((s) => s.addToast);

  const [titleDraft, setTitleDraft] = useState(frameData.title);
  const [descriptionDraft, setDescriptionDraft] = useState(frameData.description ?? '');
  const [tagsDraft, setTagsDraft] = useState((frameData.tags ?? []).join(', '));
  const [authorDraft, setAuthorDraft] = useState(frameData.author ?? '');
  const [versionDraft, setVersionDraft] = useState(frameData.version ?? '');

  // Never commit a blank title — revert the draft to the last-known-good
  // value instead (mirrors StepInspector's identical guard).
  const commitTitle = useCallback(() => {
    const trimmed = titleDraft.trim();
    if (trimmed) updateFrameData(frameId, { title: trimmed });
    else setTitleDraft(frameData.title);
  }, [frameId, titleDraft, frameData.title, updateFrameData]);

  // Description/tags/author/version have no such guard — empty is a
  // perfectly valid "unset" state, and the compiler already treats an empty
  // string/array as absent when assembling the compiled flow's meta (see
  // harness-compiler.ts's truthiness-gated `...(flowAuthor ? {...} : {})`).
  const commitDescription = useCallback(() => {
    updateFrameData(frameId, { description: descriptionDraft });
  }, [frameId, descriptionDraft, updateFrameData]);

  const commitTags = useCallback(() => {
    updateFrameData(frameId, { tags: parseTags(tagsDraft) });
  }, [frameId, tagsDraft, updateFrameData]);

  const commitAuthor = useCallback(() => {
    updateFrameData(frameId, { author: authorDraft });
  }, [frameId, authorDraft, updateFrameData]);

  const commitVersion = useCallback(() => {
    updateFrameData(frameId, { version: versionDraft });
  }, [frameId, versionDraft, updateFrameData]);

  const isBusy = executionStatus === 'compiling' || executionStatus === 'running';

  // Clones FrameNode's handleRun semantics exactly: compile the whole canvas,
  // then start execution only if compilation succeeded.
  const handleRun = useCallback(() => {
    const flow = compileCurrentCanvas();
    if (flow) void startExecution();
  }, [compileCurrentCanvas, startExecution]);

  const handleExportFlow = useCallback(() => {
    void exportActiveFlow(addToast);
  }, [addToast]);

  const handleExportMarkdown = useCallback(() => {
    void exportActiveFlowMarkdown(addToast);
  }, [addToast]);

  const childSteps = frameData.childIds
    .map((id) => mentalNodes.find((n) => n.id === id))
    .filter((n): n is StepGraphNode => !!n && n.type === 'step');

  return (
    <div data-testid="inspector-frame">
      <h3 className="step-config-section-label">Flow</h3>

      <div className="inspector-title-row">
        <span className="inspector-step-icon" aria-hidden="true">
          <LucideIcon name="Workflow" size={14} />
        </span>
        <input
          className="inspector-title-input"
          data-testid="inspector-frame-title"
          aria-label="Flow title"
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            } else if (e.key === 'Escape') {
              setTitleDraft(frameData.title);
            }
          }}
        />
      </div>

      <label htmlFor={`inspector-frame-description-${frameId}`} className="step-config-label">
        Description
      </label>
      <textarea
        id={`inspector-frame-description-${frameId}`}
        className="inspector-description-textarea"
        data-testid="inspector-frame-description"
        value={descriptionDraft}
        onChange={(e) => setDescriptionDraft(e.target.value)}
        onBlur={commitDescription}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setDescriptionDraft(frameData.description ?? '');
        }}
        placeholder="A short note about this flow's purpose…"
        rows={2}
      />

      <label htmlFor={`inspector-frame-tags-${frameId}`} className="step-config-label">
        Tags
      </label>
      <input
        id={`inspector-frame-tags-${frameId}`}
        type="text"
        className="step-config-select"
        style={{ width: '100%', marginBottom: 10 }}
        data-testid="inspector-frame-tags"
        aria-label="Flow tags"
        value={tagsDraft}
        onChange={(e) => setTagsDraft(e.target.value)}
        onBlur={commitTags}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setTagsDraft((frameData.tags ?? []).join(', '));
          }
        }}
        placeholder="comma, separated, tags"
      />

      <label htmlFor={`inspector-frame-author-${frameId}`} className="step-config-label">
        Author
      </label>
      <input
        id={`inspector-frame-author-${frameId}`}
        type="text"
        className="step-config-select"
        style={{ width: '100%', marginBottom: 10 }}
        data-testid="inspector-frame-author"
        aria-label="Flow author"
        value={authorDraft}
        onChange={(e) => setAuthorDraft(e.target.value)}
        onBlur={commitAuthor}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setAuthorDraft(frameData.author ?? '');
          }
        }}
        placeholder="Unattributed"
      />

      <label htmlFor={`inspector-frame-version-${frameId}`} className="step-config-label">
        Version
      </label>
      <input
        id={`inspector-frame-version-${frameId}`}
        type="text"
        className="step-config-select"
        style={{ width: '100%' }}
        data-testid="inspector-frame-version"
        aria-label="Flow version"
        value={versionDraft}
        onChange={(e) => setVersionDraft(e.target.value)}
        onBlur={commitVersion}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setVersionDraft(frameData.version ?? '');
          }
        }}
        placeholder="0.1.0"
      />

      <div className="step-config-connections" style={{ marginTop: 10 }}>
        <div className="step-config-connection-card">
          <div className="step-config-connection-label">Steps</div>
          <div className="step-config-connection-value" data-testid="inspector-frame-step-count">
            {frameData.childIds.length}
          </div>
        </div>
      </div>

      <h3 className="step-config-section-label" style={{ marginTop: 14 }}>Steps in this flow</h3>
      {childSteps.length === 0 ? (
        <p className="step-config-hint">No steps resolved on the canvas yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {childSteps.map((step) => {
            const meta = stepTypeMeta(step.data.stepType as string | undefined);
            return (
              <button
                key={step.id}
                type="button"
                data-testid={`inspector-frame-child-${step.id}`}
                onClick={() => setSelectedMentalNodeIds([step.id])}
                style={CHILD_ROW_STYLE}
              >
                <LucideIcon name={meta.icon} size={12} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {step.data.title}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="step-config-actions" style={{ marginTop: 14 }}>
        <button
          type="button"
          className="step-config-run-btn"
          data-testid="inspector-frame-run"
          aria-label="Run this flow"
          disabled={isBusy}
          onClick={handleRun}
        >
          <LucideIcon name="Play" size={13} />
          Run
        </button>
        <button
          type="button"
          className="step-config-run-from-btn"
          data-testid="inspector-frame-export"
          aria-label="Export this flow as a portable flow file"
          onClick={handleExportFlow}
        >
          <LucideIcon name="Download" size={13} />
          Export Flow
        </button>
        <button
          type="button"
          className="step-config-run-from-btn"
          data-testid="inspector-frame-export-md"
          aria-label="Export this flow as Markdown"
          onClick={handleExportMarkdown}
        >
          <LucideIcon name="FileText" size={13} />
          Export Markdown
        </button>
      </div>
      <p className="step-config-hint" style={{ marginTop: 10 }}>
        Run and export always compile the whole canvas, not just this flow's steps.
      </p>
    </div>
  );
}
