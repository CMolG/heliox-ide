/**
 * TutorialEngine.tsx — Scenario-driven tutorial overlay with brutalist styling.
 *
 * Responsibility:
 * - Replaces the old linear QuickTour with a scenario-aware tutorial system
 * - Renders a spotlight cutout on the target element
 * - Shows the BrutalistTutorialCard positioned near the highlighted element
 * - Supports next/prev/skip/done with per-scenario persistence
 *
 * Backward compatibility:
 * - When scenario is 'workspace', completing it also sets `tourCompleted: true`
 *   to preserve existing E2E test helpers.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useDesktopStore } from '../../../store/desktop-store';
import { BrutalistTutorialCard } from './BrutalistTutorialCard';
import { getTutorialScenario } from './TutorialScenarios';
import type { TutorialScenarioId } from '@/types/tutorial';

export function TutorialEngine() {
  const settings = useDesktopStore(s => s.settings);
  const updateSettings = useDesktopStore(s => s.updateSettings);
  const activeTutorial = useDesktopStore(s => s.activeTutorial);
  const setActiveTutorial = useDesktopStore(s => s.setActiveTutorial);

  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [visible, setVisible] = useState(false);
  const rafRef = useRef(0);

  // Derive the active scenario
  const scenario = activeTutorial ? getTutorialScenario(activeTutorial) : null;
  const steps = scenario?.steps ?? [];

  // No auto-start: the workspace tutorial only launches on demand — from the
  // Help modal's "Take the tour" action, or Settings › Tutorials (both call
  // setActiveTutorial('workspace')) — never on an unconditional timer.

  // Show/hide based on active tutorial
  useEffect(() => {
    if (activeTutorial && scenario) {
      setCurrentStep(0);
      setVisible(true);
    } else {
      setVisible(false);
      setTargetRect(null);
    }
  }, [activeTutorial, scenario]);

  // Track the target element position with rAF
  useEffect(() => {
    if (!visible || !steps.length) return;
    const step = steps[currentStep];
    if (!step) return;

    let missCount = 0;
    function updateRect() {
      const el = document.querySelector(step.target);
      if (el) {
        setTargetRect(el.getBoundingClientRect());
        missCount = 0;
      } else {
        missCount++;
        // If element not found after ~3s, skip this step
        if (missCount > 180) {
          setCurrentStep(prev => {
            const next = prev + 1;
            return next < steps.length ? next : prev;
          });
          missCount = 0;
        }
      }
      rafRef.current = requestAnimationFrame(updateRect);
    }
    updateRect();
    return () => cancelAnimationFrame(rafRef.current);
  }, [visible, currentStep, steps]);

  const completeTutorial = useCallback(() => {
    if (!activeTutorial) return;
    // Mark this scenario as completed
    const updatedProgress = { ...settings.tutorialCompleted, [activeTutorial]: true };
    const patch: any = { tutorialCompleted: updatedProgress };
    // Backward compat: workspace completion also sets tourCompleted
    if (activeTutorial === 'workspace') {
      patch.tourCompleted = true;
    }
    updateSettings(patch);
    setActiveTutorial(null);
    setVisible(false);
    setCurrentStep(0);
  }, [activeTutorial, settings.tutorialCompleted, updateSettings, setActiveTutorial]);

  const handleNext = useCallback(() => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(s => s + 1);
    } else {
      completeTutorial();
    }
  }, [currentStep, steps.length, completeTutorial]);

  const handlePrev = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep(s => s - 1);
    }
  }, [currentStep]);

  const handleSkip = useCallback(() => {
    completeTutorial();
  }, [completeTutorial]);

  if (!visible || !targetRect || !scenario) return null;

  const step = steps[currentStep];
  if (!step) return null;
  const pad = 8;

  // For large elements, highlight a centered region
  let effectiveRect = targetRect;
  if (step.highlightViewport) {
    // Full viewport cutout — the entire canvas is the highlighted region
    effectiveRect = new DOMRect(0, 0, window.innerWidth, window.innerHeight);
  } else if (step.highlightCenter) {
    const size = 200;
    effectiveRect = new DOMRect(
      targetRect.left + targetRect.width / 2 - size / 2,
      targetRect.top + targetRect.height / 2 - size / 2,
      size, size,
    );
  }

  const cutout = {
    top: effectiveRect.top - pad,
    left: effectiveRect.left - pad,
    width: effectiveRect.width + pad * 2,
    height: effectiveRect.height + pad * 2,
  };

  // Position the tooltip — clamped to viewport
  const tooltipStyle: React.CSSProperties = { position: 'fixed', zIndex: 100001 };
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  if (step.highlightViewport) {
    // Full-viewport highlight: center the card in the viewport
    tooltipStyle.left = '50%';
    tooltipStyle.top = '50%';
    tooltipStyle.transform = 'translate(-50%, -50%)';
  } else if (step.position === 'top') {
    tooltipStyle.left = clamp(cutout.left + cutout.width / 2, 200, window.innerWidth - 200);
    tooltipStyle.bottom = clamp(window.innerHeight - cutout.top + 16, 40, window.innerHeight - 40);
    tooltipStyle.transform = 'translateX(-50%)';
  } else if (step.position === 'bottom') {
    tooltipStyle.left = clamp(cutout.left + cutout.width / 2, 200, window.innerWidth - 200);
    tooltipStyle.top = clamp(cutout.top + cutout.height + 16, 40, window.innerHeight - 200);
    tooltipStyle.transform = 'translateX(-50%)';
  } else if (step.position === 'left') {
    tooltipStyle.right = window.innerWidth - cutout.left + 16;
    tooltipStyle.top = clamp(cutout.top + cutout.height / 2, 40, window.innerHeight - 100);
    tooltipStyle.transform = 'translateY(-50%)';
  } else {
    tooltipStyle.left = cutout.left + cutout.width + 16;
    tooltipStyle.top = clamp(cutout.top + cutout.height / 2, 40, window.innerHeight - 100);
    tooltipStyle.transform = 'translateY(-50%)';
  }

  return (
    <>
      {/* Backdrop with cutout */}
      <div
        className="tutorial-backdrop"
        data-testid={activeTutorial === 'workspace' ? 'quick-tour-backdrop' : 'tutorial-backdrop'}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 100000,
          background: 'transparent',
        }}
      >
        {/* Sketchbook grid background overlay (brutalist concept) */}
        <div className="tutorial-sketchbook-bg" />

        <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
          <defs>
            <mask id="tutorial-mask">
              <rect width="100%" height="100%" fill="white" />
              <rect
                x={cutout.left} y={cutout.top}
                width={cutout.width} height={cutout.height}
                rx={12} fill="black"
              />
            </mask>
          </defs>
          <rect
            width="100%" height="100%"
            fill="rgba(0,0,0,0.6)"
            mask="url(#tutorial-mask)"
          />
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
        <div style={{
          position: 'fixed',
          left: cutout.left, top: cutout.top,
          width: cutout.width, height: cutout.height,
          border: `2px solid ${scenario.accentColor}`,
          borderRadius: 12,
          boxShadow: `0 0 0 4px ${scenario.accentColor}33, 0 0 24px ${scenario.accentColor}22`,
          pointerEvents: 'none',
          zIndex: 100001,
        }} />
      </div>

      {/* Brutalist tutorial card */}
      <BrutalistTutorialCard
        scenario={scenario}
        stepIndex={currentStep}
        totalSteps={steps.length}
        title={step.title}
        description={step.description}
        onNext={handleNext}
        onPrev={handlePrev}
        onSkip={handleSkip}
        style={tooltipStyle}
        isWorkspace={activeTutorial === 'workspace'}
      />
    </>
  );
}
