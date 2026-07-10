/**
 * browser-controller.ts — Main Process Module
 *
 * Responsibility:
 * - Provides native CDP (Chrome DevTools Protocol) control over the same
 *   WebContents the human sees in a web-preview window, via Electron's
 *   `webContents.debugger` API.
 * - No --remote-debugging-port is opened; control is scoped entirely to the
 *   passed webContentsId from the renderer's <webview> guest.
 * - Exposes: attach / goto / observePage / act / extractSeo / detach.
 * - Exported as a singleton `browserController` for direct import by M3's toolset.
 *
 * Boundaries:
 * - Main process only — no renderer imports, no DOM/React.
 * - Does NOT open a global remote-debugging port (that approach is M3-incompatible).
 *
 * M3 seam:
 * - Import `{ browserController }` from this module and call its methods directly.
 * - Obtain the agent-linked webContentsId via `getActiveAgentSurfaceId()` on this
 *   controller — a MAIN-side value set over IPC ('browser:set-agent-surface')
 *   when the user links a preview. The main process must NEVER import the
 *   renderer Zustand store (different process; it would read empty state).
 */
// src/main/browser/browser-controller.ts — Native CDP browser control for M2

import { webContents, BrowserWindow } from 'electron';
import type { WebContents } from 'electron';
import type { AomNode, AomSnapshot, BrowserAction, SeoReport } from '../../types/browser';

// ─── Internal session type ─────────────────────────────────────────────────────

interface BrowserSession {
  /** The live WebContents being debugged. */
  wc: WebContents;
  /**
   * Maps the sequential numeric AOM id (returned to the agent) to the CDP
   * backendDOMNodeId so `act` can resolve it for DOM.resolveNode.
   * Reset on every observePage call — ids are only valid until the next observe.
   */
  axIdMap: Map<number, number>;
}

// ─── CDP AXNode shape (what Accessibility.getFullAXTree returns) ───────────────

interface CdpAXNode {
  nodeId: string;
  ignored: boolean;
  role?: { value: string };
  name?: { value: string };
  value?: { value: string };
  childIds?: string[];
  backendDOMNodeId?: number;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

/**
 * Roles that should always be kept in the AOM snapshot as interactive elements.
 * StaticText / text / heading are handled separately (kept when name is non-empty).
 */
const INTERACTIVE_ROLES = new Set([
  'link', 'button', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio',
  'switch', 'slider', 'tab', 'menuitem', 'option', 'textarea',
]);

/** Maximum kept nodes before we truncate and add a synthetic warning node. */
const MAX_AOM_NODES = 600;

/** Timeout (ms) for page load after goto / act. */
const LOAD_TIMEOUT_MS = 10_000;

/** Post-action settle time (ms) before re-observing. */
const ACT_SETTLE_MS = 400;

/**
 * Self-invoking async expression string for SEO extraction via Runtime.evaluate.
 * Returns a plain object matching SeoReport (serializable by returnByValue: true).
 * Every field is wrapped in try/catch — partial extraction is always preferred
 * over a hard throw.
 */
const SEO_SNIPPET = `
(async () => {
  const warnings = [];
  const safe = (label, fn) => { try { return fn(); } catch(e) { warnings.push(label + ': ' + e.message); return undefined; } };

  const title = safe('title', () => document.title) ?? '';
  const url = safe('url', () => location.href) ?? '';

  const metaDescription = safe('meta-description', () => {
    const el = document.querySelector('meta[name="description"]');
    return el ? el.getAttribute('content') ?? undefined : undefined;
  });
  const canonical = safe('canonical', () => {
    const el = document.querySelector('link[rel="canonical"]');
    return el ? el.getAttribute('href') ?? undefined : undefined;
  });
  const lang = safe('lang', () => {
    const v = document.documentElement.getAttribute('lang');
    return v || undefined;
  });
  const robots = safe('robots', () => {
    const el = document.querySelector('meta[name="robots"]');
    return el ? el.getAttribute('content') ?? undefined : undefined;
  });

  const og = {};
  safe('og', () => {
    document.querySelectorAll('meta[property^="og:"]').forEach(el => {
      const prop = el.getAttribute('property').replace(/^og:/, '');
      og[prop] = el.getAttribute('content') ?? '';
    });
  });

  const twitter = {};
  safe('twitter', () => {
    document.querySelectorAll('meta[name^="twitter:"]').forEach(el => {
      const name = el.getAttribute('name').replace(/^twitter:/, '');
      twitter[name] = el.getAttribute('content') ?? '';
    });
  });

  const headings = [];
  safe('headings', () => {
    document.querySelectorAll('h1, h2, h3').forEach(el => {
      headings.push({ level: parseInt(el.tagName[1], 10), text: el.textContent.trim() });
    });
  });

  // ── Web Vitals ──────────────────────────────────────────────────────────────
  let ttfbMs, fcpMs, lcpMs, cls;

  safe('ttfb', () => {
    const nav = performance.getEntriesByType('navigation')[0];
    if (nav) ttfbMs = nav.responseStart - nav.requestStart;
  });

  safe('fcp', () => {
    const paint = performance.getEntriesByName('first-contentful-paint')[0];
    if (paint) fcpMs = paint.startTime;
  });

  // LCP + CLS via PerformanceObserver with a ~1s timeout
  await safe('lcp-cls', () => new Promise(resolve => {
    let lcpValue, clsValue = 0;
    const observers = [];

    try {
      const lcpObs = new PerformanceObserver(list => {
        const entries = list.getEntries();
        if (entries.length) lcpValue = entries[entries.length - 1].startTime;
      });
      lcpObs.observe({ type: 'largest-contentful-paint', buffered: true });
      observers.push(lcpObs);
    } catch {}

    try {
      const clsObs = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) clsValue += entry.value;
        }
      });
      clsObs.observe({ type: 'layout-shift', buffered: true });
      observers.push(clsObs);
    } catch {}

    setTimeout(() => {
      observers.forEach(o => { try { o.disconnect(); } catch {} });
      if (lcpValue !== undefined) lcpMs = lcpValue;
      cls = clsValue;
      resolve(undefined);
    }, 1000);
  }));

  return {
    url, title, metaDescription, canonical, lang, robots,
    og, twitter, headings,
    webVitals: { ttfbMs, fcpMs, lcpMs, cls },
    warnings,
  };
})()
`.trim();

// ─── BrowserController ─────────────────────────────────────────────────────────

class BrowserController {
  /** Sessions keyed by Electron webContentsId. */
  private readonly sessions = new Map<number, BrowserSession>();

  /**
   * webContentsId of the preview the user has linked to the agent, or null.
   * This is the MAIN-side source of truth M3's browser toolset reads. The
   * renderer mirrors it in the Zustand store for UI only; main must not import
   * that store (separate process).
   */
  private activeAgentSurfaceId: number | null = null;

  /**
   * Memoized hidden BrowserWindow used as the headless fallback when no preview
   * is linked. Created lazily by `ensureAgentSurface`. Cleared on 'closed'.
   */
  private headlessWindow: BrowserWindow | null = null;

  /** Set (or clear with null) the active agent surface. Called from IPC on link/unlink. */
  setActiveAgentSurface(id: number | null): void {
    this.activeAgentSurfaceId = id;
  }

  /** The active agent surface webContentsId, or null. Read by M3's toolset. */
  getActiveAgentSurfaceId(): number | null {
    return this.activeAgentSurfaceId;
  }

  // ── attach ──────────────────────────────────────────────────────────────────

  /**
   * Attach CDP debugger to the WebContents identified by `id`.
   * Idempotent — safe to call on an already-attached session.
   *
   * Enables DOM, Accessibility, Runtime, and Page CDP domains so subsequent
   * commands work without per-command domain setup.
   *
   * @throws if the webContentsId does not correspond to a live WebContents.
   */
  async attach(id: number): Promise<void> {
    const wc = webContents.fromId(id);
    if (!wc || wc.isDestroyed()) {
      throw new Error(`BrowserController.attach: no live WebContents for id ${id}`);
    }

    // Idempotent — if we already have a session, skip re-attach
    if (this.sessions.has(id)) return;

    if (!wc.debugger.isAttached()) {
      wc.debugger.attach('1.3');
    }

    // Enable required CDP domains
    await wc.debugger.sendCommand('DOM.enable');
    await wc.debugger.sendCommand('Accessibility.enable');
    await wc.debugger.sendCommand('Runtime.enable');
    await wc.debugger.sendCommand('Page.enable');

    const session: BrowserSession = { wc, axIdMap: new Map() };
    this.sessions.set(id, session);

    // Clean up when the debugger detaches (page crash, navigation, etc.)
    wc.debugger.on('detach', () => {
      this.sessions.delete(id);
      if (this.activeAgentSurfaceId === id) this.activeAgentSurfaceId = null;
    });

    // Clean up when the WebContents is destroyed
    wc.once('destroyed', () => {
      this.sessions.delete(id);
      if (this.activeAgentSurfaceId === id) this.activeAgentSurfaceId = null;
    });
  }

  // ── detach ──────────────────────────────────────────────────────────────────

  /**
   * Detach the CDP debugger from the WebContents identified by `id`.
   * Never throws on an already-detached or unknown session (idempotent).
   */
  async detach(id: number): Promise<void> {
    if (this.activeAgentSurfaceId === id) this.activeAgentSurfaceId = null;
    const session = this.sessions.get(id);
    if (!session) return;
    try {
      if (session.wc.debugger.isAttached()) {
        session.wc.debugger.detach();
      }
    } catch {
      // Already detached or WebContents destroyed — silently ignore
    }
    this.sessions.delete(id);
  }

  // ── goto ────────────────────────────────────────────────────────────────────

  /**
   * Navigate the WebContents to `url` and wait for `did-finish-load` (max 10 s).
   * Returns the resulting AOM snapshot via `observePage`.
   *
   * @throws if the scheme is not http or https (security guard).
   * @throws if the session is not attached (call `attach` first).
   */
  async goto(id: number, url: string): Promise<AomSnapshot> {
    const parsed = new URL(url); // throws on malformed URL
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`BrowserController.goto: only http/https URLs are allowed, got "${parsed.protocol}"`);
    }

    const session = this.requireSession(id);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        session.wc.removeListener('did-finish-load', onLoad);
        reject(new Error(`BrowserController.goto: timed out waiting for "${url}" to load`));
      }, LOAD_TIMEOUT_MS);

      const onLoad = () => {
        clearTimeout(timer);
        resolve();
      };

      session.wc.once('did-finish-load', onLoad);
      session.wc.loadURL(url).catch(reject);
    });

    return this.observePage(id);
  }

  // ── observePage ─────────────────────────────────────────────────────────────

  /**
   * Build a compact Accessibility Object Model snapshot from the live page.
   *
   * Strategy:
   *  1. `Accessibility.getFullAXTree` → raw CDP AXNodes.
   *  2. Build a lookup map by nodeId.
   *  3. Identify the root (node whose nodeId is not listed as any child).
   *  4. Walk the tree, pruning ignored nodes (but recursing into their children),
   *     and keeping interactive / heading / StaticText nodes with non-empty names.
   *  5. Assign sequential numeric ids (start at 1). Record axIdMap for `act`.
   *  6. Cap at MAX_AOM_NODES and append a synthetic warning if truncated.
   *
   * axIdMap is reset at the start — ids are only valid until the next observe.
   */
  async observePage(id: number): Promise<AomSnapshot> {
    const session = this.requireSession(id);
    session.axIdMap.clear();

    const { nodes } = await session.wc.debugger.sendCommand('Accessibility.getFullAXTree') as {
      nodes: CdpAXNode[];
    };

    // Build lookup map
    const nodeMap = new Map<string, CdpAXNode>();
    for (const n of nodes) nodeMap.set(n.nodeId, n);

    // Find root: the node whose nodeId is not in any child list
    const childSet = new Set<string>();
    for (const n of nodes) {
      for (const c of (n.childIds ?? [])) childSet.add(c);
    }
    const root = nodes.find(n => !childSet.has(n.nodeId)) ?? nodes[0];

    let nextId = 1;
    let truncated = false;

    const keepRoles = new Set(['heading', 'StaticText', 'text']);

    const shouldKeep = (n: CdpAXNode): boolean => {
      const role = n.role?.value ?? '';
      if (INTERACTIVE_ROLES.has(role)) return true;
      if (keepRoles.has(role)) {
        const name = n.name?.value ?? '';
        return name.trim().length > 0;
      }
      return false;
    };

    const buildTree = (nodeId: string): AomNode | null => {
      if (nextId > MAX_AOM_NODES) {
        truncated = true;
        return null;
      }

      const n = nodeMap.get(nodeId);
      if (!n) return null;

      const childIds = n.childIds ?? [];
      const childNodes: AomNode[] = [];

      const keep = !n.ignored && shouldKeep(n);

      // Always recurse into children (even ignored nodes may have kept descendants)
      for (const cid of childIds) {
        if (nextId > MAX_AOM_NODES) {
          truncated = true;
          break;
        }
        const child = buildTree(cid);
        if (child) childNodes.push(child);
      }

      if (!keep && !n.ignored) {
        // Not kept and not ignored — act as a transparent pass-through container
        // Push children directly up to the caller level by wrapping in a container
        // only if there are children; otherwise drop.
        if (childNodes.length === 0) return null;
        // Wrap with a generic group node (no id assigned — not interactive)
        return childNodes.length === 1 ? childNodes[0] : {
          id: 0, // placeholder; will be replaced if we decide to keep the group
          role: 'group',
          children: childNodes,
        };
      }

      if (n.ignored) {
        // Ignored — surface children directly (flat promotion)
        if (childNodes.length === 0) return null;
        if (childNodes.length === 1) return childNodes[0];
        return { id: 0, role: 'group', children: childNodes };
      }

      // Assign sequential id
      const aomId = nextId++;
      if (n.backendDOMNodeId !== undefined) {
        session.axIdMap.set(aomId, n.backendDOMNodeId);
      }

      const aomNode: AomNode = {
        id: aomId,
        role: n.role?.value ?? 'unknown',
      };
      if (n.name?.value) aomNode.name = n.name.value;
      if (n.value?.value) aomNode.value = n.value.value;
      if (childNodes.length > 0) aomNode.children = childNodes;

      return aomNode;
    };

    let tree: AomNode[] = [];
    if (root) {
      const rootNode = buildTree(root.nodeId);
      if (rootNode) {
        tree = rootNode.role === 'group' && rootNode.children
          ? rootNode.children
          : [rootNode];
      }
    }

    if (truncated) {
      tree.push({
        id: 0,
        role: 'note',
        name: `[AOM truncated: snapshot capped at ${MAX_AOM_NODES} nodes. Call observe again after navigating to a simpler page.]`,
      });
    }

    return {
      url: session.wc.getURL(),
      title: session.wc.getTitle(),
      tree,
      nodeCount: nextId - 1,
    };
  }

  // ── act ─────────────────────────────────────────────────────────────────────

  /**
   * Perform a DOM interaction on the element identified by `elementId` (from the
   * most recent observePage/goto call). Returns a fresh AOM snapshot after a
   * short settle period so the model can see the result of the action.
   *
   * @throws `"Unknown elementId <n>; call observe/goto again to refresh the AOM."`
   *         if the id is not in axIdMap.
   * @throws on CDP errors (e.g. stale DOM node after navigation).
   */
  async act(
    id: number,
    elementId: number,
    action: BrowserAction,
    value?: string,
  ): Promise<AomSnapshot> {
    const session = this.requireSession(id);
    const backendNodeId = session.axIdMap.get(elementId);

    if (backendNodeId === undefined) {
      throw new Error(
        `BrowserController.act: Unknown elementId ${elementId}; call observe/goto again to refresh the AOM.`,
      );
    }

    // Resolve to a Runtime objectId
    const { object } = await session.wc.debugger.sendCommand('DOM.resolveNode', {
      backendNodeId,
    }) as { object: { objectId: string } };

    const objectId = object.objectId;

    switch (action) {
      case 'click':
        await session.wc.debugger.sendCommand('Runtime.callFunctionOn', {
          objectId,
          functionDeclaration: 'function(){ this.scrollIntoView({block:"center"}); this.click(); }',
          silent: true,
        });
        break;

      case 'fill':
        await session.wc.debugger.sendCommand('Runtime.callFunctionOn', {
          objectId,
          functionDeclaration:
            'function(v){ this.focus(); this.value=v; this.dispatchEvent(new Event("input",{bubbles:true})); this.dispatchEvent(new Event("change",{bubbles:true})); }',
          arguments: [{ value: value ?? '' }],
          silent: true,
        });
        break;

      case 'select':
        await session.wc.debugger.sendCommand('Runtime.callFunctionOn', {
          objectId,
          functionDeclaration:
            'function(v){ this.focus(); this.value=v; this.dispatchEvent(new Event("input",{bubbles:true})); this.dispatchEvent(new Event("change",{bubbles:true})); }',
          arguments: [{ value: value ?? '' }],
          silent: true,
        });
        break;

      case 'press': {
        const key = value ?? '';
        await session.wc.debugger.sendCommand('Runtime.callFunctionOn', {
          objectId,
          functionDeclaration:
            'function(k){ this.dispatchEvent(new KeyboardEvent("keydown",{key:k,bubbles:true,cancelable:true})); this.dispatchEvent(new KeyboardEvent("keypress",{key:k,bubbles:true,cancelable:true})); this.dispatchEvent(new KeyboardEvent("keyup",{key:k,bubbles:true,cancelable:true})); }',
          arguments: [{ value: key }],
          silent: true,
        });
        break;
      }

      default: {
        const _exhaustive: never = action;
        throw new Error(`BrowserController.act: Unknown action "${_exhaustive as string}"`);
      }
    }

    // Allow a short settle — race against did-finish-load or fall back to timeout
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, ACT_SETTLE_MS);
      const onLoad = () => { clearTimeout(timer); resolve(); };
      session.wc.once('did-finish-load', onLoad);
      // If timeout fires first, we're fine — resolve and continue
    });

    return this.observePage(id);
  }

  // ── extractSeo ──────────────────────────────────────────────────────────────

  /**
   * Extract SEO metadata and Core Web Vitals from the current page (or navigate
   * to `url` first if provided). Returns a structured `SeoReport`.
   */
  async extractSeo(id: number, url?: string): Promise<SeoReport> {
    if (url) {
      await this.goto(id, url);
    }

    const session = this.requireSession(id);

    const { result } = await session.wc.debugger.sendCommand('Runtime.evaluate', {
      expression: SEO_SNIPPET,
      returnByValue: true,
      awaitPromise: true,
    }) as { result: { value: SeoReport } };

    return result.value;
  }

  // ── ensureAgentSurface ──────────────────────────────────────────────────────

  /**
   * Return a ready webContentsId the agent can drive — either the preview the
   * human linked, or a memoized hidden BrowserWindow (created lazily).
   *
   * Priority:
   *  1. If `getActiveAgentSurfaceId()` is non-null AND that webContents is still
   *     alive, `attach` it (idempotent) and return its id.
   *  2. Else reuse the memoized headless window if it is still alive.
   *  3. Else create a new hidden `BrowserWindow`, store it, attach CDP, and
   *     promote it to `activeAgentSurfaceId` so subsequent calls hit case 1.
   *
   * This allows agents to browse even when no preview is linked; when a preview
   * IS linked that surface always wins.
   */
  async ensureAgentSurface(): Promise<number> {
    // Case 1 — linked preview is alive
    const activeId = this.getActiveAgentSurfaceId();
    if (activeId !== null) {
      const wc = webContents.fromId(activeId);
      if (wc && !wc.isDestroyed()) {
        await this.attach(activeId);
        return activeId;
      }
      // Linked surface is gone — clear the stale reference
      this.activeAgentSurfaceId = null;
    }

    // Case 2 — reuse memoized headless window
    if (this.headlessWindow && !this.headlessWindow.isDestroyed()) {
      const wcId = this.headlessWindow.webContents.id;
      await this.attach(wcId);
      return wcId;
    }

    // Case 3 — create a new hidden window
    // sandbox: true — renderer process is fully sandboxed (CDP debugger operates
    //   on the main side and is unaffected by sandbox mode).
    // partition: 'persist:fluxor-agent' — isolated storage so agent browsing never
    //   shares cookies/cache with the developer's own preview sessions.
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: 'persist:fluxor-agent',
      },
    });
    this.headlessWindow = win;
    // Deny any popup the guest page tries to open
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.once('closed', () => {
      this.headlessWindow = null;
    });

    const wcId = win.webContents.id;
    await this.attach(wcId);
    this.setActiveAgentSurface(wcId);
    return wcId;
  }

  // ── disposeAll ──────────────────────────────────────────────────────────────

  /**
   * Tear down all active CDP sessions and destroy the headless window (if any).
   * Called at app quit to prevent orphaned Chrome renderer processes.
   * Never throws — each cleanup step is guarded independently.
   */
  disposeAll(): void {
    // Detach every session — iterate a copy so deletions inside detach() are safe
    const ids = Array.from(this.sessions.keys());
    for (const id of ids) {
      try {
        const session = this.sessions.get(id);
        if (session && session.wc.debugger.isAttached()) {
          session.wc.debugger.detach();
        }
      } catch { /* already detached or WebContents destroyed — ignore */ }
      this.sessions.delete(id);
    }

    // Destroy the headless window if still alive
    if (this.headlessWindow && !this.headlessWindow.isDestroyed()) {
      try {
        this.headlessWindow.destroy();
      } catch { /* ignore */ }
    }
    this.headlessWindow = null;
    this.activeAgentSurfaceId = null;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private requireSession(id: number): BrowserSession {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(
        `BrowserController: no active session for webContentsId ${id}. Call attach() first.`,
      );
    }
    return session;
  }
}

// ─── Singleton export ──────────────────────────────────────────────────────────
//
// M3's browser toolset imports this directly:
//
//   import { browserController } from '../browser/browser-controller';
//
// The controller is stateless except for session tracking (the Map), so a single
// module-level instance is safe and avoids creating duplicate debugger sessions.

export const browserController = new BrowserController();
