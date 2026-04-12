/**
 * metrics-collector.ts — Snapshot engine
 *
 * Architecture note:
 * This file follows the explanatory style used across the codebase:
 * explicit intent, clear boundaries, and behavior-preserving structure.
 */
// src/snapshot-engine/metrics-collector.ts
import { Page } from 'playwright';
import { PerformanceMetrics } from '@/types';

/**
 * Collects Web Vitals and runtime metrics from a Playwright page
 * using Performance API and CDP for heap info.
 */
export async function collectMetrics(page: Page): Promise<PerformanceMetrics> {
  await page.waitForLoadState('networkidle');

  const metrics = await page.evaluate((): Promise<Omit<PerformanceMetrics, 'jsHeapMB'>> => {
    return new Promise(resolve => {
      const result: Partial<PerformanceMetrics> = {
        ttfb: 0, lcp: 0, cls: 0, inp: 0, tbt: 0,
        requestCount: performance.getEntriesByType('resource').length,
        transferKB: Math.round(
          performance.getEntriesByType('resource')
            .reduce((sum, r) => sum + ((r as PerformanceResourceTiming).transferSize || 0), 0) / 1024
        ),
        renderBlockingCount: performance.getEntriesByType('resource')
          .filter(r => (r as any).renderBlockingStatus === 'blocking').length,
      };

      // TTFB
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      result.ttfb = Math.round(nav?.responseStart - nav?.requestStart) || 0;

      // Track observers for cleanup
      const observers: PerformanceObserver[] = [];

      // Cumulative Layout Shift
      let clsValue = 0;
      const clsObserver = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (!(entry as any).hadRecentInput) clsValue += (entry as any).value;
        }
      });
      clsObserver.observe({ type: 'layout-shift', buffered: true });
      observers.push(clsObserver);

      // Largest Contentful Paint
      const lcpObserver = new PerformanceObserver(list => {
        const entries = list.getEntries();
        result.lcp = Math.round(entries[entries.length - 1]?.startTime || 0);
      });
      lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
      observers.push(lcpObserver);

      // Interaction to Next Paint — collect from event-timing entries
      let maxInp = 0;
      try {
        const inpObserver = new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            const duration = (entry as any).duration ?? 0;
            if (duration > maxInp) maxInp = duration;
          }
        });
        inpObserver.observe({ type: 'event', buffered: true });
        observers.push(inpObserver);
      } catch {
        // event type not supported in this browser context
      }

      // Total Blocking Time — sum of long-task durations beyond 50ms
      let tbtTotal = 0;
      try {
        const tbtObserver = new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            const blocking = entry.duration - 50;
            if (blocking > 0) tbtTotal += blocking;
          }
        });
        tbtObserver.observe({ type: 'longtask', buffered: true });
        observers.push(tbtObserver);
      } catch {
        // longtask type not supported in this browser context
      }

      setTimeout(() => {
        result.cls = Math.round(clsValue * 1000) / 1000;
        result.inp = Math.round(maxInp);
        result.tbt = Math.round(tbtTotal);

        // Disconnect all observers to prevent memory leaks
        for (const obs of observers) {
          obs.disconnect();
        }

        resolve(result as Omit<PerformanceMetrics, 'jsHeapMB'>);
      }, 500);
    });
  });

  // JS Heap via CDP (Chromium/Electron only)
  const cdpSession = await page.context().newCDPSession(page);
  const heapInfo = await cdpSession.send('Runtime.getHeapUsage');
  const jsHeapMB = Math.round(heapInfo.usedSize / 1024 / 1024);
  await cdpSession.detach();

  return { ...metrics, jsHeapMB };
}
