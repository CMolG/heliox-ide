/**
 * FluxorDropdown.tsx — Renderer UI Primitive Component
 *
 * Responsibility:
 * - Renders the FluxorDropdown surface in the renderer layer.
 * - Encapsulates Reusable UI primitive used by higher-level panels and surfaces.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/ui/FluxorDropdown.tsx — Custom dropdown replacing native <select>, styled like context menus
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { theme } from '../../logic/theme';

// ─── Types ───────────────────────────────────────────────────────

export interface DropdownOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
  separator?: boolean;
}

interface FluxorDropdownProps {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Font size for the trigger label (default 11) */
  fontSize?: number;
  /** Style variant — 'compact' for inline toolbar use, 'field' for form fields */
  variant?: 'compact' | 'field';
  /** Maximum width of the trigger */
  maxWidth?: number;
  /** aria-label for the trigger button */
  ariaLabel?: string;
  /** data-testid for the trigger button */
  testId?: string;
  /** Custom style overrides for the trigger */
  triggerStyle?: React.CSSProperties;
}

// ─── Component ───────────────────────────────────────────────────

export function FluxorDropdown({
  value,
  options,
  onChange,
  disabled = false,
  placeholder = 'Select…',
  fontSize = 11,
  variant = 'compact',
  maxWidth,
  ariaLabel,
  testId,
  triggerStyle,
}: FluxorDropdownProps) {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selectableOptions = options.filter(o => !o.separator);
  const selectedOption = selectableOptions.find(o => o.value === value);
  const displayLabel = selectedOption?.label ?? placeholder;

  // ── Viewport-anchored position for the portalled menu ───────────
  const [menuCoords, setMenuCoords] = useState<{ top: number; left: number; minWidth: number; direction: 'below' | 'above' }>({
    top: 0, left: 0, minWidth: 0, direction: 'below',
  });

  // ── Close on outside click or Escape ────────────────────────────
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current && !containerRef.current.contains(target) &&
        menuRef.current && !menuRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  // ── Compute fixed position from trigger's viewport rect ─────────
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const estimatedMenuHeight = Math.min(selectableOptions.length * 30 + 8, 240);
    const spaceBelow = window.innerHeight - rect.bottom;
    const direction = spaceBelow < estimatedMenuHeight ? 'above' : 'below';
    setMenuCoords({
      top: direction === 'below' ? rect.bottom + 4 : rect.top - estimatedMenuHeight - 4,
      left: rect.left,
      minWidth: rect.width,
      direction,
    });
  }, [open, selectableOptions.length]);

  // ── Keyboard navigation inside menu ─────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setOpen(true);
        const currentIdx = selectableOptions.findIndex(o => o.value === value);
        setFocusedIndex(currentIdx >= 0 ? currentIdx : 0);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex(prev => (prev + 1) % selectableOptions.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex(prev => (prev - 1 + selectableOptions.length) % selectableOptions.length);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < selectableOptions.length) {
          onChange(selectableOptions[focusedIndex].value);
          setOpen(false);
          triggerRef.current?.focus();
        }
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  }, [open, focusedIndex, selectableOptions, value, onChange]);

  // ── Scroll focused item into view ───────────────────────────────
  useEffect(() => {
    if (!open || focusedIndex < 0 || !menuRef.current) return;
    const items = menuRef.current.querySelectorAll('[role="option"]');
    items[focusedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [focusedIndex, open]);

  const toggle = useCallback(() => {
    if (disabled) return;
    setOpen(prev => {
      if (!prev) {
        const currentIdx = selectableOptions.findIndex(o => o.value === value);
        setFocusedIndex(currentIdx >= 0 ? currentIdx : 0);
      }
      return !prev;
    });
  }, [disabled, selectableOptions, value]);

  // ── Style tokens ────────────────────────────────────────────────
  const isField = variant === 'field';
  const triggerPadding = isField ? '6px 10px' : '2px 6px';
  const triggerBg = isField ? '#000000' : 'transparent';
  const triggerBorder = isField ? `1px solid ${theme.borderLight}` : `1px solid ${theme.border}`;
  const triggerRadius = isField ? 8 : 6;

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-flex' }}>
      {/* ── Trigger Button ──────────────────────────────────────── */}
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        data-testid={testId}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: triggerPadding,
          background: open ? theme.surfaceHover : triggerBg,
          border: triggerBorder,
          borderRadius: triggerRadius,
          color: disabled ? theme.textGhost : (selectedOption ? theme.textMuted : theme.textFaint),
          fontSize,
          fontFamily: theme.fontInter,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          maxWidth: maxWidth ?? 'none',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
          outline: 'none',
          transition: 'background 0.1s, border-color 0.1s',
          ...triggerStyle,
        }}
      >
        {selectedOption?.icon && <span style={{ display: 'flex', flexShrink: 0 }}>{selectedOption.icon}</span>}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {displayLabel}
        </span>
        <svg
          width="8" height="5" viewBox="0 0 8 5" fill="none"
          aria-hidden="true"
          style={{ flexShrink: 0, marginLeft: 2, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
        >
          <path d="M1 1l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* ── Dropdown Menu (portalled to body to escape overflow:hidden) */}
      {open && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          aria-label={ariaLabel}
          onKeyDown={handleKeyDown}
          style={{
            position: 'fixed',
            top: menuCoords.top,
            left: menuCoords.left,
            zIndex: 99999,
            minWidth: menuCoords.minWidth,
            maxHeight: 240,
            overflowY: 'auto',
            background: theme.surfaceRaised,
            borderRadius: 10,
            border: `1px solid ${theme.borderLight}`,
            boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
            padding: '4px 0',
          }}
        >
          {options.map((option, i) =>
            option.separator ? (
              <div
                key={`sep-${i}`}
                style={{ height: 1, margin: '4px 10px', background: theme.borderLight }}
              />
            ) : (
              <button
                key={option.value}
                role="option"
                aria-selected={option.value === value}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)';
                  setFocusedIndex(selectableOptions.indexOf(option));
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background =
                    selectableOptions.indexOf(option) === focusedIndex ? 'rgba(255,255,255,0.05)' : 'none';
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '7px 12px',
                  background: selectableOptions.indexOf(option) === focusedIndex ? 'rgba(255,255,255,0.05)' : 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: option.danger ? theme.danger : theme.textTertiary,
                  fontSize: Math.max(fontSize, 11),
                  fontFamily: theme.fontInter,
                  textAlign: 'left',
                  outline: 'none',
                }}
              >
                {option.icon && <span style={{ display: 'flex', flexShrink: 0 }}>{option.icon}</span>}
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {option.label}
                </span>
                {option.value === value && (
                  <span style={{ fontSize: 9, color: theme.accentBlue, flexShrink: 0 }}>●</span>
                )}
              </button>
            )
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
