/**
 * ArenaButton.tsx — One-Click Arena "Best Model for This Flow"
 *
 * Responsibility:
 * - Trigger the Arena across candidate models for the current flow.
 * - Render the resulting leaderboard (score, latency, cost per model).
 * - Surface four recommendation lenses — best-score / cheapest / fastest /
 *   best-value — with evidence, reusing the same strategy logic as
 *   `model-selector.ts` (ARCH-065) so the canvas and deploy recommendation
 *   are always consistent.
 * - Provide a "Use for deploy" affordance that records the chosen model so
 *   `fluxor serve --select` can pick it up.
 *
 * Boundaries:
 * - Owns: presentation, local formatting, ARIA annotations.
 * - Does NOT own: IPC, store mutations, scoring math.
 *
 * UI rules: Lucide icons (via LucideIcon), dark-theme CSS vars, focus-visible
 * outlines, ARIA labels, prefers-reduced-motion.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { useHarnessStore } from '../../../store/harness-store';
import type { ArenaLeaderboardEntryResult, ArenaRecommendation } from '@/types/ipc-events';
import { LucideIcon } from '../LucideIcon';

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtMs(ms: number | undefined): string {
  if (ms === undefined) return '—';
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)} min`;
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(2)} s`;
  return `${ms} ms`;
}

function fmtCost(usd: number): string {
  if (usd === 0) return 'free';
  if (usd < 0.0001) return `$${(usd * 1e6).toFixed(2)}µ`;
  return `$${usd.toFixed(4)}`;
}

function scoreColor(score: number): string {
  if (score >= 70) return 'var(--hx-green, #4caf50)';
  if (score >= 40) return 'var(--hx-yellow, #ff9800)';
  return 'var(--hx-red, #f44336)';
}

// "Benchmarked" seal — recommendation cards are always drawn from completed
// Arena leaderboard entries (ResultsView already excludes api_error models
// from `recommendations`), so every card is sealed by construction. NEVER
// "verified" — that word is reserved (RoutedModelEvidence.sealed doc
// comment, src/types/ipc-events.ts). No dedicated CSS class exists for this
// pill (this file is CSS-change-restricted this round — `.ab-*` classNames
// here have no stylesheet rules at all yet), so it's inline-styled. The same
// style constant is duplicated in StepInfoModal.tsx's "Why this model" card
// so the two surfaces read as one visual language.
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

/** Human-readable label + icon for each strategy lens. */
const STRATEGY_META: Record<
  ArenaRecommendation['strategy'],
  { label: string; icon: string; description: string }
> = {
  'best-score': {
    label: 'Best Score',
    icon: 'TrendingUp',
    description: 'Highest overall Arena score across all benchmark suites.',
  },
  cheapest: {
    label: 'Cheapest',
    icon: 'Zap',
    description: 'Lowest execution cost per benchmark run. Free models win here.',
  },
  fastest: {
    label: 'Fastest',
    icon: 'Clock',
    description: 'Lowest average wall-clock latency across successful suites.',
  },
  'best-value': {
    label: 'Best Value',
    icon: 'Gauge',
    description: 'Highest score-to-cost ratio. Free models are treated as infinite value.',
  },
};

// ── Sub-components ────────────────────────────────────────────────────────────

interface RecommendationCardProps {
  rec: ArenaRecommendation;
  isChosen: boolean;
  onChoose: (modelId: string) => void;
}

function RecommendationCard({ rec, isChosen, onChoose }: RecommendationCardProps) {
  const meta = STRATEGY_META[rec.strategy];
  const handleChoose = useCallback(() => onChoose(rec.modelId), [onChoose, rec.modelId]);

  return (
    <div
      className={`ab-rec-card ${isChosen ? 'ab-rec-card--chosen' : ''}`}
      aria-label={`${meta.label} recommendation: ${rec.modelId}`}
    >
      <div className="ab-rec-header">
        <LucideIcon name={meta.icon} size={13} aria-hidden="true" />
        <span className="ab-rec-strategy">{meta.label}</span>
        <span
          className="ab-benchmarked-pill"
          data-testid="ab-benchmarked-pill"
          style={{ ...BENCHMARKED_PILL_STYLE, marginLeft: 6 }}
        >
          <LucideIcon name="ShieldCheck" size={10} aria-hidden="true" />
          Benchmarked
        </span>
      </div>
      <p className="ab-rec-description">{meta.description}</p>
      <div className="ab-rec-model" title={rec.modelId}>
        {rec.modelId}
      </div>
      <div className="ab-rec-evidence">
        <span className="ab-rec-evidence-item">
          <LucideIcon name="TrendingUp" size={11} aria-hidden="true" />
          <span>{rec.evidence.score}/100</span>
        </span>
        <span className="ab-rec-evidence-item">
          <LucideIcon name="Clock" size={11} aria-hidden="true" />
          <span>{fmtMs(rec.evidence.latencyMs)}</span>
        </span>
        <span className="ab-rec-evidence-item">
          <LucideIcon name="Zap" size={11} aria-hidden="true" />
          <span>{fmtCost(rec.evidence.costPerRun)}</span>
        </span>
      </div>
      <button
        type="button"
        className={`ab-deploy-btn ${isChosen ? 'ab-deploy-btn--chosen' : ''}`}
        onClick={handleChoose}
        aria-label={isChosen ? `Using ${rec.modelId} for deploy` : `Use ${rec.modelId} for deploy`}
        aria-pressed={isChosen}
      >
        {isChosen ? (
          <>
            <LucideIcon name="CheckCircle" size={12} aria-hidden="true" />
            Chosen for deploy
          </>
        ) : (
          <>
            <LucideIcon name="Server" size={12} aria-hidden="true" />
            Use for deploy
          </>
        )}
      </button>
    </div>
  );
}

interface LeaderboardRowProps {
  entry: ArenaLeaderboardEntryResult;
  rank: number;
  isChosen: boolean;
  onChoose: (modelId: string) => void;
}

function LeaderboardRow({ entry, rank, isChosen, onChoose }: LeaderboardRowProps) {
  const isError = entry.status === 'api_error';
  const handleChoose = useCallback(() => onChoose(entry.modelId), [onChoose, entry.modelId]);

  return (
    <tr
      className={`ab-lb-row ${isError ? 'ab-lb-row--error' : ''} ${isChosen ? 'ab-lb-row--chosen' : ''}`}
      aria-label={`Rank ${rank}: ${entry.name}`}
    >
      <td className="ab-lb-rank" aria-label="Rank">
        {isError ? (
          <LucideIcon name="XCircle" size={12} style={{ color: 'var(--hx-red, #f44336)' }} aria-hidden="true" />
        ) : (
          <span>{rank}</span>
        )}
      </td>
      <td className="ab-lb-name" title={entry.modelId}>
        {entry.name}
        {isError && entry.errors && (
          <span className="ab-lb-error-badge" title={entry.errors.join('; ')}>
            <LucideIcon name="Bug" size={10} aria-hidden="true" />
            api_error
          </span>
        )}
      </td>
      <td
        className="ab-lb-score"
        style={{ color: isError ? 'var(--hx-muted, #6b7280)' : scoreColor(entry.finalArenaScore) }}
        aria-label={`Score: ${entry.finalArenaScore}`}
      >
        {isError ? '—' : `${entry.finalArenaScore}`}
      </td>
      <td className="ab-lb-latency" aria-label="Avg latency">
        {fmtMs(entry.avgLatencyMs)}
      </td>
      <td className="ab-lb-cost" aria-label="Cost per run">
        {isError ? '—' : fmtCost(entry.executionCostUsd)}
      </td>
      <td className="ab-lb-actions">
        {!isError && (
          <button
            type="button"
            className={`ab-lb-deploy-btn ${isChosen ? 'ab-lb-deploy-btn--chosen' : ''}`}
            onClick={handleChoose}
            aria-label={isChosen ? `${entry.name} chosen for deploy` : `Use ${entry.name} for deploy`}
            aria-pressed={isChosen}
          >
            {isChosen ? (
              <LucideIcon name="CheckCircle" size={12} aria-hidden="true" />
            ) : (
              <LucideIcon name="Server" size={12} aria-hidden="true" />
            )}
          </button>
        )}
      </td>
    </tr>
  );
}

// ── Progress overlay ──────────────────────────────────────────────────────────

function RunningState() {
  const progressEvents = useHarnessStore((s) => s.arena.progressEvents);
  // Latest event per model to dedupe — last write wins.
  const byModel = useMemo(() => {
    const map = new Map<string, (typeof progressEvents)[number]>();
    for (const e of progressEvents) map.set(e.modelId, e);
    return [...map.values()];
  }, [progressEvents]);

  const total = byModel.length > 0 ? byModel[0].totalModels : 0;
  const done = byModel.filter((e) => e.status !== 'running').length;

  return (
    <div className="ab-running" aria-live="polite" aria-label="Arena run in progress">
      <div className="ab-running-header" aria-hidden="true">
        <LucideIcon name="Loader2" size={16} className="ab-spin" />
        <span>Running Arena… {total > 0 ? `${done}/${total} models` : ''}</span>
      </div>
      {byModel.length > 0 && (
        <ul className="ab-progress-list" aria-label="Per-model progress">
          {byModel.map((e) => (
            <li key={e.modelId} className={`ab-progress-item ab-progress-item--${e.status}`}>
              <span className="ab-progress-icon" aria-hidden="true">
                {e.status === 'running' && <LucideIcon name="Loader2" size={11} className="ab-spin" />}
                {e.status === 'completed' && <LucideIcon name="CheckCircle" size={11} />}
                {e.status === 'api_error' && <LucideIcon name="XCircle" size={11} />}
              </span>
              <span className="ab-progress-name">{e.modelName}</span>
              {e.status === 'completed' && (
                <span className="ab-progress-score">
                  {Object.values(e.scoresSoFar).filter((v) => v !== null).join(' / ')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Empty / CTA state ─────────────────────────────────────────────────────────

interface EmptyStateProps {
  onRun: () => void;
}

function EmptyState({ onRun }: EmptyStateProps) {
  return (
    <div className="ab-empty" aria-label="No Arena result yet">
      <div className="ab-empty-icon" aria-hidden="true">
        <LucideIcon name="GitCompareArrows" size={32} />
      </div>
      <p className="ab-empty-title">No Arena result yet</p>
      <p className="ab-empty-desc">
        Benchmark candidate models head-to-head and get a recommendation backed by
        execution-grade data — score, latency, and cost.
      </p>
      <button
        type="button"
        className="ab-run-btn"
        onClick={onRun}
        aria-label="Run Arena benchmark"
      >
        <LucideIcon name="Play" size={14} />
        Run Arena
      </button>
    </div>
  );
}

// ── Error state ───────────────────────────────────────────────────────────────

interface ErrorStateProps {
  error: string;
  onRetry: () => void;
}

function ErrorState({ error, onRetry }: ErrorStateProps) {
  return (
    <div className="ab-error" role="alert" aria-label="Arena run failed">
      <LucideIcon name="XCircle" size={20} />
      <p className="ab-error-title">Arena run failed</p>
      <p className="ab-error-message">{error}</p>
      <button
        type="button"
        className="ab-run-btn"
        onClick={onRetry}
        aria-label="Retry Arena run"
      >
        <LucideIcon name="RefreshCw" size={14} />
        Retry
      </button>
    </div>
  );
}

// ── Results view ──────────────────────────────────────────────────────────────

interface ResultsViewProps {
  result: import('@/types/ipc-events').ArenaResult;
  chosenModelId: string | null;
  onChoose: (modelId: string) => void;
}

function ResultsView({ result, chosenModelId, onChoose }: ResultsViewProps) {
  const [activeTab, setActiveTab] = useState<'recommendations' | 'leaderboard'>('recommendations');

  return (
    <div className="ab-results">
      {/* Tab bar */}
      <div className="ab-tabs" role="tablist" aria-label="Arena result views">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'recommendations'}
          className={`ab-tab ${activeTab === 'recommendations' ? 'ab-tab--active' : ''}`}
          onClick={() => setActiveTab('recommendations')}
        >
          <LucideIcon name="Sparkles" size={12} aria-hidden="true" />
          Recommendations
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'leaderboard'}
          className={`ab-tab ${activeTab === 'leaderboard' ? 'ab-tab--active' : ''}`}
          onClick={() => setActiveTab('leaderboard')}
        >
          <LucideIcon name="Columns2" size={12} aria-hidden="true" />
          Leaderboard
        </button>
      </div>

      {/* Recommendations: four lenses */}
      {activeTab === 'recommendations' && (
        <section
          className="ab-recs"
          aria-label="Model recommendations"
          role="tabpanel"
        >
          {result.recommendations.length === 0 ? (
            <p className="ab-empty-note">No completed models — all runs returned api_error.</p>
          ) : (
            <div className="ab-recs-grid">
              {result.recommendations.map((rec) => (
                <RecommendationCard
                  key={rec.strategy}
                  rec={rec}
                  isChosen={chosenModelId === rec.modelId}
                  onChoose={onChoose}
                />
              ))}
            </div>
          )}
          {chosenModelId && (
            <div className="ab-deploy-notice" role="status" aria-live="polite">
              <LucideIcon name="Server" size={13} aria-hidden="true" />
              <strong>{chosenModelId}</strong> will run this flow when its Model policy is{' '}
              <em>Fixed</em>, and is picked up by <code>fluxor serve --select</code>.
            </div>
          )}
        </section>
      )}

      {/* Leaderboard table */}
      {activeTab === 'leaderboard' && (
        <section
          className="ab-lb-section"
          aria-label="Arena leaderboard"
          role="tabpanel"
        >
          <table className="ab-lb-table">
            <thead>
              <tr>
                <th scope="col" className="ab-lb-rank">Rank</th>
                <th scope="col" className="ab-lb-name">Model</th>
                <th scope="col" className="ab-lb-score">Score</th>
                <th scope="col" className="ab-lb-latency">Latency</th>
                <th scope="col" className="ab-lb-cost">Cost</th>
                <th scope="col" className="ab-lb-actions">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {result.leaderboard.map((entry, idx) => (
                <LeaderboardRow
                  key={entry.modelId}
                  entry={entry}
                  rank={idx + 1}
                  isChosen={chosenModelId === entry.modelId}
                  onChoose={onChoose}
                />
              ))}
            </tbody>
          </table>
          <p className="ab-lb-footer">
            Ranked by score — api_error models appear last.
            {` Elapsed: ${(result.elapsedMs / 1000).toFixed(1)} s.`}
          </p>
        </section>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export interface ArenaButtonProps {
  /** Optional pinned model ids (forwarded to `pf:run-arena`). When omitted,
   *  the Arena discovers free models + ARENA_FORCED_MODEL_IDS from OpenRouter. */
  modelIds?: string[];
  /** CSS class applied to the outermost element. */
  className?: string;
}

export function ArenaButton({ modelIds, className }: ArenaButtonProps) {
  const arena = useHarnessStore((s) => s.arena);
  const runArena = useHarnessStore((s) => s.runArena);
  const resetArena = useHarnessStore((s) => s.resetArena);
  const setArenaDeployModel = useHarnessStore((s) => s.setArenaDeployModel);

  const handleRun = useCallback(() => {
    void runArena(modelIds ? { modelIds } : {});
  }, [runArena, modelIds]);

  const handleReset = useCallback(() => {
    resetArena();
  }, [resetArena]);

  const handleChooseDeploy = useCallback(
    (modelId: string) => {
      setArenaDeployModel(modelId);
    },
    [setArenaDeployModel],
  );

  const rootClass = ['ab-root', className].filter(Boolean).join(' ');

  return (
    <section className={rootClass} aria-label="Arena model benchmark">
      {/* Toolbar */}
      <div className="ab-toolbar">
        <div className="ab-toolbar-left">
          <LucideIcon name="GitCompareArrows" size={14} aria-hidden="true" />
          <span className="ab-toolbar-title">Arena</span>
          {arena.status === 'done' && arena.result && (
            <span className="ab-toolbar-badge" aria-label={`${arena.result.leaderboard.length} models benchmarked`}>
              {arena.result.leaderboard.length} models
            </span>
          )}
        </div>
        <div className="ab-toolbar-right">
          {arena.status === 'done' && (
            <button
              type="button"
              className="ab-icon-btn"
              onClick={handleReset}
              aria-label="Clear Arena result"
              title="Clear result"
            >
              <LucideIcon name="X" size={13} />
            </button>
          )}
          <button
            type="button"
            className="ab-run-btn ab-run-btn--toolbar"
            onClick={handleRun}
            disabled={arena.status === 'running'}
            aria-label={arena.status === 'running' ? 'Arena run in progress' : 'Run Arena benchmark'}
            aria-busy={arena.status === 'running'}
          >
            {arena.status === 'running' ? (
              <>
                <LucideIcon name="Loader2" size={13} className="ab-spin" aria-hidden="true" />
                Running…
              </>
            ) : (
              <>
                <LucideIcon name="Play" size={13} aria-hidden="true" />
                {arena.status === 'done' ? 'Re-run' : 'Run Arena'}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="ab-body">
        {arena.status === 'idle' && <EmptyState onRun={handleRun} />}
        {arena.status === 'running' && <RunningState />}
        {arena.status === 'error' && arena.error && (
          <ErrorState error={arena.error} onRetry={handleRun} />
        )}
        {arena.status === 'done' && arena.result && (
          <ResultsView
            result={arena.result}
            chosenModelId={arena.deployChosenModelId}
            onChoose={handleChooseDeploy}
          />
        )}
      </div>
    </section>
  );
}
