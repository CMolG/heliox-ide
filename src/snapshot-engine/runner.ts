/**
 * Snapshot Runner
 *
 * Responsibility: execute flow steps in Playwright and capture deterministic
 * artifacts used by the diff engine.
 *
 * Design notes:
 *  - One Browser instance per runner lifecycle (init/close)
 *  - One isolated BrowserContext per flow run
 *  - One snapshot captured after each step (including no-op screenshot steps)
 */
import type { Browser, Page } from 'playwright';
import { Flow, FlowStep, SnapshotArtifact, errMsg } from '@/types';
import { collectMetrics } from './metrics-collector';
import { createHash, randomUUID } from 'crypto';

const STEP_TIMEOUT_MS = 15_000;
const NAVIGATION_TIMEOUT_MS = 30_000;

/**
 * Executes E2E flows in a headless browser and captures snapshot artifacts
 * (screenshots + performance metrics + DOM hash) for each step.
 */
export class SnapshotRunner {
  private browser: Browser | null = null;

  async init(): Promise<void> {
    // Dynamic import — deliberate, not a stylistic choice. Playwright's browser
    // registry reads PLAYWRIGHT_BROWSERS_PATH once, the moment 'playwright' is
    // first loaded into this process, and caches the result at module scope.
    // Loading it lazily here — only when a snapshot run actually starts —
    // guarantees ensureSnapshotBrowsers() (called just before this, in
    // agent-manager.ts#initialize) has already set that env var for packaged
    // builds. A static top-level import would load 'playwright' (and freeze
    // its registry lookup) at app boot instead, before the env var is ever
    // set. See src/main/snapshot-browser-installer.ts for the full contract.
    const { chromium } = await import('playwright');
    this.browser = await chromium.launch({ headless: true });
  }

  async runFlow(flow: Flow): Promise<SnapshotArtifact[]> {
    if (!this.browser) throw new Error('SnapshotRunner not initialized. Call init() first.');

    // Per-flow isolation avoids state leakage (cookies/storage/history) across
    // scenarios and makes baseline comparisons more stable.
    const context = await this.browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(STEP_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);

    const snapshots: SnapshotArtifact[] = [];

    try {
      for (const step of flow.steps) {
        try {
          await this.executeStep(page, step, flow.baseUrl);
        } catch (err) {
          throw new Error(
            `Flow "${flow.name}" failed at step "${step.name}" (${step.action} → ${step.target ?? 'n/a'}): ${errMsg(err)}`
          );
        }
        const snapshot = await this.captureSnapshot(page, step, flow.id);
        snapshots.push(snapshot);
      }
    } finally {
      await context.close();
    }

    return snapshots;
  }

  private async executeStep(page: Page, step: FlowStep, baseUrl: string): Promise<void> {
    // Keep this switch exhaustive: unsupported actions should fail fast so the
    // caller receives a precise "step + action" error message.
    switch (step.action) {
      case 'navigate':
        await page.goto(`${baseUrl}${step.target ?? ''}`, { waitUntil: 'domcontentloaded' });
        break;
      case 'click':
        await page.click(step.target!);
        break;
      case 'type':
        await page.fill(step.target!, step.value!);
        break;
      case 'wait':
        await page.waitForSelector(step.target!, { state: 'visible' });
        break;
      case 'screenshot':
        // screenshot is captured after every step by the runner
        break;
      case 'scroll':
        if (step.target) {
          await page.locator(step.target).scrollIntoViewIfNeeded();
        } else {
          await page.evaluate(() => window.scrollBy(0, window.innerHeight));
        }
        break;
      default:
        throw new Error(`Unknown step action: ${(step as any).action}`);
    }
  }

  private async captureSnapshot(
    page: Page,
    step: FlowStep,
    flowId: string,
  ): Promise<SnapshotArtifact> {
    // Capture in parallel to minimize timing skew between screenshot, metrics,
    // and DOM hash while keeping total run cost lower.
    const [screenshotBuf, metrics, domContent] = await Promise.all([
      page.screenshot({ fullPage: false, type: 'png' }),
      collectMetrics(page),
      page.content(),
    ]);

    return {
      id: randomUUID(),
      stepId: step.id,
      flowId,
      timestamp: Date.now(),
      screenshotBase64: screenshotBuf.toString('base64'),
      metrics,
      url: page.url(),
      domHash: createHash('sha256').update(domContent).digest('hex'),
    };
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
  }
}
