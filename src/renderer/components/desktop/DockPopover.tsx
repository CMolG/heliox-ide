/**
 * DockPopover.tsx — Shared dock-styled popover shell
 */
import React from 'react';

interface DockPopoverProps {
  className?: string;
  role?: string;
  ariaLabel?: string;
  children: React.ReactNode;
  onPointerDownOutside?: () => void;
  onEscape?: () => void;
}

export function DockPopover({
  className,
  role = 'menu',
  ariaLabel,
  children,
  onPointerDownOutside,
  onEscape,
}: DockPopoverProps) {
  const ref = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!onPointerDownOutside) return;
      const target = event.target as Node | null;
      if (!target) return;
      if (ref.current?.contains(target)) return;
      onPointerDownOutside();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      onEscape?.();
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onPointerDownOutside, onEscape]);

  return (
    <div
      ref={ref}
      className={`dock-popover-shell${className ? ` ${className}` : ''}`}
      role={role}
      aria-label={ariaLabel}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}
