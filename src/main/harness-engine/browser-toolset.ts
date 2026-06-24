/**
 * browser-toolset.ts — Agent-facing browser tools (M3)
 *
 * Exposes three Vercel AI SDK tools that let a pipeline step drive the live
 * preview (or a headless fallback) via the main-process `browserController`
 * singleton.
 *
 * Tool names are stable and referenced by the `web-browser` mod id:
 *   - browser_goto         — navigate to a URL; returns compact AOM
 *   - browser_act          — click / fill / select / press an element by AOM id
 *   - browser_extract_seo  — extract meta tags, canonical, and Core Web Vitals
 *
 * Shape mirrors `createLocalMcpToolSet` in mcp-adapter.ts: each tool is built
 * with `tool({ description, inputSchema, execute, toModelOutput })` so the Vercel
 * AI SDK handles schema validation and result serialization uniformly.
 *
 * All `execute` implementations catch controller errors and return a plain
 * recovery-hint string rather than throwing — the LLM can self-correct without
 * a hard run failure.
 */

import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { browserController } from '../browser/browser-controller';
import type { AomSnapshot, AomNode, SeoReport } from '../../types/browser';

// ─── AOM → compact text ────────────────────────────────────────────────────────

/**
 * Render an `AomSnapshot` as a compact, depth-indented plain-text listing.
 *
 * Format:
 * ```
 * # <title> — <url> (<nodeCount> elements)
 *   [12] button "Submit"
 *   [13] textbox "Email" value="user@example.com"
 *       [14] link "Forgot password?"
 * ```
 *
 * Nodes with `id === 0` are synthetic group/note containers — their `[id]`
 * prefix is omitted and they act as transparent indentation parents. When a
 * node has a `value`, it is appended as `value="<v>"` for form-control context.
 *
 * The output is intentionally compact to minimise token consumption while
 * preserving the information the LLM needs: numeric id → role → accessible name.
 */
export function aomToText(snapshot: AomSnapshot): string {
  const lines: string[] = [
    `# ${snapshot.title} — ${snapshot.url} (${snapshot.nodeCount} elements)`,
  ];

  function walk(node: AomNode, depth: number): void {
    const indent = '  '.repeat(depth);
    const idPart = node.id !== 0 ? `[${node.id}] ` : '';
    const namePart = node.name ? ` "${node.name}"` : '';
    const valuePart = node.value !== undefined ? ` value="${node.value}"` : '';
    lines.push(`${indent}${idPart}${node.role}${namePart}${valuePart}`);
    for (const child of node.children ?? []) {
      walk(child, depth + 1);
    }
  }

  for (const node of snapshot.tree) {
    walk(node, 1);
  }

  return lines.join('\n');
}

// ─── SEO → compact text ────────────────────────────────────────────────────────

function seoToText(report: SeoReport): string {
  const lines: string[] = [`# SEO report — ${report.url}`];

  lines.push(`title: ${report.title}`);
  if (report.metaDescription !== undefined) lines.push(`description: ${report.metaDescription}`);
  if (report.canonical !== undefined) lines.push(`canonical: ${report.canonical}`);
  if (report.lang !== undefined) lines.push(`lang: ${report.lang}`);
  if (report.robots !== undefined) lines.push(`robots: ${report.robots}`);

  for (const [key, val] of Object.entries(report.og)) {
    lines.push(`og:${key}: ${val}`);
  }
  for (const [key, val] of Object.entries(report.twitter)) {
    lines.push(`twitter:${key}: ${val}`);
  }

  if (report.headings.length > 0) {
    lines.push('');
    lines.push('headings:');
    for (const h of report.headings) {
      lines.push(`  h${h.level}: ${h.text}`);
    }
  }

  const vt = report.webVitals;
  if (Object.values(vt).some(v => v !== undefined)) {
    lines.push('');
    lines.push('webVitals:');
    if (vt.ttfbMs !== undefined) lines.push(`  ttfb: ${vt.ttfbMs.toFixed(1)} ms`);
    if (vt.fcpMs !== undefined) lines.push(`  fcp: ${vt.fcpMs.toFixed(1)} ms`);
    if (vt.lcpMs !== undefined) lines.push(`  lcp: ${vt.lcpMs.toFixed(1)} ms`);
    if (vt.cls !== undefined) lines.push(`  cls: ${vt.cls.toFixed(4)}`);
  }

  if (report.warnings.length > 0) {
    lines.push('');
    lines.push('warnings:');
    for (const w of report.warnings) lines.push(`  - ${w}`);
  }

  return lines.join('\n');
}

// ─── Input schemas ─────────────────────────────────────────────────────────────

const gotoSchema = z.object({
  url: z.string().url().describe('Absolute http/https URL to navigate to.'),
});

const actSchema = z.object({
  elementId: z.number().int().positive().describe(
    'Numeric element id from the most recent AOM snapshot (browser_goto or browser_act result).',
  ),
  action: z.enum(['click', 'fill', 'select', 'press']).describe(
    'DOM interaction: click fires .click(); fill sets .value; select sets <select> value; press dispatches a KeyboardEvent.',
  ),
  value: z.string().optional().describe(
    'Required for fill/select (the text/option value) and press (the key name, e.g. "Enter").',
  ),
});

const extractSeoSchema = z.object({
  url: z.string().url().optional().describe(
    'Optional URL to navigate to before extracting SEO data. Omit to inspect the current page.',
  ),
});

// ─── ToolSet factory ───────────────────────────────────────────────────────────

/**
 * Build the browser ToolSet injected by the executor when a step declares the
 * `web-browser` mod. Each tool follows the same `tool()` shape as
 * `createLocalMcpToolSet` so the Vercel AI SDK handles schema validation and
 * `toModelOutput` serialisation uniformly.
 */
export function createBrowserToolSet(): ToolSet {
  return {
    browser_goto: tool({
      description:
        'Navigate to a URL and return a compact accessibility tree (AOM) with numeric element ids. '
        + 'Use the returned ids with browser_act to interact with elements. '
        + 'Drives the linked preview window when present, else a headless surface.',
      inputSchema: gotoSchema,
      execute: async ({ url }) => {
        try {
          const id = await browserController.ensureAgentSurface();
          return await browserController.goto(id, url);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return `browser_goto failed: ${msg}. Verify the URL is reachable and uses http/https.`;
        }
      },
      toModelOutput: ({ output }) => ({
        type: 'text',
        value: typeof output === 'string' ? output : aomToText(output as AomSnapshot),
      }),
    }),

    browser_act: tool({
      description:
        'Interact with a page element identified by its numeric AOM id from the last browser_goto '
        + 'or browser_act snapshot. Returns a fresh AOM snapshot after the action settles. '
        + 'If the id is stale (page navigated since last observe), call browser_goto again first.',
      inputSchema: actSchema,
      execute: async ({ elementId, action, value }) => {
        try {
          const id = await browserController.ensureAgentSurface();
          return await browserController.act(id, elementId, action, value);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // Stale element ids are the most common failure — give a targeted hint
          if (msg.toLowerCase().includes('unknown elementid') || msg.toLowerCase().includes('elementid')) {
            return `browser_act failed: element id ${elementId} is no longer valid — call browser_goto or observe to refresh element ids, then retry.`;
          }
          return `browser_act failed: ${msg}. Call browser_goto to navigate and refresh element ids.`;
        }
      },
      toModelOutput: ({ output }) => ({
        type: 'text',
        value: typeof output === 'string' ? output : aomToText(output as AomSnapshot),
      }),
    }),

    browser_extract_seo: tool({
      description:
        'Extract SEO metadata (title, meta description, canonical, Open Graph, Twitter Card, '
        + 'h1–h3 headings) and Core Web Vitals (TTFB, FCP, LCP, CLS) from the current page. '
        + 'Pass url to navigate there first; omit to inspect the already-loaded page.',
      inputSchema: extractSeoSchema,
      execute: async ({ url }) => {
        try {
          const id = await browserController.ensureAgentSurface();
          return await browserController.extractSeo(id, url);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return `browser_extract_seo failed: ${msg}. Ensure the page is loaded (call browser_goto first if needed).`;
        }
      },
      toModelOutput: ({ output }) => ({
        type: 'text',
        value: typeof output === 'string' ? output : seoToText(output as SeoReport),
      }),
    }),
  };
}
