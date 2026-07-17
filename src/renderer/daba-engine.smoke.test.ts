// Smoke test for the @javadaba/daba-engine dependency (Task 9, plan
// docs/superpowers/plans/2026-07-12-daba-engine-motor-y-adopcion-fluxor.md, javadaba-web Core).
//
// This does NOT test engine behavior (that's the engine's own 92-test suite in the
// Core repo). It only pins down that Vitest/Vite in fluxor-ide can resolve the
// `@javadaba/daba-engine` package coordinate declared in package.json — today via
// `npm link` for local dev (see docs/superpowers/backlog/2026-07-17-daba-engine-registro-privado.md),
// and via the private registry once Task 9 Step 3 (publish) is authorized and run.
import { describe, expect, it } from 'vitest';
import { screenToWorld, worldToScreen } from '@javadaba/daba-engine';

describe('@javadaba/daba-engine dependency resolution', () => {
  it('resolves the package and its camera primitives', () => {
    const camera = { pan: { x: 10, y: 20 }, zoom: 2 };
    const viewportOrigin = { x: 0, y: 0 };
    const world = screenToWorld({ x: 110, y: 120 }, camera, viewportOrigin);
    const screen = worldToScreen(world, camera, viewportOrigin);

    expect(screen.x).toBeCloseTo(110);
    expect(screen.y).toBeCloseTo(120);
  });
});
