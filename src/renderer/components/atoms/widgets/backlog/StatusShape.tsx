/**
 * StatusShape.tsx — SVG polygon status indicator (2→7 sides = workflow
 * position). Ported verbatim from the frozen reference
 * (docs/superpowers/specs/2026-07-08-backlog-bento-reference.tsx:80-106).
 */
import React from 'react';

export interface StatusShapeProps {
  sides: number;
  className?: string;
  fillClass?: string;
  strokeClass?: string;
}

export function StatusShape({ sides, className, fillClass = 'fill-white', strokeClass = 'stroke-black' }: StatusShapeProps) {
  const shapeProps = { strokeWidth: '2.5', strokeLinejoin: 'round' as const };

  const getShape = () => {
    switch (sides) {
      case 2: // Line (Refine)
        return <rect x="3" y="10" width="18" height="4" rx="1.5" {...shapeProps} />;
      case 3: // Triangle (To Do)
        return <polygon points="12,3 22,20 2,20" {...shapeProps} />;
      case 4: // Square (Ready)
        return <rect x="4" y="4" width="16" height="16" rx="2" {...shapeProps} />;
      case 5: // Pentagon (In Progress)
        return <polygon points="12,2 22,9.5 18.5,21 5.5,21 2,9.5" {...shapeProps} />;
      case 6: // Hexagon (Review)
        return <polygon points="12,2 21,7.5 21,16.5 12,22 3,16.5 3,7.5" {...shapeProps} />;
      case 7: // Heptagon (Deploy)
        return <polygon points="12,2 20,6.5 22,14.5 17,21 7,21 2,14.5 4,6.5" {...shapeProps} />;
      default:
        return <circle cx="12" cy="12" r="9" {...shapeProps} />;
    }
  };

  return (
    <svg viewBox="0 0 24 24" className={`${className ?? ''} ${fillClass} ${strokeClass}`} xmlns="http://www.w3.org/2000/svg">
      {getShape()}
    </svg>
  );
}
