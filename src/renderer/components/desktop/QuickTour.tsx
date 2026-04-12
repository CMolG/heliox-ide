/**
 * QuickTour.tsx — Renderer Desktop Surface Component
 *
 * Responsibility:
 * - Renders the QuickTour surface in the renderer layer.
 * - Encapsulates Desktop canvas/window composition within the renderer workspace.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/desktop/QuickTour.tsx — Interactive onboarding tour with element highlighting
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useDesktopStore } from '../../store/desktop-store';

interface TourStep {
  target: string; // data-testid or CSS selector
  title: string;
  description: string;
  position: 'top' | 'bottom' | 'left' | 'right';
  highlightCenter?: boolean; // highlight a small centered region instead of full element
}

const TOUR_STEPS: TourStep[] = [
  {
    target: '[data-testid="dock"]',
    title: 'Application Dock',
    description: 'Your command center. Launch apps, access the marketplace, and manage attachables from the dock.',
    position: 'top',
  },
  {
    target: '[data-testid="dock-new-chat"]',
    title: 'New Chat',
    description: 'Start a new agentic AI chat session scoped to your project. Each session gets its own window.',
    position: 'top',
  },
  {
    target: '[data-testid="dock-file-explorer"]',
    title: 'File Explorer',
    description: 'Browse your project files with syntax highlighting, tabbed editing, and drag-out support.',
    position: 'top',
  },
  {
    target: '[data-testid="dock-backlog"]',
    title: 'Backlog Board',
    description: 'A built-in Kanban board. Manage tasks across Backlog, In Progress, Done, and Failed columns with drag-and-drop.',
    position: 'top',
  },
  {
    target: '[data-testid="dock-marketplace"]',
    title: 'Marketplace',
    description: 'Browse and deploy Roles, Mods, and Flows to customize your AI agent sessions.',
    position: 'top',
  },
  {
    target: '[data-testid="desktop-canvas-bg"]',
    title: 'Desktop Canvas',
    description: 'Your infinite workspace. Pan with middle-click, zoom with Ctrl+scroll. Click anywhere to see the wave animation!',
    position: 'top',
    highlightCenter: true,
  },
  {
    target: '[data-testid="dock-settings"]',
    title: 'Settings',
    description: 'Configure your IDE preferences — CLI adapter, canvas animations, and more.',
    position: 'top',
  },
  {
    target: '[data-testid="attachable-scroll-left"]',
    title: 'Attachables Dock',
    description: 'Deployed marketplace items appear here. Drag them upward onto the canvas, or click to spawn. Scroll infinitely with the arrows.',
    position: 'top',
  },
];

export function QuickTour() {
  const settings = useDesktopStore(s => s.settings);
  const updateSettings = useDesktopStore(s => s.updateSettings);
  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [visible, setVisible] = useState(false);
  const rafRef = useRef(0);

  // Show tour if not completed
  useEffect(() => {
    if (!settings.tourCompleted) {
      // Delay to let the DOM render
      const timer = setTimeout(() => setVisible(true), 800);
      return () => clearTimeout(timer);
    } else {
      setVisible(false);
    }
  }, [settings.tourCompleted]);

  // Track the target element position
  useEffect(() => {
    if (!visible) return;
    const step = TOUR_STEPS[currentStep];
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
            return next < TOUR_STEPS.length ? next : prev;
          });
          missCount = 0;
        }
      }
      rafRef.current = requestAnimationFrame(updateRect);
    }
    updateRect();
    return () => cancelAnimationFrame(rafRef.current);
  }, [visible, currentStep]);

  const handleNext = useCallback(() => {
    if (currentStep < TOUR_STEPS.length - 1) {
      setCurrentStep(s => s + 1);
    } else {
      // Complete
      updateSettings({ tourCompleted: true });
      setVisible(false);
      setCurrentStep(0);
    }
  }, [currentStep, updateSettings]);

  const handleSkip = useCallback(() => {
    updateSettings({ tourCompleted: true });
    setVisible(false);
    setCurrentStep(0);
  }, [updateSettings]);

  if (!visible || !targetRect) return null;

  const step = TOUR_STEPS[currentStep];
  const pad = 8;

  // For large elements (like canvas), highlight a centered region instead of the full element
  let effectiveRect = targetRect;
  if (step.highlightCenter) {
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
  if (step.position === 'top') {
    tooltipStyle.left = clamp(cutout.left + cutout.width / 2, 160, window.innerWidth - 160);
    tooltipStyle.bottom = clamp(window.innerHeight - cutout.top + 12, 40, window.innerHeight - 40);
    tooltipStyle.transform = 'translateX(-50%)';
  } else if (step.position === 'bottom') {
    tooltipStyle.left = clamp(cutout.left + cutout.width / 2, 160, window.innerWidth - 160);
    tooltipStyle.top = clamp(cutout.top + cutout.height + 12, 40, window.innerHeight - 200);
    tooltipStyle.transform = 'translateX(-50%)';
  } else if (step.position === 'left') {
    tooltipStyle.right = window.innerWidth - cutout.left + 12;
    tooltipStyle.top = clamp(cutout.top + cutout.height / 2, 40, window.innerHeight - 100);
    tooltipStyle.transform = 'translateY(-50%)';
  } else {
    tooltipStyle.left = cutout.left + cutout.width + 12;
    tooltipStyle.top = clamp(cutout.top + cutout.height / 2, 40, window.innerHeight - 100);
    tooltipStyle.transform = 'translateY(-50%)';
  }

  return (
    <>
      {/* Backdrop with cutout — no click to dismiss */}
      <div
        className="tour-backdrop"
        data-testid="quick-tour-backdrop"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 100000,
          background: 'transparent',
        }}
      >
        <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
          <defs>
            <mask id="tour-mask">
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
            fill="rgba(0,0,0,0.55)"
            mask="url(#tour-mask)"
          />
        </svg>

        {/* Highlight ring */}
        <div style={{
          position: 'fixed',
          left: cutout.left, top: cutout.top,
          width: cutout.width, height: cutout.height,
          border: '2px solid rgba(52, 211, 153, 0.7)',
          borderRadius: 12,
          boxShadow: '0 0 0 4px rgba(52, 211, 153, 0.15)',
          pointerEvents: 'none',
          zIndex: 100001,
        }} />
      </div>

      {/* Tooltip */}
      <div
        className="tour-tooltip"
        data-testid="quick-tour-tooltip"
        style={tooltipStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tour-step-counter">{currentStep + 1} / {TOUR_STEPS.length}</div>
        <h3 className="tour-title">{step.title}</h3>
        <p className="tour-desc">{step.description}</p>
        <div className="tour-actions">
          <button className="tour-btn tour-skip" onClick={handleSkip} type="button">Skip</button>
          <button className="tour-btn tour-next" onClick={handleNext} type="button" data-testid="quick-tour-next">
            {currentStep < TOUR_STEPS.length - 1 ? 'Next' : 'Done'}
          </button>
        </div>
      </div>
    </>
  );
}
