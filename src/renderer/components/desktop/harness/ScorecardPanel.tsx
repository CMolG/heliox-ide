/**
 * ScorecardPanel.tsx — Performance Frontier in-IDE Scorecard
 *
 * Responsibility:
 * - Render the PF scorecard: execution ground-truth verifiers (tests, a11y,
 *   API), the judge score + semantic CI, telemetry cost/latency. Ground truth
 *   and judge are shown in visually DISTINCT sections so the rigor is preserved
 *   and not flattened to a single vanity number.
 * - Loading/streaming + empty states with a "Run scorecard" CTA.
 * - Streaming progress messages while a run is in flight.
 *
 * Boundaries:
 * - Owns: presentation, local formatting, ARIA annotations.
 * - Does NOT own: IPC, store mutations, scoring math.
 *
 * UI rules: Lucide icons (via LucideIcon), dark theme CSS vars, focus-visible
 * outlines, ARIA labels, keyboard nav, prefers-reduced-motion.
 */
import React, { useCallback } from 'react';
import { useHarnessStore } from '../../../store/harness-store';
import type { ScorecardResult } from '@/types/ipc-events';
import { LucideIcon } from '../LucideIcon';

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtMs(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)} min`;
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(2)} s`;
  return `${ms} ms`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function verdictColor(verdict: 'pass' | 'partial' | 'fail'): string {
  if (verdict === 'pass') return 'var(--hx-green, #4caf50)';
  if (verdict === 'partial') return 'var(--hx-yellow, #ff9800)';
  return 'var(--hx-red, #f44336)';
}

function verdictIcon(verdict: 'pass' | 'partial' | 'fail'): string {
  if (verdict === 'pass') return 'CheckCircle';
  if (verdict === 'partial') return 'Flag';
  return 'XCircle';
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface MetricTileProps {
  label: string;
  value: React.ReactNode;
  accent?: string;
}

function MetricTile({ label, value, accent }: MetricTileProps) {
  return (
    <div className="sc-metric-tile" style={accent ? ({ '--sc-tile-accent': accent } as React.CSSProperties) : undefined}>
      <span className="sc-metric-label">{label}</span>
      <strong className="sc-metric-value">{value}</strong>
    </div>
  );
}

// ── Ground Truth sections ─────────────────────────────────────────────────────

interface GroundTruthSectionProps {
  groundTruth: ScorecardResult['groundTruth'];
}

function TestsSection({ tests }: { tests: NonNullable<ScorecardResult['groundTruth']>['tests'] }) {
  if (!tests) return null;
  const allPass = tests.ran && tests.failed === 0;
  const didNotRun = !tests.ran;
  const color = didNotRun ? 'var(--hx-yellow, #ff9800)' : allPass ? 'var(--hx-green, #4caf50)' : 'var(--hx-red, #f44336)';
  const statusLabel = didNotRun ? 'DID NOT RUN' : allPass ? 'ALL PASS' : `${tests.failed} FAIL`;
  const icon = didNotRun ? 'Ban' : allPass ? 'CheckCircle' : 'XCircle';

  return (
    <section className="sc-gt-section" aria-label="Ground truth: tests">
      <div className="sc-gt-header">
        <LucideIcon name="ListChecks" size={13} />
        <span className="sc-gt-title">Executed Tests</span>
        <span className="sc-gt-badge" style={{ color }}>
          <LucideIcon name={icon} size={11} />
          {statusLabel}
        </span>
      </div>
      <div className="sc-gt-grid">
        <MetricTile label="Passed" value={`${tests.passed}/${tests.total}`} accent={color} />
        <MetricTile label="Failed" value={tests.failed} accent={tests.failed > 0 ? 'var(--hx-red, #f44336)' : undefined} />
        <MetricTile label="Runner" value={tests.ran ? 'executed' : 'not run'} />
      </div>
      {tests.errorMessage && (
        <p className="sc-gt-error" role="alert">{tests.errorMessage}</p>
      )}
    </section>
  );
}

function A11ySection({ a11y }: { a11y: NonNullable<ScorecardResult['groundTruth']>['a11y'] }) {
  if (!a11y) return null;
  const clean = a11y.ran && a11y.violations === 0;
  const didNotRun = !a11y.ran;
  const color = didNotRun ? 'var(--hx-yellow, #ff9800)' : clean ? 'var(--hx-green, #4caf50)' : 'var(--hx-red, #f44336)';
  const statusLabel = didNotRun ? 'DID NOT RUN' : clean ? 'NO VIOLATIONS' : `${a11y.violations} VIOLATION${a11y.violations === 1 ? '' : 'S'}`;

  return (
    <section className="sc-gt-section" aria-label="Ground truth: accessibility">
      <div className="sc-gt-header">
        <LucideIcon name="Accessibility" size={13} />
        <span className="sc-gt-title">axe-core WCAG (a11y)</span>
        <span className="sc-gt-badge" style={{ color }}>
          <LucideIcon name={clean ? 'CheckCircle' : 'XCircle'} size={11} />
          {statusLabel}
        </span>
      </div>
      <div className="sc-gt-grid">
        <MetricTile label="Violations" value={a11y.violations} accent={a11y.violations > 0 ? 'var(--hx-red, #f44336)' : undefined} />
        <MetricTile label="Passes" value={a11y.passes} />
        <MetricTile label="Runner" value={a11y.ran ? 'executed' : 'not run'} />
      </div>
      {a11y.critical.length > 0 && (
        <p className="sc-gt-error" role="alert">
          Critical/Serious: {a11y.critical.join(', ')}
        </p>
      )}
      {a11y.errorMessage && (
        <p className="sc-gt-error">{a11y.errorMessage}</p>
      )}
    </section>
  );
}

function ApiSection({ api }: { api: NonNullable<ScorecardResult['groundTruth']>['api'] }) {
  if (!api) return null;
  const allOk = api.booted && api.checks.length > 0 && api.checks.every((c) => c.ok);
  const color = !api.booted ? 'var(--hx-red, #f44336)' : allOk ? 'var(--hx-green, #4caf50)' : 'var(--hx-yellow, #ff9800)';
  const statusLabel = !api.booted ? 'SERVER CRASH' : allOk ? 'ALL PASS' : `${api.checks.filter((c) => !c.ok).length} FAIL`;

  return (
    <section className="sc-gt-section" aria-label="Ground truth: API verification">
      <div className="sc-gt-header">
        <LucideIcon name="Globe" size={13} />
        <span className="sc-gt-title">API Verification (HTTP)</span>
        <span className="sc-gt-badge" style={{ color }}>
          <LucideIcon name={allOk ? 'CheckCircle' : 'XCircle'} size={11} />
          {statusLabel}
        </span>
      </div>
      <div className="sc-gt-grid">
        <MetricTile
          label="Server Boot"
          value={api.booted ? 'BOOTED' : 'FAILED'}
          accent={api.booted ? 'var(--hx-green, #4caf50)' : 'var(--hx-red, #f44336)'}
        />
        <MetricTile label="Checks" value={`${api.checks.filter((c) => c.ok).length}/${api.checks.length}`} />
      </div>
      {api.checks.length > 0 && (
        <ul className="sc-api-checks" aria-label="HTTP check results">
          {api.checks.map((c, idx) => (
            <li key={idx} className="sc-api-check" style={{ color: c.ok ? 'var(--hx-green, #4caf50)' : 'var(--hx-red, #f44336)' }}>
              <LucideIcon name={c.ok ? 'CheckCircle' : 'XCircle'} size={11} />
              <span className="sc-api-check-name">{c.name}</span>
              {c.status !== undefined && <code className="sc-api-status">HTTP {c.status}</code>}
              {c.detail && <span className="sc-api-detail">{c.detail}</span>}
            </li>
          ))}
        </ul>
      )}
      {api.errorMessage && (
        <p className="sc-gt-error" role="alert">{api.errorMessage}</p>
      )}
    </section>
  );
}

function GroundTruthSection({ groundTruth }: GroundTruthSectionProps) {
  if (!groundTruth) {
    return (
      <section className="sc-panel sc-panel--gt" aria-label="Ground truth verifiers">
        <div className="sc-panel-header">
          <LucideIcon name="ShieldCheck" size={14} />
          <h3 className="sc-panel-title">Ground Truth Verifiers</h3>
          <span className="sc-panel-tag sc-panel-tag--execution">EXECUTION</span>
        </div>
        <p className="sc-empty-note">No ground-truth verifiers ran for this suite.</p>
      </section>
    );
  }

  return (
    <section className="sc-panel sc-panel--gt" aria-label="Ground truth verifiers">
      <div className="sc-panel-header">
        <LucideIcon name="ShieldCheck" size={14} />
        <h3 className="sc-panel-title">Ground Truth Verifiers</h3>
        <span className="sc-panel-tag sc-panel-tag--execution">EXECUTION</span>
      </div>
      <p className="sc-panel-subtitle">
        Real test execution — not LLM opinion. These are objective pass/fail signals.
      </p>
      <TestsSection tests={groundTruth.tests} />
      <A11ySection a11y={groundTruth.a11y} />
      <ApiSection api={groundTruth.api} />
    </section>
  );
}

// ── Judge Section ─────────────────────────────────────────────────────────────

function JudgeSection({ result }: { result: ScorecardResult }) {
  const semanticPct = result.semanticMaxScore > 0
    ? Math.round((result.semanticScore / result.semanticMaxScore) * 100)
    : 0;

  return (
    <section className="sc-panel sc-panel--judge" aria-label="Judge evaluation">
      <div className="sc-panel-header">
        <LucideIcon name="Gauge" size={14} />
        <h3 className="sc-panel-title">Judge Score</h3>
        <span className="sc-panel-tag sc-panel-tag--judge">LLM JUDGE</span>
      </div>
      <p className="sc-panel-subtitle">
        Semantic quality assessed by the calibrated judge — separate from execution ground truth above.
      </p>
      <div className="sc-judge-score-row">
        <span
          className="sc-judge-score"
          style={{ color: verdictColor(result.verdict) }}
          aria-label={`Final score: ${result.finalScore} out of 100`}
        >
          {result.finalScore}
          <span className="sc-judge-score-denom">/100</span>
        </span>
        <span className="sc-judge-verdict" style={{ color: verdictColor(result.verdict) }}>
          <LucideIcon name={verdictIcon(result.verdict)} size={14} />
          {result.verdict.toUpperCase()}
        </span>
        {result.judgeError && (
          <span className="sc-judge-error-badge" role="alert">
            <LucideIcon name="Bug" size={11} />
            Judge failed — degraded result
          </span>
        )}
      </div>
      <div className="sc-gt-grid">
        <MetricTile
          label={`Semantic (${result.semanticScore}/${result.semanticMaxScore})`}
          value={`${semanticPct}%`}
          accent={semanticPct >= 70 ? 'var(--hx-green, #4caf50)' : semanticPct >= 40 ? 'var(--hx-yellow, #ff9800)' : 'var(--hx-red, #f44336)'}
        />
        <MetricTile
          label="Efficiency (0–10)"
          value={result.telemetryScore.toFixed(1)}
          accent={result.telemetryScore >= 7 ? 'var(--hx-green, #4caf50)' : result.telemetryScore >= 4 ? 'var(--hx-yellow, #ff9800)' : 'var(--hx-red, #f44336)'}
        />
        <MetricTile label="Suite" value={result.suite} />
        <MetricTile label="Model" value={result.modelUnderTest} />
      </div>
      {result.bench && (
        <div className="sc-ci-row" aria-label="Bench confidence interval">
          <LucideIcon name="TrendingUp" size={12} />
          <span className="sc-ci-label">95% CI</span>
          <span className="sc-ci-value">
            {result.bench.mean.toFixed(1)} ± {((result.bench.ci95.upper - result.bench.ci95.lower) / 2).toFixed(1)}
            <span className="sc-ci-range">
              [{result.bench.ci95.lower.toFixed(1)}, {result.bench.ci95.upper.toFixed(1)}]
            </span>
          </span>
          <span className="sc-ci-n">n={result.bench.n}</span>
        </div>
      )}
      {result.criticalFailures.length > 0 && (
        <div className="sc-failures" role="alert" aria-label="Critical failures">
          <div className="sc-failures-header">
            <LucideIcon name="XCircle" size={12} />
            <span>Critical Failures</span>
          </div>
          <ul className="sc-failures-list">
            {result.criticalFailures.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// ── Telemetry Section ─────────────────────────────────────────────────────────

function TelemetrySection({ result }: { result: ScorecardResult }) {
  const { telemetry } = result;
  return (
    <section className="sc-panel sc-panel--telemetry" aria-label="Cost and latency telemetry">
      <div className="sc-panel-header">
        <LucideIcon name="Cpu" size={14} />
        <h3 className="sc-panel-title">Cost &amp; Latency</h3>
      </div>
      <div className="sc-gt-grid">
        <MetricTile label="Latency" value={fmtMs(telemetry.latencyMs)} />
        <MetricTile label="Total Tokens" value={fmtTokens(telemetry.totalTokens)} />
        <MetricTile label="Steps" value={telemetry.stepCount} />
        <MetricTile
          label="MCP Precision"
          value={`${(telemetry.mcpSyntaxPrecision * 100).toFixed(1)}%`}
          accent={telemetry.mcpSyntaxPrecision >= 0.9 ? 'var(--hx-green, #4caf50)' : 'var(--hx-yellow, #ff9800)'}
        />
      </div>
      <div className="sc-gt-grid sc-gt-grid--tokens">
        <MetricTile label="Prompt" value={fmtTokens(telemetry.inputTokens)} />
        <MetricTile label="Completion" value={fmtTokens(telemetry.outputTokens)} />
        <MetricTile label="Reasoning" value={fmtTokens(telemetry.reasoningTokens)} />
        <MetricTile label="Cache Read" value={fmtTokens(telemetry.cacheReadTokens)} />
        <MetricTile label="Cache Write" value={fmtTokens(telemetry.cacheWriteTokens)} />
      </div>
    </section>
  );
}

// ── Loading / Streaming state ─────────────────────────────────────────────────

function LoadingState() {
  const progressMessages = useHarnessStore((s) => s.scorecard.progressMessages);
  const latest = progressMessages.at(-1);

  return (
    <div className="sc-loading" aria-live="polite" aria-label="Scorecard run in progress">
      <div className="sc-loading-spinner" aria-hidden="true">
        <LucideIcon name="Loader2" size={20} className="sc-spin" />
      </div>
      <p className="sc-loading-label">Running Performance Frontier…</p>
      {latest && (
        <p className="sc-loading-phase">{latest.message}</p>
      )}
      {progressMessages.length > 0 && (
        <ol className="sc-progress-log" aria-label="Progress log">
          {progressMessages.map((msg, i) => (
            <li key={i} className={`sc-progress-entry sc-progress-entry--${msg.phase}`}>
              <span className="sc-progress-elapsed">{fmtMs(msg.elapsedMs)}</span>
              {msg.message}
            </li>
          ))}
        </ol>
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
    <div className="sc-empty" aria-label="No scorecard result yet">
      <div className="sc-empty-icon" aria-hidden="true">
        <LucideIcon name="FlaskConical" size={32} />
      </div>
      <p className="sc-empty-title">No scorecard yet</p>
      <p className="sc-empty-desc">
        Run the Performance Frontier to see execution-verified results: ground-truth
        tests, a11y checks, judge scores, and cost/latency telemetry.
      </p>
      <button
        type="button"
        className="sc-run-btn"
        onClick={onRun}
        aria-label="Run Performance Frontier scorecard"
      >
        <LucideIcon name="Play" size={14} />
        Run scorecard
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
    <div className="sc-error" role="alert" aria-label="Scorecard error">
      <LucideIcon name="XCircle" size={20} />
      <p className="sc-error-title">Scorecard run failed</p>
      <p className="sc-error-message">{error}</p>
      <button
        type="button"
        className="sc-run-btn"
        onClick={onRetry}
        aria-label="Retry scorecard run"
      >
        <LucideIcon name="RefreshCw" size={14} />
        Retry
      </button>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export interface ScorecardPanelProps {
  /** Optional override opts forwarded to `pf:run-scorecard`. */
  runOptions?: { suite?: string; seed?: number; modelId?: string };
  /** CSS class applied to the outermost element. */
  className?: string;
}

export function ScorecardPanel({ runOptions, className }: ScorecardPanelProps) {
  const scorecard = useHarnessStore((s) => s.scorecard);
  const runScorecard = useHarnessStore((s) => s.runScorecard);
  const resetScorecard = useHarnessStore((s) => s.resetScorecard);

  const handleRun = useCallback(() => {
    void runScorecard(runOptions ?? {});
  }, [runScorecard, runOptions]);

  const handleReset = useCallback(() => {
    resetScorecard();
  }, [resetScorecard]);

  const panelClass = ['sc-panel-root', className].filter(Boolean).join(' ');

  return (
    <section className={panelClass} aria-label="Performance Frontier Scorecard">
      {/* Toolbar */}
      <div className="sc-toolbar">
        <div className="sc-toolbar-left">
          <LucideIcon name="Gauge" size={14} />
          <span className="sc-toolbar-title">Scorecard</span>
        </div>
        <div className="sc-toolbar-right">
          {scorecard.status === 'done' && (
            <button
              type="button"
              className="sc-icon-btn"
              onClick={handleReset}
              aria-label="Clear scorecard result"
              title="Clear result"
            >
              <LucideIcon name="X" size={13} />
            </button>
          )}
          <button
            type="button"
            className="sc-run-btn sc-run-btn--toolbar"
            onClick={handleRun}
            disabled={scorecard.status === 'running'}
            aria-label={scorecard.status === 'running' ? 'Scorecard run in progress' : 'Run Performance Frontier scorecard'}
            aria-busy={scorecard.status === 'running'}
          >
            {scorecard.status === 'running' ? (
              <>
                <LucideIcon name="Loader2" size={13} className="sc-spin" aria-hidden="true" />
                Running…
              </>
            ) : (
              <>
                <LucideIcon name="Play" size={13} />
                {scorecard.status === 'done' ? 'Re-run' : 'Run'}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="sc-body">
        {scorecard.status === 'idle' && (
          <EmptyState onRun={handleRun} />
        )}
        {scorecard.status === 'running' && (
          <LoadingState />
        )}
        {scorecard.status === 'error' && scorecard.error && (
          <ErrorState error={scorecard.error} onRetry={handleRun} />
        )}
        {scorecard.status === 'done' && scorecard.result && (
          <div className="sc-results">
            {/* Ground Truth — DISTINCTLY separated from judge */}
            <GroundTruthSection groundTruth={scorecard.result.groundTruth} />

            {/* Visual separator */}
            <div className="sc-divider" aria-hidden="true">
              <span className="sc-divider-label">Judge Evaluation (LLM)</span>
            </div>

            {/* Judge */}
            <JudgeSection result={scorecard.result} />

            {/* Telemetry */}
            <TelemetrySection result={scorecard.result} />
          </div>
        )}
      </div>
    </section>
  );
}
