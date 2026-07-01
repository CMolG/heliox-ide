/**
 * WebPreviewApp.tsx — Renderer Embedded App Component
 *
 * Responsibility:
 * - Renders an embedded browser preview using Electron's <webview> tag.
 * - Provides a slim dark address bar (back / forward / reload + editable URL).
 * - Captures the guest WebContents id on dom-ready and persists it to the
 *   desktop store so M2 can attach a CDP debugger without further plumbing.
 * - Hosts the "link to agent" toggle (M2): attaches / detaches the CDP session
 *   for this window and marks it as the active agent surface in the store.
 *
 * Boundaries:
 * - Owns: webview lifecycle wiring, address bar interactions, store write for
 *         webContentsId, agent-link toggle UX (M2 surface).
 * - Does NOT own: CDP internals (browser-controller.ts), agent toolset (M3),
 *                 or IPC transport details.
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/atoms/apps/WebPreviewApp.tsx — Embedded dev-server preview window
import React, { useRef, useState, useEffect, useCallback } from 'react';
import { theme } from '../../../logic/theme';
import { LucideIcon } from '../../desktop/LucideIcon';
import { useDesktopStore } from '../../../store/desktop-store';

// ─── Webview element type ────────────────────────────────────────────────────
// Electron's WebviewTag exposes DOM methods not on standard HTMLElement.
// We use a narrow interface here rather than importing from electron (no node
// imports in renderer) so we get compile-time safety without bundling main deps.

interface WebviewEl extends HTMLElement {
  src: string;
  loadURL(url: string): void;
  goBack(): void;
  goForward(): void;
  reload(): void;
  getWebContentsId(): number;
  canGoBack(): boolean;
  canGoForward(): boolean;
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface WebPreviewAppProps {
  windowId: string;
  /** Initial URL to load — typically 'http://localhost:<port>' from the dev-server watcher. */
  url: string;
}

// ─── Address bar button style helper ────────────────────────────────────────

const NAV_BTN: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 26,
  height: 26,
  borderRadius: 4,
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  flexShrink: 0,
  color: theme.textDim,
  padding: 0,
};

// ─── Component ───────────────────────────────────────────────────────────────

export function WebPreviewApp({ windowId, url: initialUrl }: WebPreviewAppProps) {
  const _updateWindow = useDesktopStore(s => s._updateWindow);
  const linkWindowToAgent = useDesktopStore(s => s.linkWindowToAgent);
  // Read agentLinked and webContentsId reactively from the store
  const agentLinked = useDesktopStore(s => {
    const w = s.windows.find(w => w.id === windowId);
    return w?.agentLinked ?? false;
  });
  const webContentsId = useDesktopStore(s => {
    const w = s.windows.find(w => w.id === windowId);
    return w?.webContentsId ?? null;
  });

  const webviewRef = useRef<WebviewEl>(null);

  // Address bar mirrors the live URL; starts with the prop value (read-only display)
  const [addressValue, setAddressValue] = useState(initialUrl);
  // Tracks whether the link/unlink IPC call is in-flight (prevents double-click)
  const [linkPending, setLinkPending] = useState(false);

  // ── Agent-link toggle ────────────────────────────────────────────
  // Enable: call browserAttach then mark this window as the agent surface.
  // Disable: clear agent surface then call browserDetach.
  // Both paths are guarded by linkPending to prevent racing IPC calls.
  const handleAgentLinkToggle = useCallback(async () => {
    if (linkPending || webContentsId == null) return;
    // helioxAPI is always present in Electron renderer — the bridge is set up before
    // any React code runs. The optional type is a TypeScript precaution for non-Electron
    // test environments; we guard here to satisfy strict mode cleanly.
    const api = window.helioxAPI;
    if (!api) return;
    setLinkPending(true);
    try {
      if (!agentLinked) {
        const result = await api.browserAttach(webContentsId);
        if (result?.success) {
          // Tell the MAIN process this is the active agent surface (M3 reads it).
          await api.browserSetAgentSurface(webContentsId);
          linkWindowToAgent(windowId, true);
        }
      } else {
        linkWindowToAgent(windowId, false);
        await api.browserSetAgentSurface(null);
        await api.browserDetach(webContentsId);
      }
    } catch {
      // IPC failure — silently restore to unlinked state to keep UI consistent
      linkWindowToAgent(windowId, false);
    } finally {
      setLinkPending(false);
    }
  }, [linkPending, webContentsId, agentLinked, linkWindowToAgent, windowId]);

  // On dom-ready: capture webContentsId for M2, and update address bar
  useEffect(() => {
    const el = webviewRef.current;
    if (!el) return;

    const handleDomReady = () => {
      // Persist the guest WebContents id so M2 can attach a CDP debugger.
      // _updateWindow accepts Partial<DesktopWindow> — webContentsId is the M2 seam.
      const wcId = el.getWebContentsId();
      _updateWindow(windowId, { webContentsId: wcId });
    };

    // Keep the address bar in sync with page navigations initiated inside the webview
    const handleNavigate = (e: Event) => {
      const ev = e as CustomEvent<{ url: string }>;
      if (ev.detail?.url) {
        setAddressValue(ev.detail.url);
      }
    };

    el.addEventListener('dom-ready', handleDomReady);
    el.addEventListener('did-navigate', handleNavigate);
    el.addEventListener('did-navigate-in-page', handleNavigate);

    return () => {
      el.removeEventListener('dom-ready', handleDomReady);
      el.removeEventListener('did-navigate', handleNavigate);
      el.removeEventListener('did-navigate-in-page', handleNavigate);
    };
  }, [windowId, _updateWindow]);

  // ─── Render ─────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: theme.bg }}>

      {/* ── Address bar ────────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 8px',
        borderBottom: `1px solid ${theme.borderLight}`,
        background: theme.surface,
        flexShrink: 0,
      }}>
        {/* Back */}
        <button
          style={NAV_BTN}
          title="Go back"
          onClick={() => webviewRef.current?.goBack()}
          onMouseEnter={e => (e.currentTarget.style.background = theme.surfaceHover)}
          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
        >
          <LucideIcon name="ChevronLeft" size={14} />
        </button>

        {/* Forward */}
        <button
          style={NAV_BTN}
          title="Go forward"
          onClick={() => webviewRef.current?.goForward()}
          onMouseEnter={e => (e.currentTarget.style.background = theme.surfaceHover)}
          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
        >
          <LucideIcon name="ChevronRight" size={14} />
        </button>

        {/* Reload */}
        <button
          style={NAV_BTN}
          title="Reload"
          onClick={() => webviewRef.current?.reload()}
          onMouseEnter={e => (e.currentTarget.style.background = theme.surfaceHover)}
          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
        >
          <LucideIcon name="RotateCw" size={13} />
        </button>

        {/* Agent-link toggle — M2 seam ─────────────────────────────────────── */}
        {/*
          Visible only when a webContentsId has been captured (post dom-ready).
          Accent color when linked; dimmed when unlinked or waiting for the CDP
          attach/detach IPC call. Clicking while linkPending is a no-op.
        */}
        <button
          style={{
            ...NAV_BTN,
            color: agentLinked ? '#22d3ee' : linkPending ? theme.textGhost : theme.textDim,
            opacity: linkPending ? 0.5 : 1,
            cursor: linkPending || webContentsId == null ? 'not-allowed' : 'pointer',
            position: 'relative',
          }}
          title={
            webContentsId == null
              ? 'Waiting for page to load…'
              : agentLinked
                ? 'Unlink agent (detach CDP session)'
                : 'Link to agent (attach CDP session)'
          }
          onClick={handleAgentLinkToggle}
          disabled={linkPending || webContentsId == null}
          onMouseEnter={e => {
            if (!linkPending && webContentsId != null) {
              e.currentTarget.style.background = theme.surfaceHover;
            }
          }}
          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
        >
          <LucideIcon name={agentLinked ? 'Bot' : 'BotOff'} size={13} />
        </button>

        {/* URL input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 1, minWidth: 0,
          background: theme.surfaceMid, borderRadius: 5, border: `1px solid ${theme.borderLight}`,
          padding: '2px 8px', height: 24 }}>
          <LucideIcon name="Globe" size={11} style={{ color: theme.textGhost, flexShrink: 0 }} />
          <input
            value={addressValue}
            readOnly
            style={{
              flex: 1,
              minWidth: 0,
              background: 'none',
              border: 'none',
              outline: 'none',
              color: theme.textSecondary,
              fontSize: 11,
              fontFamily: 'inherit',
              cursor: 'default',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />
        </div>
      </div>

      {/* ── Webview ─────────────────────────────────────────────────── */}
    {/*
        partition="persist:heliox-preview" keeps session cookies across reloads
        but isolated from the main renderer session.
        Popups/new windows are denied in the MAIN process via setWindowOpenHandler
        (the did-attach-webview guard in src/main/index.ts). The `allowpopups`
        attribute is intentionally omitted: a <webview> enables popups by the
        attribute's mere PRESENCE, and `allowpopups={false}` would render the
        string "false" (treated as truthy) — the opposite of the intent.
        No preload — guest content runs with no privileged access.
      */}
      <webview
        ref={webviewRef as React.Ref<HTMLElement>}
        src={initialUrl}
        partition="persist:heliox-preview"
        style={{ flex: 1, width: '100%', height: '100%', border: 'none' }}
      />
    </div>
  );
}
