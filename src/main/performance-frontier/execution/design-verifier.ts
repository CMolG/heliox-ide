/**
 * design-verifier.ts — Deterministic ground-truth accessibility verifier for
 * the Performance Frontier Design suite.
 *
 * Parses the agent's VFS snapshot for /workspace/index.html, builds a static
 * jsdom DOM, injects axe-core into the jsdom window context, runs it, and
 * returns a machine-readable A11yVerificationResult.
 *
 * IMPORTANT: This module NEVER throws. All error paths return ran:false with an
 * errorMessage so callers can surface the failure without try/catch.
 *
 * Deliberately does NOT load external resources (no network, no scripts from HTML)
 * so it is deterministic and offline-safe. Color-contrast is disabled because
 * jsdom cannot compute CSS visual rendering — that dimension is left to the LLM judge.
 */

import { JSDOM } from 'jsdom';
import axe from 'axe-core';

const OUTPUT_TRUNCATE_BYTES = 4 * 1024; // 4 KB

export interface A11yVerificationResult {
  /** Did axe-core actually execute against the DOM? */
  ran: boolean;
  /** Total number of axe violations found. */
  violations: number;
  /** IDs of violations with impact 'critical' or 'serious'. */
  critical: string[];
  /** Count of axe passing rules. */
  passes: number;
  /** Truncated human summary: "rule-id (impact): help text" per violation. */
  output: string;
  errorMessage?: string;
}

function truncate(text: string): string {
  const buf = Buffer.from(text, 'utf-8');
  if (buf.byteLength <= OUTPUT_TRUNCATE_BYTES) return text;
  return buf.slice(0, OUTPUT_TRUNCATE_BYTES).toString('utf-8') + '\n… (truncated)';
}

/**
 * Locates the project's index.html in a VFS snapshot. Prefers the canonical
 * /workspace/index.html path, then falls back to any path ending in
 * /index.html (e.g. team-work's differently-rooted snapshots), then a bare
 * index.html key.
 */
function findIndexHtml(snapshot: Record<string, string>): string | undefined {
  if (snapshot['/workspace/index.html'] != null) return snapshot['/workspace/index.html'];
  const k = Object.keys(snapshot).find((key) => key.endsWith('/index.html'));
  if (k) return snapshot[k];
  if (snapshot['index.html'] != null) return snapshot['index.html'];
  return undefined;
}

/**
 * Run axe-core structural accessibility checks against the HTML string from the
 * VFS snapshot. Returns a deterministic, machine-readable result.
 *
 * The snapshot MUST include /workspace/index.html for analysis to proceed.
 */
export async function verifyDesign(
  vfsSnapshot: Record<string, string>,
): Promise<A11yVerificationResult> {
  const html = findIndexHtml(vfsSnapshot);
  if (!html) {
    return {
      ran: false,
      violations: 0,
      critical: [],
      passes: 0,
      output: '',
      errorMessage: 'no index.html in VFS snapshot at /workspace/index.html',
    };
  }

  // Save globals that axe-core needs so we can restore them in finally.
  const savedWindow = (globalThis as Record<string, unknown>)['window'];
  const savedDocument = (globalThis as Record<string, unknown>)['document'];

  try {
    // Build a static jsdom DOM — no resource loading, no script execution from
    // the HTML itself. This keeps us offline-deterministic.
    const dom = new JSDOM(html, { pretendToBeVisual: false });
    const { window } = dom;
    const { document } = window;

    // Point axe-core's expected globals at the jsdom context.
    (globalThis as Record<string, unknown>)['window'] = window;
    (globalThis as Record<string, unknown>)['document'] = document;

    // Inject axe-core into the jsdom window so axe.run can locate the DOM.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const axeSetup = new window.Function(axe.source);
    axeSetup();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const windowAxe: typeof axe = (window as any).axe as typeof axe;

    // Run structural WCAG 2.x + best-practice rules; disable color-contrast
    // because jsdom cannot compute visual CSS rendering.
    const result = await windowAxe.run(document, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'best-practice'],
      },
      rules: {
        'color-contrast': { enabled: false },
      },
    });

    const violationCount = result.violations.length;
    const criticalIds = result.violations
      .filter((v) => v.impact === 'critical' || v.impact === 'serious')
      .map((v) => v.id);
    const passCount = result.passes.length;

    const summaryLines = result.violations.map(
      (v) => `${v.id} (${v.impact ?? 'unknown'}): ${v.help}`,
    );
    const output = truncate(summaryLines.join('\n'));

    return {
      ran: true,
      violations: violationCount,
      critical: criticalIds,
      passes: passCount,
      output,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ran: false,
      violations: 0,
      critical: [],
      passes: 0,
      output: '',
      errorMessage: `axe-core run failed: ${msg}`,
    };
  } finally {
    // Restore original globals unconditionally.
    (globalThis as Record<string, unknown>)['window'] = savedWindow;
    (globalThis as Record<string, unknown>)['document'] = savedDocument;
  }
}
