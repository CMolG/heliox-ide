/**
 * TimeTravelPanel.tsx — Canvas time-travel scrubber and state inspector
 *
 * Responsibility:
 * - Renders a scrubber/timeline over a run's checkpoints (from `harness:list-checkpoints`).
 * - Selecting a checkpoint highlights the matching StepNode on the canvas and
 *   shows a state inspector (inputContext, output, model, timestamp).
 * - Provides an "Edit output" textarea and a "Fork from here" button that
 *   calls `harness:replay-from` and surfaces the resulting fork run id.
 *
 * Boundaries:
 * - Owns: presentation, keyboard navigation, ARIA semantics, and store dispatch.
 * - Does NOT own: canvas node selection (dispatched via store `checkpointState.highlightedStepId`),
 *   IPC transport (delegated to harness-store actions), or layout placement.
 *
 * Accessibility:
 * - Scrubber uses role="slider" with `aria-valuenow`, `aria-valuemin`, `aria-valuemax`.
 * - Arrow-key navigation steps through checkpoints; Home/End jump to first/last.
 * - All interactive elements have visible `:focus-visible` outlines.
 * - `prefers-reduced-motion` disables CSS transitions on the scrubber thumb.
 *
 * Icons: Lucide only (via `<LucideIcon name="..." />`).
 */
import React, {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useHarnessStore } from '../../../store/harness-store';
import type { CheckpointRecord } from '@/types/ipc-events';
import { LucideIcon } from '../LucideIcon';

// ── Constants ─────────────────────────────────────────────────────────────────

const PANEL_WIDTH = 360;
const INSPECTOR_MAX_CHARS = 1200;

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function abbreviate(text: string, max = INSPECTOR_MAX_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}…`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface CheckpointBadgeProps {
  checkpoint: CheckpointRecord;
  index: number;
  total: number;
  isActive: boolean;
  onClick: () => void;
}

function CheckpointBadge({ checkpoint, index, isActive, onClick }: CheckpointBadgeProps) {
  return (
    <button
      type="button"
      className={`ttp-badge${isActive ? ' ttp-badge--active' : ''}`}
      aria-label={`Checkpoint ${index + 1}: step ${checkpoint.stepId}, ${formatTimestamp(checkpoint.timestamp)}`}
      onClick={onClick}
      tabIndex={-1} /* keyboard nav is on the slider track, not individual badges */
    >
      <div className="ttp-badge-pip" />
      <span className="ttp-badge-label">{checkpoint.stepId}</span>
    </button>
  );
}

interface StateInspectorProps {
  checkpoint: CheckpointRecord;
  editedOutput: string | null;
  onEditChange: (val: string) => void;
  onFork: () => void;
  isForkingInProgress: boolean;
  labelPrefix: string;
}

function StateInspector({
  checkpoint,
  editedOutput,
  onEditChange,
  onFork,
  isForkingInProgress,
  labelPrefix,
}: StateInspectorProps) {
  const inputId = `${labelPrefix}-input`;
  const outputId = `${labelPrefix}-output`;
  const editId = `${labelPrefix}-edit`;

  return (
    <section className="ttp-inspector" aria-label="Checkpoint state inspector">
      {/* Meta row */}
      <div className="ttp-inspector-meta">
        <span className="ttp-inspector-meta-item">
          <LucideIcon name="Clock" size={11} />
          {formatTimestamp(checkpoint.timestamp)}
        </span>
        {checkpoint.modelId && (
          <span className="ttp-inspector-meta-item">
            <LucideIcon name="Cpu" size={11} />
            {checkpoint.modelId}
          </span>
        )}
        <span className="ttp-inspector-meta-item ttp-inspector-meta-item--step">
          <LucideIcon name="GitCommitVertical" size={11} />
          {checkpoint.stepId}
        </span>
      </div>

      {/* Input context */}
      <div className="ttp-inspector-section">
        <label htmlFor={inputId} className="ttp-inspector-label">
          <LucideIcon name="Eye" size={11} />
          Input context
        </label>
        <pre id={inputId} className="ttp-inspector-pre">
          {abbreviate(checkpoint.inputContext) || <em className="ttp-inspector-empty">— empty —</em>}
        </pre>
      </div>

      {/* Output */}
      <div className="ttp-inspector-section">
        <label htmlFor={outputId} className="ttp-inspector-label">
          <LucideIcon name="ScrollText" size={11} />
          Output
        </label>
        <pre id={outputId} className="ttp-inspector-pre">
          {abbreviate(checkpoint.output) || <em className="ttp-inspector-empty">— empty —</em>}
        </pre>
      </div>

      {/* Editable output */}
      <div className="ttp-inspector-section">
        <label htmlFor={editId} className="ttp-inspector-label">
          <LucideIcon name="PenTool" size={11} />
          Edit output before fork
          <span className="ttp-inspector-label-hint">(optional)</span>
        </label>
        <textarea
          id={editId}
          className="ttp-inspector-textarea"
          aria-label="Edit step output before forking"
          rows={4}
          value={editedOutput ?? checkpoint.output}
          onChange={(e) => onEditChange(e.target.value)}
          placeholder="Leave unchanged or type a replacement for the step output…"
        />
      </div>

      {/* Fork button */}
      <button
        type="button"
        className="ttp-fork-btn"
        aria-label={`Fork from here (step ${checkpoint.stepId})`}
        aria-busy={isForkingInProgress}
        disabled={isForkingInProgress}
        onClick={onFork}
      >
        {isForkingInProgress ? (
          <>
            <LucideIcon name="Loader" size={14} />
            Forking…
          </>
        ) : (
          <>
            <LucideIcon name="GitFork" size={14} />
            Fork from here
          </>
        )}
      </button>
    </section>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export interface TimeTravelPanelProps {
  /**
   * The run id whose checkpoints to display.
   * The panel calls `loadCheckpoints(runId)` automatically when this changes.
   */
  runId: string | null;
  /**
   * The `AgenticFlow` definition of the active run — forwarded to `forkFrom`.
   * Must be the same definition used during the original run.
   */
  flow: import('@/types/harness').AgenticFlow | null;
  /** Called when the user closes the panel. */
  onClose?: () => void;
}

export function TimeTravelPanel({ runId, flow, onClose }: TimeTravelPanelProps) {
  const labelPrefix = useId();

  // Fine-grained store selectors to avoid unnecessary re-renders
  const { checkpoints, status, activeIndex, editedOutput, error, lastForkRunId } =
    useHarnessStore((s) => s.checkpointState);
  const loadCheckpoints = useHarnessStore((s) => s.loadCheckpoints);
  const rewindTo = useHarnessStore((s) => s.rewindTo);
  const forkFrom = useHarnessStore((s) => s.forkFrom);
  const setEditedOutput = useHarnessStore((s) => s.setEditedOutput);
  const resetCheckpoints = useHarnessStore((s) => s.resetCheckpoints);

  const [isForkingInProgress, setIsForkingInProgress] = useState(false);
  const sliderRef = useRef<HTMLDivElement>(null);

  // Load checkpoints whenever `runId` changes
  useEffect(() => {
    if (!runId) {
      resetCheckpoints();
      return;
    }
    void loadCheckpoints(runId);
  }, [runId, loadCheckpoints, resetCheckpoints]);

  // ── Keyboard navigation on the slider track ──────────────────────────────
  const handleSliderKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const total = checkpoints.length;
      if (total === 0) return;

      let next: number | null = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        next = Math.min(activeIndex + 1, total - 1);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        next = Math.max(activeIndex - 1, 0);
      } else if (e.key === 'Home') {
        next = 0;
      } else if (e.key === 'End') {
        next = total - 1;
      }

      if (next !== null && next !== activeIndex) {
        e.preventDefault();
        rewindTo(next);
      }
    },
    [checkpoints.length, activeIndex, rewindTo],
  );

  // ── Fork handler ─────────────────────────────────────────────────────────
  const handleFork = useCallback(async () => {
    if (!flow || activeIndex < 0 || activeIndex >= checkpoints.length) return;
    const checkpoint = checkpoints[activeIndex];
    setIsForkingInProgress(true);
    await forkFrom(flow, checkpoint.id, editedOutput ?? undefined);
    setIsForkingInProgress(false);
  }, [flow, activeIndex, checkpoints, editedOutput, forkFrom]);

  // ── Derived ──────────────────────────────────────────────────────────────
  const isLoading = status === 'loading';
  const isEmpty = status === 'done' && checkpoints.length === 0;
  const activeCheckpoint: CheckpointRecord | null =
    activeIndex >= 0 && activeIndex < checkpoints.length
      ? checkpoints[activeIndex]
      : null;

  const sliderPercent =
    checkpoints.length > 1
      ? Math.round((activeIndex / (checkpoints.length - 1)) * 100)
      : 0;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <aside
      className="ttp-panel"
      style={{ width: PANEL_WIDTH }}
      aria-label="Time-travel debugging panel"
      data-testid="time-travel-panel"
    >
      {/* Header */}
      <header className="ttp-header">
        <div className="ttp-header-title">
          <LucideIcon name="History" size={14} />
          <span>Time Travel</span>
          {runId && (
            <span className="ttp-header-run-id" title={runId}>
              {runId.slice(0, 16)}…
            </span>
          )}
        </div>
        {onClose && (
          <button
            type="button"
            className="ttp-close-btn"
            aria-label="Close time-travel panel"
            onClick={onClose}
          >
            <LucideIcon name="X" size={13} />
          </button>
        )}
      </header>

      {/* Body */}
      {isLoading && (
        <div className="ttp-status" role="status" aria-live="polite">
          <LucideIcon name="Loader" size={16} />
          <span>Loading checkpoints…</span>
        </div>
      )}

      {!isLoading && error && (
        <div className="ttp-status ttp-status--error" role="alert">
          <LucideIcon name="XCircle" size={16} />
          <span>{error}</span>
        </div>
      )}

      {!isLoading && !error && isEmpty && (
        <div className="ttp-status" role="status">
          <LucideIcon name="Inbox" size={16} />
          <span>No checkpoints for this run yet.</span>
        </div>
      )}

      {!isLoading && !error && checkpoints.length > 0 && (
        <>
          {/* Scrubber */}
          <div className="ttp-scrubber-wrap">
            {/* ARIA slider track */}
            <div
              ref={sliderRef}
              role="slider"
              className="ttp-slider"
              tabIndex={0}
              aria-label={`Checkpoint scrubber, ${checkpoints.length} checkpoints`}
              aria-valuenow={activeIndex + 1}
              aria-valuemin={1}
              aria-valuemax={checkpoints.length}
              aria-valuetext={
                activeCheckpoint
                  ? `Step ${activeCheckpoint.stepId}, ${formatTimestamp(activeCheckpoint.timestamp)}`
                  : undefined
              }
              onKeyDown={handleSliderKeyDown}
            >
              {/* Track fill */}
              <div
                className="ttp-slider-track"
                aria-hidden="true"
              >
                <div
                  className="ttp-slider-fill"
                  style={{ width: `${sliderPercent}%` }}
                />
                {/* Thumb */}
                <div
                  className="ttp-slider-thumb"
                  style={{ left: `${sliderPercent}%` }}
                  aria-hidden="true"
                />
              </div>

              {/* Badge dots along the track */}
              <div className="ttp-badge-row" aria-hidden="true">
                {checkpoints.map((ckpt, i) => (
                  <CheckpointBadge
                    key={ckpt.id}
                    checkpoint={ckpt}
                    index={i}
                    total={checkpoints.length}
                    isActive={i === activeIndex}
                    onClick={() => rewindTo(i)}
                  />
                ))}
              </div>
            </div>

            {/* Counter */}
            <div className="ttp-scrubber-counter" aria-live="polite" aria-atomic="true">
              <span>{activeIndex + 1}</span>
              <span className="ttp-scrubber-sep">/</span>
              <span>{checkpoints.length}</span>
            </div>
          </div>

          {/* Keyboard hint */}
          <p className="ttp-kbd-hint" aria-hidden="true">
            <kbd>←</kbd> <kbd>→</kbd> to step &nbsp; <kbd>Home</kbd> <kbd>End</kbd> to jump
          </p>

          {/* Fork success banner */}
          {lastForkRunId && (
            <div
              className="ttp-fork-banner"
              role="status"
              aria-live="polite"
              data-testid="fork-banner"
            >
              <LucideIcon name="GitBranch" size={12} />
              <span>
                Fork created:{' '}
                <span className="ttp-fork-banner-id" title={lastForkRunId}>
                  {lastForkRunId.slice(0, 24)}…
                </span>
              </span>
            </div>
          )}

          {/* State inspector + edit/fork controls */}
          {activeCheckpoint && (
            <StateInspector
              checkpoint={activeCheckpoint}
              editedOutput={editedOutput}
              onEditChange={setEditedOutput}
              onFork={handleFork}
              isForkingInProgress={isForkingInProgress}
              labelPrefix={labelPrefix}
            />
          )}
        </>
      )}

      {/* No runId fallback */}
      {!runId && (
        <div className="ttp-status" role="status">
          <LucideIcon name="Route" size={16} />
          <span>Start a run to enable time travel.</span>
        </div>
      )}
    </aside>
  );
}
