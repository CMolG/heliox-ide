/**
 * browser.ts — M2 Browser/CDP types
 *
 * Responsibility:
 * - Defines the data shapes shared across the browser-controller (main),
 *   browser-ipc (main), preload bridge, and renderer (M3 toolset).
 *
 * Boundaries:
 * - Pure types only — no runtime code, no imports, no side-effects.
 * - Safe to import from renderer, main, or preload without bundling issues.
 */
// src/types/browser.ts — Shared type definitions for M2 native CDP browser control

// ─── Accessibility Object Model ────────────────────────────────────────────────

/**
 * A single node in the compact Accessibility Object Model tree returned by
 * `observePage`. Only semantically meaningful nodes are kept (pruned from the
 * full AXTree) and assigned a sequential numeric id that is stable until the
 * next observe/goto call.
 */
export interface AomNode {
  /** Sequential numeric id, valid until the next observePage/goto. */
  id: number;
  /** ARIA role string (e.g. 'button', 'link', 'textbox', 'heading'). */
  role: string;
  /** Accessible name, if present. */
  name?: string;
  /** Current value (for form controls). */
  value?: string;
  /** Child nodes (only kept nodes; ignored nodes are pruned). */
  children?: AomNode[];
}

/**
 * Snapshot of the page's compact AOM, returned by `observePage` and as the
 * side-effect result of `goto` and `act`.
 */
export interface AomSnapshot {
  /** The current page URL at snapshot time. */
  url: string;
  /** The current document title. */
  title: string;
  /** Compact, pruned accessibility tree (max 600 nodes). */
  tree: AomNode[];
  /** Total number of kept nodes in the snapshot. */
  nodeCount: number;
}

// ─── Browser Actions ────────────────────────────────────────────────────────────

/**
 * The set of DOM interactions the agent can perform via `act`.
 *
 * - `click`  — scrolls into view and fires `.click()`.
 * - `fill`   — sets `.value` and dispatches input+change events.
 * - `select` — same as fill; covers <select> dropdowns.
 * - `press`  — dispatches a KeyboardEvent (e.g. 'Enter', 'Tab').
 */
export type BrowserAction = 'click' | 'fill' | 'select' | 'press';

// ─── SEO Report ────────────────────────────────────────────────────────────────

/**
 * Structured SEO + performance snapshot extracted from a live page via
 * `Runtime.evaluate` in the guest WebContents. All fields are best-effort;
 * missing data appears as undefined or an empty structure. Warnings array
 * collects any extraction failures.
 */
export interface SeoReport {
  /** The URL the report was extracted from. */
  url: string;
  /** document.title */
  title: string;
  /** <meta name="description"> content */
  metaDescription?: string;
  /** <link rel="canonical"> href */
  canonical?: string;
  /** <html lang> attribute */
  lang?: string;
  /** <meta name="robots"> content */
  robots?: string;
  /** All Open Graph meta tags, keyed by property suffix (e.g. 'title', 'image'). */
  og: Record<string, string>;
  /** All Twitter Card meta tags, keyed by name suffix (e.g. 'card', 'title'). */
  twitter: Record<string, string>;
  /** h1–h3 heading outline in document order. */
  headings: { level: number; text: string }[];
  /** Core Web Vitals from Navigation / Paint / PerformanceObserver entries. */
  webVitals: {
    /** First Contentful Paint (ms) */
    fcpMs?: number;
    /** Largest Contentful Paint (ms) — collected via PerformanceObserver */
    lcpMs?: number;
    /** Cumulative Layout Shift score */
    cls?: number;
    /** Time to First Byte (ms) */
    ttfbMs?: number;
  };
  /** Non-fatal extraction warnings (one per failed field). */
  warnings: string[];
}
