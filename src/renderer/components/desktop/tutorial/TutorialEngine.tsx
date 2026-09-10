/**
 * TutorialEngine.tsx — Scenario-driven tutorial overlay with brutalist styling.
 *
 * Responsibility:
 * - Thin wrapper composing @cmolg/daba-engine's `TutorialEngine` (the
 *   state machine: current step, rAF target tracking, missing-target skip,
 *   next/prev/skip/complete transitions — adoption plan #20, javadaba-web
 *   Core, Task 10) with Fluxor's own visuals: the "sketchbook" backdrop with
 *   doodles + a per-scenario accent-colored highlight ring (`renderBackdrop`)
 *   and the `BrutalistTutorialCard` (`renderCard`), including the exact
 *   cutout/tooltip clamp-positioning math this component used to own itself
 *   before the adoption (ported verbatim below — the motor doesn't
 *   generalize this positioning scheme, it only tracks the target and hands
 *   back its rect).
 * - Supports next/prev/skip/done with per-scenario persistence.
 *
 * Why a wrapper instead of using the motor's default backdrop/card as-is:
 * the motor's built-in SVG-mask backdrop and default `TutorialCard` are
 * intentionally generic (no doodles, no per-scenario color, no legacy
 * testids) — this adoption is iso-visual (no redesign), so Fluxor's actual
 * look moves into `renderBackdrop`/`renderCard`, while the motor keeps
 * owning the reusable state machine. See the daba-engine CHANGELOG's Task 10
 * entry for the 2 small ADDITIVE engine changes this wrapper needed
 * (renderCard's 3rd `targetRect` arg + the new `renderBackdrop` slot).
 *
 * Known latent gap (documented, not fixed — unused today): the motor treats
 * `highlightCenter` like `highlightViewport` (skips target tracking, always
 * hands back `targetRect: null`), whereas Fluxor's original centered a small
 * spotlight ON the tracked target's center for `highlightCenter` (needs a
 * real targetRect). `TutorialScenarios.ts` uses `highlightViewport` exclusively
 * today (`highlightCenter` count: 0), so this never triggers — `computeCutout`
 * below degrades gracefully (no cutout) if it ever does. Revisit in the motor
 * (interface-first) if a scenario ever adds `highlightCenter`.
 *
 * Backward compatibility:
 * - When scenario is 'workspace', completing it also sets `tourCompleted: true`
 *   to preserve existing E2E test helpers.
 * - Fluxor's "Skip" has always meant "mark complete and close" (not "abandon
 *   without completing") — both the motor's onComplete and onExit map to the
 *   same completeTutorial() here to preserve that.
 */
import React, { useCallback } from 'react';
import {
  TutorialEngine as MotorTutorialEngine,
  type TutorialControls,
  type TutorialStep,
} from '@cmolg/daba-engine';
import { useDesktopStore } from '../../../store/desktop-store';
import { BrutalistTutorialCard } from './BrutalistTutorialCard';
import { getTutorialScenario } from './TutorialScenarios';
import type { TutorialScenarioId } from '@/types/tutorial';

// ─── Cutout + tooltip positioning (Fluxor's own math, ported verbatim from
// this file's pre-adoption version — the motor does not generalize this) ──

interface Cutout {
  top: number;
  left: number;
  width: number;
  height: number;
}

function computeCutout(step: TutorialStep, targetRect: DOMRect | null): Cutout | null {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 0;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 0;
  const pad = 8;

  let effectiveRect: { left: number; top: number; width: number; height: number };
  if (step.highlightViewport) {
    // Full viewport cutout — the entire canvas is the highlighted region.
    effectiveRect = { left: 0, top: 0, width: vw, height: vh };
  } else if (step.highlightCenter) {
    if (!targetRect) return null; // see the module docblock's "known latent gap" note
    const size = 200;
    effectiveRect = {
      left: targetRect.left + targetRect.width / 2 - size / 2,
      top: targetRect.top + targetRect.height / 2 - size / 2,
      width: size,
      height: size,
    };
  } else {
    if (!targetRect) return null; // still tracking — target hasn't appeared yet
    effectiveRect = targetRect;
  }

  return {
    top: effectiveRect.top - pad,
    left: effectiveRect.left - pad,
    width: effectiveRect.width + pad * 2,
    height: effectiveRect.height + pad * 2,
  };
}

function computeTooltipStyle(step: TutorialStep, cutout: Cutout | null): React.CSSProperties {
  const style: React.CSSProperties = { position: 'fixed', zIndex: 100001 };
  const vw = typeof window !== 'undefined' ? window.innerWidth : 0;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 0;
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  if (step.highlightViewport) {
    // Full-viewport highlight: center the card in the viewport.
    style.left = '50%';
    style.top = '50%';
    style.transform = 'translate(-50%, -50%)';
    return style;
  }

  if (!cutout) return style; // no target tracked yet — defensive fallback, not normally reached

  if (step.position === 'top') {
    style.left = clamp(cutout.left + cutout.width / 2, 200, vw - 200);
    style.bottom = clamp(vh - cutout.top + 16, 40, vh - 40);
    style.transform = 'translateX(-50%)';
  } else if (step.position === 'bottom') {
    style.left = clamp(cutout.left + cutout.width / 2, 200, vw - 200);
    style.top = clamp(cutout.top + cutout.height + 16, 40, vh - 200);
    style.transform = 'translateX(-50%)';
  } else if (step.position === 'left') {
    style.right = vw - cutout.left + 16;
    style.top = clamp(cutout.top + cutout.height / 2, 40, vh - 100);
    style.transform = 'translateY(-50%)';
  } else {
    style.left = cutout.left + cutout.width + 16;
    style.top = clamp(cutout.top + cutout.height / 2, 40, vh - 100);
    style.transform = 'translateY(-50%)';
  }
  return style;
}

// ─── Component ───────────────────────────────────────────────────

export function TutorialEngine() {
  const settings = useDesktopStore(s => s.settings);
  const updateSettings = useDesktopStore(s => s.updateSettings);
  const activeTutorial = useDesktopStore(s => s.activeTutorial);
  const setActiveTutorial = useDesktopStore(s => s.setActiveTutorial);

  const scenario = activeTutorial ? getTutorialScenario(activeTutorial) : null;
  const isWorkspace = activeTutorial === 'workspace';
  // The motor's TutorialScenario requires `title` (it's a generic label the
  // motor's OWN default TutorialCard would show) — Fluxor's own scenario
  // type uses `label` instead (plus accentColor/subtitle/iconName/tags that
  // the motor's type doesn't know about). Since renderCard/renderBackdrop
  // below read the richer Fluxor `scenario` directly (not this adapter),
  // this is purely to satisfy the motor's prop type — never actually
  // displayed anywhere.
  const motorScenario = scenario ? { ...scenario, title: scenario.label } : null;

  // Fluxor's "Skip" has always meant "mark complete and close" — both the
  // motor's onComplete (reaching the last step) and onExit (the Skip button)
  // map here, matching the pre-adoption behavior exactly.
  const completeTutorial = useCallback(() => {
    if (!activeTutorial) return;
    const updatedProgress = { ...settings.tutorialCompleted, [activeTutorial]: true };
    const patch: Record<string, unknown> = { tutorialCompleted: updatedProgress };
    // Backward compat: workspace completion also sets tourCompleted.
    if (activeTutorial === 'workspace') {
      patch.tourCompleted = true;
    }
    updateSettings(patch as Partial<typeof settings>);
    setActiveTutorial(null);
  }, [activeTutorial, settings.tutorialCompleted, updateSettings, setActiveTutorial]);

  const renderBackdrop = useCallback(
    (step: TutorialStep, _controls: TutorialControls, targetRect: DOMRect | null) => {
      const cutout = computeCutout(step, targetRect);
      if (!cutout || !scenario) return null;
      return (
        <div
          className="tutorial-backdrop"
          data-testid={isWorkspace ? 'quick-tour-backdrop' : 'tutorial-backdrop'}
          style={{ position: 'fixed', inset: 0, zIndex: 100000, background: 'transparent' }}
        >
          {/* Sketchbook grid background overlay (brutalist concept) */}
          <div className="tutorial-sketchbook-bg" />

          <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
            <defs>
              <mask id="tutorial-mask">
                <rect width="100%" height="100%" fill="white" />
                <rect x={cutout.left} y={cutout.top} width={cutout.width} height={cutout.height} rx={12} fill="black" />
              </mask>
            </defs>
            <rect width="100%" height="100%" fill="rgba(0,0,0,0.6)" mask="url(#tutorial-mask)" />
          </svg>

          {/* Decorative SVG doodles from the concept */}
          <svg className="tutorial-doodle tutorial-doodle-top" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10,50 Q30,10 50,50 T90,50" />
            <path d="M10,60 Q30,20 50,60 T90,60" />
          </svg>
          <svg className="tutorial-doodle tutorial-doodle-bottom" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
            <circle cx="50" cy="50" r="40" strokeDasharray="10 15" />
            <path d="M30,50 L70,50 M50,30 L50,70" />
          </svg>

          {/* Highlight ring around target */}
          <div
            style={{
              position: 'fixed',
              left: cutout.left,
              top: cutout.top,
              width: cutout.width,
              height: cutout.height,
              border: `2px solid ${scenario.accentColor}`,
              borderRadius: 12,
              boxShadow: `0 0 0 4px ${scenario.accentColor}33, 0 0 24px ${scenario.accentColor}22`,
              pointerEvents: 'none',
              zIndex: 100001,
            }}
          />
        </div>
      );
    },
    [scenario, isWorkspace],
  );

  const renderCard = useCallback(
    (step: TutorialStep, controls: TutorialControls, targetRect: DOMRect | null) => {
      if (!scenario) return null;
      const cutout = computeCutout(step, targetRect);
      // Mirrors the pre-adoption guard (`!targetRect => render nothing`) for
      // steps that DO need a real tracked target — highlightViewport steps
      // (100% of today's scenario data) never hit this since their cutout is
      // viewport-derived and never null.
      if (!cutout && !step.highlightViewport) return null;

      return (
        <BrutalistTutorialCard
          scenario={scenario}
          stepIndex={controls.stepIndex}
          totalSteps={controls.totalSteps}
          title={step.title}
          description={step.description}
          onNext={controls.next}
          onPrev={controls.prev}
          onSkip={controls.skip}
          style={computeTooltipStyle(step, cutout)}
          isWorkspace={isWorkspace}
        />
      );
    },
    [scenario, isWorkspace],
  );

  return (
    <MotorTutorialEngine
      scenario={motorScenario}
      onComplete={completeTutorial}
      onExit={completeTutorial}
      renderBackdrop={renderBackdrop}
      renderCard={renderCard}
    />
  );
}

// Re-exported for callers that only need the id type (none today, kept for parity
// with the pre-adoption module surface).
export type { TutorialScenarioId };
