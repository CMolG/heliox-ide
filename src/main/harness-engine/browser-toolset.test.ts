/**
 * browser-toolset.test.ts — Unit tests for M3 browser toolset
 *
 * Strategy:
 * - `browserController` is mocked via vi.mock so no Electron process is needed.
 * - Each test verifies:
 *   1. The tool calls `ensureAgentSurface` before delegating to the controller.
 *   2. The correct controller method is called with the correct arguments.
 *   3. `aomToText` renders numeric ids, roles, names, and values compactly and
 *      omits the `[id]` prefix for synthetic id===0 group/note nodes.
 *   4. A thrown controller error is converted into a recovery-hint string
 *      (the tool execute resolves; it does NOT re-throw).
 *   5. `hasWebBrowserMod` gating (exercised indirectly via the toolset factory —
 *      the executor wiring is validated by testing createBrowserToolSet keys).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AomSnapshot, SeoReport } from '../../types/browser';
import { aomToText, createBrowserToolSet } from './browser-toolset';

// ─── Canned fixtures ──────────────────────────────────────────────────────────

const CANNED_SNAPSHOT: AomSnapshot = {
  url: 'https://example.com/page',
  title: 'Example Page',
  nodeCount: 4,
  tree: [
    {
      id: 1,
      role: 'heading',
      name: 'Welcome',
    },
    {
      id: 2,
      role: 'button',
      name: 'Submit',
    },
    {
      id: 3,
      role: 'textbox',
      name: 'Email',
      value: 'user@example.com',
    },
    {
      // id === 0 → synthetic group; [id] prefix must be omitted in aomToText
      id: 0,
      role: 'group',
      children: [
        {
          id: 4,
          role: 'link',
          name: 'Forgot password?',
        },
      ],
    },
  ],
};

const CANNED_SEO: SeoReport = {
  url: 'https://example.com/',
  title: 'Example',
  metaDescription: 'A test site',
  canonical: 'https://example.com/',
  lang: 'en',
  robots: 'index,follow',
  og: { title: 'Example OG', image: 'https://example.com/img.png' },
  twitter: { card: 'summary' },
  headings: [{ level: 1, text: 'Hello World' }],
  webVitals: { ttfbMs: 120, fcpMs: 800, lcpMs: 1500, cls: 0.05 },
  warnings: [],
};

// ─── Controller mock ──────────────────────────────────────────────────────────
//
// vi.mock is hoisted; the factory returns an object whose spies can be
// overridden per-test via `mockResolvedValue` / `mockRejectedValue`.

vi.mock('../browser/browser-controller', () => ({
  browserController: {
    ensureAgentSurface: vi.fn(),
    goto: vi.fn(),
    act: vi.fn(),
    extractSeo: vi.fn(),
  },
}));

// Import AFTER mock registration so the module gets the mocked version.
import { browserController } from '../browser/browser-controller';

// Typed helper so we get autocompletion on mock methods.
// The double-cast (unknown first) is required because the real BrowserController
// type and the vi.fn mock shape have no structural overlap.
const mockController = browserController as unknown as {
  ensureAgentSurface: ReturnType<typeof vi.fn>;
  goto: ReturnType<typeof vi.fn>;
  act: ReturnType<typeof vi.fn>;
  extractSeo: ReturnType<typeof vi.fn>;
};

// ─── Shared setup ─────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockController.ensureAgentSurface.mockResolvedValue(42);
  mockController.goto.mockResolvedValue(CANNED_SNAPSHOT);
  mockController.act.mockResolvedValue(CANNED_SNAPSHOT);
  mockController.extractSeo.mockResolvedValue(CANNED_SEO);
});

// ─── aomToText ────────────────────────────────────────────────────────────────

describe('aomToText', () => {
  it('renders a header with title, url, and nodeCount', () => {
    const text = aomToText(CANNED_SNAPSHOT);
    expect(text).toContain('# Example Page — https://example.com/page (4 elements)');
  });

  it('renders numeric ids for kept nodes', () => {
    const text = aomToText(CANNED_SNAPSHOT);
    expect(text).toContain('[1] heading "Welcome"');
    expect(text).toContain('[2] button "Submit"');
    expect(text).toContain('[3] textbox "Email"');
    expect(text).toContain('[4] link "Forgot password?"');
  });

  it('appends value="..." for form controls', () => {
    const text = aomToText(CANNED_SNAPSHOT);
    expect(text).toContain('value="user@example.com"');
  });

  it('omits [id] prefix for id===0 synthetic group nodes', () => {
    const text = aomToText(CANNED_SNAPSHOT);
    // The group node (id=0) should appear as "group" without a numeric prefix
    const lines = text.split('\n');
    const groupLine = lines.find(l => l.trimStart().startsWith('group'));
    expect(groupLine).toBeDefined();
    expect(groupLine).not.toMatch(/\[\d+\]/);
  });

  it('indents children deeper than their parent', () => {
    const text = aomToText(CANNED_SNAPSHOT);
    const lines = text.split('\n');
    const groupIdx = lines.findIndex(l => l.trimStart().startsWith('group'));
    const linkIdx = lines.findIndex(l => l.includes('[4] link'));
    expect(groupIdx).toBeGreaterThan(-1);
    expect(linkIdx).toBeGreaterThan(groupIdx);
    // The link line should have more leading spaces than the group line
    const groupIndent = lines[groupIdx].match(/^(\s*)/)?.[1].length ?? 0;
    const linkIndent = lines[linkIdx].match(/^(\s*)/)?.[1].length ?? 0;
    expect(linkIndent).toBeGreaterThan(groupIndent);
  });
});

// ─── createBrowserToolSet ─────────────────────────────────────────────────────

describe('createBrowserToolSet', () => {
  it('exports exactly the three required tool names', () => {
    const toolset = createBrowserToolSet();
    expect(Object.keys(toolset).sort()).toEqual([
      'browser_act',
      'browser_extract_seo',
      'browser_goto',
    ]);
  });
});

// ─── browser_goto ─────────────────────────────────────────────────────────────

describe('browser_goto tool', () => {
  it('calls ensureAgentSurface then goto with the correct url', async () => {
    const { browser_goto } = createBrowserToolSet();
    await browser_goto.execute?.(
      { url: 'https://example.com/page' },
      { toolCallId: 'tc-1', messages: [] },
    );

    expect(mockController.ensureAgentSurface).toHaveBeenCalledOnce();
    expect(mockController.goto).toHaveBeenCalledWith(42, 'https://example.com/page');
  });

  it('returns the AomSnapshot from the controller', async () => {
    const { browser_goto } = createBrowserToolSet();
    const result = await browser_goto.execute?.(
      { url: 'https://example.com/page' },
      { toolCallId: 'tc-2', messages: [] },
    );
    expect(result).toEqual(CANNED_SNAPSHOT);
  });

  it('converts a controller error into a recovery-hint string (does not throw)', async () => {
    mockController.goto.mockRejectedValue(new Error('load timeout'));
    const { browser_goto } = createBrowserToolSet();

    const result = await browser_goto.execute?.(
      { url: 'https://example.com/page' },
      { toolCallId: 'tc-3', messages: [] },
    );

    expect(typeof result).toBe('string');
    expect(result as string).toContain('browser_goto failed');
    expect(result as string).toContain('load timeout');
  });

  it('toModelOutput converts an AomSnapshot to compact text', () => {
    const { browser_goto } = createBrowserToolSet();
    const out = browser_goto.toModelOutput?.({ toolCallId: 'tc-m1', output: CANNED_SNAPSHOT, input: { url: 'https://example.com/page' } });
    expect(out).toMatchObject({ type: 'text' });
    expect((out as { type: string; value: string }).value).toContain('[2] button "Submit"');
  });

  it('toModelOutput passes through a recovery string unchanged', () => {
    const { browser_goto } = createBrowserToolSet();
    const recovery = 'browser_goto failed: some error';
    const out = browser_goto.toModelOutput?.({ toolCallId: 'tc-m2', output: recovery, input: { url: 'https://example.com/page' } });
    expect((out as { type: string; value: string }).value).toBe(recovery);
  });
});

// ─── browser_act ──────────────────────────────────────────────────────────────

describe('browser_act tool', () => {
  it('calls ensureAgentSurface then act with elementId, action, value', async () => {
    const { browser_act } = createBrowserToolSet();
    await browser_act.execute?.(
      { elementId: 3, action: 'fill', value: 'hello@test.com' },
      { toolCallId: 'ta-1', messages: [] },
    );

    expect(mockController.ensureAgentSurface).toHaveBeenCalledOnce();
    expect(mockController.act).toHaveBeenCalledWith(42, 3, 'fill', 'hello@test.com');
  });

  it('calls act without value when value is omitted', async () => {
    const { browser_act } = createBrowserToolSet();
    await browser_act.execute?.(
      { elementId: 2, action: 'click' },
      { toolCallId: 'ta-2', messages: [] },
    );

    expect(mockController.act).toHaveBeenCalledWith(42, 2, 'click', undefined);
  });

  it('returns a stale-id recovery hint when elementId is unknown', async () => {
    mockController.act.mockRejectedValue(
      new Error('BrowserController.act: Unknown elementId 99; call observe/goto again to refresh the AOM.'),
    );
    const { browser_act } = createBrowserToolSet();
    const result = await browser_act.execute?.(
      { elementId: 99, action: 'click' },
      { toolCallId: 'ta-3', messages: [] },
    );

    expect(typeof result).toBe('string');
    expect(result as string).toContain('browser_act failed');
    expect(result as string).toContain('refresh element ids');
  });

  it('returns a generic recovery hint for non-stale errors', async () => {
    mockController.act.mockRejectedValue(new Error('CDP connection lost'));
    const { browser_act } = createBrowserToolSet();
    const result = await browser_act.execute?.(
      { elementId: 2, action: 'click' },
      { toolCallId: 'ta-4', messages: [] },
    );

    expect(typeof result).toBe('string');
    expect(result as string).toContain('browser_act failed');
    expect(result as string).toContain('CDP connection lost');
  });

  it('toModelOutput converts an AomSnapshot to compact text', () => {
    const { browser_act } = createBrowserToolSet();
    const out = browser_act.toModelOutput?.({ toolCallId: 'ta-m1', output: CANNED_SNAPSHOT, input: { elementId: 2, action: 'click' } });
    expect((out as { type: string; value: string }).value).toContain('[2] button "Submit"');
  });
});

// ─── browser_extract_seo ──────────────────────────────────────────────────────

describe('browser_extract_seo tool', () => {
  it('calls ensureAgentSurface then extractSeo without url when omitted', async () => {
    const { browser_extract_seo } = createBrowserToolSet();
    await browser_extract_seo.execute?.(
      {},
      { toolCallId: 'ts-1', messages: [] },
    );

    expect(mockController.ensureAgentSurface).toHaveBeenCalledOnce();
    expect(mockController.extractSeo).toHaveBeenCalledWith(42, undefined);
  });

  it('passes the url when provided', async () => {
    const { browser_extract_seo } = createBrowserToolSet();
    await browser_extract_seo.execute?.(
      { url: 'https://example.com/' },
      { toolCallId: 'ts-2', messages: [] },
    );

    expect(mockController.extractSeo).toHaveBeenCalledWith(42, 'https://example.com/');
  });

  it('returns the SeoReport from the controller', async () => {
    const { browser_extract_seo } = createBrowserToolSet();
    const result = await browser_extract_seo.execute?.(
      {},
      { toolCallId: 'ts-3', messages: [] },
    );
    expect(result).toEqual(CANNED_SEO);
  });

  it('converts a controller error into a recovery-hint string', async () => {
    mockController.extractSeo.mockRejectedValue(new Error('session not attached'));
    const { browser_extract_seo } = createBrowserToolSet();
    const result = await browser_extract_seo.execute?.(
      {},
      { toolCallId: 'ts-4', messages: [] },
    );

    expect(typeof result).toBe('string');
    expect(result as string).toContain('browser_extract_seo failed');
    expect(result as string).toContain('session not attached');
  });

  it('toModelOutput renders a compact key/line SEO block', () => {
    const { browser_extract_seo } = createBrowserToolSet();
    const out = browser_extract_seo.toModelOutput?.({ toolCallId: 'ts-m1', output: CANNED_SEO, input: {} });
    const text = (out as { type: string; value: string }).value;

    expect(text).toContain('# SEO report — https://example.com/');
    expect(text).toContain('title: Example');
    expect(text).toContain('description: A test site');
    expect(text).toContain('canonical: https://example.com/');
    expect(text).toContain('og:title: Example OG');
    expect(text).toContain('twitter:card: summary');
    expect(text).toContain('h1: Hello World');
    expect(text).toContain('ttfb: 120.0 ms');
    expect(text).toContain('lcp: 1500.0 ms');
    expect(text).toContain('cls: 0.0500');
  });
});
