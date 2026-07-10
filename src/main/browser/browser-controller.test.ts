/**
 * browser-controller.test.ts — Unit tests for M2/M4 BrowserController
 *
 * Strategy:
 * - electron's `webContents.fromId` is mocked at the top level. Each suite
 *   updates `currentWc` (a module-scoped ref) in beforeEach so the factory
 *   closure always returns the latest fake wc — this is necessary because
 *   vi.mock() factories are hoisted and cannot close over beforeEach locals.
 * - BrowserWindow is also mocked via a module-level ref `currentBrowserWindowCtor`
 *   so ensureAgentSurface tests can verify the created window's webPreferences
 *   without instantiating a real Electron window.
 * - Tests verify:
 *   1. observePage prunes the AXTree correctly (ignored, interactive, text nodes).
 *   2. Sequential numeric ids are assigned to kept nodes.
 *   3. axIdMap maps aomId → backendDOMNodeId correctly (verified via act).
 *   4. act resolves the backendNodeId via DOM.resolveNode and rejects unknown ids.
 *   5. extractSeo returns the parsed Runtime.evaluate value.
 *   6. (M4) setActiveAgentSurface / getActiveAgentSurfaceId round-trip.
 *   7. (M4) 'detach' and 'destroyed' events clear activeAgentSurfaceId.
 *   8. (M4) ensureAgentSurface priority and headless-window security settings.
 *   9. (M4) disposeAll tears down sessions and the headless window.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AomNode } from '../../types/browser';

// ─── Module-level refs (updated in beforeEach so hoisted vi.mock closures work) ─

let currentWc: ReturnType<typeof makeWc> | null = null;

/**
 * Tracks the options passed to `new BrowserWindow(...)` in the most recent call,
 * and supplies a fake window instance for ensureAgentSurface tests.
 */
let lastBrowserWindowOpts: Record<string, unknown> | null = null;
let fakeBrowserWindowInstance: ReturnType<typeof makeFakeBrowserWindow> | null = null;

// ─── Electron mock (hoisted) ──────────────────────────────────────────────────

vi.mock('electron', () => ({
  webContents: {
    fromId: vi.fn(() => currentWc),
  },
  ipcMain: { handle: vi.fn() },
  // BrowserWindow mock — a plain vi.fn() stub. Tests that exercise
  // ensureAgentSurface call mockImplementation in beforeEach so they can
  // control the returned instance.  Using vi.fn() without an arrow-return
  // lets `new BrowserWindow(...)` in the SUT work correctly (the ctor returns
  // `this` when the implementation does not return an object; we override that
  // with mockImplementation in the relevant suites).
  BrowserWindow: vi.fn(),
}));

// ─── Fake WebContents factory ─────────────────────────────────────────────────

function makeDebugger(sendImpl: (method: string, params?: unknown) => Promise<unknown>) {
  return {
    isAttached: vi.fn(() => false),
    attach: vi.fn(),
    detach: vi.fn(),
    sendCommand: vi.fn((method: string, params?: unknown) => sendImpl(method, params)),
    on: vi.fn(),
  };
}

// ─── Fake BrowserWindow factory ───────────────────────────────────────────────
// Used by ensureAgentSurface and disposeAll tests — no real window is created.

function makeFakeBrowserWindow(wcId: number = 200) {
  const fakeWc = makeWc(async () => ({}));
  // Override id so BrowserController can look it up
  (fakeWc as unknown as Record<string, unknown>).id = wcId;
  const win = {
    webContents: fakeWc,
    isDestroyed: vi.fn(() => false),
    destroy: vi.fn(),
    setWindowOpenHandler: vi.fn(), // called on win.webContents in production; we also track it on win for the test
    once: vi.fn((_event: string, handler: () => void) => {
      // do NOT fire 'closed' automatically — tests control that manually
      void handler;
    }),
  };
  // Also expose setWindowOpenHandler on webContents so the SUT call succeeds
  (fakeWc as unknown as Record<string, unknown>).setWindowOpenHandler = vi.fn();
  return win;
}

function makeWc(sendImpl: (method: string, params?: unknown) => Promise<unknown>) {
  const dbg = makeDebugger(sendImpl);
  return {
    isDestroyed: vi.fn(() => false),
    debugger: dbg,
    getURL: vi.fn(() => 'http://localhost:3000/'),
    getTitle: vi.fn(() => 'Test Page'),
    loadURL: vi.fn(async () => {}),
    // Immediately fire did-finish-load listeners to unblock goto()
    once: vi.fn((event: string, handler: () => void) => {
      if (event === 'did-finish-load') handler();
    }),
    removeListener: vi.fn(),
  };
}

// ─── Helper: canned AXTree ────────────────────────────────────────────────────
//
// Shape (see test comments for expected outcomes):
//   root (WebArea, not ignored, not interactive → transparent pass-through)
//     ├─ ignored-wrapper (ignored=true → resurface children)
//     │   └─ link-node (link ✓ keep)
//     ├─ button-node (button ✓ keep)
//     ├─ text-node (StaticText + name ✓ keep)
//     ├─ empty-text (StaticText, name="" → prune)
//     └─ generic-container (generic, no name → prune, but child kept)
//         └─ textbox-node (textbox ✓ keep)
//
// Expected kept nodes: link(id=1), button(id=2), text(id=3), textbox(id=4)

function makeCannedAXTree() {
  return {
    nodes: [
      {
        nodeId: 'n0', ignored: false,
        role: { value: 'WebArea' }, name: { value: 'Test Page' },
        childIds: ['n1', 'n2', 'n3', 'n4', 'n5'], backendDOMNodeId: 1,
      },
      {
        nodeId: 'n1', ignored: true,
        childIds: ['n6'], backendDOMNodeId: 2,
      },
      {
        nodeId: 'n2', ignored: false,
        role: { value: 'button' }, name: { value: 'Submit' },
        childIds: [], backendDOMNodeId: 10,
      },
      {
        nodeId: 'n3', ignored: false,
        role: { value: 'StaticText' }, name: { value: 'Hello world' },
        childIds: [], backendDOMNodeId: 11,
      },
      {
        // empty StaticText — should be pruned
        nodeId: 'n4', ignored: false,
        role: { value: 'StaticText' }, name: { value: '' },
        childIds: [], backendDOMNodeId: 12,
      },
      {
        // generic container with no name — pruned, but child textbox should surface
        nodeId: 'n5', ignored: false,
        role: { value: 'generic' },
        childIds: ['n7'], backendDOMNodeId: 13,
      },
      {
        // child of ignored n1 — must surface via flat promotion
        nodeId: 'n6', ignored: false,
        role: { value: 'link' }, name: { value: 'Go home' },
        childIds: [], backendDOMNodeId: 20,
      },
      {
        // child of generic container n5
        nodeId: 'n7', ignored: false,
        role: { value: 'textbox' }, name: { value: 'Search' },
        childIds: [], backendDOMNodeId: 30,
      },
    ],
  };
}

// Flatten an AOM tree into a list of all nodes
function flatten(nodes: AomNode[]): AomNode[] {
  return nodes.flatMap(n => [n, ...flatten(n.children ?? [])]);
}

// ─── BrowserController.observePage ────────────────────────────────────────────

describe('BrowserController.observePage', () => {
  let browserController: Awaited<typeof import('./browser-controller')>['browserController'];

  beforeEach(async () => {
    // Update the module-level ref BEFORE any import so the electron mock factory
    // returns this wc for the upcoming controller.attach() call.
    currentWc = makeWc(async (method: string) => {
      if (method === 'Accessibility.getFullAXTree') return makeCannedAXTree();
      return {};
    });

    const mod = await import('./browser-controller');
    browserController = mod.browserController;
    await browserController.attach(42);
  });

  afterEach(async () => {
    await browserController.detach(42);
    vi.clearAllMocks();
    currentWc = null;
  });

  it('assigns sequential numeric ids starting at 1', async () => {
    const snapshot = await browserController.observePage(42);
    const kept = flatten(snapshot.tree).filter(n => n.id > 0);
    const ids = kept.map(n => n.id).sort((a, b) => a - b);
    for (let i = 0; i < ids.length; i++) {
      expect(ids[i]).toBe(i + 1);
    }
  });

  it('keeps interactive and non-empty StaticText nodes', async () => {
    const snapshot = await browserController.observePage(42);
    const kept = flatten(snapshot.tree).filter(n => n.id > 0);
    const roles = kept.map(n => n.role);

    expect(roles).toContain('link');
    expect(roles).toContain('button');
    expect(roles).toContain('StaticText');
    expect(roles).toContain('textbox');

    // Non-interactive, non-text roots are pruned
    expect(roles).not.toContain('WebArea');
    // Empty generic containers are pruned
    expect(roles.filter(r => r === 'generic')).toHaveLength(0);
  });

  it('prunes ignored nodes but resurfaces their children', async () => {
    const snapshot = await browserController.observePage(42);
    const kept = flatten(snapshot.tree).filter(n => n.id > 0);

    const linkNode = kept.find(n => n.role === 'link');
    expect(linkNode).toBeDefined();
    expect(linkNode?.name).toBe('Go home');
  });

  it('nodeCount matches kept nodes', async () => {
    const snapshot = await browserController.observePage(42);
    const kept = flatten(snapshot.tree).filter(n => n.id > 0);
    expect(snapshot.nodeCount).toBe(kept.length);
    expect(snapshot.nodeCount).toBe(4); // link, button, StaticText, textbox
  });

  it('returns current url and title from the wc', async () => {
    const snapshot = await browserController.observePage(42);
    expect(snapshot.url).toBe('http://localhost:3000/');
    expect(snapshot.title).toBe('Test Page');
  });
});

// ─── BrowserController.act ────────────────────────────────────────────────────

describe('BrowserController.act', () => {
  let browserController: Awaited<typeof import('./browser-controller')>['browserController'];
  let callFnOnCalls: Array<{ objectId: string; functionDeclaration: string }>;

  beforeEach(async () => {
    callFnOnCalls = [];

    currentWc = makeWc(async (method: string, params?: unknown) => {
      if (method === 'Accessibility.getFullAXTree') return makeCannedAXTree();
      if (method === 'DOM.resolveNode') return { object: { objectId: 'obj-99' } };
      if (method === 'Runtime.callFunctionOn') {
        const p = params as { objectId: string; functionDeclaration: string };
        callFnOnCalls.push({ objectId: p.objectId, functionDeclaration: p.functionDeclaration });
        return { result: {} };
      }
      return {};
    });

    const mod = await import('./browser-controller');
    browserController = mod.browserController;
    await browserController.attach(99);
  });

  afterEach(async () => {
    await browserController.detach(99);
    vi.clearAllMocks();
    currentWc = null;
  });

  it('resolves DOM.resolveNode with the correct backendDOMNodeId for a known element', async () => {
    const snapshot = await browserController.observePage(99);
    const btnNode = flatten(snapshot.tree).filter(n => n.id > 0).find(n => n.role === 'button');
    expect(btnNode).toBeDefined();

    await browserController.act(99, btnNode!.id, 'click');

    const allCalls: unknown[][] = (currentWc!.debugger.sendCommand as ReturnType<typeof vi.fn>).mock.calls;
    const resolveCall = allCalls.find((args) => args[0] === 'DOM.resolveNode');
    expect(resolveCall).toBeDefined();
    // button's backendDOMNodeId = 10 in the canned tree
    expect(resolveCall![1]).toMatchObject({ backendNodeId: 10 });

    // Runtime.callFunctionOn must have been called with the resolved objectId
    expect(callFnOnCalls.length).toBeGreaterThan(0);
    expect(callFnOnCalls[0].objectId).toBe('obj-99');
    expect(callFnOnCalls[0].functionDeclaration).toContain('scrollIntoView');
    expect(callFnOnCalls[0].functionDeclaration).toContain('click');
  });

  it('rejects an unknown elementId with the prescribed error message', async () => {
    await browserController.observePage(99);

    await expect(
      browserController.act(99, 9999, 'click'),
    ).rejects.toThrow(/Unknown elementId 9999.*observe\/goto/i);
  });

  it('uses the fill function declaration with value for fill action', async () => {
    const snapshot = await browserController.observePage(99);
    const inputNode = flatten(snapshot.tree)
      .filter(n => n.id > 0)
      .find(n => n.role === 'textbox');
    expect(inputNode).toBeDefined();

    await browserController.act(99, inputNode!.id, 'fill', 'hello');

    const fillCall = callFnOnCalls.find(c => c.functionDeclaration.includes('this.value'));
    expect(fillCall).toBeDefined();
    expect(fillCall?.functionDeclaration).toContain('dispatchEvent');
  });
});

// ─── BrowserController.extractSeo ────────────────────────────────────────────

describe('BrowserController.extractSeo', () => {
  let browserController: Awaited<typeof import('./browser-controller')>['browserController'];

  const cannedSeoReport = {
    url: 'http://localhost:3000/',
    title: 'My App',
    metaDescription: 'A great app',
    canonical: 'http://localhost:3000/',
    lang: 'en',
    robots: 'index,follow',
    og: { title: 'My App', description: 'A great app', image: 'http://localhost:3000/og.png' },
    twitter: { card: 'summary_large_image', title: 'My App' },
    headings: [{ level: 1, text: 'Welcome' }, { level: 2, text: 'Features' }],
    webVitals: { ttfbMs: 120, fcpMs: 350, lcpMs: 800, cls: 0.05 },
    warnings: [],
  };

  beforeEach(async () => {
    currentWc = makeWc(async (method: string) => {
      if (method === 'Runtime.evaluate') return { result: { value: cannedSeoReport } };
      return {};
    });

    const mod = await import('./browser-controller');
    browserController = mod.browserController;
    await browserController.attach(77);
  });

  afterEach(async () => {
    await browserController.detach(77);
    vi.clearAllMocks();
    currentWc = null;
  });

  it('returns the parsed SeoReport from Runtime.evaluate', async () => {
    const report = await browserController.extractSeo(77);

    expect(report.title).toBe('My App');
    expect(report.metaDescription).toBe('A great app');
    expect(report.lang).toBe('en');
    expect(report.og.title).toBe('My App');
    expect(report.twitter.card).toBe('summary_large_image');
    expect(report.headings).toHaveLength(2);
    expect(report.headings[0]).toEqual({ level: 1, text: 'Welcome' });
    expect(report.webVitals.ttfbMs).toBe(120);
    expect(report.webVitals.lcpMs).toBe(800);
    expect(report.webVitals.cls).toBe(0.05);
    expect(report.warnings).toHaveLength(0);
  });
});

// ─── BrowserController.attach / detach idempotency ───────────────────────────

describe('BrowserController.attach / detach', () => {
  let browserController: Awaited<typeof import('./browser-controller')>['browserController'];

  beforeEach(async () => {
    currentWc = makeWc(async () => ({}));
    const mod = await import('./browser-controller');
    browserController = mod.browserController;
  });

  afterEach(async () => {
    vi.clearAllMocks();
    currentWc = null;
  });

  it('attaches the debugger only once when called twice', async () => {
    await browserController.attach(1);
    await browserController.attach(1); // idempotent

    expect(currentWc!.debugger.attach).toHaveBeenCalledTimes(1);
    await browserController.detach(1);
  });

  it('detach is safe on an unknown session (does not throw)', async () => {
    await expect(browserController.detach(9999)).resolves.not.toThrow();
  });

  it('throws when the webContentsId does not correspond to a live WebContents', async () => {
    // Point the electron mock at a null return
    currentWc = null;
    await expect(browserController.attach(123)).rejects.toThrow(/no live WebContents/i);
  });
});

// ─── M4: setActiveAgentSurface / getActiveAgentSurfaceId ─────────────────────

describe('BrowserController.setActiveAgentSurface / getActiveAgentSurfaceId', () => {
  let browserController: Awaited<typeof import('./browser-controller')>['browserController'];

  beforeEach(async () => {
    currentWc = makeWc(async () => ({}));
    const mod = await import('./browser-controller');
    browserController = mod.browserController;
    // Start from a clean slate
    browserController.setActiveAgentSurface(null);
  });

  afterEach(async () => {
    vi.clearAllMocks();
    currentWc = null;
  });

  it('round-trips: set → get returns the same id', () => {
    browserController.setActiveAgentSurface(42);
    expect(browserController.getActiveAgentSurfaceId()).toBe(42);
  });

  it('clears to null', () => {
    browserController.setActiveAgentSurface(42);
    browserController.setActiveAgentSurface(null);
    expect(browserController.getActiveAgentSurfaceId()).toBeNull();
  });

  it('debugger "detach" event clears activeAgentSurfaceId when it matches the session', async () => {
    await browserController.attach(55);
    browserController.setActiveAgentSurface(55);
    expect(browserController.getActiveAgentSurfaceId()).toBe(55);

    // Find the 'detach' listener registered on wc.debugger.on and invoke it
    const onCalls: Array<[string, () => void]> = (
      currentWc!.debugger.on as ReturnType<typeof vi.fn>
    ).mock.calls as Array<[string, () => void]>;
    const detachEntry = onCalls.find(([event]) => event === 'detach');
    expect(detachEntry).toBeDefined();
    detachEntry![1](); // fire the listener

    expect(browserController.getActiveAgentSurfaceId()).toBeNull();
    // Session should also have been cleaned up
    await expect(browserController.detach(55)).resolves.not.toThrow();
  });

  it('"destroyed" event clears activeAgentSurfaceId when it matches the session', async () => {
    await browserController.attach(66);
    browserController.setActiveAgentSurface(66);
    expect(browserController.getActiveAgentSurfaceId()).toBe(66);

    // Find the 'destroyed' listener registered via wc.once and invoke it
    const onceCalls: Array<[string, () => void]> = (
      currentWc!.once as ReturnType<typeof vi.fn>
    ).mock.calls as Array<[string, () => void]>;
    const destroyedEntry = onceCalls.find(([event]) => event === 'destroyed');
    expect(destroyedEntry).toBeDefined();
    destroyedEntry![1](); // fire the listener

    expect(browserController.getActiveAgentSurfaceId()).toBeNull();
  });
});

// ─── M4: ensureAgentSurface ───────────────────────────────────────────────────

describe('BrowserController.ensureAgentSurface', () => {
  let browserController: Awaited<typeof import('./browser-controller')>['browserController'];
  let MockBW: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    currentWc = makeWc(async () => ({}));
    fakeBrowserWindowInstance = makeFakeBrowserWindow(200);
    lastBrowserWindowOpts = null;

    // Wire up the BrowserWindow mock so `new BrowserWindow(opts)` returns the
    // fake instance and captures opts.  Must be a regular `function` (not arrow)
    // so that Vitest's new-able mock mechanism works correctly.
    const { BrowserWindow } = await import('electron') as unknown as { BrowserWindow: ReturnType<typeof vi.fn> };
    MockBW = BrowserWindow;
    MockBW.mockImplementation(function(opts: Record<string, unknown>) {
      lastBrowserWindowOpts = opts;
      return fakeBrowserWindowInstance;
    });

    const mod = await import('./browser-controller');
    browserController = mod.browserController;
    // Ensure headlessWindow and activeAgentSurface are clear
    browserController.disposeAll();
    browserController.setActiveAgentSurface(null);
  });

  afterEach(async () => {
    browserController.disposeAll();
    vi.clearAllMocks();
    currentWc = null;
    fakeBrowserWindowInstance = null;
    lastBrowserWindowOpts = null;
  });

  it('(priority 1) returns the live linked surface when set', async () => {
    // Prime a session for wcId=300 — currentWc is returned by fromId for any id.
    await browserController.attach(300);
    browserController.setActiveAgentSurface(300);

    const wcId = await browserController.ensureAgentSurface();
    expect(wcId).toBe(300);

    await browserController.detach(300);
  });

  it('(priority 3) creates a hidden BrowserWindow when no surface is linked', async () => {
    // Route fromId calls to the fake window's webContents so attach() succeeds.
    currentWc = fakeBrowserWindowInstance!.webContents as ReturnType<typeof makeWc>;

    const wcId = await browserController.ensureAgentSurface();
    expect(wcId).toBe(200);
    expect(MockBW).toHaveBeenCalledOnce();
  });

  it('new headless window has sandbox: true', async () => {
    currentWc = fakeBrowserWindowInstance!.webContents as ReturnType<typeof makeWc>;
    await browserController.ensureAgentSurface();

    expect(lastBrowserWindowOpts).not.toBeNull();
    const wp = (lastBrowserWindowOpts as Record<string, unknown>).webPreferences as Record<string, unknown>;
    expect(wp.sandbox).toBe(true);
  });

  it('new headless window has partition: persist:fluxor-agent', async () => {
    currentWc = fakeBrowserWindowInstance!.webContents as ReturnType<typeof makeWc>;
    await browserController.ensureAgentSurface();

    const wp = (lastBrowserWindowOpts as Record<string, unknown>).webPreferences as Record<string, unknown>;
    expect(wp.partition).toBe('persist:fluxor-agent');
  });

  it('new headless window calls setWindowOpenHandler({ action: "deny" }) on its webContents', async () => {
    currentWc = fakeBrowserWindowInstance!.webContents as ReturnType<typeof makeWc>;
    await browserController.ensureAgentSurface();

    const setWOH = (
      fakeBrowserWindowInstance!.webContents as unknown as Record<string, ReturnType<typeof vi.fn>>
    ).setWindowOpenHandler;
    expect(setWOH).toHaveBeenCalledOnce();
    expect(setWOH.mock.calls[0][0]()).toEqual({ action: 'deny' });
  });

  it('(priority 2) reuses the memoized headless window on second call', async () => {
    currentWc = fakeBrowserWindowInstance!.webContents as ReturnType<typeof makeWc>;

    await browserController.ensureAgentSurface();
    const ctorCallsAfterFirst = MockBW.mock.calls.length;

    await browserController.ensureAgentSurface();
    // The BrowserWindow constructor must NOT have been called a second time
    expect(MockBW.mock.calls.length).toBe(ctorCallsAfterFirst);
  });
});

// ─── M4: disposeAll ───────────────────────────────────────────────────────────

describe('BrowserController.disposeAll', () => {
  let browserController: Awaited<typeof import('./browser-controller')>['browserController'];

  beforeEach(async () => {
    currentWc = makeWc(async () => ({}));
    fakeBrowserWindowInstance = makeFakeBrowserWindow(201);
    lastBrowserWindowOpts = null;

    const { BrowserWindow } = await import('electron') as unknown as { BrowserWindow: ReturnType<typeof vi.fn> };
    BrowserWindow.mockImplementation(function(opts: Record<string, unknown>) {
      lastBrowserWindowOpts = opts;
      return fakeBrowserWindowInstance;
    });

    const mod = await import('./browser-controller');
    browserController = mod.browserController;
    browserController.disposeAll();
    browserController.setActiveAgentSurface(null);
  });

  afterEach(async () => {
    vi.clearAllMocks();
    currentWc = null;
    fakeBrowserWindowInstance = null;
    lastBrowserWindowOpts = null;
  });

  it('detaches all active sessions', async () => {
    // Attach two sessions
    await browserController.attach(10);
    await browserController.attach(11);
    // Make the second wc reachable via the same mock (both sessions use currentWc)
    // — the key thing is that debugger.detach() is called for each attached session.
    // We force isAttached = true so the SUT actually calls detach().
    currentWc!.debugger.isAttached.mockReturnValue(true);

    browserController.disposeAll();

    // debugger.detach should have been called for each of the two sessions
    expect(currentWc!.debugger.detach).toHaveBeenCalledTimes(2);
  });

  it('destroys the headless window if alive', async () => {
    // Simulate a live headless window by calling ensureAgentSurface
    currentWc = fakeBrowserWindowInstance!.webContents as ReturnType<typeof makeWc>;
    await browserController.ensureAgentSurface();

    // Now dispose
    browserController.disposeAll();

    expect(fakeBrowserWindowInstance!.destroy).toHaveBeenCalledOnce();
  });

  it('does not throw when called with no sessions and no headless window', () => {
    expect(() => browserController.disposeAll()).not.toThrow();
  });

  it('clears activeAgentSurfaceId to null', async () => {
    browserController.setActiveAgentSurface(42);
    browserController.disposeAll();
    expect(browserController.getActiveAgentSurfaceId()).toBeNull();
  });
});
