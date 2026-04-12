/**
 * BrutalistTutorialCard.tsx — Brutalist/Comic/Sketchbook styled tutorial card.
 *
 * Responsibility:
 * - Renders the tutorial tooltip with the provided brutalist aesthetic
 * - Used as the tooltip content by the TutorialEngine
 * - Preserves the exact visual concept: halftone dots, brutal shadows,
 *   sketch borders, masking tape, marker fonts, comic colors
 *
 * The concept HTML is used **unchanged** as the visual basis.
 */
import React from 'react';
import type { TutorialScenario } from '@/types/tutorial';
import { LucideIcon } from '../LucideIcon';

interface BrutalistTutorialCardProps {
  scenario: TutorialScenario;
  stepIndex: number;
  totalSteps: number;
  title: string;
  description: string;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
  style?: React.CSSProperties;
  /** When true, adds backward-compat testids for workspace/Quick Tour E2E tests */
  isWorkspace?: boolean;
}

export function BrutalistTutorialCard({
  scenario,
  stepIndex,
  totalSteps,
  title,
  description,
  onNext,
  onPrev,
  onSkip,
  style,
  isWorkspace,
}: BrutalistTutorialCardProps) {
  const isLast = stepIndex === totalSteps - 1;
  const isFirst = stepIndex === 0;
  const accentColor = scenario.accentColor;

  return (
    <div
      className="brutalist-tutorial-card"
      data-testid={isWorkspace ? 'quick-tour-tooltip' : 'tutorial-card'}
      style={style}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Masking tape top */}
      <div className="brutalist-tape brutalist-tape-top" />

      {/* Main card */}
      <div className="brutalist-card-inner">
        {/* Halftone accent */}
        <div className="brutalist-halftone" />

        {/* Header */}
        <div className="brutalist-card-header">
          <div className="brutalist-card-header-left">
            {/* Icon box */}
            <div
              className="brutalist-icon-box"
              style={{ backgroundColor: accentColor }}
            >
              <LucideIcon name={scenario.iconName} size={28} />
            </div>
            <h2 className="brutalist-card-label">{scenario.label}</h2>
          </div>

          {/* Step badge */}
          <div
            className="brutalist-step-badge"
            style={{ backgroundColor: accentColor }}
          >
            <span className={`brutalist-step-badge-text${isWorkspace ? ' tour-step-counter' : ''}`}>
              {stepIndex + 1} / {totalSteps}
            </span>
          </div>
        </div>

        {/* Body */}
        <div className="brutalist-card-body">
          <p>
            <strong className={`brutalist-title-highlight${isWorkspace ? ' tour-title' : ''}`}>{title}</strong>
            {' — '}
            <span className="brutalist-description">{description}</span>
          </p>
        </div>

        {/* Tags */}
        <div className="brutalist-card-tags">
          {scenario.tags.map((tag, i) => {
            const tagColors = [
              { bg: '#FDFCF0', color: '#111', rotate: '-1deg' },
              { bg: '#FFEA00', color: '#111', rotate: '2deg' },
              { bg: '#FF007F', color: '#fff', rotate: '-2deg' },
            ];
            const tc = tagColors[i % tagColors.length];
            return (
              <div
                key={tag}
                className="brutalist-tag hover-wiggle"
                style={{
                  backgroundColor: tc.bg,
                  color: tc.color,
                  transform: `rotate(${tc.rotate})`,
                }}
              >
                <span className="brutalist-tag-text">{tag}</span>
              </div>
            );
          })}
        </div>

        {/* Navigation */}
        <div className="brutalist-card-actions">
          <button
            className={`brutalist-btn brutalist-btn-skip${isWorkspace ? ' tour-skip' : ''}`}
            onClick={onSkip}
            type="button"
            data-testid="tutorial-skip"
          >
            Skip
          </button>
          <div className="brutalist-card-actions-right">
            {!isFirst && (
              <button
                className="brutalist-btn brutalist-btn-prev"
                onClick={onPrev}
                type="button"
                data-testid="tutorial-prev"
              >
                Prev
              </button>
            )}
            <button
              className="brutalist-btn brutalist-btn-next"
              onClick={onNext}
              type="button"
              data-testid={isWorkspace ? 'quick-tour-next' : 'tutorial-next'}
              style={{ backgroundColor: accentColor }}
            >
              {isLast ? 'Done' : 'Next'}
            </button>
          </div>
        </div>

        {/* Decorative asterisk */}
        <div className="brutalist-asterisk" style={{ color: accentColor }}>*</div>
      </div>

      {/* Masking tape bottom corner */}
      <div className="brutalist-tape brutalist-tape-bottom" />
    </div>
  );
}
