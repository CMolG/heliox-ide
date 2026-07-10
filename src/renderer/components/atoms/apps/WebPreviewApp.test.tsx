/**
 * WebPreviewApp.test.tsx — Dead-URL guard tests for the embedded preview webview
 *
 * Strategy (mirrors StepNode.test.tsx):
 * - Mock desktop-store with a hoisted spy object exposing a single minimal
 *   web-preview window fixture — WebPreviewApp only reads `windows` (via a
 *   `.find(id)` selector), `_updateWindow`, and `linkWindowToAgent` from it.
 * - jsdom renders <webview> as a generic unknown HTMLElement (none of
 *   Electron's guest-view methods like `loadURL`/`goBack` exist on it — those
 *   are added by Electron's runtime at dom-ready). Tests attach their own
 *   `loadURL` spy onto the rendered node and dispatch native DOM events
 *   carrying the extra properties Electron's real `did-fail-load` event has
 *   (errorCode/errorDescription/isMainFrame), exactly mirroring how the
 *   component's own listeners read them.
 *
 * Scenarios:
 *   1. A genuine `did-fail-load` shows the "Preview unreachable" overlay.
 *   2. errorCode -3 (ABORTED — cancelled/superseded navigation) is ignored.
 *   3. isMainFrame=false (a sub-frame failure) is ignored.
 *   4. The Fluxor Serve hint appears only for :8080 preview URLs.
 *   5. Retry calls `loadURL` with the current address and clears the overlay.
 *   6. `did-finish-load` clears a previously-shown overlay.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Module mocks ─────────────────────────────────────────────────────────────

const mockDesktop = vi.hoisted(() => ({
  windows: [
    { id: 'win-1', type: 'web-preview', agentLinked: false, webContentsId: undefined as number | undefined },
  ],
  _updateWindow: vi.fn(),
  linkWindowToAgent: vi.fn(),
}));

vi.mock('../../../store/desktop-store', () => ({
  useDesktopStore: (selector: (s: typeof mockDesktop) => unknown) => selector(mockDesktop),
}));

// ── Import after mocks ───────────────────────────────────────────────────────

import { WebPreviewApp } from './WebPreviewApp';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Builds a 'did-fail-load' event the way Electron's <webview> dispatches it. */
function failLoadEvent(overrides: Partial<{ errorCode: number; errorDescription: string; isMainFrame: boolean }> = {}) {
  const event = new Event('did-fail-load') as Event & {
    errorCode: number;
    errorDescription: string;
    isMainFrame: boolean;
  };
  event.errorCode = overrides.errorCode ?? -105;
  event.errorDescription = overrides.errorDescription ?? 'ERR_NAME_NOT_RESOLVED';
  event.isMainFrame = overrides.isMainFrame ?? true;
  return event;
}

function getWebview(container: HTMLElement) {
  const el = container.querySelector('webview');
  if (!el) throw new Error('Expected a <webview> element to be rendered');
  return el as HTMLElement & { loadURL?: (url: string) => void };
}

beforeEach(() => {
  document.body.innerHTML = '';
  mockDesktop.windows = [
    { id: 'win-1', type: 'web-preview', agentLinked: false, webContentsId: undefined },
  ];
  mockDesktop._updateWindow.mockClear();
  mockDesktop.linkWindowToAgent.mockClear();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('WebPreviewApp — dead-URL guard', () => {
  it('shows the "Preview unreachable" overlay on a genuine did-fail-load', () => {
    const { container } = render(<WebPreviewApp windowId="win-1" url="http://localhost:8080/dashboard/" />);
    fireEvent(getWebview(container), failLoadEvent());

    expect(screen.getByText('Preview unreachable')).toBeInTheDocument();
    expect(screen.getByText('http://localhost:8080/dashboard/')).toBeInTheDocument();
    expect(screen.getByText('ERR_NAME_NOT_RESOLVED')).toBeInTheDocument();
  });

  it('ignores errorCode -3 (ABORTED) — no overlay', () => {
    const { container } = render(<WebPreviewApp windowId="win-1" url="http://localhost:3000/" />);
    fireEvent(getWebview(container), failLoadEvent({ errorCode: -3, errorDescription: 'ERR_ABORTED' }));

    expect(screen.queryByText('Preview unreachable')).not.toBeInTheDocument();
  });

  it('ignores sub-frame failures (isMainFrame=false) — no overlay', () => {
    const { container } = render(<WebPreviewApp windowId="win-1" url="http://localhost:3000/" />);
    fireEvent(getWebview(container), failLoadEvent({ isMainFrame: false }));

    expect(screen.queryByText('Preview unreachable')).not.toBeInTheDocument();
  });

  it('adds the Fluxor Serve hint only for :8080 preview URLs', () => {
    const { container } = render(<WebPreviewApp windowId="win-1" url="http://localhost:8080/dashboard/" />);
    fireEvent(getWebview(container), failLoadEvent());

    expect(screen.getByText(/Fluxor Serve is not running/)).toBeInTheDocument();
    expect(screen.getByText('npm run fluxor:serve')).toBeInTheDocument();
  });

  it('omits the Fluxor Serve hint for non-8080 URLs', () => {
    const { container } = render(<WebPreviewApp windowId="win-1" url="http://localhost:3000/" />);
    fireEvent(getWebview(container), failLoadEvent());

    expect(screen.queryByText(/Fluxor Serve is not running/)).not.toBeInTheDocument();
  });

  it('Retry calls loadURL with the current address and clears the overlay', () => {
    const { container } = render(<WebPreviewApp windowId="win-1" url="http://localhost:8080/dashboard/" />);
    const webview = getWebview(container);
    const loadURLSpy = vi.fn();
    webview.loadURL = loadURLSpy;

    fireEvent(webview, failLoadEvent());
    expect(screen.getByText('Preview unreachable')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Retry'));

    expect(loadURLSpy).toHaveBeenCalledWith('http://localhost:8080/dashboard/');
    expect(screen.queryByText('Preview unreachable')).not.toBeInTheDocument();
  });

  it('did-finish-load clears a previously-shown overlay', () => {
    const { container } = render(<WebPreviewApp windowId="win-1" url="http://localhost:8080/dashboard/" />);
    const webview = getWebview(container);

    fireEvent(webview, failLoadEvent());
    expect(screen.getByText('Preview unreachable')).toBeInTheDocument();

    fireEvent(webview, new Event('did-finish-load'));

    expect(screen.queryByText('Preview unreachable')).not.toBeInTheDocument();
  });
});
