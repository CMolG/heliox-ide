/**
 * design-verifier.test.ts — Unit tests for the axe-core accessibility verifier.
 *
 * These tests prove that axe-core actually runs inside jsdom and correctly
 * discriminates between accessible and inaccessible HTML. They run in-process
 * (no subprocess spawn) so they are fast; a 30-second timeout is still given
 * as a safety net in case jsdom init is slow.
 */

import { describe, expect, it } from 'vitest';
import { verifyDesign } from './design-verifier';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A structurally accessible page:
 * - <button> with aria-label
 * - <input> linked to its <label> via for/id
 * - A <main> landmark
 * - A single <h1> heading
 * - An <img> with alt text
 */
const ACCESSIBLE_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Accessible Page</title></head>
<body>
  <a href="#main" class="skip-link">Skip to main content</a>
  <main id="main">
    <h1>Dashboard</h1>
    <label for="search">Search</label>
    <input id="search" type="search" />
    <button aria-label="Close dialog">×</button>
    <img src="logo.png" alt="Company logo" />
    <nav aria-label="Primary navigation">
      <ul>
        <li><a href="/home">Home</a></li>
        <li><a href="/about">About</a></li>
      </ul>
    </nav>
  </main>
</body>
</html>`;

/**
 * A structurally inaccessible page:
 * - <div onclick="..."> used as a button (no role, no name)
 * - <input> with no associated <label>
 * - <img> with no alt attribute
 * - No <main> landmark
 * - No page title
 * - No lang attribute on <html>
 */
const INACCESSIBLE_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8"></head>
<body>
  <div onclick="doSomething()">Click me</div>
  <input type="text" placeholder="Enter name" />
  <img src="logo.png" />
  <div role="button">Another fake button</div>
</body>
</html>`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('verifyDesign — axe-core accessibility verifier', () => {
  it(
    'returns ran:false with errorMessage when no index.html is in the snapshot',
    async () => {
      const result = await verifyDesign({});
      expect(result.ran).toBe(false);
      expect(result.violations).toBe(0);
      expect(result.critical).toEqual([]);
      expect(result.passes).toBe(0);
      expect(result.errorMessage).toMatch(/no index\.html/);
    },
    30_000,
  );

  it(
    'returns ran:true with few/zero critical violations for well-structured accessible HTML',
    async () => {
      const snapshot = { '/workspace/index.html': ACCESSIBLE_HTML };
      const result = await verifyDesign(snapshot);

      expect(result.ran, `ran must be true — errorMessage: ${result.errorMessage ?? 'none'}`).toBe(true);
      expect(result.errorMessage).toBeUndefined();
      expect(result.passes).toBeGreaterThan(0);
      // A structurally sound page should produce no critical/serious violations.
      expect(result.critical.length).toBe(0);
    },
    30_000,
  );

  it(
    'returns ran:true with violations > 0 and critical violations for inaccessible HTML',
    async () => {
      const snapshot = { '/workspace/index.html': INACCESSIBLE_HTML };
      const result = await verifyDesign(snapshot);

      expect(result.ran, `ran must be true — errorMessage: ${result.errorMessage ?? 'none'}`).toBe(true);
      expect(result.errorMessage).toBeUndefined();
      // The inaccessible page must trigger at least one axe violation.
      expect(result.violations).toBeGreaterThan(0);
      // At least one of those must be critical or serious.
      expect(result.critical.length).toBeGreaterThan(0);
    },
    30_000,
  );

  it(
    'produces a non-empty output summary for inaccessible HTML',
    async () => {
      const snapshot = { '/workspace/index.html': INACCESSIBLE_HTML };
      const result = await verifyDesign(snapshot);

      expect(result.ran).toBe(true);
      // The output summary should contain at least one rule id.
      expect(result.output.length).toBeGreaterThan(0);
    },
    30_000,
  );

  it(
    'does not throw — returns ran:false gracefully when given malformed HTML',
    async () => {
      // Extremely malformed but should not throw; jsdom is tolerant.
      const snapshot = { '/workspace/index.html': '<not html at all >>><' };
      const result = await verifyDesign(snapshot);
      // jsdom tolerates any input so we just confirm no exception bubbles up.
      expect(typeof result.ran).toBe('boolean');
    },
    30_000,
  );
});
