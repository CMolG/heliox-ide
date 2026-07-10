/**
 * webview.d.ts — Ambient JSX declaration for Electron's <webview> element
 *
 * Responsibility:
 * - Teaches TypeScript/JSX about the <webview> intrinsic element so renderer
 *   components can use it without "Property 'webview' does not exist" errors.
 *
 * Boundaries:
 * - Renderer-only ambient augmentation. Does NOT introduce runtime code.
 * - Only props used by WebPreviewApp are listed; extend as M2/M3 need them.
 *
 * Reference: https://www.electronjs.org/docs/latest/api/webview-tag
 */

// src/types/webview.d.ts — JSX intrinsic element declaration for <webview>

import type React from 'react';

declare namespace JSX {
  interface IntrinsicElements {
    webview: React.DetailedHTMLProps<WebviewHTMLAttributes, HTMLElement>;
  }
}

/**
 * Props subset for <webview> that WebPreviewApp and future M2/M3 components use.
 * Maps 1-to-1 to the Electron WebviewTag attributes documented in the Electron API.
 */
interface WebviewHTMLAttributes extends React.HTMLAttributes<HTMLElement> {
  /** Initial URL to load. Mutable at runtime via el.loadURL(). */
  src?: string;
  /** Session partition — 'persist:' prefix makes it durable across restarts. */
  partition?: string;
  /** Allow the webview to open new windows (we set this to false for security). */
  allowpopups?: boolean;
  /** Pre-registered JS to inject into every page (kept empty in M1 for security). */
  preload?: string;
  /** Allow HTTP Basic Auth dialogs (disabled by default). */
  httpreferrer?: string;
  /** User-agent override. */
  useragent?: string;
  /** Disable the guest page's web security (never set to true in Fluxor). */
  disablewebsecurity?: boolean;
  /** Node integration in the guest (always false — we use contextIsolation). */
  nodeintegration?: boolean;
  /** Enables WebRTC in the webview. */
  enableblinkfeatures?: string;
  /** Height/width provided via style — standard React. */
  style?: React.CSSProperties;
  className?: string;
  ref?: React.Ref<HTMLElement>;
}
