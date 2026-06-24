import type { PFCognitiveTraceEntry, PFGroundTruth, PFJudgeResult } from '../types';

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function metric(label: string, value: unknown): string {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function renderGeneratedArtifacts(result: PFJudgeResult): string {
  const artifacts = result.generatedArtifacts ?? [];
  if (artifacts.length === 0) {
    return '<div class="trace-empty">No generated artifacts were exported for this run.</div>';
  }

  return [
    result.artifactsDir ? `<p class="artifact-root">${escapeHtml(result.artifactsDir)}</p>` : '',
    '<ul class="artifacts">',
    ...artifacts.map((artifact) => [
      '<li>',
      `<span>${escapeHtml(artifact.vfsPath)}</span>`,
      `<code>${escapeHtml(artifact.artifactPath)}</code>`,
      `<a href="${escapeHtml(artifact.fileUrl)}">${escapeHtml(artifact.fileUrl)}</a>`,
      '</li>',
    ].join('')),
    '</ul>',
  ].join('');
}

function renderGroundTruth(groundTruth: PFGroundTruth | undefined): string {
  const parts: string[] = [];

  if (groundTruth?.tests) {
    const { ran, passed, failed, total, errorMessage } = groundTruth.tests;
    const statusColor = !ran
      ? 'var(--hx-yellow)'
      : failed > 0
        ? 'var(--hx-red)'
        : 'var(--hx-green)';

    parts.push(
      '<section class="panel">',
      '<h2>Ground Truth — Executed Tests</h2>',
      '<div class="grid">',
      metric('Passed / Total', `${passed}/${total}`),
      metric('Failed', failed),
      metric('Runner', ran ? 'executed' : 'not run'),
      `<div class="metric"><span>Status</span><strong style="color:${escapeHtml(statusColor)}">${escapeHtml(ran ? (failed === 0 ? 'ALL PASS' : `${failed} FAIL`) : 'DID NOT RUN')}</strong></div>`,
      '</div>',
      errorMessage ? `<p style="margin:12px 0 0;color:var(--hx-muted);font-family:var(--hx-mono);font-size:12px;">${escapeHtml(errorMessage)}</p>` : '',
      '</section>',
    );
  }

  if (groundTruth?.a11y) {
    const { ran, violations, critical, passes, errorMessage } = groundTruth.a11y;
    const statusColor = !ran
      ? 'var(--hx-yellow)'
      : violations > 0
        ? 'var(--hx-red)'
        : 'var(--hx-green)';
    const criticalLabel = critical.length > 0
      ? critical.join(', ')
      : 'none';

    parts.push(
      '<section class="panel">',
      '<h2>Ground Truth — Accessibility (axe-core WCAG)</h2>',
      '<div class="grid">',
      metric('Violations', violations),
      metric('Passes', passes),
      metric('Runner', ran ? 'executed' : 'not run'),
      `<div class="metric"><span>Status</span><strong style="color:${escapeHtml(statusColor)}">${escapeHtml(ran ? (violations === 0 ? 'NO VIOLATIONS' : `${violations} VIOLATION${violations === 1 ? '' : 'S'}`) : 'DID NOT RUN')}</strong></div>`,
      '</div>',
      critical.length > 0
        ? `<p style="margin:12px 0 0;color:var(--hx-red);font-family:var(--hx-mono);font-size:12px;">Critical/Serious: ${escapeHtml(criticalLabel)}</p>`
        : '',
      errorMessage ? `<p style="margin:12px 0 0;color:var(--hx-muted);font-family:var(--hx-mono);font-size:12px;">${escapeHtml(errorMessage)}</p>` : '',
      '</section>',
    );
  }

  if (groundTruth?.api) {
    const { booted, checks, errorMessage } = groundTruth.api;
    const allOk = booted && checks.length > 0 && checks.every((c) => c.ok);
    const statusColor = !booted
      ? 'var(--hx-red)'
      : allOk
        ? 'var(--hx-green)'
        : 'var(--hx-yellow)';
    const failedChecks = checks.filter((c) => !c.ok);

    parts.push(
      '<section class="panel">',
      '<h2>Ground Truth — API Verification (HTTP)</h2>',
      '<div class="grid">',
      `<div class="metric"><span>Server Boot</span><strong style="color:${escapeHtml(booted ? 'var(--hx-green)' : 'var(--hx-red)')}">${escapeHtml(booted ? 'BOOTED' : 'FAILED TO BOOT')}</strong></div>`,
      metric('Checks Passed', `${checks.filter((c) => c.ok).length}/${checks.length}`),
      metric('Checks Failed', failedChecks.length),
      `<div class="metric"><span>Status</span><strong style="color:${escapeHtml(statusColor)}">${escapeHtml(!booted ? 'SERVER CRASH' : allOk ? 'ALL PASS' : `${failedChecks.length} FAIL`)}</strong></div>`,
      '</div>',
      checks.length > 0
        ? [
          '<ul style="margin:12px 0 0;padding-left:20px;font-family:var(--hx-mono);font-size:12px;">',
          ...checks.map((c) => {
            const color = c.ok ? 'var(--hx-green)' : 'var(--hx-red)';
            const label = `${c.ok ? '✓' : '✗'} [${escapeHtml(c.name)}]${c.status !== undefined ? ` HTTP ${escapeHtml(c.status)}` : ''} — ${escapeHtml(c.detail ?? (c.ok ? 'ok' : 'failed'))}`;
            return `<li style="color:${color};margin-bottom:4px;">${label}</li>`;
          }),
          '</ul>',
        ].join('')
        : '',
      errorMessage ? `<p style="margin:12px 0 0;color:var(--hx-muted);font-family:var(--hx-mono);font-size:12px;">${escapeHtml(errorMessage)}</p>` : '',
      '</section>',
    );
  }

  return parts.join('');
}

function renderFlowAssemblerAudit(result: PFJudgeResult): string {
  if (result.suite !== 'flow-assembler' || !result.flowAssembler) return '';

  return [
    '<section class="panel">',
    '<h2>User Intent</h2>',
    `<pre><code>${escapeHtml(result.flowAssembler.userIntent)}</code></pre>`,
    '</section>',
    '<section class="panel">',
    '<h2>Generated AST (JSON)</h2>',
    `<pre><code>${escapeHtml(JSON.stringify(result.flowAssembler.generatedAst, null, 2))}</code></pre>`,
    '</section>',
  ].join('');
}

function renderTraceList(trace: PFCognitiveTraceEntry[]): string {
  if (trace.length === 0) {
    return '<div class="trace-empty">No cognitive trace was captured.</div>';
  }

  return [
    '<ol class="trace">',
    ...trace.map((entry, index) => {
      const label = entry.type === 'thought'
        ? 'thought'
        : entry.type === 'tool_call'
          ? `call:${entry.toolName ?? 'tool'}`
          : `result:${entry.toolName ?? 'tool'}`;
      return [
        `<li class="trace-row trace-${entry.type.replace('_', '-')}">`,
        `<span class="trace-index">${String(index + 1).padStart(2, '0')}</span>`,
        '<div class="trace-body">',
        entry.stepId ? `<span class="trace-step">${escapeHtml(entry.stepId)}</span>` : '',
        `<span class="trace-label">${escapeHtml(label)}</span>`,
        `<pre>${escapeHtml(entry.content)}</pre>`,
        '</div>',
        '</li>',
      ].join('');
    }),
    '</ol>',
  ].join('');
}

function renderCognitiveTrace(result: PFJudgeResult): string {
  const trace = result.cognitiveTrace ?? [];
  if (trace.length === 0) {
    return '<div class="trace-empty">No cognitive trace was captured for this run.</div>';
  }
  return renderTraceList(trace);
}

function renderEpochFiles(snapshot: Record<string, string>): string {
  const entries = Object.entries(snapshot).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) {
    return '<div class="trace-empty">No files in this epoch snapshot.</div>';
  }

  return [
    '<ul class="artifacts">',
    ...entries.map(([path, content]) => [
      '<li>',
      '<details>',
      `<summary><span>${escapeHtml(path)}</span> <code>${Buffer.byteLength(content, 'utf-8')} bytes</code></summary>`,
      `<pre>${escapeHtml(content)}</pre>`,
      '</details>',
      '</li>',
    ].join('')),
    '</ul>',
  ].join('');
}

function renderProgressionEvidence(result: PFJudgeResult): string {
  if (result.suite !== 'progression' || !result.progression) return '';

  return result.progression.epochs
    .map((epoch) => [
      '<section class="panel epoch">',
      `<h2>${escapeHtml(epoch.label)}</h2>`,
      `<pre class="epoch-prompt">${escapeHtml(epoch.prompt)}</pre>`,
      '<h3>VFS snapshot after this epoch</h3>',
      renderEpochFiles(epoch.vfsSnapshot),
      '<h3>Cognitive Trace</h3>',
      renderTraceList(epoch.cognitiveTrace),
      '</section>',
    ].join(''))
    .join('');
}

export function renderHtmlReport(result: PFJudgeResult): string {
  const telemetry = result.telemetry;
  const evaluations = JSON.stringify(result.evaluations, null, 2);
  const semanticMaxScore = result.semanticMaxScore ?? (result.suite === 'flow-assembler' ? 150 : 90);
  const criticalFailures = result.criticalFailures.length > 0
    ? result.criticalFailures.map((failure) => `<li>${escapeHtml(failure)}</li>`).join('')
    : '<li>None</li>';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Performance Frontier ${escapeHtml(result.runId)}</title>
  <style>
    :root {
      --hx-bg: #0a0a0a;
      --hx-surface: rgba(255, 255, 255, 0.055);
      --hx-surface-strong: rgba(255, 255, 255, 0.09);
      --hx-border: rgba(255, 255, 255, 0.12);
      --hx-text: #f5f5f5;
      --hx-muted: #a1a1aa;
      --hx-green: #4caf50;
      --hx-yellow: #ff9800;
      --hx-red: #f44336;
      --hx-blue: #42a5f5;
      --hx-mono: 'SF Mono', 'JetBrains Mono', 'Fira Code', monospace;
      --hx-sans: 'Atkinson Hyperlegible', Inter, system-ui, sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--hx-text);
      background:
        radial-gradient(circle at top right, rgba(66, 165, 245, 0.12), transparent 32rem),
        var(--hx-bg);
      font-family: var(--hx-sans);
      line-height: 1.5;
    }
    main {
      width: min(1120px, calc(100vw - 40px));
      margin: 0 auto;
      padding: 36px 0 48px;
    }
    .hero, .panel {
      border: 1px solid var(--hx-border);
      background: var(--hx-surface);
      backdrop-filter: blur(16px) saturate(145%);
      border-radius: 8px;
      box-shadow: 0 16px 42px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.05);
    }
    .hero { padding: 28px; margin-bottom: 16px; }
    h1, h2 { margin: 0; letter-spacing: 0; }
    h1 { font-size: 28px; font-weight: 760; }
    h2 { font-size: 15px; color: var(--hx-muted); text-transform: uppercase; }
    .score { font-size: 72px; font-weight: 800; line-height: 1; margin-top: 18px; }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-top: 18px; }
    .metric {
      padding: 14px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: var(--hx-surface-strong);
      border-radius: 8px;
    }
    .metric span { display: block; color: var(--hx-muted); font-size: 12px; }
    .metric strong { display: block; margin-top: 6px; font-size: 18px; }
    .panel { padding: 18px; margin-top: 16px; }
    h3 { margin: 18px 0 8px; font-size: 13px; color: var(--hx-muted); text-transform: uppercase; letter-spacing: 0.04em; }
    .panel.epoch { border-left: 3px solid var(--hx-blue); }
    .epoch-prompt { white-space: pre-wrap; color: #c7d2fe; }
    .artifacts details summary {
      cursor: pointer;
      list-style: none;
      display: flex;
      gap: 8px;
      align-items: baseline;
    }
    .artifacts details summary::-webkit-details-marker { display: none; }
    .artifacts details[open] summary { margin-bottom: 8px; }
    .trace {
      list-style: none;
      margin: 14px 0 0;
      padding: 0;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      overflow: hidden;
      background: rgba(0, 0, 0, 0.26);
    }
    .trace-row {
      display: grid;
      grid-template-columns: 52px minmax(0, 1fr);
      gap: 12px;
      padding: 12px 14px;
      border-top: 1px solid rgba(255, 255, 255, 0.07);
    }
    .trace-row:first-child { border-top: 0; }
    .trace-index {
      color: rgba(255, 255, 255, 0.34);
      font-family: var(--hx-mono);
      font-size: 12px;
      padding-top: 3px;
    }
    .trace-label {
      display: inline-block;
      margin-bottom: 6px;
      color: var(--hx-muted);
      font-family: var(--hx-mono);
      font-size: 11px;
      text-transform: uppercase;
    }
    .trace-step {
      display: inline-block;
      margin: 0 8px 6px 0;
      color: #f8fafc;
      font-family: var(--hx-mono);
      font-size: 11px;
      text-transform: uppercase;
    }
    .trace-thought { background: rgba(66, 165, 245, 0.055); }
    .trace-thought pre { color: #c7d2fe; }
    .trace-tool-call pre { color: #d6f6ff; }
    .trace-tool-result pre { color: #d8f5df; }
    .trace-empty {
      margin-top: 14px;
      color: var(--hx-muted);
      font-family: var(--hx-mono);
      font-size: 12px;
    }
    .artifact-root {
      margin: 12px 0;
      color: var(--hx-muted);
      font-family: var(--hx-mono);
      font-size: 12px;
    }
    .artifacts {
      list-style: none;
      margin: 14px 0 0;
      padding: 0;
      display: grid;
      gap: 8px;
    }
    .artifacts li {
      display: grid;
      gap: 6px;
      padding: 12px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      background: rgba(0, 0, 0, 0.26);
    }
    .artifacts span { color: #e5e7eb; font-family: var(--hx-mono); font-size: 12px; }
    .artifacts code, .artifacts a {
      overflow-wrap: anywhere;
      color: var(--hx-muted);
      font-family: var(--hx-mono);
      font-size: 12px;
    }
    .artifacts a { color: #93c5fd; text-decoration: none; }
    pre {
      overflow: auto;
      padding: 14px;
      border-radius: 8px;
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: #e5e7eb;
      font-family: var(--hx-mono);
      font-size: 12px;
    }
    pre code { font: inherit; color: inherit; }
    ul { margin: 10px 0 0; padding-left: 20px; color: var(--hx-muted); }
    @media (max-width: 800px) { .grid { grid-template-columns: 1fr 1fr; } .score { font-size: 54px; } }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <h1>Performance Frontier</h1>
      <div class="score">${escapeHtml(result.finalScore)}/100</div>
      <div class="grid">
        ${metric('Verdict', result.verdict)}
        ${metric('Suite', result.suite)}
        ${metric('Case', result.caseId)}
        ${metric('Model', result.modelUnderTest)}
      </div>
    </section>
    <section class="panel">
      <h2>Telemetry</h2>
      <div class="grid">
        ${metric('Semantic', `${result.semanticScore}/${semanticMaxScore}`)}
        ${metric('Latency/Tokens', `${result.telemetryScore}/10`)}
        ${metric('Tokens', telemetry.totalTokens)}
        ${metric('MCP Precision', telemetry.mcpSyntaxPrecision.toFixed(3))}
      </div>
    </section>
    <section class="panel">
      <h2>Token Breakdown</h2>
      <div class="grid">
        ${metric('Prompt Tokens', telemetry.inputTokens)}
        ${metric('Completion Tokens', telemetry.outputTokens)}
        ${metric('Reasoning Tokens', telemetry.reasoningTokens)}
        ${metric('Cache Read', telemetry.cacheReadTokens)}
        ${metric('Cache Write', telemetry.cacheWriteTokens)}
      </div>
    </section>
    ${renderGroundTruth(result.groundTruth)}
    <section class="panel">
      <h2>Critical Failures</h2>
      <ul>${criticalFailures}</ul>
    </section>
    <section class="panel">
      <h2>Generated Artifacts</h2>
      ${renderGeneratedArtifacts(result)}
    </section>
    ${renderFlowAssemblerAudit(result)}
    ${result.suite === 'progression' && result.progression
      ? [
        '<section class="panel">',
        '<h2>Progression — Epoch Evolution</h2>',
        '<p class="artifact-root">VFS snapshots and cognitive trace separated by epoch so you can see how the code mutated over time.</p>',
        '</section>',
        renderProgressionEvidence(result),
      ].join('')
      : `<section class="panel">
      <h2>Cognitive Execution Trace</h2>
      ${renderCognitiveTrace(result)}
    </section>`}
    <section class="panel">
      <h2>Judge Evaluation JSON</h2>
      <pre>${escapeHtml(evaluations)}</pre>
    </section>
  </main>
</body>
</html>`;
}
